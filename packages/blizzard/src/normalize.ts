/* eslint-disable @typescript-eslint/no-explicit-any -- raw Blizzard payloads differ per game version and are validated field by field here. */
import type {
  AccountCharacter,
  CharacterMedia,
  CharacterSummary,
  EquippedItem,
  GuildInfo,
  GuildRosterMember,
  Profession,
  Reputation,
  Talent,
  TalentSetup,
  TalentTree,
} from "./types";

type Raw = any;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v : []);

/** Blizzard localizes names either as a plain string or as { en_US: "...", ... } when no locale is requested. */
export function text(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const record = v as Record<string, unknown>;
    return str(record.en_US) ?? str(Object.values(record).find((x) => typeof x === "string"));
  }
  return undefined;
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

export function normalizeEquipment(raw: Raw): EquippedItem[] {
  return list(raw.equipped_items).map((item) => ({
    slot: item.slot?.type ?? "UNKNOWN",
    slotName: text(item.slot?.name),
    itemId: item.item?.id,
    name: text(item.name) ?? "",
    quality: str(item.quality?.type),
    itemLevel: num(item.level?.value),
    enchantments: list(item.enchantments).map((e) => ({
      id: num(e.enchantment_id),
      text: text(e.display_string) ?? text(e.source_item?.name) ?? "",
      slot: str(e.enchantment_slot?.type),
    })),
    gems: list(item.sockets)
      .filter((s) => s.item || s.display_string)
      .map((s) => ({ itemId: num(s.item?.id), text: text(s.display_string) })),
    setName: text(item.set?.item_set?.name),
    bonusIds: list(item.bonus_list).filter((b) => typeof b === "number"),
  }));
}

function toTalent(t: Raw): Talent {
  const tooltip = t.tooltip ?? t;
  return {
    id: num(t.id) ?? num(tooltip.talent?.id) ?? num(t.talent?.id),
    spellId: num(tooltip.spell_tooltip?.spell?.id),
    name: text(tooltip.talent?.name) ?? text(tooltip.spell_tooltip?.spell?.name) ?? "",
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
      trees,
    };
  });
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

/** Flattens the statistics payload into numeric values without assuming which stats a game version has. */
export function normalizeStatistics(raw: Raw): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (key === "_links" || key === "character") continue;
    if (typeof value === "number") stats[key] = value;
    else if (value && typeof value === "object") {
      const v = value as Raw;
      const n = num(v.effective) ?? num(v.value) ?? num(v.rating_normalized);
      if (n !== undefined) stats[key] = n;
    }
  }
  return stats;
}

export function normalizeProfessions(raw: Raw): Profession[] {
  const map = (p: Raw, secondary: boolean): Profession => {
    const tiers = list(p.tiers).map((t) => ({
      name: text(t.tier?.name),
      skill: num(t.skill_points),
      maxSkill: num(t.max_skill_points),
      knownRecipes: list(t.known_recipes).length || undefined,
    }));
    return {
      id: p.profession?.id,
      name: text(p.profession?.name) ?? "",
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
    name: text(r.faction?.name) ?? "",
    standing: text(r.standing?.name),
    value: num(r.standing?.value),
    max: num(r.standing?.max),
    tier: num(r.standing?.tier),
  }));
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
