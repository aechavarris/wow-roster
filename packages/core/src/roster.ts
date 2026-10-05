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
  /** Null for planned entries that do not exist in the game yet. */
  character: RosterInputCharacter | null;
  plannedName?: string | null;
  plannedClassId?: number | null;
  plannedSpec?: string | null;
  playerName?: string | null;
  userId?: string | null;
}

export interface RosterCharacterView {
  entryId: string;
  characterId: string | null;
  planned: boolean;
  region: string | null;
  realm: string | null;
  name: string;
  playerName: string | null;
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
  /** App user the entry belongs to (verified owner, or the player of a planned entry). */
  userId: string | null;
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

function specKeyFor(profile: GameProfile, classId: number | null, specName: string | null, specId: number | null): string | null {
  const gameClass = findClass(profile, classId);
  if (!gameClass) return null;
  const byKey = gameClass.specs.find((s) => s.key === specName);
  if (byKey) return byKey.key;
  const byId = specId != null ? gameClass.specs.find((s) => s.blizzardIds.includes(specId)) : undefined;
  return byId?.key ?? null;
}

const ownerOf = (entry: RosterInputEntry) => entry.character?.ownerId ?? entry.userId ?? null;

export function toCharacterView(
  profile: GameProfile,
  rankStatus: Map<number, string>,
  entry: RosterInputEntry,
): RosterCharacterView {
  const c = entry.character;
  const classId = c?.classId ?? entry.plannedClassId ?? null;
  const specKey = c
    ? specKeyFor(profile, c.classId, c.specName, c.specId)
    : specKeyFor(profile, classId, entry.plannedSpec ?? null, null);
  const spec = findClass(profile, classId)?.specs.find((s) => s.key === specKey);
  const rankDerived = c?.guildRank != null ? rankStatus.get(c.guildRank) : undefined;
  const fallbackStatus = profile.rosterStatuses.find((s) => !s.hidden)?.key ?? profile.rosterStatuses[0]!.key;
  return {
    entryId: entry.id,
    characterId: c?.id ?? null,
    planned: !c,
    region: c?.region ?? null,
    realm: c?.realm ?? null,
    name: c?.name ?? (entry.plannedName || entry.playerName || "?"),
    playerName: entry.playerName ?? null,
    level: c?.level ?? 0,
    classId,
    specKey,
    role: entry.role ?? defaultRoleForSpec(spec) ?? null,
    roleOverridden: entry.role !== null,
    status: entry.status ?? rankDerived ?? fallbackStatus,
    statusOverridden: entry.status !== null,
    itemLevel: c ? (c.equippedItemLevel ?? c.averageItemLevel) : null,
    guildRank: c?.guildRank ?? null,
    source: entry.source,
    note: entry.note,
    claimed: c?.ownerId != null,
    userId: ownerOf(entry),
    lastSyncedAt: c?.lastSyncedAt?.toISOString() ?? null,
    syncError: c?.syncError ?? null,
    avatar: c?.avatar ?? null,
  };
}

/**
 * Groups roster entries into players. Verified Battle.net ownership (or the player assigned to a
 * planned entry) wins; otherwise officers link alts to a main entry.
 */
export function buildRoster(
  profile: GameProfile,
  ranks: { rank: number; status: string }[],
  entries: RosterInputEntry[],
): RosterPlayerView[] {
  const rankStatus = new Map(ranks.map((r) => [r.rank, r.status]));
  const byId = new Map(entries.map((e) => [e.id, e]));

  const groupKey = (entry: RosterInputEntry): string => {
    const owner = ownerOf(entry);
    if (owner) return `user:${owner}`;
    const main = entry.mainEntryId ? byId.get(entry.mainEntryId) : undefined;
    const mainOwner = main ? ownerOf(main) : null;
    if (mainOwner) return `user:${mainOwner}`;
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
      group.find((e) => e.character?.ownerId && e.character.isMain) ??
      group.find((e) => e.id === linkedMainId) ??
      [...group].sort(
        (a, b) =>
          (b.character?.level ?? 0) - (a.character?.level ?? 0) ||
          (b.character?.equippedItemLevel ?? 0) - (a.character?.equippedItemLevel ?? 0),
      )[0]!;
    const views = group.map((e) => toCharacterView(profile, rankStatus, e));
    players.push({
      key,
      claimed: group.some((e) => e.character?.ownerId),
      main: views.find((v) => v.entryId === main.id)!,
      alts: views.filter((v) => v.entryId !== main.id).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)),
    });
  }
  return players.sort((a, b) => a.main.name.localeCompare(b.main.name));
}
