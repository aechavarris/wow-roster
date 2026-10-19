/**
 * Wowhead client (prototype). Wowhead has no official API, so this reads an entity by id from its public `&xml`
 * page (`https://www.wowhead.com/<domain>/item=19019&xml`): `<level>` is the item level; the required level, the
 * item's `source` codes and its stats live in the `<json>`/`<jsonEquip>` blocks. It resolves an imported BiS item
 * id to a name/icon/quality for the saved list and tooltips. (The item *finder* was removed: Wowhead serves it
 * behind a Cloudflare challenge that 403s every server-side request; BiS lists are imported instead of searched.)
 *
 * It is unofficial and can break if Wowhead changes its markup, so every parse is defensive and degrades to
 * "nothing found" rather than throwing. The game version only chooses the domain (classic, tbc, mop-classic,
 * forever, or "" for retail), because item ids and data differ per version. `fetch` is injectable for tests.
 */

export type WowheadType = "item" | "quest" | "npc" | "zone" | "object" | "spell" | "achievement";

/** Entity types understood by the by-id lookup. */
export const WOWHEAD_TYPES: WowheadType[] = ["item", "quest", "npc", "zone", "object", "spell", "achievement"];

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
}
