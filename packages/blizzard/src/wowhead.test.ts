import { describe, expect, it } from "vitest";
import { WowheadClient, parseWowheadListviews, parseWowheadXml } from "./wowhead";

// A representative &xml item page (trimmed to the fields the parser reads).
const ITEM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<wowhead>
  <item id="19019">
    <name><![CDATA[Thunderfury, Blessed Blade of the Windseeker]]></name>
    <level>60</level>
    <quality id="5">Legendary</quality>
    <class id="2"><![CDATA[Weapon]]></class>
    <subclass id="7"><![CDATA[One-Handed Swords]]></subclass>
    <icon displayId="30606">INV_Sword_39</icon>
    <inventorySlot id="13">One-Hand</inventorySlot>
    <htmlTooltip><![CDATA[<table><tr><td>Thunderfury</td></tr></table>]]></htmlTooltip>
    <link>https://www.wowhead.com/classic/item=19019</link>
  </item>
</wowhead>`;

// A search page with two Listview blocks (items, quests); the parser pulls rows from each.
const SEARCH_HTML = `<script>
new Listview({template: 'item', id: 'items', name: 'Items', data: [
  {"id":19019,"name":"Thunderfury, Blessed Blade of the Windseeker","quality":5,"level":60},
  {"id":1234,"name":"Some Sword","quality":3,"level":40}
]});
new Listview({template: 'quest', id: 'quests', data: [
  {"id":7761,"name":"Thunderfury, Blessed Blade of the Windseeker","level":60}
]});
new Listview({template: 'spell', id: 'spells', data: [{"name":"no id here"}]});
</script>`;

describe("Wowhead XML parsing", () => {
  it("reads an item's fields from its &xml page, unwrapping CDATA and attributes", () => {
    const entity = parseWowheadXml(ITEM_XML, "item", 19019, "https://www.wowhead.com/classic/item=19019");
    expect(entity).toEqual({
      type: "item",
      id: 19019,
      name: "Thunderfury, Blessed Blade of the Windseeker",
      level: 60,
      quality: 5,
      qualityName: "Legendary",
      icon: "inv_sword_39",
      className: "Weapon",
      subclassName: "One-Handed Swords",
      slot: "One-Hand",
      tooltipHtml: "<table><tr><td>Thunderfury</td></tr></table>",
      url: "https://www.wowhead.com/classic/item=19019",
    });
  });

  it("returns undefined when the page has no block of that type", () => {
    expect(parseWowheadXml("<wowhead></wowhead>", "item", 1, "u")).toBeUndefined();
  });
});

describe("Wowhead search listview parsing", () => {
  it("extracts rows per entity type and skips rows without an id", () => {
    const results = parseWowheadListviews(SEARCH_HTML);
    expect(results).toEqual([
      { type: "item", id: 19019, name: "Thunderfury, Blessed Blade of the Windseeker", quality: 5, level: 60 },
      { type: "item", id: 1234, name: "Some Sword", quality: 3, level: 40 },
      { type: "quest", id: 7761, name: "Thunderfury, Blessed Blade of the Windseeker", quality: undefined, level: 60 },
    ]);
  });

  it("degrades to nothing when the markup is not what it expects", () => {
    expect(parseWowheadListviews("<html>no listviews here</html>")).toEqual([]);
  });
});

describe("WowheadClient", () => {
  const fakeFetch = (routes: Record<string, { status?: number; body: string }>): typeof fetch =>
    (async (input: string | URL) => {
      const url = input.toString();
      const route = routes[url];
      if (!route) return new Response("", { status: 404 });
      return new Response(route.body, { status: route.status ?? 200 });
    }) as typeof fetch;

  it("builds the per-domain &xml URL and parses the item", async () => {
    const client = new WowheadClient({ fetch: fakeFetch({ "https://www.wowhead.com/classic/item=19019&xml": { body: ITEM_XML } }) });
    const entity = await client.entity("item", 19019, "classic");
    expect(entity?.name).toBe("Thunderfury, Blessed Blade of the Windseeker");
    expect(entity?.quality).toBe(5);
  });

  it("returns undefined for an unknown entity (404) and uses no domain for retail", async () => {
    const client = new WowheadClient({ fetch: fakeFetch({}) });
    expect(await client.entity("item", 1, "")).toBeUndefined();
  });

  it("searches by name through the search page", async () => {
    const client = new WowheadClient({ fetch: fakeFetch({ "https://www.wowhead.com/classic/search?q=thunderfury": { body: SEARCH_HTML } }) });
    const results = await client.search("thunderfury", "classic");
    expect(results.map((r) => `${r.type}:${r.id}`)).toEqual(["item:19019", "item:1234", "quest:7761"]);
  });

  it("queries the item finder with a filter string", async () => {
    const client = new WowheadClient({
      fetch: fakeFetch({ "https://www.wowhead.com/classic/items?filter=minle=10;maxle=30": { body: SEARCH_HTML } }),
    });
    const items = await client.itemsByFilter("minle=10;maxle=30", "classic");
    expect(items.some((r) => r.id === 19019)).toBe(true);
  });
});
