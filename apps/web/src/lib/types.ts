import type { CharacterProfile } from "@wow/blizzard";
import type { GameClass, GameRole, Localized, RaidSize, RosterStatus, StatSection } from "@wow/config";

/** Shapes returned by the API (see apps/api/src/routes). */

export interface PublicConfig {
  profile: {
    id: string;
    label: string;
    maxLevel: number;
    hasRealms: boolean;
    wowheadDomain: string;
    roles: GameRole[];
    classes: GameClass[];
    raidSizes: RaidSize[];
    raids: { key: string; name: Localized; size: number; enabled: boolean }[];
    rosterStatuses: RosterStatus[];
    statPanel: StatSection[];
    sync: { defaultIntervalMinutes: number; minIntervalMinutes: number; defaultMinLevel: number };
  };
  regions: string[];
  defaultRegion: string;
  loginEnabled: boolean;
}

export type ViewerRole = "OWNER" | "OFFICER" | "MEMBER" | null;

export interface MeResponse {
  user: { id: string; battletag: string; locale: string } | null;
  characters?: {
    id: string;
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
    guild: { id: string; name: string } | null;
  }[];
  guilds?: { id: string; name: string; realm: string; region: string; role: ViewerRole }[];
}

export interface Guild {
  id: string;
  region: string;
  realm: string;
  slug: string;
  name: string;
  faction: string | null;
  public: boolean;
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
  characterId: string;
  region: string;
  realm: string;
  name: string;
  level: number;
  classId: number | null;
  specKey: string | null;
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
}
