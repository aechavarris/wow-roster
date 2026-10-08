import type { CharacterProfile, EquippedItem, InstanceProgress, MythicPlusProfile, Profession, RaiderIoProfile, Reputation, StatValue } from "@wow/blizzard";
import type { Buff, DataSource, Dungeon, GameClass, GameRole, Localized, RaidSize, Requirement, RosterStatus, StatSection, TimelineEvent } from "@wow/config";

export type { DataSource };

/** Shapes returned by the API (see apps/api/src/routes). */

/** A game version's rules as the API exposes them (see apps/api/src/routes/meta.ts). */
export interface GameVersion {
  id: string;
  label: string;
  /** Short name for pickers and badges. */
  name: Localized;
  maxLevel: number;
  /** False while Blizzard has no API for the version (Forever): rosters only hold planned characters. */
  apiAvailable: boolean;
  /** Character data the version's API provides (equipment, raids, mythicPlus…); empty without an API. */
  characterEndpoints: string[];
  /** Warcraft Logs site the raid kills come from, where the API has no raid progress (Classic). */
  warcraftLogsHost: string | null;
  /** Details sections the version hides although its API has the data. */
  hiddenDetails: string[];
  /** What the details pages highlight: resistances column, raid reputations. */
  details: { resistances: string[]; keyReputations: number[] };
  /** Attunements tracked by hand, if the version has any. */
  requirements: Requirement[];
  hasRealms: boolean;
  /** Version whose real characters stand in for this one while it has no API (testing), or null. */
  apiStandIn: { id: string; name: Localized } | null;
  /** Rulesets the version has instead of realms (Forever); realm inputs pick one unless the API has realms. */
  rulesets: { key: string; name: Localized }[];
  wowheadDomain: string;
  roles: GameRole[];
  classes: GameClass[];
  raidSizes: RaidSize[];
  raids: { key: string; name: Localized; size: number; enabled: boolean; bossCount?: number; source?: DataSource; note?: string }[];
  /** Dungeons and milestones for the version's overview page (Forever before launch). */
  dungeons: Dungeon[];
  timeline: TimelineEvent[];
  rosterStatuses: RosterStatus[];
  statPanel: StatSection[];
  buffs: Buff[];
  professions: GameProfession[];
  maxPrimaryProfessions: number;
  /** False where the version's API has no professions and owners enter them by hand (Classic). */
  apiProfessions: boolean;
  sync: { defaultIntervalMinutes: number; minIntervalMinutes: number; defaultMinLevel: number };
}

export interface GameProfession {
  id: number;
  key: string;
  name: Localized;
  kind: "primary" | "secondary";
  maxSkill?: number;
}

/** A profession entered by the character's owner; skill is optional. */
export interface ManualProfession {
  id: number;
  skill: number | null;
}

export interface PublicConfig {
  versions: GameVersion[];
  defaultVersion: string;
  regions: string[];
  defaultRegion: string;
  loginEnabled: boolean;
}

export type ViewerRole = "OWNER" | "OFFICER" | "MEMBER" | null;

/** "guild" rosters mirror an in-game guild; "custom" ones have no guild. */
export type RosterKind = "guild" | "custom";

export interface MeResponse {
  user: { id: string; battletag: string; locale: string } | null;
  characters?: {
    id: string;
    gameVersion: string;
    region: string;
    realm: string;
    name: string;
    level: number;
    classId: number | null;
    specName: string | null;
    equippedItemLevel: number | null;
    isMain: boolean;
    avatarUrl: string | null;
    lastSyncedAt: string | null;
    /** "not_found" when the version's API does not know the character. */
    syncError: string | null;
    guild: { id: string; name: string } | null;
  }[];
  guilds?: { id: string; kind: RosterKind; gameVersion: string; name: string; realm: string | null; region: string; role: ViewerRole }[];
}

export interface Guild {
  id: string;
  kind: RosterKind;
  gameVersion: string;
  region: string;
  realm: string | null;
  slug: string | null;
  name: string;
  faction: string | null;
  public: boolean;
  /** Listed for signed-in users, who can propose characters for the owner to accept. */
  published: boolean;
  syncIntervalMinutes: number;
  minLevel: number;
  officerMaxRank: number;
  lastSyncedAt: string | null;
  syncError: string | null;
}

export interface GuildRank {
  rank: number;
  label: string | null;
  status: string;
}

export interface GuildResponse {
  guild: Guild;
  ranks: GuildRank[];
  viewerRole: ViewerRole;
}

export interface RosterCharacter {
  entryId: string;
  /** Null for planned entries that do not exist in the game yet. */
  characterId: string | null;
  planned: boolean;
  gameVersion: string | null;
  region: string | null;
  realm: string | null;
  name: string;
  playerName: string | null;
  userId: string | null;
  level: number;
  classId: number | null;
  specKey: string | null;
  offSpecKey: string | null;
  offRole: string | null;
  role: string | null;
  roleOverridden: boolean;
  status: string;
  statusOverridden: boolean;
  itemLevel: number | null;
  guildRank: number | null;
  source: string;
  note: string | null;
  claimed: boolean;
  lastSyncedAt: string | null;
  syncError: string | null;
  avatar: string | null;
}

export interface RosterPlayer {
  key: string;
  claimed: boolean;
  main: RosterCharacter;
  alts: RosterCharacter[];
}

export interface CharacterDetail {
  id: string;
  gameVersion: string;
  region: string;
  realm: string;
  name: string;
  level: number;
  classId: number | null;
  raceId: number | null;
  gender: string | null;
  faction: string | null;
  specId: number | null;
  specName: string | null;
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  lastLoginAt: string | null;
  avatarUrl: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  claimed: boolean;
  guild: { id: string; name: string } | null;
  profile: Omit<CharacterProfile, "summary"> | null;
  manualProfessions: ManualProfession[] | null;
  manualRequirements: string[] | null;
  bis: BisItem[] | null;
}

/** Where a BiS item is obtained (from the journal or set by hand). */
export interface BisSource {
  type: "raid" | "dungeon" | "quest" | "vendor" | "crafted" | "pvp" | "world" | "other";
  zoneKey?: string;
  zoneName?: Localized;
  bossName?: Localized;
  auto?: boolean;
}

/** One best-in-slot item on a character or planned entry. */
export interface BisItem {
  slot: string;
  itemId: number;
  name: string;
  icon?: string;
  quality?: string;
  itemLevel?: number;
  requiredLevel?: number;
  source?: BisSource;
  note?: string;
}

/** A row from GET /items/search for the BiS item picker. */
export interface ItemSearchResult {
  id: number;
  name: Localized;
  slot: string;
  quality: string | null;
  itemLevel: number | null;
  requiredLevel: number | null;
  icon: string | null;
  source: BisSource | null;
}

/** GET /guilds/:id/roster/:entryId — a roster entry's detail for the character/planned details view. */
export interface RosterEntryDetail {
  id: string;
  gameVersion: string;
  region: string;
  pending: boolean;
  planned: boolean;
  plannedName: string | null;
  plannedClassId: number | null;
  plannedSpec: string | null;
  playerName: string | null;
  note: string | null;
  bis: BisItem[] | null;
  character: { version: string; region: string; realm: string; name: string } | null;
  canEdit: boolean;
}

export interface RosterMember {
  userId: string;
  battletag: string;
  role: Exclude<ViewerRole, null>;
}

export interface RosterInvite {
  id: string;
  role: "OFFICER" | "MEMBER";
  expiresAt: string;
  uses: number;
  maxUses: number | null;
}

/** A proposal on a published roster, waiting for the owner. */
export interface PendingEntry extends RosterCharacter {
  submittedBy: string | null;
  submittedAt: string;
}

/** One character's row data in GET /guilds/:id/details; null where the API gave nothing. */
export interface CharacterDetails {
  level: number;
  equippedItemLevel: number | null;
  averageItemLevel: number | null;
  lastLoginAt: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  missing: Record<string, string>;
  equipment: EquippedItem[] | null;
  professions: Profession[] | null;
  manualProfessions: ManualProfession[] | null;
  reputations: Reputation[] | null;
  raids: InstanceProgress[] | null;
  dungeons: InstanceProgress[] | null;
  mythicPlus: MythicPlusProfile | null;
  raiderIo: RaiderIoProfile | null;
  statistics: Record<string, StatValue> | null;
  talents: TalentSummary[] | null;
  /** Requirement keys the owner ticked (attunements). */
  manualRequirements: string[] | null;
}

/** One talent setup of a character, summarized for the roster table (the full trees are on the character sheet). */
export interface TalentSummary {
  active: boolean;
  specName: string | null;
  loadoutCode: string | null;
  trees: { name: string; points: number | null }[];
}

export interface RosterDetailsResponse {
  characters: Record<string, CharacterDetails>;
  /** Start of the current game week in the roster's region. */
  weekStart: string;
}

export interface WeekInstance {
  instanceId?: number;
  name: Localized;
  difficulty: string;
  difficultyName?: Localized;
  bosses: { id?: number; name: Localized }[];
}

export interface WeekActivity {
  raids: WeekInstance[];
  dungeons: WeekInstance[];
  mythicPlus: { dungeon: Localized; level: number; timed: boolean; completedAt?: string }[];
}

/** GET /guilds/:id/weekly: one week of the roster plus a short history per character. */
export interface WeeklyResponse {
  week: string;
  current: string;
  weeks: string[];
  vault: { raid: number[]; dungeons: number[] } | null;
  characters: Record<
    string,
    { itemLevel: number | null; activity: WeekActivity; vault: { raid: number; dungeons: number; bosses: number; runs: number } | null; updatedAt: string }
  >;
  history: Record<string, { weekStart: string; bosses: number; runs: number; itemLevel: number | null }[]>;
}

export interface RosterResponse {
  players: RosterPlayer[];
  /** Every proposal for the owner; only the viewer's own for anyone else. */
  pending: PendingEntry[];
}

export interface PublishedRoster {
  id: string;
  kind: RosterKind;
  gameVersion: string;
  name: string;
  region: string;
  realm: string | null;
  owner: string | null;
  entries: number;
}
