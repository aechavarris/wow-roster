import { describe, expect, it } from "vitest";
import { resolveProfile } from "./profile";
import {
  availableProgressEvents,
  crossesThreshold,
  defaultProgressProfessions,
  defaultProgressSettings,
  progressSettingsSchema,
  readProgressSettings,
  selectProgressEvents,
  type ProgressEvent,
} from "./progress";

const retail = resolveProfile("retail");
const era = resolveProfile("classic-era");
const settings = (raw: unknown = {}) => progressSettingsSchema.parse(raw);
const keep = (profile: typeof retail, raw: unknown, events: ProgressEvent[]) => selectProgressEvents(profile, settings(raw), events);

describe("crossesThreshold", () => {
  it("fires when a multiple of `every` is reached or skipped over", () => {
    expect(crossesThreshold(58, 61, { every: 10, at: [] })).toBe(true);
    expect(crossesThreshold(61, 69, { every: 10, at: [] })).toBe(false);
    expect(crossesThreshold(69, 70, { every: 10, at: [] })).toBe(true);
  });

  it("fires on exact values from the list, only when moving up", () => {
    expect(crossesThreshold(240, 251, { every: null, at: [250, 300] })).toBe(true);
    expect(crossesThreshold(251, 299, { every: null, at: [250, 300] })).toBe(false);
    expect(crossesThreshold(300, 250, { every: null, at: [250] })).toBe(false);
  });

  it("never fires without a rule", () => {
    expect(crossesThreshold(0, 1000, { every: null, at: [] })).toBe(false);
  });
});

describe("settings", () => {
  it("fills every block with defaults", () => {
    expect(defaultProgressSettings()).toEqual({
      level: { every: 10, at: [], atMax: true },
      itemLevel: { every: 10, at: [] },
      mythicRating: { every: 250, at: [] },
      mythicPlus: { minKey: 10 },
      profession: { every: null, at: [], professions: null, atMax: true, onLearn: false },
      reputation: { standings: ["honored", "revered", "exalted"], renown: { every: 5, at: [] }, friendship: false },
    });
  });

  it("keeps given values and defaults the rest", () => {
    expect(settings({ level: { every: 5 } }).level).toEqual({ every: 5, at: [], atMax: true });
  });

  it("falls back to defaults when stored settings are invalid", () => {
    expect(readProgressSettings({ level: { every: -3 } })).toEqual(defaultProgressSettings());
    expect(readProgressSettings(null)).toEqual(defaultProgressSettings());
  });
});

describe("selectProgressEvents", () => {
  it("announces levels at the configured steps and at the cap", () => {
    expect(keep(era, {}, [{ type: "level_up", from: 41, value: 42 }])).toEqual([]);
    expect(keep(era, {}, [{ type: "level_up", from: 49, value: 50 }])).toHaveLength(1);
    // The cap (60) is announced even when "every" would skip it.
    expect(keep(era, { level: { every: 25 } }, [{ type: "level_up", from: 59, value: 60 }])).toHaveLength(1);
    expect(keep(era, { level: { every: null, atMax: false } }, [{ type: "level_up", from: 59, value: 60 }])).toEqual([]);
  });

  it("announces item level and rating on their thresholds", () => {
    expect(keep(retail, { itemLevel: { every: 100 } }, [{ type: "item_level", from: 280, value: 301 }])).toHaveLength(1);
    expect(keep(retail, { itemLevel: { every: null, at: [285, 290] } }, [{ type: "item_level", from: 280, value: 284 }])).toEqual([]);
    expect(keep(retail, {}, [{ type: "mythic_rating", from: 2490, value: 2510 }])).toHaveLength(1);
  });

  it("announces best keys from the minimum level", () => {
    expect(keep(retail, {}, [{ type: "mythic_plus", from: 8, value: 9 }])).toEqual([]);
    expect(keep(retail, {}, [{ type: "mythic_plus", from: 9, value: 10 }])).toHaveLength(1);
  });

  it("only announces the selected professions (crafting ones by default)", () => {
    const mining = era.professions.find((p) => p.key === "mining")!;
    const tailoring = era.professions.find((p) => p.key === "tailoring")!;
    const capped = (id: number): ProgressEvent => ({ type: "profession", professionId: id, from: 290, value: 300, cap: 300 });
    expect(defaultProgressProfessions(era)).not.toContain("mining");
    expect(defaultProgressProfessions(era)).not.toContain("first-aid");
    expect(keep(era, {}, [capped(mining.id)])).toEqual([]);
    expect(keep(era, {}, [capped(tailoring.id)])).toHaveLength(1);
    expect(keep(era, { profession: { professions: ["mining"] } }, [capped(mining.id)])).toHaveLength(1);
  });

  it("announces profession steps and learning only when asked", () => {
    const tailoring = era.professions.find((p) => p.key === "tailoring")!.id;
    const learned: ProgressEvent = { type: "profession", professionId: tailoring, from: 0, value: 1, cap: 300 };
    const step: ProgressEvent = { type: "profession", professionId: tailoring, from: 140, value: 152, cap: 300 };
    expect(keep(era, {}, [learned, step])).toEqual([]);
    expect(keep(era, { profession: { onLearn: true, every: 75 } }, [learned, step])).toEqual([learned, step]);
  });

  it("filters reputation by ladder: standings, renown steps and friendship", () => {
    const standard = (standingKey: string): ProgressEvent => ({ type: "reputation", reputation: { kind: "standard", standingKey } });
    expect(keep(retail, {}, [standard("friendly")])).toEqual([]);
    expect(keep(retail, {}, [standard("revered")])).toHaveLength(1);
    expect(keep(retail, { reputation: { standings: ["friendly"] } }, [standard("friendly")])).toHaveLength(1);
    expect(keep(retail, {}, [{ type: "reputation", from: 9, value: 10, reputation: { kind: "renown" } }])).toHaveLength(1);
    expect(keep(retail, {}, [{ type: "reputation", from: 10, value: 11, reputation: { kind: "renown" } }])).toEqual([]);
    const friend: ProgressEvent = { type: "reputation", reputation: { kind: "friendship" } };
    expect(keep(retail, {}, [friend])).toEqual([]);
    expect(keep(retail, { reputation: { friendship: true } }, [friend])).toHaveLength(1);
  });
});

describe("availableProgressEvents", () => {
  it("only offers what the version's data supports", () => {
    expect(availableProgressEvents(retail)).toContain("mythic_plus");
    expect(availableProgressEvents(era)).not.toContain("mythic_plus");
    expect(availableProgressEvents(era)).not.toContain("mythic_rating");
    expect(availableProgressEvents(era)).toContain("reputation");
  });

  it("every version's reputation ladder is the standard eight standings", () => {
    for (const id of ["retail", "classic-era", "anniversary", "progression", "forever"]) {
      expect(resolveProfile(id).reputation.standings.map((s) => s.tier)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
    expect(resolveProfile("retail").reputation).toMatchObject({ friendship: true, renown: true });
    expect(resolveProfile("progression").reputation).toMatchObject({ friendship: true, renown: false });
    expect(resolveProfile("classic-era").reputation).toMatchObject({ friendship: false, renown: false });
  });
});
