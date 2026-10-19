import { describe, expect, it } from "vitest";
import { BIS_TEMPLATE_SOURCES, enabledTemplateSources, parseWowsimsGearSet, type BisTemplateSource } from "./bisSources";

describe("parseWowsimsGearSet", () => {
  it("maps a WoWSims gear array to our slots by position, skipping empty slots", () => {
    // 17 entries in WoWSims slot order; two slots (back, off hand) are empty placeholders.
    const json = {
      items: [
        { id: 12640, enchant: 1506 }, // head
        { id: 18404 }, // neck
        { id: 12927 }, // shoulder
        {}, // back (empty placeholder -> skipped, but keeps the position)
        { id: 11726 }, // chest
        { id: 11764 }, // wrist
        { id: 15062 }, // hands
        { id: 12622 }, // waist
        { id: 11840 }, // legs
        { id: 12427 }, // feet
        { id: 942 }, // finger 1
        { id: 11669 }, // finger 2
        { id: 11815 }, // trinket 1
        { id: 13965 }, // trinket 2
        { id: 12590 }, // main hand
        null, // off hand (null -> skipped)
        { id: 2825 }, // ranged
      ],
    };
    const items = parseWowsimsGearSet(json);
    expect(items).toContainEqual({ slot: "head", itemId: 12640 });
    expect(items).toContainEqual({ slot: "ranged", itemId: 2825 });
    // Both rings map to the same "finger" key; both trinkets to "trinket".
    expect(items.filter((i) => i.slot === "finger").map((i) => i.itemId)).toEqual([942, 11669]);
    expect(items.filter((i) => i.slot === "trinket").map((i) => i.itemId)).toEqual([11815, 13965]);
    // The empty back and null off hand produced no entry; no "back"/"offHand" rows.
    expect(items.some((i) => i.slot === "back")).toBe(false);
    expect(items.some((i) => i.slot === "offHand")).toBe(false);
    // 17 positions minus 2 empty = 15 items.
    expect(items).toHaveLength(15);
  });

  it("returns nothing for malformed input", () => {
    expect(parseWowsimsGearSet(null)).toEqual([]);
    expect(parseWowsimsGearSet({})).toEqual([]);
    expect(parseWowsimsGearSet({ items: "nope" })).toEqual([]);
    expect(parseWowsimsGearSet({ items: [{ id: 0 }, { id: -5 }, {}] })).toEqual([]);
  });
});

describe("enabledTemplateSources", () => {
  const sources: BisTemplateSource[] = [
    { key: "a", name: "A", url: "https://a.example", adapter: "wowsims", enabled: true, gameVersions: ["forever"] },
    { key: "b", name: "B", url: "https://b.example", adapter: "wowsims", enabled: false, gameVersions: ["forever"] },
    { key: "c", name: "C", url: "https://c.example", adapter: "wowsims", enabled: true, gameVersions: ["classic-era"] },
  ];

  it("filters by game version and the source's own enabled flag by default", () => {
    expect(enabledTemplateSources("forever", undefined, sources).map((s) => s.key)).toEqual(["a"]);
    expect(enabledTemplateSources("classic-era", undefined, sources).map((s) => s.key)).toEqual(["c"]);
  });

  it("lets an operator override which keys show (configure which sources to display)", () => {
    // Enabling "b" (off by default) and "a" for Forever; version filter still applies, so "c" never shows here.
    expect(enabledTemplateSources("forever", ["a", "b", "c"], sources).map((s) => s.key)).toEqual(["a", "b"]);
    // An empty allow-list shows nothing.
    expect(enabledTemplateSources("forever", [], sources)).toEqual([]);
  });

  it("ships a Forever source in the default registry", () => {
    expect(enabledTemplateSources("forever").some((s) => s.gameVersions.includes("forever"))).toBe(true);
    // Every seed source has a valid adapter and a link.
    for (const s of BIS_TEMPLATE_SOURCES) {
      expect(s.adapter).toBe("wowsims");
      expect(s.url).toMatch(/^https:\/\//);
    }
  });
});
