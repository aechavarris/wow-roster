/**
 * Wowhead client (prototype). Wowhead has no official API, so this reads its public pages and parses them. Two
 * shapes, both confirmed against live pages:
 *   - by id: the `&xml` page (`https://www.wowhead.com/<domain>/item=19019&xml`). `<level>` is the item level; the
 *     required level, the item's `source` codes and its stats live in the `<json>`/`<jsonEquip>` blocks.
 *   - lists (name search and the "item finder"): the database pages carry a `var listview<type> = [ … ]` array of
 *     rows ({id, name, quality, level, reqlevel, source, …}). Some keys are unquoted, so the rows are read field by
 *     field, not JSON.parsed. The search page itself registers its rows indirectly, so a name search is run as the
 *     finder query `?filter=na=<name>`, which returns the same listview array.
 *
 * It is unofficial and can break if Wowhead changes its markup, so every parse is defensive and degrades to
 * "nothing found" rather than throwing. The game version only chooses the domain (classic, tbc, mop-classic,
 * forever, or "" for retail), because item ids and data differ per version. `fetch` is injectable for tests.
 */

export type WowheadType = "item" | "quest" | "npc" | "zone" | "object" | "spell" | "achievement";

/** Entity types understood by the by-id lookup and the database lists, with the plural used in finder URLs. */
export const WOWHEAD_TYPES: WowheadType[] = ["item", "quest", "npc", "zone", "object", "spell", "achievement"];
const PLURAL: Record<WowheadType, string> = {
  item: "items",
  quest: "quests",
  npc: "npcs",
  zone: "zones",
  object: "objects",
  spell: "spells",
  achievement: "achievements",
};

/**
 * Wowhead's numeric `source` codes, as they appear on item rows. Confirmed from live data (quest 4, vendor 5…);
 * the rest are Wowhead's well-known values. Dungeon and raid drops are both "drop" (2) with the boss named in the
 * item's `sourcemore`, so they are not distinguishable from this code alone — the finder's own filter separates
 * them server-side.
 */
export const WOWHEAD_SOURCE: Record<number, string> = {
  1: "crafted",
  2: "drop",
  3: "pvp",
  4: "quest",
  5: "vendor",
  6: "quest", // "starting" / quest-given in some datasets
  7: "achievement",
  10: "gathered",
  12: "fished",
  16: "vendor",
};

/** One entity looked up by id from the `&xml` page. Fields are best-effort: not every type carries every field. */
export interface WowheadEntity {
  type: WowheadType;
  id: number;
  name?: string;
  /** Item level, from the page's `<level>` tag. */
  itemLevel?: number;
  /** Required character level, from the `<json>` block's `reqlevel`. */
  reqLevel?: number;
  /** Item quality id (0 poor … 5 legendary, 7 heirloom). */
  quality?: number;
  qualityName?: string;
  icon?: string;
  className?: string;
  subclassName?: string;
  slot?: string;
  /** Wowhead `source` type codes (see WOWHEAD_SOURCE); [4] = quest, [2] = a drop, etc. */
  sourceCodes: number[];
  tooltipHtml?: string;
  url: string;
}

/** One row from a database list (name search or the item finder). */
export interface WowheadSearchResult {
  type: WowheadType;
  id: number;
  name: string;
  quality?: number;
  itemLevel?: number;
  reqLevel?: number;
  sourceCodes: number[];
  /** Numeric ids from an item row (Blizzard enums), for filtering: inventory slot, item class and subclass. */
  slotId?: number;
  classId?: number;
  subclassId?: number;
  /** Icon name (e.g. "inv_sword_39"), to build the icon URL; absent when the row has no icon field. */
  icon?: string;
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

const toInt = (v: string | undefined): number | undefined => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : undefined);
const codes = (csv: string | undefined): number[] => (csv ? csv.split(",").filter(Boolean).map(Number) : []);

/** Inner text of the first `<tag>…</tag>`, unwrapping a CDATA section; undefined when the tag is absent. */
function tagText(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return undefined;
  const raw = match[1]!.trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  const value = (cdata ? cdata[1]! : raw).trim();
  return value.length > 0 ? value : undefined;
}

/** Parses one `<item>` block of a Wowhead `&xml` page into a WowheadEntity (other types reuse the shared fields). */
export function parseWowheadXml(xml: string, type: WowheadType, id: number, url: string): WowheadEntity | undefined {
  const block = xml.match(new RegExp(`<${type}\\b[\\s\\S]*?</${type}>`, "i"))?.[0];
  if (!block) return undefined;
  const json = tagText(block, "json") ?? "";
  return {
    type,
    id,
    name: tagText(block, "name"),
    itemLevel: toInt(tagText(block, "level")),
    reqLevel: toInt(json.match(/"reqlevel":(\d+)/)?.[1]),
    quality: toInt(block.match(/<quality\b[^>]*\bid="(\d+)"/i)?.[1]),
    qualityName: tagText(block, "quality"),
    icon: tagText(block, "icon")?.toLowerCase(),
    className: tagText(block, "class"),
    subclassName: tagText(block, "subclass"),
    slot: tagText(block, "inventorySlot"),
    sourceCodes: codes(json.match(/"source":\[([0-9,]*)\]/)?.[1]),
    tooltipHtml: tagText(block, "htmlTooltip"),
    url: tagText(block, "link") ?? url,
  };
}

/** The array literal starting at the first `[` on or after `from`, matched by balancing brackets (string-aware). */
function sliceArray(src: string, from: number): string | undefined {
  const start = src.indexOf("[", from);
  if (start === -1) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return src.slice(start, i + 1);
  }
  return undefined;
}

/** Splits a `[ {…}, {…} ]` array literal into its top-level object chunks (string- and nesting-aware). */
function splitObjects(arrayText: string): string[] {
  const inner = arrayText.slice(1, -1);
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth++ === 0) start = i;
    } else if (ch === "}") {
      if (--depth === 0) out.push(inner.slice(start, i + 1));
    }
  }
  return out;
}

/**
 * Rows from the `var listview<type> = [ … ]` arrays of a search/finder page. Each object is read field by field
 * because Wowhead mixes unquoted keys (`popularity:88`) into otherwise-JSON objects. Rows without an id or name
 * are skipped, so a markup change loses rows rather than breaking.
 *
 * A page can embed several such arrays: the item finder grouped by slot (`/items/…/group-by:slot`) emits one per
 * slot tab, and surfaces off-hand frills (shields, held-in-off-hand) that the flat, popularity-capped single-array
 * page drops. So every `var listview… = […]` array is read and concatenated, de-duplicated by id, up to `limit`.
 */
export function parseWowheadListview(html: string, type: WowheadType, limit = 200): WowheadSearchResult[] {
  const results: WowheadSearchResult[] = [];
  const seen = new Set<number>();
  const marker = /var\s+listview\w+\s*=/g;
  for (let m = marker.exec(html); m; m = marker.exec(html)) {
    const arrayText = sliceArray(html, m.index + m[0].length);
    if (!arrayText) continue;
    for (const obj of splitObjects(arrayText)) {
      const id = toInt(obj.match(/"id":(\d+)/)?.[1]);
      const name = obj.match(/"name":"((?:[^"\\]|\\.)*)"/)?.[1];
      if (id === undefined || name === undefined || seen.has(id)) continue;
      seen.add(id);
      results.push({
        type,
        id,
        name: name.replace(/\\(.)/g, "$1"),
        quality: toInt(obj.match(/"quality":(\d+)/)?.[1]),
        itemLevel: toInt(obj.match(/"level":(\d+)/)?.[1]),
        reqLevel: toInt(obj.match(/"reqlevel":(\d+)/)?.[1]),
        sourceCodes: codes(obj.match(/"source":\[([0-9,]*)\]/)?.[1]),
        slotId: toInt(obj.match(/"slot":(\d+)/)?.[1]),
        classId: toInt(obj.match(/"classs":(\d+)/)?.[1]),
        subclassId: toInt(obj.match(/"subclass":(\d+)/)?.[1]),
        icon: obj.match(/"icon":"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\(.)/g, "$1").toLowerCase(),
      });
      if (results.length >= limit) return results;
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

  /**
   * Rows from a database list page (`/<plural>?filter=…`), parsed from its `var listview…` array. This is the
   * engine behind both the name search and the item finder.
   */
  async list(type: WowheadType, filter: string, domain = "", opts: { limit?: number } = {}): Promise<WowheadSearchResult[]> {
    const html = await this.get(`${this.base(domain)}/${PLURAL[type]}?filter=${filter}`);
    return parseWowheadListview(html, type, opts.limit);
  }

  /** Name search for one entity type, run as the finder query `?filter=na=<query>`. */
  async search(query: string, domain = "", opts: { type?: WowheadType; limit?: number } = {}): Promise<WowheadSearchResult[]> {
    return this.list(opts.type ?? "item", `na=${encodeURIComponent(query)}`, domain, opts);
  }

  /**
   * Items from Wowhead's item database (the "item finder"), narrowed by one of its filter strings. The finder UI
   * builds that string and shows it in the URL after `?filter=` (required-level range, slot, quality, source…);
   * pass it through verbatim. This is how the BiS picker can get the source/level filtering Blizzard's Classic API
   * lacks.
   */
  async itemsByFilter(filter: string, domain = "", opts: { limit?: number } = {}): Promise<WowheadSearchResult[]> {
    return this.list("item", filter, domain, opts);
  }

  /**
   * Items from the database list narrowed by Wowhead's current **path-facet** URLs, e.g.
   * `/<domain>/items/min-req-level:31/max-req-level:40`. Wowhead moved the finder filters from the old `?filter=`
   * query string to path segments (`facet:value`); the query form is now ignored, which is why a level filter sent
   * that way returned a popularity sample instead of the requested range. Each facet is a `name:value` string, URL
   * safe. The matching rows are embedded in the page's listview, parsed as usual.
   */
  async itemsByFacets(facets: string[], domain = "", opts: { limit?: number } = {}): Promise<WowheadSearchResult[]> {
    const path = facets.map((f) => `/${f}`).join("");
    const html = await this.get(`${this.base(domain)}/${PLURAL.item}${path}`);
    return parseWowheadListview(html, "item", opts.limit);
  }
}
