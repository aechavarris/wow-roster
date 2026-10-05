import { describe, expect, it } from "vitest";
import { cleanWowText } from "./text";
import {
  normalizeEquipment,
  normalizeTalentTree,
  normalizeGuildRoster,
  normalizeMedia,
  normalizeProfessions,
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
  // Shape of a locale-less /equipment response (every string in all locales).
  const all = (en: string, es: string) => ({ en_US: en, es_ES: es, fr_FR: "x" });

  it("keeps every tooltip line localized and colored", () => {
    const [item] = normalizeEquipment({
      equipped_items: [
        {
          slot: { type: "HEAD", name: all("Head", "Cabeza") },
          item: { id: 249961 },
          name: all("Unbreakable Gaze", "Mirada inquebrantable"),
          quality: { type: "EPIC" },
          level: { value: 289 },
          name_description: { display_string: all("Mythic+", "Mítica+"), color: { r: 0, g: 255, b: 0, a: 1 } },
          binding: { type: "ON_ACQUIRE", name: all("Binds when picked up", "Se liga al recogerlo") },
          armor: { value: 221, display: { display_string: all("221 Armor", "221 p. de armadura"), color: { r: 255, g: 255, b: 255, a: 1 } } },
          stats: [
            { type: { type: "STRENGTH" }, value: 106, is_negated: true, display: { display_string: all("+106 Strength", "+106 fuerza"), color: { r: 128, g: 128, b: 128 } } },
          ],
          enchantments: [
            { enchantment_id: 8039, display_string: all("Enchanted: Acuity |A:Professions-ChatIcon-Quality-12-Tier2:20:20|a", "Encantado: Agudeza |A:x:20:20|a"), enchantment_slot: { type: "PERMANENT" } },
          ],
          sockets: [{ socket_type: { name: all("Prismatic Socket", "Ranura prismática") }, item: { id: 240902 }, display_string: all("+16 Mastery", "+16 maestría") }],
          spells: [{ spell: { id: 1 }, description: all("Equip: Something.\r\nMore.", "Equipar: Algo.\r\nMás.") }],
          set: {
            item_set: { name: all("Radiant Verdict", "Veredicto luminoso") },
            items: [{ item: { name: all("Helm", "Yelmo") }, is_equipped: true }, { item: { name: all("Legs", "Piernas") } }],
            effects: [{ display_string: all("Set: Holy Shock heals 15% more.", "Conjunto: Choque Sagrado sana un 15% más."), required_count: 2, is_active: true }],
          },
          requirements: { level: { value: 90, display_string: all("Requires Level 90", "Necesitas ser de nivel 90") } },
        },
      ],
    });
    expect(item).toMatchObject({
      slot: "HEAD",
      itemId: 249961,
      itemLevel: 289,
      name: { en: "Unbreakable Gaze", es: "Mirada inquebrantable" },
      nameDescription: { text: { es: "Mítica+" }, color: "#00ff00" },
      armor: { text: { en: "221 Armor" }, color: "#ffffff" },
      stats: [{ type: "STRENGTH", negated: true, color: "#808080", text: { es: "+106 fuerza" } }],
      enchantments: [{ id: 8039, text: { en: "Enchanted: Acuity", es: "Encantado: Agudeza" }, slot: "PERMANENT" }],
      gems: [{ itemId: 240902, socket: { es: "Ranura prismática" }, text: { en: "+16 Mastery" } }],
      spells: [{ spellId: 1, text: { en: "Equip: Something.\nMore." } }],
      set: {
        name: { es: "Veredicto luminoso" },
        items: [{ equipped: true }, { equipped: false }],
        effects: [{ active: true, text: { en: "Set: Holy Shock heals 15% more." } }],
      },
      requirements: [{ en: "Requires Level 90", es: "Necesitas ser de nivel 90" }],
    });
    // Only the configured UI locales are kept.
    expect(Object.keys(item!.name)).toEqual(["en", "es"]);
  });
});

describe("cleanWowText", () => {
  it("strips client color, atlas and texture codes", () => {
    expect(cleanWowText("|cff00ff00Green|r text |A:icon:20:20|a|Tpath:0|t")).toBe("Green text");
  });
});

describe("normalizeTalentTree", () => {
  const tree = (locale: "en" | "es") => {
    const t = (en: string, es: string) => (locale === "en" ? en : es);
    return {
      id: 790,
      playable_class: { name: t("Paladin", "Paladín") },
      playable_specialization: { id: 65, name: t("Holy", "Sagrado") },
      class_talent_nodes: [
        {
          id: 1,
          node_type: { type: "ACTIVE" },
          display_row: 1,
          display_col: 9,
          raw_position_x: 7800,
          raw_position_y: 599,
          ranks: [
            { rank: 1, tooltip: { talent: { id: 10, name: t("Shock", "Choque") }, spell_tooltip: { spell: { id: 100 }, description: t("Rank one.", "Rango uno."), power_cost: t("3 Holy Power", "3 p. de poder sagrado") } } },
            { rank: 2, tooltip: { talent: { id: 10, name: t("Shock", "Choque") }, spell_tooltip: { spell: { id: 100 }, description: t("Rank two.", "Rango dos.") } } },
          ],
        },
        {
          id: 2,
          node_type: { type: "CHOICE" },
          display_row: 2,
          display_col: 10,
          locked_by: [1],
          ranks: [
            {
              rank: 1,
              choice_of_tooltips: [
                { talent: { id: 20, name: t("Left", "Izquierda") }, spell_tooltip: { spell: { id: 200 }, description: t("Left.", "Izq.") } },
                { talent: { id: 21, name: t("Right", "Derecha") }, spell_tooltip: { spell: { id: 201 }, description: t("Right.", "Der.") } },
              ],
            },
          ],
        },
      ],
      spec_talent_nodes: [
        // Real payloads repeat hero nodes here and include option-less nodes; both must be dropped.
        heroNode(t),
        { id: 4, node_type: { type: "CHOICE" }, display_row: 1, display_col: 1, ranks: [{ rank: 1 }] },
        {
          id: 5,
          node_type: { type: "PASSIVE" },
          ranks: [{ rank: 1, tooltip: { talent: { id: 50, name: t("Spec", "Espec") }, spell_tooltip: { spell: { id: 500 }, description: t("S.", "E.") } } }],
        },
      ],
      hero_talent_trees: [{ id: 50, name: t("Herald of the Sun", "Heraldo del Sol"), hero_talent_nodes: [heroNode(t)] }],
    };
  };
  const heroNode = (t: (en: string, es: string) => string) => ({
    id: 3,
    node_type: { type: "PASSIVE" },
    ranks: [{ rank: 1, tooltip: { talent: { id: 30, name: t("Dawnlight", "Albaluz") }, spell_tooltip: { spell: { id: 300 }, description: t("D.", "A.") } } }],
  });

  it("merges both locales and keeps layout, ranks and choices", () => {
    const layout = normalizeTalentTree({ en: tree("en"), es: tree("es") });
    expect(layout).toMatchObject({ treeId: 790, specId: 65, specName: { en: "Holy", es: "Sagrado" } });
    const [active, choice] = layout.classNodes;
    expect(active).toMatchObject({ id: 1, row: 1, col: 9, x: 7800, y: 599, type: "ACTIVE", maxRank: 2, lockedBy: [] });
    expect(active!.options).toHaveLength(1);
    expect(active!.options[0]).toMatchObject({
      talentId: 10,
      spellId: 100,
      name: { en: "Shock", es: "Choque" },
      descriptions: [{ en: "Rank one.", es: "Rango uno." }, { en: "Rank two.", es: "Rango dos." }],
      cost: { es: "3 p. de poder sagrado" },
    });
    expect(choice).toMatchObject({ type: "CHOICE", lockedBy: [1], maxRank: 1 });
    expect(choice!.options.map((o) => o.name.es)).toEqual(["Izquierda", "Derecha"]);
    expect(layout.heroTrees[0]).toMatchObject({ id: 50, name: { es: "Heraldo del Sol" } });
    expect(layout.heroTrees[0]!.nodes.map((n) => n.id)).toEqual([3]);
  });

  it("keeps hero nodes out of the spec tree and drops nodes without options", () => {
    const layout = normalizeTalentTree({ en: tree("en"), es: tree("es") });
    expect(layout.specNodes.map((n) => n.id)).toEqual([5]);
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
    expect(setups[0]!.selected).toBeUndefined();
    expect(setups[1]).toMatchObject({ active: false, specName: "Restoration" });
  });

  it("handles retail spec loadouts with the tree references and picked nodes", () => {
    const setups = normalizeSpecializations({
      active_specialization: { id: 73 },
      specializations: [
        {
          specialization: { id: 73, name: "Protection" },
          loadouts: [
            {
              is_active: true,
              talent_loadout_code: "ABC",
              // Current API: plain picks carry only node id + rank; choice picks include the chosen talent.
              selected_class_talents: [{ id: 1, rank: 2 }, { id: 2, rank: 1, tooltip: { talent: { id: 5, name: "Shield Wall" } } }],
              selected_spec_talents: [{ id: 3, rank: 1, default_points: 1 }],
              selected_class_talent_tree: { key: { href: "https://eu.api.blizzard.com/data/wow/talent-tree/790?namespace=static-12.1.0_68914-eu" } },
              selected_hero_talent_tree: { id: 50, name: "Templar" },
            },
          ],
        },
        { specialization: { id: 71, name: "Arms" }, loadouts: [] },
      ],
    });
    expect(setups[0]).toMatchObject({ active: true, specId: 73, loadoutCode: "ABC", treeId: 790, heroTreeId: 50 });
    expect(setups[0]!.selected).toEqual([
      { nodeId: 1, rank: 2, talentId: undefined, defaultPoints: undefined },
      { nodeId: 2, rank: 1, talentId: 5, defaultPoints: undefined },
      { nodeId: 3, rank: 1, talentId: undefined, defaultPoints: 1 },
    ]);
    expect(setups[1]).toMatchObject({ active: false, specId: 71, trees: [], selected: [] });
  });
});

describe("normalizeMedia / normalizeStatistics / normalizeGuildRoster", () => {
  it("picks render assets", () => {
    expect(
      normalizeMedia({ assets: [{ key: "avatar", value: "a.jpg" }, { key: "main-raw", value: "m.png" }] }),
    ).toEqual({ avatar: "a.jpg", inset: undefined, main: "m.png" });
  });

  it("keeps base/effective values and percentages with their rating", () => {
    expect(
      normalizeStatistics({
        _links: {},
        health: 5000,
        strength: { base: 100, effective: 150 },
        melee_crit: { rating_bonus: 11.17, value: 21.17, rating_normalized: 514 },
        power_type: { name: "Mana", id: 0 },
      }),
    ).toEqual({
      health: 5000,
      power_type_id: 0,
      strength: { base: 100, effective: 150 },
      melee_crit: { value: 21.17, rating: 514, ratingBonus: 11.17 },
    });
  });

  it("maps guild roster members", () => {
    expect(
      normalizeGuildRoster({
        members: [{ character: { id: 3, name: "Rexxar", level: 60, realm: { slug: "x" }, playable_class: { id: 3 } }, rank: 1 }],
      }),
    ).toEqual([{ blizzardId: 3, name: "Rexxar", realmSlug: "x", level: 60, classId: 3, raceId: undefined, rank: 1 }]);
  });
});

describe("normalizeProfessions", () => {
  const tier = (id: number, name: string, skill: number, max: number, recipes = 0) => ({
    tier: { id, name: { en_US: name, es_ES: `${name} (es)` } },
    skill_points: skill,
    max_skill_points: max,
    known_recipes: Array.from({ length: recipes }, (_, i) => ({ id: i })),
  });

  it("headlines the newest retail tier instead of the first one listed", () => {
    const [jewelcrafting, cooking] = normalizeProfessions({
      primaries: [
        {
          profession: { id: 755, name: { en_US: "Jewelcrafting", es_ES: "Joyería" } },
          tiers: [tier(2477, "Jewelcrafting", 1, 300), tier(2822, "Dragon Isles Jewelcrafting", 100, 100, 40), tier(2878, "Khaz Algar Jewelcrafting", 87, 100, 25)],
        },
      ],
      secondaries: [{ profession: { id: 185, name: { en_US: "Cooking" } }, tiers: [tier(2873, "Khaz Algar Cooking", 12, 100)] }],
    });
    expect(jewelcrafting).toMatchObject({ id: 755, name: { en: "Jewelcrafting", es: "Joyería" }, secondary: false, skill: 87, maxSkill: 100 });
    expect(jewelcrafting!.tiers.map((t) => [t.id, t.skill, t.knownRecipes])).toEqual([
      [2878, 87, 25],
      [2822, 100, 40],
      [2477, 1, undefined],
    ]);
    expect(jewelcrafting!.tiers[0]!.name).toEqual({ en: "Khaz Algar Jewelcrafting", es: "Khaz Algar Jewelcrafting (es)" });
    expect(cooking).toMatchObject({ id: 185, secondary: true, skill: 12 });
  });

  it("keeps a profession-level skill when there are no tiers", () => {
    const [archaeology] = normalizeProfessions({ secondaries: [{ profession: { id: 794, name: "Archaeology" }, skill_points: 950, max_skill_points: 950 }] });
    expect(archaeology).toMatchObject({ skill: 950, maxSkill: 950, tiers: [] });
    expect(normalizeProfessions({})).toEqual([]);
  });
});
