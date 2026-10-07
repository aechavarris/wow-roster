import type { LocalizedText } from "./text";

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

/** A tooltip line as the game shows it: text plus its color. */
export interface TooltipLine {
  text: LocalizedText;
  color?: string;
}

export interface EquippedItem {
  slot: string;
  itemId: number;
  name: LocalizedText;
  quality?: string;
  itemLevel?: number;
  /** Icon URL, filled from the static media cache. */
  icon?: string;
  /** Green subtitle under the name (e.g. "Mythic+"). */
  nameDescription?: TooltipLine;
  binding?: LocalizedText;
  uniqueEquipped?: LocalizedText;
  inventoryType?: LocalizedText;
  itemSubclass?: LocalizedText;
  armor?: TooltipLine;
  weapon?: { damage?: LocalizedText; speed?: LocalizedText; dps?: LocalizedText };
  stats: (TooltipLine & { type: string; negated?: boolean })[];
  enchantments: { id?: number; text: LocalizedText; slot?: string }[];
  gems: { itemId?: number; text?: LocalizedText; socket?: LocalizedText; icon?: string }[];
  /** "Equip:" / "Use:" effects. */
  spells: { spellId?: number; text: LocalizedText }[];
  set?: { name: LocalizedText; items: { name: LocalizedText; equipped: boolean }[]; effects: { text: LocalizedText; active: boolean }[] };
  /** Flavor text. */
  description?: LocalizedText;
  requirements: LocalizedText[];
  durability?: LocalizedText;
  bonusIds: number[];
}

export interface Talent {
  id?: number;
  spellId?: number;
  name: string;
  description?: string;
  rank?: number;
}

export interface TalentTree {
  name: string;
  points?: number;
  talents: Talent[];
}

/** A talent node picked in a retail loadout; the visual layout comes from the static talent tree. */
export interface SelectedTalentNode {
  nodeId: number;
  rank: number;
  /** For choice nodes: the talent chosen. */
  talentId?: number;
  /** Granted for free by the game (not spent by the player). */
  defaultPoints?: number;
}

/** One talent configuration: a retail spec loadout or a Classic/Forever dual-spec group. */
export interface TalentSetup {
  active: boolean;
  specId?: number;
  specName?: string;
  loadoutCode?: string;
  /** Retail: static tree to draw the loadout on. */
  treeId?: number;
  heroTreeId?: number;
  selected?: SelectedTalentNode[];
  /** Classic-style trees (and a readable fallback for retail). */
  trees: TalentTree[];
}

/** One option of a talent node (choice nodes have two). Text is localized; descriptions are per rank. */
export interface TalentOption {
  talentId?: number;
  spellId?: number;
  name: LocalizedText;
  descriptions: LocalizedText[];
  castTime?: LocalizedText;
  cost?: LocalizedText;
  range?: LocalizedText;
  cooldown?: LocalizedText;
  icon?: string;
}

export interface TalentNode {
  id: number;
  row: number;
  col: number;
  /** Exact in-game position (client units, ~600 per grid step); preferred over row/col for drawing. */
  x?: number;
  y?: number;
  type: string;
  maxRank: number;
  lockedBy: number[];
  options: TalentOption[];
}

/** Static layout of a retail talent tree for one spec, cached per game version. */
export interface TalentTreeLayout {
  treeId: number;
  specId: number;
  className?: LocalizedText;
  specName?: LocalizedText;
  classNodes: TalentNode[];
  specNodes: TalentNode[];
  heroTrees: { id: number; name: LocalizedText; nodes: TalentNode[] }[];
}

/** Stat as reported by the API: a plain number, or base/effective values, or a percentage with its rating. */
export type StatValue = number | { base?: number; effective?: number; value?: number; rating?: number; ratingBonus?: number };

export interface CharacterMedia {
  avatar?: string;
  inset?: string;
  main?: string;
}

export interface ProfessionTier {
  /** Blizzard tier id; newer expansions have higher ids. */
  id?: number;
  name?: LocalizedText;
  skill?: number;
  maxSkill?: number;
  knownRecipes?: number;
}

export interface Profession {
  id: number;
  name: LocalizedText;
  icon?: string;
  secondary: boolean;
  skill?: number;
  maxSkill?: number;
  tiers: ProfessionTier[];
}

export interface Reputation {
  factionId: number;
  name: LocalizedText;
  standing?: LocalizedText;
  value?: number;
  max?: number;
  tier?: number;
  renownLevel?: number;
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

/** One boss of a raid or dungeon difficulty, with the character's kills. */
export interface EncounterProgress {
  id?: number;
  name: LocalizedText;
  kills: number;
  lastKillAt?: string;
}

/** Progress in one difficulty of an instance (Normal, Heroic, Mythic, Mythic Keystone…). */
export interface InstanceMode {
  /** Blizzard difficulty type, e.g. "NORMAL", "HEROIC", "MYTHIC", "MYTHIC_KEYSTONE", "LFR". */
  difficulty: string;
  difficultyName?: LocalizedText;
  completed: number;
  total: number;
  encounters: EncounterProgress[];
}

/**
 * One boss kill counter of the in-game statistics ("Garrosh Hellscream kills (Siege of Orgrimmar 25 player)"),
 * from the "Dungeons & Raids" category: how many kills and when the counter last changed.
 */
export interface EncounterStatistic {
  id: number;
  name: LocalizedText;
  quantity: number;
  lastUpdated?: string;
  /** Expansion subcategory it is listed under, and its position (1 = oldest) to tell the current tier. */
  expansion?: LocalizedText;
  expansionOrder: number;
}

/** A raid or dungeon the character has killed something in, grouped by expansion. */
export interface InstanceProgress {
  id?: number;
  name: LocalizedText;
  expansionId?: number;
  expansion?: LocalizedText;
  modes: InstanceMode[];
}

export interface MythicPlusRun {
  dungeonId?: number;
  dungeon: LocalizedText;
  level: number;
  timed: boolean;
  durationMs?: number;
  completedAt?: string;
  /** Rating the run is worth (season runs only). */
  rating?: number;
}

/** Retail Mythic+ profile: season rating, this week's best runs and the season's best run per dungeon. */
export interface MythicPlusProfile {
  rating?: number;
  /** Rating color as hex (#rrggbb), as Blizzard colors it in game. */
  color?: string;
  weeklyRuns: MythicPlusRun[];
  /** Current season: the highest id the profile lists (Blizzard does not sort them). */
  seasonId?: number;
  /** Best run per dungeon this season, highest key first; undefined until the season was fetched. */
  seasonRuns?: MythicPlusRun[];
}

/** One Mythic+ run as Raider.IO reports it (dungeon names in English). */
export interface RaiderIoRun {
  dungeon: string;
  shortName?: string;
  level: number;
  /** Raider.IO counts keystone upgrades; 0 means the run was over time. */
  timed: boolean;
  upgrades: number;
  completedAt?: string;
  score?: number;
  url?: string;
}

/**
 * A character's Mythic+ data from Raider.IO. Unlike Blizzard, it lists every run of the week (not only the best per
 * dungeon), which is what run counts and the Great Vault need.
 */
export interface RaiderIoProfile {
  profileUrl?: string;
  /** Season slug, e.g. "season-mn-2". */
  season?: string;
  score?: number;
  color?: string;
  /** This week's runs, highest first. */
  weeklyRuns: RaiderIoRun[];
  /** Latest runs of the season, newest first. */
  recentRuns: RaiderIoRun[];
  /** Best run per dungeon this season. */
  bestRuns: RaiderIoRun[];
}

/** Everything fetched in one character sync; endpoints the game version lacks stay undefined. */
export interface CharacterProfile {
  summary: CharacterSummary;
  equipment?: EquippedItem[];
  talents?: TalentSetup[];
  media?: CharacterMedia;
  statistics?: Record<string, StatValue>;
  professions?: Profession[];
  reputations?: Reputation[];
  raids?: InstanceProgress[];
  dungeons?: InstanceProgress[];
  mythicPlus?: MythicPlusProfile;
  /** Boss kill counters of /achievements/statistics, where the API has no /encounters (MoP Classic). */
  encounterStatistics?: EncounterStatistic[];
  /** Mythic+ runs from Raider.IO, for versions that enable it (retail). */
  raiderIo?: RaiderIoProfile;
  /** Endpoints that failed or are unsupported, with the reason. */
  missing: Record<string, string>;
}
