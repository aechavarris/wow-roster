import { describe, expect, it } from "vitest";
import { resolveProfile } from "./profile";
import { computeStatPanel } from "./stats";

// Values taken from a real retail /statistics response (holy paladin).
const retailStats = {
  health: 529620,
  strength: { base: 617, effective: 641 },
  agility: { base: 218, effective: 218 },
  intellect: { base: 622, effective: 2253 },
  stamina: { base: 4600, effective: 26481 },
  armor: { base: 0, effective: 3100 },
  melee_crit: { value: 21.17, rating: 514, ratingBonus: 11.17 },
  ranged_crit: { value: 21.17, rating: 514 },
  spell_crit: { value: 21.17, rating: 514 },
  melee_haste: { value: 16.45, rating: 480 },
  spell_haste: { value: 16.45, rating: 480 },
  mastery: { value: 59.7, rating: 1049 },
  versatility: 325,
  versatility_damage_done_bonus: 6.02,
  lifesteal: { value: 0, rating: 0 },
  avoidance: { rating: 0 },
  speed: { rating: 0 },
};

describe("computeStatPanel", () => {
  it("follows the retail character sheet: attributes then enhancements", () => {
    const panel = computeStatPanel(resolveProfile("retail-dev").statPanel, retailStats);
    expect(panel.map((s) => s.key)).toEqual(["attributes", "enhancements"]);
    expect(panel[0]!.rows.map((r) => [r.label.en, r.value, r.base])).toEqual([
      ["Intellect", 2253, 622],
      ["Stamina", 26481, 4600],
      ["Armor", 3100, undefined],
    ]);
    expect(panel[1]!.rows.map((r) => [r.key, r.value, r.rating])).toEqual([
      ["crit", 21.17, 514],
      ["haste", 16.45, 480],
      ["mastery", 59.7, 1049],
      ["versatility", 6.02, 325],
    ]);
  });

  it("skips rows the API does not report (Classic panel against retail data)", () => {
    const panel = computeStatPanel(resolveProfile("forever").statPanel, retailStats);
    expect(panel.find((s) => s.key === "resistances")).toBeUndefined();
    expect(panel.find((s) => s.key === "base")!.rows.map((r) => r.key)).toEqual(["strength", "agility", "stamina", "intellect", "armor"]);
  });
});
