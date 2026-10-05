/** Normalized character data shared by every game version. Fields are optional because each API exposes a different subset. */

export interface CharacterRef {
  name: string;
  /** Realm slug for realm-based games; the ruleset/shard key for realmless ones. */
  realm: string;
}

export interface CharacterSummary {
  blizzardId: number;
  name: string;
  realmSlug: string;
  realmName?: string;
  level: number;
  classId?: number;
  className?: string;
  raceId?: number;
  raceName?: string;
  gender?: string;
  faction?: string;
  guild?: { name: string; realmSlug?: string };
  activeSpec?: { id?: number; name?: string };
  averageItemLevel?: number;
  equippedItemLevel?: number;
  lastLoginAt?: string;
}

export interface EquippedItem {
  slot: string;
  slotName?: string;
  itemId: number;
  name: string;
  quality?: string;
  itemLevel?: number;
  enchantments: { id?: number; text: string; slot?: string }[];
  gems: { itemId?: number; text?: string }[];
  setName?: string;
  bonusIds: number[];
}

export interface Talent {
  id?: number;
  spellId?: number;
  name: string;
  rank?: number;
}

export interface TalentTree {
  name: string;
  points?: number;
  talents: Talent[];
}

/** One talent configuration: a retail spec loadout or a Classic/Forever dual-spec group. */
export interface TalentSetup {
  active: boolean;
  specId?: number;
  specName?: string;
  loadoutCode?: string;
  trees: TalentTree[];
}

export interface CharacterMedia {
  avatar?: string;
  inset?: string;
  main?: string;
}

export interface ProfessionTier {
  name?: string;
  skill?: number;
  maxSkill?: number;
  knownRecipes?: number;
}

export interface Profession {
  id: number;
  name: string;
  secondary: boolean;
  skill?: number;
  maxSkill?: number;
  tiers: ProfessionTier[];
}

export interface Reputation {
  factionId: number;
  name: string;
  standing?: string;
  value?: number;
  max?: number;
  tier?: number;
}

export interface GuildInfo {
  blizzardId: number;
  name: string;
  realmSlug: string;
  realmName?: string;
  faction?: string;
  memberCount?: number;
}

export interface GuildRosterMember {
  blizzardId: number;
  name: string;
  realmSlug: string;
  level: number;
  classId?: number;
  raceId?: number;
  rank: number;
}

export interface AccountCharacter {
  blizzardId: number;
  name: string;
  realmSlug: string;
  realmName?: string;
  level: number;
  classId?: number;
  raceId?: number;
  faction?: string;
}

export interface BattleNetUser {
  id: number;
  battletag: string;
}

/** Everything fetched in one character sync; endpoints the game version lacks stay undefined. */
export interface CharacterProfile {
  summary: CharacterSummary;
  equipment?: EquippedItem[];
  talents?: TalentSetup[];
  media?: CharacterMedia;
  statistics?: Record<string, number>;
  professions?: Profession[];
  reputations?: Reputation[];
  /** Endpoints that failed or are unsupported, with the reason. */
  missing: Record<string, string>;
}
