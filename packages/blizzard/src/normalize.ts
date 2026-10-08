/* eslint-disable @typescript-eslint/no-explicit-any -- raw Blizzard payloads differ per game version and are validated field by field here. */
import { cleanWowText, localized, rgbToHex, type LocalizedText } from "./text";
import type {
  AccountCharacter,
  CharacterMedia,
  CharacterSummary,
  EncounterStatistic,
  EquippedItem,
  GuildInfo,
  GuildRosterMember,
  InstanceMode,
  InstanceProgress,
  ItemResult,
  JournalEncounter,
  JournalInstance,
  JournalInstanceRef,
  MythicPlusProfile,
  MythicPlusRun,
  Profession,
  Reputation,
  StatValue,
  Talent,
  TalentNode,
  TalentOption,
  TalentSetup,
  TalentTree,
  TalentTreeLayout,
  TooltipLine,
} from "./types";

type Raw = any;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v : []);
const compact = <T>(values: (T | undefined)[]): T[] => values.filter((v): v is T => v !== undefined);

/** Blizzard localizes names either as a plain string or as { en_US: "...", ... } when no locale is requested. */
export function text(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const record = v as Record<string, unknown>;
    return str(record.en_US) ?? str(Object.values(record).find((x) => typeof x === "string"));
  }
  return undefined;
}

/** The numeric id at the end of a Blizzard API href (e.g. ".../talent-tree/790/hero-talent/50?…" -> 50). */
export function idFromHref(href: unknown): number | undefined {
  const match = typeof href === "string" ? /\/(\d+)(?:\?|$)/.exec(href) : null;
  return match ? Number(match[1]) : undefined;
}

export function normalizeSummary(raw: Raw): CharacterSummary {
  return {
    blizzardId: raw.id,
    name: text(raw.name) ?? "",
    realmSlug: raw.realm?.slug ?? "",
    realmName: text(raw.realm?.name),
    level: num(raw.level) ?? 0,
    classId: num(raw.character_class?.id),
    className: text(raw.character_class?.name),
    raceId: num(raw.race?.id),
    raceName: text(raw.race?.name),
    gender: str(raw.gender?.type),
    faction: str(raw.faction?.type),
    guild: raw.guild ? { name: text(raw.guild.name) ?? "", realmSlug: raw.guild.realm?.slug } : undefined,
    activeSpec: raw.active_spec ? { id: num(raw.active_spec.id), name: text(raw.active_spec.name) } : undefined,
    averageItemLevel: num(raw.average_item_level),
    equippedItemLevel: num(raw.equipped_item_level),
    lastLoginAt: num(raw.last_login_timestamp) ? new Date(raw.last_login_timestamp).toISOString() : undefined,
  };
}

/** A "display" block ({ display_string, color }) as a colored tooltip line. */
function line(display: Raw): TooltipLine | undefined {
  const text = localized(display?.display_string);
  return text ? { text, color: rgbToHex(display?.color) } : undefined;
}

/** Collects every display_string inside the requirements block (level, classes, skills, reputation…). */
function requirementLines(requirements: Raw): LocalizedText[] {
  if (!requirements || typeof requirements !== "object") return [];
  return compact(Object.values(requirements).map((r: Raw) => localized(r?.display_string)));
}

/**
 * Equipment with everything the in-game tooltip shows. Request it without a locale
 * so every display string arrives in all languages in a single call.
 */
export function normalizeEquipment(raw: Raw): EquippedItem[] {
  return list(raw.equipped_items).map((item) => ({
    slot: item.slot?.type ?? "UNKNOWN",
    itemId: item.item?.id,
    name: localized(item.name) ?? { en: String(item.item?.id ?? "?") },
    quality: str(item.quality?.type),
    itemLevel: num(item.level?.value),
    nameDescription: line(item.name_description),
    binding: localized(item.binding?.name),
    uniqueEquipped: localized(item.unique_equipped),
    inventoryType: localized(item.inventory_type?.name),
    itemSubclass: localized(item.item_subclass?.name),
    armor: line(item.armor?.display),
    weapon: item.weapon
      ? {
          damage: localized(item.weapon.damage?.display_string),
          speed: localized(item.weapon.attack_speed?.display_string),
          dps: localized(item.weapon.dps?.display_string),
        }
      : undefined,
    stats: compact(
      list(item.stats).map((s) => {
        const l = line(s.display);
        return l ? { ...l, type: s.type?.type ?? "", negated: s.is_negated === true || undefined } : undefined;
      }),
    ),
    enchantments: compact(
      list(item.enchantments).map((e) => {
        const t = localized(e.display_string) ?? localized(e.source_item?.name);
        return t ? { id: num(e.enchantment_id), text: t, slot: str(e.enchantment_slot?.type) } : undefined;
      }),
    ),
    gems: list(item.sockets).map((s) => ({
      itemId: num(s.item?.id),
      text: localized(s.display_string),
      socket: localized(s.socket_type?.name),
    })),
    spells: compact(
      list(item.spells).map((s) => {
        const t = localized(s.description);
        return t ? { spellId: num(s.spell?.id), text: t } : undefined;
      }),
    ),
    set: item.set
      ? {
          name: localized(item.set.item_set?.name) ?? {},
          items: list(item.set.items).map((i) => ({ name: localized(i.item?.name) ?? {}, equipped: i.is_equipped === true })),
          effects: compact(
            list(item.set.effects).map((e) => {
              const t = localized(e.display_string);
              return t ? { text: t, active: e.is_active === true } : undefined;
            }),
          ),
        }
      : undefined,
    description: localized(item.description),
    requirements: requirementLines(item.requirements),
    durability: localized(item.durability?.display_string),
    bonusIds: list(item.bonus_list).filter((b) => typeof b === "number"),
  }));
}

function toTalent(t: Raw): Talent {
  const tooltip = t.tooltip ?? t;
  const description = text(tooltip.spell_tooltip?.description);
  return {
    id: num(t.id) ?? num(tooltip.talent?.id) ?? num(t.talent?.id),
    spellId: num(tooltip.spell_tooltip?.spell?.id),
    name: text(tooltip.talent?.name) ?? text(tooltip.spell_tooltip?.spell?.name) ?? "",
    description: description ? cleanWowText(description) : undefined,
    rank: num(t.rank) ?? num(t.talent_rank),
  };
}

/** Handles both the retail shape (spec loadouts) and the Classic shape (dual-spec groups of three trees). */
export function normalizeSpecializations(raw: Raw): TalentSetup[] {
  if (Array.isArray(raw.specialization_groups)) {
    return raw.specialization_groups.map((group: Raw): TalentSetup => {
      const trees: TalentTree[] = list(group.specializations).map((tree) => ({
        name: text(tree.specialization_name) ?? text(tree.specialization?.name) ?? "",
        points: num(tree.spent_points),
        talents: list(tree.talents).map(toTalent),
      }));
      const main = [...trees].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0];
      return { active: Boolean(group.is_active), specName: main?.name, trees };
    });
  }

  const activeId = num(raw.active_specialization?.id);
  return list(raw.specializations).map((spec): TalentSetup => {
    const loadouts = list(spec.loadouts);
    const loadout = loadouts.find((l) => l.is_active) ?? loadouts[0];
    const specId = num(spec.specialization?.id);
    const picked = [
      ...list(loadout?.selected_class_talents),
      ...list(loadout?.selected_spec_talents),
      ...list(loadout?.selected_hero_talents),
    ];
    const trees: TalentTree[] = [
      { name: "class", talents: list(loadout?.selected_class_talents).map(toTalent) },
      { name: "spec", talents: list(loadout?.selected_spec_talents).map(toTalent) },
      { name: "hero", talents: list(loadout?.selected_hero_talents).map(toTalent) },
    ].filter((tree) => tree.talents.length > 0);
    return {
      active: specId !== undefined && specId === activeId,
      specId,
      specName: text(spec.specialization?.name),
      loadoutCode: str(loadout?.talent_loadout_code),
      // The class tree reference only carries its id in the href (".../talent-tree/790?…").
      treeId: idFromHref(loadout?.selected_class_talent_tree?.key?.href),
      heroTreeId: num(loadout?.selected_hero_talent_tree?.id),
      selected: picked
        .filter((t) => num(t.id) !== undefined)
        .map((t) => ({
          nodeId: t.id,
          rank: num(t.rank) ?? 1,
          talentId: num(t.tooltip?.talent?.id),
          defaultPoints: num(t.default_points),
        })),
      trees,
    };
  });
}

/** Talent tree payloads fetched once per UI locale, merged into one localized layout. */
export function normalizeTalentTree(rawByLocale: Record<string, Raw>): TalentTreeLayout {
  const locales = Object.keys(rawByLocale);
  const base = rawByLocale[locales[0]!];

  /** Reads the same field from every locale's payload into one LocalizedText. */
  const loc = (pick: (locale: string) => unknown): LocalizedText | undefined => {
    const result: LocalizedText = {};
    for (const locale of locales) {
      const value = text(pick(locale));
      if (value) result[locale] = cleanWowText(value);
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };

  const nodesOf = (select: (raw: Raw) => unknown): TalentNode[] => {
    const nodeIndex = Object.fromEntries(
      locales.map((l) => [l, new Map(list(select(rawByLocale[l])).map((n: Raw) => [n.id, n]))]),
    );
    return list(select(base)).map((node: Raw): TalentNode => {
      const ranks = list(node.ranks);
      const isChoice = list(ranks[0]?.choice_of_tooltips).length > 0;
      // Choice nodes hold their options in rank 1; regular nodes have one tooltip per rank.
      const tooltip = (locale: string, option: number, rank: number) => {
        const n = nodeIndex[locale]!.get(node.id);
        return isChoice ? list(n?.ranks)[0]?.choice_of_tooltips?.[option] : list(n?.ranks)[rank]?.tooltip;
      };
      const optionCount = isChoice ? list(ranks[0].choice_of_tooltips).length : 1;
      const options: TalentOption[] = [];
      for (let o = 0; o < optionCount; o++) {
        const first = tooltip(locales[0]!, o, 0);
        if (!first) continue;
        const spell = (locale: string, rank = 0) => tooltip(locale, o, rank)?.spell_tooltip;
        options.push({
          talentId: num(first.talent?.id),
          spellId: num(first.spell_tooltip?.spell?.id),
          name: loc((l) => tooltip(l, o, 0)?.talent?.name) ?? {},
          descriptions: compact((isChoice ? [0] : ranks.map((_, r) => r)).map((r) => loc((l) => spell(l, r)?.description))),
          castTime: loc((l) => spell(l)?.cast_time),
          cost: loc((l) => spell(l)?.power_cost),
          range: loc((l) => spell(l)?.range),
          cooldown: loc((l) => spell(l)?.cooldown),
        });
      }
      return {
        id: node.id,
        row: num(node.display_row) ?? 0,
        col: num(node.display_col) ?? 0,
        x: num(node.raw_position_x),
        y: num(node.raw_position_y),
        type: str(node.node_type?.type) ?? "PASSIVE",
        maxRank: Math.max(1, ranks.length),
        lockedBy: list(node.locked_by).filter((id) => typeof id === "number"),
        options,
      };
    });
  };

  // The API also lists every hero tree's nodes under spec_talent_nodes; they belong to the hero trees only.
  const heroNodeIds = new Set(list(base.hero_talent_trees).flatMap((h: Raw) => list(h.hero_talent_nodes).map((n: Raw) => n.id)));
  // Nodes without any option (no tooltip in the API) cannot be drawn or explained.
  const drawable = (nodes: TalentNode[]) => nodes.filter((n) => n.options.length > 0);

  return {
    treeId: base.id,
    specId: base.playable_specialization?.id,
    className: loc((l) => rawByLocale[l].playable_class?.name),
    specName: loc((l) => rawByLocale[l].playable_specialization?.name),
    classNodes: drawable(nodesOf((raw) => raw.class_talent_nodes)),
    specNodes: drawable(nodesOf((raw) => raw.spec_talent_nodes)).filter((n) => !heroNodeIds.has(n.id)),
    heroTrees: list(base.hero_talent_trees).map((hero: Raw, index: number) => ({
      id: hero.id,
      name: loc((l) => list(rawByLocale[l].hero_talent_trees)[index]?.name) ?? {},
      nodes: drawable(nodesOf((raw) => list(raw.hero_talent_trees)[index]?.hero_talent_nodes)),
    })),
  };
}

/** Icon URL from a media payload (item, spell, profession…). */
export function normalizeIcon(raw: Raw): string | undefined {
  return list(raw?.assets).find((a) => a.key === "icon")?.value;
}

/** One item from the item search or item detail API (for the BiS picker). Returns undefined for non-equippable rows. */
export function normalizeItem(raw: Raw): ItemResult | undefined {
  const id = num(raw?.id);
  const name = localized(raw?.name);
  if (id === undefined || !name) return undefined;
  return {
    id,
    name,
    quality: str(raw?.quality?.type),
    itemLevel: num(raw?.level),
    requiredLevel: num(raw?.required_level),
    inventoryType: str(raw?.inventory_type?.type),
    subclass: localized(raw?.item_subclass?.name),
    mediaId: num(raw?.media?.id) ?? idFromHref(raw?.media?.key?.href) ?? id,
  };
}

/** The item search response: `{ results: [{ data: <item> }] }`, each result normalized and non-items dropped. */
export function normalizeItemSearch(raw: Raw): ItemResult[] {
  return compact(list(raw?.results).map((r) => normalizeItem(r?.data)));
}

/** The journal instance index: every raid and dungeon with its id and name. */
export function normalizeJournalIndex(raw: Raw): JournalInstanceRef[] {
  return compact(
    list(raw?.instances).map((i) => {
      const id = num(i?.id);
      return id === undefined ? undefined : { id, name: localized(i?.name) };
    }),
  );
}

/** A journal instance (raid or dungeon) with the ids of its encounters, for building the BiS source index. */
export function normalizeJournalInstance(raw: Raw): JournalInstance | undefined {
  const id = num(raw?.id);
  const name = localized(raw?.name);
  if (id === undefined || !name) return undefined;
  return {
    id,
    name,
    type: str(raw?.category?.type) ?? str(raw?.type),
    encounterIds: compact(list(raw?.encounters).map((e) => num(e?.id))),
  };
}

/** A journal encounter (boss) with the ids of the items it drops. */
export function normalizeJournalEncounter(raw: Raw): JournalEncounter | undefined {
  const id = num(raw?.id);
  const name = localized(raw?.name);
  if (id === undefined || !name) return undefined;
  return {
    id,
    name,
    instanceId: num(raw?.instance?.id),
    itemIds: compact(list(raw?.items).map((entry) => num(entry?.item?.id))),
  };
}

export function normalizeMedia(raw: Raw): CharacterMedia {
  const assets = list(raw.assets);
  const find = (...keys: string[]) => assets.find((a) => keys.includes(a.key))?.value as string | undefined;
  return {
    avatar: find("avatar") ?? str(raw.avatar_url),
    inset: find("inset") ?? str(raw.bust_url),
    main: find("main-raw", "main") ?? str(raw.render_url),
  };
}

/**
 * Keeps each stat as the API reports it: plain numbers, base/effective pairs, or a
 * percentage with its rating, so panels can show both like the game does.
 */
export function normalizeStatistics(raw: Raw): Record<string, StatValue> {
  const stats: Record<string, StatValue> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (key === "_links" || key === "character") continue;
    // The resource type only matters by id (0 mana, 1 rage, 3 energy…), e.g. to color the power bar.
    if (key === "power_type") {
      const id = num((value as Raw)?.id);
      if (id !== undefined) stats.power_type_id = id;
      continue;
    }
    if (typeof value === "number") stats[key] = value;
    else if (value && typeof value === "object") {
      const v = value as Raw;
      const stat = {
        base: num(v.base),
        effective: num(v.effective),
        value: num(v.value),
        rating: num(v.rating_normalized) ?? num(v.rating),
        ratingBonus: num(v.rating_bonus),
      };
      if (Object.values(stat).some((n) => n !== undefined)) stats[key] = JSON.parse(JSON.stringify(stat));
    }
  }
  return stats;
}

/**
 * Retail splits each profession into one tier per expansion ("Khaz Algar Jewelcrafting"…), each with
 * its own skill. Taking the first tier showed whatever expansion came first (often an untouched 1/300),
 * so tiers are sorted by id, highest first: the tiers of recent expansions have the highest ids, and
 * the profession's headline skill is that tier's. Every tier stays in the list for the details view.
 */
export function normalizeProfessions(raw: Raw): Profession[] {
  const map = (p: Raw, secondary: boolean): Profession => {
    const tiers = list(p.tiers)
      .map((t) => ({
        id: num(t.tier?.id),
        name: localized(t.tier?.name),
        skill: num(t.skill_points),
        maxSkill: num(t.max_skill_points),
        knownRecipes: list(t.known_recipes).length || undefined,
      }))
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    return {
      id: p.profession?.id,
      name: localized(p.profession?.name) ?? {},
      secondary,
      skill: num(p.skill_points) ?? tiers[0]?.skill,
      maxSkill: num(p.max_skill_points) ?? tiers[0]?.maxSkill,
      tiers,
    };
  };
  return [...list(raw.primaries).map((p) => map(p, false)), ...list(raw.secondaries).map((p) => map(p, true))];
}

export function normalizeReputations(raw: Raw): Reputation[] {
  return list(raw.reputations).map((r) => ({
    factionId: r.faction?.id,
    name: localized(r.faction?.name) ?? {},
    standing: localized(r.standing?.name),
    value: num(r.standing?.value),
    max: num(r.standing?.max),
    tier: num(r.standing?.tier),
    // Renown factions (retail) have a renown level instead of a named standing.
    renownLevel: num(r.standing?.renown_level),
  }));
}

const isoDate = (ms: unknown) => (num(ms) ? new Date(ms as number).toISOString() : undefined);

/**
 * Raid or dungeon progress (/encounters/raids, /encounters/dungeons): expansions > instances >
 * difficulty modes > encounters with kill counts. Kept in the API's order (oldest expansion first).
 */
export function normalizeEncounters(raw: Raw): InstanceProgress[] {
  return list(raw.expansions).flatMap((expansion) =>
    list(expansion.instances).map(
      (instance): InstanceProgress => ({
        id: num(instance.instance?.id),
        name: localized(instance.instance?.name) ?? {},
        expansionId: num(expansion.expansion?.id),
        expansion: localized(expansion.expansion?.name),
        // Retail also lists a mode with an empty difficulty that repeats another mode's kills: it says nothing.
        modes: list(instance.modes).filter((mode) => str(mode.difficulty?.type) !== undefined).map(
          (mode): InstanceMode => ({
            difficulty: str(mode.difficulty?.type) ?? "UNKNOWN",
            difficultyName: localized(mode.difficulty?.name),
            completed: num(mode.progress?.completed_count) ?? 0,
            total: num(mode.progress?.total_count) ?? 0,
            encounters: list(mode.progress?.encounters).map((e) => ({
              id: num(e.encounter?.id),
              name: localized(e.encounter?.name) ?? {},
              kills: num(e.completed_count) ?? 0,
              lastKillAt: isoDate(e.last_kill_timestamp),
            })),
          }),
        ),
      }),
    ),
  );
}

/** Best Mythic+ runs (weekly or season), highest key first. */
function mythicPlusRuns(runs: unknown): MythicPlusRun[] {
  return list(runs)
    .map(
      (run): MythicPlusRun => ({
        dungeonId: num(run.dungeon?.id),
        dungeon: localized(run.dungeon?.name) ?? {},
        level: num(run.keystone_level) ?? 0,
        timed: run.is_completed_within_time === true,
        durationMs: num(run.duration),
        completedAt: isoDate(run.completed_timestamp),
        rating: num(run.mythic_rating?.rating),
      }),
    )
    .sort((a, b) => b.level - a.level || (b.rating ?? 0) - (a.rating ?? 0));
}

/** Retail /mythic-keystone-profile: current season rating, this week's best runs and the current season id. */
export function normalizeMythicPlus(raw: Raw): MythicPlusProfile {
  const rating = raw.current_mythic_rating;
  const seasons = list(raw.seasons).map((s) => num(s.id)).filter((id): id is number => id !== undefined);
  return {
    rating: num(rating?.rating),
    color: rating?.color ? rgbToHex(rating.color) : undefined,
    weeklyRuns: mythicPlusRuns(raw.current_period?.best_runs),
    seasonId: seasons.length > 0 ? Math.max(...seasons) : undefined,
  };
}

/** Retail /mythic-keystone-profile/season/{id}: the best run of each dungeon in that season. */
export function normalizeMythicPlusSeason(raw: Raw): MythicPlusRun[] {
  return mythicPlusRuns(raw.best_runs);
}

export function normalizeGuild(raw: Raw): GuildInfo {
  return {
    blizzardId: raw.id,
    name: text(raw.name) ?? "",
    realmSlug: raw.realm?.slug ?? "",
    realmName: text(raw.realm?.name),
    faction: str(raw.faction?.type),
    memberCount: num(raw.member_count),
  };
}

export function normalizeGuildRoster(raw: Raw): GuildRosterMember[] {
  return list(raw.members).map((m) => ({
    blizzardId: m.character?.id,
    name: text(m.character?.name) ?? "",
    realmSlug: m.character?.realm?.slug ?? "",
    level: num(m.character?.level) ?? 0,
    classId: num(m.character?.playable_class?.id),
    raceId: num(m.character?.playable_race?.id),
    rank: num(m.rank) ?? 99,
  }));
}

export function normalizeAccountCharacters(raw: Raw): AccountCharacter[] {
  return list(raw.wow_accounts).flatMap((account) =>
    list(account.characters).map((c) => ({
      blizzardId: c.id,
      name: text(c.name) ?? "",
      realmSlug: c.realm?.slug ?? "",
      realmName: text(c.realm?.name),
      level: num(c.level) ?? 0,
      classId: num(c.playable_class?.id),
      raceId: num(c.playable_race?.id),
      faction: str(c.faction?.type),
    })),
  );
}

/**
 * /achievements/statistics, requested in every locale: the boss kill counters of the "Dungeons & Raids" category,
 * one subcategory per expansion. Other categories (deaths, travel, consumables…) are dropped: only these are used.
 */
export function normalizeEncounterStatistics(raw: Raw): EncounterStatistic[] {
  const category = list(raw.categories).find((c) => /dungeons? & raids?/i.test(localized(c.name)?.en ?? ""));
  return list(category?.sub_categories).flatMap((expansion, index) =>
    list(expansion.statistics).flatMap((stat): EncounterStatistic[] => {
      const id = num(stat.id);
      const name = localized(stat.name);
      if (id === undefined || !name) return [];
      return [
        {
          id,
          name,
          quantity: num(stat.quantity) ?? 0,
          lastUpdated: isoDate(stat.last_updated_timestamp),
          expansion: localized(expansion.name),
          expansionOrder: index + 1,
        },
      ];
    }),
  );
}
