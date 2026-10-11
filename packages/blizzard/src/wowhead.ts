/**
 * Wowhead client (prototype). Wowhead has no official API, so this reads its public endpoints and parses them:
 *   - by id: the `&xml` page (`https://www.wowhead.com/<domain>/item=19019&xml`), a stable, structured format many
 *     community tools rely on;
 *   - by name: the search page, pulling the item/quest/… rows out of the embedded `new Listview({ data: [...] })`.
 *
 * It is unofficial and can break if Wowhead changes its markup, so every parse is defensive and failures degrade to
 * "nothing found" rather than throwing. The game version chooses the domain (classic, tbc, mop-classic, forever, or
 * "" for retail), because item ids and data differ per version. `fetch` is injectable for tests.
 */

export type WowheadType = "item" | "quest" | "npc" | "zone" | "object" | "spell" | "achievement";

/** Entity types the search and the by-id lookup understand, with the Listview template name Wowhead uses. */
export const WOWHEAD_TYPES: WowheadType[] = ["item", "quest", "npc", "zone", "object", "spell", "achievement"];

/** One entity looked up by id from the `&xml` page. Fields are best-effort: not every type carries every field. */
export interface WowheadEntity {
  type: WowheadType;
  id: number;
  name?: string;
  /** Required level for an item, or the level of a quest/npc, as Wowhead's `<level>` reports it. */
  level?: number;
  /** Item quality id (0 poor … 5 legendary, 7 heirloom). */
  quality?: number;
  qualityName?: string;
  /** Icon name (without extension), the same the tooltip widget uses. */
  icon?: string;
  className?: string;
  subclassName?: string;
  slot?: string;
  tooltipHtml?: string;
  /** Canonical Wowhead page for this entity on this domain. */
  url: string;
}

/** One row from a name search, before a full lookup. */
export interface WowheadSearchResult {
  type: WowheadType;
  id: number;
  name: string;
  quality?: number;
  level?: number;
}

/** Wowhead answered with an error status, or (404) does not know the entity. */
export class WowheadError extends Error {
  constructor(readonly status: number, detail?: string) {
    super(`Wowhead responded ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "WowheadError";
  }
  get notFound() {
    return this.status === 404;
  }
}

/** Inner text of the first `<tag>…</tag>`, unwrapping a CDATA section; undefined when the tag is absent. */
function tagText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return undefined;
  const raw = match[1]!.trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  const value = (cdata ? cdata[1]! : raw).trim();
  return value.length > 0 ? value : undefined;
}

/** A numeric attribute of the first `<tag …>` (e.g. the id on `<quality id="5">`). */
function tagAttr(xml: string, tag: string, attr: string): number | undefined {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}="(\\d+)"`, "i"));
  return match ? Number(match[1]) : undefined;
}

const toInt = (v: string | undefined): number | undefined => (v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined);

/** Parses one `<item|quest|…>` block of a Wowhead `&xml` page into a WowheadEntity. */
export function parseWowheadXml(xml: string, type: WowheadType, id: number, url: string): WowheadEntity | undefined {
  const block = xml.match(new RegExp(`<${type}\\b[\\s\\S]*?</${type}>`, "i"))?.[0];
  if (!block) return undefined;
  return {
    type,
    id,
    name: tagText(block, "name"),
    level: toInt(tagText(block, "level")),
    quality: tagAttr(block, "quality", "id"),
    qualityName: tagText(block, "quality"),
    icon: tagText(block, "icon")?.toLowerCase(),
    className: tagText(block, "class"),
    subclassName: tagText(block, "subclass"),
    slot: tagText(block, "inventorySlot"),
    tooltipHtml: tagText(block, "htmlTooltip"),
    url: tagText(block, "link") ?? url,
  };
}

/** The `data: [ … ]` array literal after `position` in `source`, matched by balancing its brackets. */
function sliceJsonArray(source: string, from: number): string | undefined {
  const start = source.indexOf("[", from);
  if (start === -1) return undefined;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return source.slice(start, i + 1);
  }
  return undefined;
}

/**
 * Pulls search rows out of the `new Listview({ template: 'item', …, data: [ … ] })` blocks Wowhead embeds in its
 * search page. Each block is one entity type; the data array holds its rows. Unknown templates and unparsable
 * blocks are skipped, so a markup change loses rows rather than breaking.
 */
export function parseWowheadListviews(html: string, limitPerType = 20): WowheadSearchResult[] {
  const results: WowheadSearchResult[] = [];
  const templates = new Map(WOWHEAD_TYPES.map((t) => [t, t] as const));
  const re = /new\s+Listview\(\{([\s\S]*?)data:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const head = m[1]!;
    const template = head.match(/template:\s*['"]([a-z-]+)['"]/i)?.[1];
    const type = template && templates.get(template as WowheadType);
    if (!type) continue;
    const arrayText = sliceJsonArray(html, re.lastIndex - 1);
    if (!arrayText) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(arrayText);
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const row of rows.slice(0, limitPerType)) {
      const r = row as { id?: unknown; name?: unknown; quality?: unknown; level?: unknown };
      if (typeof r.id !== "number" || typeof r.name !== "string") continue;
      results.push({
        type,
        id: r.id,
        // Item names in the listview can carry a leading quality marker; strip control chars.
        name: r.name.replace(/[\u0000-\u001f]/g, "").trim(),
        quality: typeof r.quality === "number" ? r.quality : undefined,
        level: typeof r.level === "number" ? r.level : undefined,
      });
    }
  }
  return results;
}

/** Reads Wowhead's public pages for a game version's domain. Unofficial; see the file header. */
export class WowheadClient {
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(options: { fetch?: typeof fetch; userAgent?: string } = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    // A descriptive UA so Wowhead can see who is calling; polite scraping needs identification.
    this.userAgent = options.userAgent ?? "wow-roster (+https://github.com/aechavarris/wow-roster)";
  }

  /** Base URL for a game version's Wowhead domain ("" retail, "classic", "tbc", "mop-classic", "forever"…). */
  private base(domain: string): string {
    return `https://www.wowhead.com${domain ? `/${domain}` : ""}`;
  }

  private async get(url: string): Promise<string> {
    const response = await this.fetchImpl(url, {
      headers: { "User-Agent": this.userAgent, Accept: "text/html,application/xml" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new WowheadError(response.status);
    return response.text();
  }

  /** One entity by id from the `&xml` page; undefined when Wowhead does not know it. */
  async entity(type: WowheadType, id: number, domain = ""): Promise<WowheadEntity | undefined> {
    const url = `${this.base(domain)}/${type}=${id}`;
    let xml: string;
    try {
      xml = await this.get(`${url}&xml`);
    } catch (error) {
      if (error instanceof WowheadError && error.notFound) return undefined;
      throw error;
    }
    return parseWowheadXml(xml, type, id, url);
  }

  /** Name search across the version's database; returns rows (id, name, type) to then look up in full. */
  async search(query: string, domain = "", opts: { limitPerType?: number } = {}): Promise<WowheadSearchResult[]> {
    const html = await this.get(`${this.base(domain)}/search?q=${encodeURIComponent(query)}`);
    return parseWowheadListviews(html, opts.limitPerType);
  }

  /**
   * Items from Wowhead's item database (the "item finder"), narrowed by one of its filter strings. The finder UI
   * builds that string and shows it in the URL after `?filter=` (e.g. required-level range, slot, quality, source);
   * pass it through verbatim and the parsed rows come back. This is how the BiS picker can get the source/level
   * filtering Blizzard's Classic API lacks.
   */
  async itemsByFilter(filter: string, domain = "", opts: { limitPerType?: number } = {}): Promise<WowheadSearchResult[]> {
    const html = await this.get(`${this.base(domain)}/items?filter=${filter}`);
    return parseWowheadListviews(html, opts.limitPerType ?? 200);
  }
}
