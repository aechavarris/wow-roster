import { describe, expect, it } from "vitest";
import {
  normalizeEquipment,
  normalizeGuildRoster,
  normalizeMedia,
  normalizeSpecializations,
  normalizeStatistics,
  normalizeSummary,
} from "./normalize";

describe("normalizeSummary", () => {
  it("maps the retail summary payload", () => {
    const summary = normalizeSummary({
      id: 42,
      name: "Thrall",
      level: 60,
      realm: { slug: "los-errantes", name: "Los Errantes" },
      character_class: { id: 7, name: "Shaman" },
      race: { id: 2, name: "Orc" },
      faction: { type: "HORDE" },
      active_spec: { id: 263, name: "Enhancement" },
      guild: { name: "Horda Eterna", realm: { slug: "los-errantes" } },
      equipped_item_level: 75,
      last_login_timestamp: 1_760_000_000_000,
    });
    expect(summary).toMatchObject({
      blizzardId: 42,
      realmSlug: "los-errantes",
      classId: 7,
      activeSpec: { id: 263, name: "Enhancement" },
      guild: { name: "Horda Eterna" },
      equippedItemLevel: 75,
    });
    expect(summary.lastLoginAt).toMatch(/^2025-/);
  });

  it("accepts names localized as objects", () => {
    expect(normalizeSummary({ id: 1, name: { en_US: "Jaina", es_ES: "Jaina" } }).name).toBe("Jaina");
  });
});

describe("normalizeEquipment", () => {
  it("extracts enchants and gems", () => {
    const [item] = normalizeEquipment({
      equipped_items: [
        {
          slot: { type: "HEAD", name: "Head" },
          item: { id: 16866 },
          name: "Helm of Ten Storms",
          quality: { type: "EPIC" },
          level: { value: 76 },
          enchantments: [{ enchantment_id: 2583, display_string: "Enchanted: +10 Stamina", enchantment_slot: { type: "PERMANENT" } }],
          sockets: [{ item: { id: 1 }, display_string: "+5 Stamina" }, {}],
          set: { item_set: { name: "The Ten Storms" } },
        },
      ],
    });
    expect(item).toMatchObject({
      slot: "HEAD",
      itemId: 16866,
      itemLevel: 76,
      setName: "The Ten Storms",
      enchantments: [{ id: 2583, text: "Enchanted: +10 Stamina" }],
      gems: [{ itemId: 1, text: "+5 Stamina" }],
    });
  });
});

describe("normalizeSpecializations", () => {
  it("handles Classic dual-spec groups with three trees", () => {
    const setups = normalizeSpecializations({
      specialization_groups: [
        {
          is_active: true,
          specializations: [
            { specialization_name: "Elemental", spent_points: 0, talents: [] },
            {
              specialization_name: "Enhancement",
              spent_points: 31,
              talents: [{ talent: { id: 10 }, spell_tooltip: { spell: { id: 99, name: "Stormstrike" } }, talent_rank: 1 }],
            },
            { specialization_name: "Restoration", spent_points: 20, talents: [] },
          ],
        },
        { is_active: false, specializations: [{ specialization_name: "Restoration", spent_points: 51, talents: [] }] },
      ],
    });
    expect(setups).toHaveLength(2);
    expect(setups[0]).toMatchObject({ active: true, specName: "Enhancement" });
    expect(setups[0]!.trees[1]!.talents[0]).toMatchObject({ id: 10, spellId: 99, name: "Stormstrike", rank: 1 });
    expect(setups[1]).toMatchObject({ active: false, specName: "Restoration" });
  });

  it("handles retail spec loadouts", () => {
    const setups = normalizeSpecializations({
      active_specialization: { id: 73 },
      specializations: [
        {
          specialization: { id: 73, name: "Protection" },
          loadouts: [
            {
              is_active: true,
              talent_loadout_code: "ABC",
              selected_class_talents: [{ id: 1, rank: 2, tooltip: { talent: { id: 5, name: "Shield Wall" } } }],
              selected_spec_talents: [],
            },
          ],
        },
        { specialization: { id: 71, name: "Arms" }, loadouts: [] },
      ],
    });
    expect(setups[0]).toMatchObject({ active: true, specId: 73, loadoutCode: "ABC" });
    expect(setups[0]!.trees).toEqual([{ name: "class", talents: [{ id: 1, name: "Shield Wall", rank: 2, spellId: undefined }] }]);
    expect(setups[1]).toMatchObject({ active: false, specId: 71, trees: [] });
  });
});

describe("normalizeMedia / normalizeStatistics / normalizeGuildRoster", () => {
  it("picks render assets", () => {
    expect(
      normalizeMedia({ assets: [{ key: "avatar", value: "a.jpg" }, { key: "main-raw", value: "m.png" }] }),
    ).toEqual({ avatar: "a.jpg", inset: undefined, main: "m.png" });
  });

  it("flattens statistics without assuming fields", () => {
    expect(
      normalizeStatistics({
        _links: {},
        health: 5000,
        strength: { base: 100, effective: 150 },
        melee_crit: { rating: 10, value: 7.5 },
        power_type: { name: "Mana" },
      }),
    ).toEqual({ health: 5000, strength: 150, melee_crit: 7.5 });
  });

  it("maps guild roster members", () => {
    expect(
      normalizeGuildRoster({
        members: [{ character: { id: 3, name: "Rexxar", level: 60, realm: { slug: "x" }, playable_class: { id: 3 } }, rank: 1 }],
      }),
    ).toEqual([{ blizzardId: 3, name: "Rexxar", realmSlug: "x", level: 60, classId: 3, raceId: undefined, rank: 1 }]);
  });
});
