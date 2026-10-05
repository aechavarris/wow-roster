import { defaultRoleForSpec, findClass, type GameProfile } from "@wow/config";

/** Minimal shapes so the roster can be built from Prisma rows or test fixtures. */
export interface RosterInputCharacter {
  id: string;
  region: string;
  realm: string;
  name: string;
  level: number;
  classId: number | null;
  specId: number | null;
  specName: string | null;
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  guildRank: number | null;
  ownerId: string | null;
  isMain: boolean;
  lastSyncedAt: Date | null;
  syncError: string | null;
  avatar?: string | null;
}

export interface RosterInputEntry {
  id: string;
  source: string;
  status: string | null;
  role: string | null;
  note: string | null;
  mainEntryId: string | null;
  character: RosterInputCharacter;
}

export interface RosterCharacterView {
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

export interface RosterPlayerView {
  /** Owner user id, or the main entry id for unclaimed groups. */
  key: string;
  claimed: boolean;
  main: RosterCharacterView;
  alts: RosterCharacterView[];
}

function specKeyFor(profile: GameProfile, character: RosterInputCharacter): string | null {
  const gameClass = findClass(profile, character.classId);
  if (!gameClass) return null;
  const byKey = gameClass.specs.find((s) => s.key === character.specName);
  if (byKey) return byKey.key;
  const byId = character.specId != null ? gameClass.specs.find((s) => s.blizzardIds.includes(character.specId!)) : undefined;
  return byId?.key ?? null;
}

export function toCharacterView(
  profile: GameProfile,
  rankStatus: Map<number, string>,
  entry: RosterInputEntry,
): RosterCharacterView {
  const c = entry.character;
  const specKey = specKeyFor(profile, c);
  const spec = findClass(profile, c.classId)?.specs.find((s) => s.key === specKey);
  const rankDerived = c.guildRank != null ? rankStatus.get(c.guildRank) : undefined;
  const fallbackStatus = profile.rosterStatuses.find((s) => !s.hidden)?.key ?? profile.rosterStatuses[0]!.key;
  return {
    entryId: entry.id,
    characterId: c.id,
    region: c.region,
    realm: c.realm,
    name: c.name,
    level: c.level,
    classId: c.classId,
    specKey,
    role: entry.role ?? defaultRoleForSpec(spec) ?? null,
    roleOverridden: entry.role !== null,
    status: entry.status ?? rankDerived ?? fallbackStatus,
    statusOverridden: entry.status !== null,
    itemLevel: c.equippedItemLevel ?? c.averageItemLevel,
    guildRank: c.guildRank,
    source: entry.source,
    note: entry.note,
    claimed: c.ownerId !== null,
    lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
    syncError: c.syncError,
    avatar: c.avatar ?? null,
  };
}

/**
 * Groups roster entries into players. Verified Battle.net ownership wins;
 * otherwise officers link alts to a main entry.
 */
export function buildRoster(
  profile: GameProfile,
  ranks: { rank: number; status: string }[],
  entries: RosterInputEntry[],
): RosterPlayerView[] {
  const rankStatus = new Map(ranks.map((r) => [r.rank, r.status]));
  const byId = new Map(entries.map((e) => [e.id, e]));

  const groupKey = (entry: RosterInputEntry): string => {
    if (entry.character.ownerId) return `user:${entry.character.ownerId}`;
    const main = entry.mainEntryId ? byId.get(entry.mainEntryId) : undefined;
    if (main?.character.ownerId) return `user:${main.character.ownerId}`;
    return `entry:${main?.id ?? entry.id}`;
  };

  const groups = new Map<string, RosterInputEntry[]>();
  for (const entry of entries) {
    const key = groupKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  const players: RosterPlayerView[] = [];
  for (const [key, group] of groups) {
    const linkedMainId = group.find((e) => e.mainEntryId)?.mainEntryId;
    const main =
      group.find((e) => e.character.ownerId && e.character.isMain) ??
      group.find((e) => e.id === linkedMainId) ??
      [...group].sort(
        (a, b) =>
          b.character.level - a.character.level ||
          (b.character.equippedItemLevel ?? 0) - (a.character.equippedItemLevel ?? 0),
      )[0]!;
    const views = group.map((e) => toCharacterView(profile, rankStatus, e));
    players.push({
      key,
      claimed: key.startsWith("user:"),
      main: views.find((v) => v.entryId === main.id)!,
      alts: views.filter((v) => v.entryId !== main.id).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)),
    });
  }
  return players.sort((a, b) => a.main.name.localeCompare(b.main.name));
}
