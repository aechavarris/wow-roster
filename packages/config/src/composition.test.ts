import { describe, expect, it } from "vitest";
import { computeComposition } from "./composition";
import { resolveProfile } from "./profile";

const forever = resolveProfile("forever");
const coverage = (members: Parameters<typeof computeComposition>[1]) =>
  Object.fromEntries(computeComposition(forever, members).buffs.map((b) => [b.buff.key, b.providers]));

describe("computeComposition", () => {
  it("counts roles, classes and planned members", () => {
    const result = computeComposition(forever, [
      { classId: 1, specKey: "protection", role: "tank", planned: false },
      { classId: 5, specKey: "holy", role: "healer", planned: true },
      { classId: 5, specKey: "shadow", role: "rdps", planned: true },
    ]);
    expect(result).toMatchObject({ total: 3, planned: 2, byRole: { tank: 1, healer: 1, rdps: 1 }, byClass: { 1: 1, 5: 2 } });
  });

  it("requires the spec for talent-based effects", () => {
    expect(coverage([{ classId: 5, specKey: "holy", role: "healer", planned: false }])).toMatchObject({
      fortitude: 1,
      "shadow-weaving": 0,
    });
    expect(coverage([{ classId: 5, specKey: "shadow", role: "rdps", planned: true }])["shadow-weaving"]).toBe(1);
  });

  it("does not count a class-wide buff for an unknown class", () => {
    expect(coverage([{ classId: null, specKey: null, role: null, planned: true }]).fortitude).toBe(0);
  });

  it("tolerates profiles without a buff list", () => {
    const { buffs: _buffs, ...withoutBuffs } = forever;
    expect(computeComposition(withoutBuffs as typeof forever, []).buffs).toEqual([]);
  });

  it("only references class and spec keys that exist in the profile", () => {
    for (const profile of ["forever", "classic-era", "anniversary", "progression", "retail"].map((id) => resolveProfile(id))) {
      for (const buff of profile.buffs) {
        for (const provider of buff.providers) {
          const gameClass = profile.classes.find((c) => c.key === provider.classKey);
          expect(gameClass, `${profile.id}: ${buff.key} -> ${provider.classKey}`).toBeDefined();
          for (const spec of provider.specs ?? []) {
            expect(gameClass!.specs.some((s) => s.key === spec), `${profile.id}: ${buff.key} -> ${spec}`).toBe(true);
          }
        }
      }
    }
  });
});
