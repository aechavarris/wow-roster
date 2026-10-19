import { describe, expect, it } from "vitest";
import { WowheadClient, parseWowheadXml } from "./wowhead";

// A representative &xml item page: <level> is the item level, reqlevel and source live in the <json> block.
const ITEM_XML = `<?xml version="1.0" encoding="UTF-8"?><wowhead><item id="19019">` +
  `<name><![CDATA[Thunderfury, Blessed Blade of the Windseeker]]></name><level>80</level>` +
  `<quality id="5">Legendary</quality><class id="2"><![CDATA[Weapons]]></class>` +
  `<subclass id="7"><![CDATA[One-Handed Swords]]></subclass><icon displayId="30606">inv_sword_39</icon>` +
  `<inventorySlot id="13">One-Hand</inventorySlot><htmlTooltip><![CDATA[<table>Thunderfury</table>]]></htmlTooltip>` +
  `<json><![CDATA["classs":2,"id":19019,"level":80,"quality":5,"reqlevel":60,"slot":13,"source":[4]]]></json>` +
  `<link>https://www.wowhead.com/classic/item=19019/thunderfury</link></item></wowhead>`;

describe("Wowhead XML parsing", () => {
  it("reads item level, required level and source codes from the &xml page", () => {
    const entity = parseWowheadXml(ITEM_XML, "item", 19019, "https://www.wowhead.com/classic/item=19019");
    expect(entity).toEqual({
      type: "item",
      id: 19019,
      name: "Thunderfury, Blessed Blade of the Windseeker",
      itemLevel: 80,
      reqLevel: 60,
      quality: 5,
      qualityName: "Legendary",
      icon: "inv_sword_39",
      className: "Weapons",
      subclassName: "One-Handed Swords",
      slot: "One-Hand",
      sourceCodes: [4],
      tooltipHtml: "<table>Thunderfury</table>",
      url: "https://www.wowhead.com/classic/item=19019/thunderfury",
    });
  });

  it("returns undefined when the page has no block of that type", () => {
    expect(parseWowheadXml("<wowhead></wowhead>", "item", 1, "u")).toBeUndefined();
  });
});

describe("WowheadClient", () => {
  const fakeFetch = (routes: Record<string, string>): typeof fetch =>
    (async (input: string | URL) => {
      const body = routes[input.toString()];
      return body === undefined ? new Response("", { status: 404 }) : new Response(body);
    }) as typeof fetch;

  it("builds the per-domain &xml URL and parses the item", async () => {
    const client = new WowheadClient({ fetch: fakeFetch({ "https://www.wowhead.com/classic/item=19019&xml": ITEM_XML }) });
    const entity = await client.entity("item", 19019, "classic");
    expect(entity).toMatchObject({ name: "Thunderfury, Blessed Blade of the Windseeker", reqLevel: 60, sourceCodes: [4] });
  });

  it("returns undefined for an unknown entity (404)", async () => {
    expect(await new WowheadClient({ fetch: fakeFetch({}) }).entity("item", 1, "")).toBeUndefined();
  });
});
