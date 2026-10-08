import {
  BlizzardApiError,
  RaiderIoError,
  WarcraftLogsError,
  type AccountCharacter,
  type CharacterProfile,
  type CharacterSummary,
  type WarcraftLogsProfile,
} from "@wow/blizzard";
import { resolveSpec, type GameProfile } from "@wow/config";
import type { Prisma } from "@wow/db";
import { gameVersion, type CoreContext } from "./context";
import { announceProgress, detectProgressEvents, type ProgressSnapshot } from "./progress";
import { enrichProfile } from "./static";
import { instancesFromStatistics } from "./encounterStatistics";
import { instancesFromWarcraftLogs, persistWarcraftLogsReports, warcraftLogsStale } from "./warcraftLogs";
import { recordWeek } from "./weekly";

/** Ranks up to this index default to a raiding status; officers can remap them later. */
const DEFAULT_RAIDING_RANKS = 3;

export function defaultStatusForRank(profile: GameProfile, rank: number): string {
  const visible = profile.rosterStatuses.filter((s) => !s.hidden);
  const raiding = visible.find((s) => s.raiding);
  const nonRaiding = visible.find((s) => !s.raiding);
  const pick = rank <= DEFAULT_RAIDING_RANKS ? raiding : nonRaiding;
  return (pick ?? visible[0] ?? profile.rosterStatuses[0])!.key;
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** The slice of a character used to detect progress between two syncs. */
const progressSnapshot = (
  row: { level: number; equippedItemLevel: number | null },
  prof: Partial<CharacterProfile> | null | undefined,
): ProgressSnapshot => ({
  level: row.level,
  equippedItemLevel: row.equippedItemLevel,
  raids: prof?.raids ?? null,
  mythicPlus: prof?.mythicPlus ?? null,
  professions: prof?.professions ?? null,
  reputations: prof?.reputations ?? null,
});

const isStale = (lastSyncedAt: Date | null, intervalMinutes: number) =>
  !lastSyncedAt || Date.now() - lastSyncedAt.getTime() >= intervalMinutes * 60_000;

async function staleRosterCharacters(ctx: CoreContext, guildId: string, intervalMinutes: number) {
  // Planned entries have no character to sync.
  const roster = await ctx.prisma.rosterEntry.findMany({
    where: { guildId, characterId: { not: null } },
    select: { character: { select: { id: true, lastSyncedAt: true } } },
  });
  return roster
    .flatMap((e) => (e.character ? [e.character] : []))
    .filter((c) => isStale(c.lastSyncedAt, intervalMinutes))
    .map((c) => c.id);
}

/**
 * Refreshes a roster. Guild-linked rosters mirror the in-game guild: members above the minimum
 * level are upserted and characters that left are detached. Custom rosters have no in-game
 * guild, so only their characters are refreshed. Returns the characters whose details are stale.
 */
export async function syncGuild(ctx: CoreContext, guildId: string): Promise<{ staleCharacterIds: string[] }> {
  const { prisma } = ctx;
  const guild = await prisma.guild.findUniqueOrThrow({ where: { id: guildId }, include: { ranks: true } });
  const profile = gameVersion(ctx, guild.gameVersion);

  if (guild.kind !== "guild" || !guild.realm || !guild.slug) {
    await prisma.guild.update({ where: { id: guildId }, data: { lastSyncedAt: new Date(), syncError: null } });
    return { staleCharacterIds: await staleRosterCharacters(ctx, guildId, guild.syncIntervalMinutes) };
  }
  const realm = guild.realm;
  const slug = guild.slug;
  const client = ctx.blizzard(guild.gameVersion, guild.region);

  try {
    const [info, members] = await Promise.all([
      client.getGuild(realm, slug),
      client.getGuildRoster(realm, slug),
    ]);

    const knownRanks = new Set(guild.ranks.map((r) => r.rank));
    const newRanks = [...new Set(members.map((m) => m.rank))].filter((rank) => !knownRanks.has(rank));
    if (newRanks.length > 0) {
      await prisma.guildRank.createMany({
        data: newRanks.map((rank) => ({ guildId, rank, status: defaultStatusForRank(profile, rank) })),
        skipDuplicates: true,
      });
    }

    const tracked = members.filter((m) => m.level >= guild.minLevel);
    const characterIds: string[] = [];
    for (const member of tracked) {
      const fields = {
        blizzardId: member.blizzardId,
        level: member.level,
        classId: member.classId ?? null,
        raceId: member.raceId ?? null,
        guildId,
        guildRank: member.rank,
      };
      const character = await prisma.character.upsert({
        where: {
          gameVersion_region_realm_nameKey: {
            gameVersion: guild.gameVersion,
            region: guild.region,
            realm: member.realmSlug,
            nameKey: nameKey(member.name),
          },
        },
        create: {
          gameVersion: guild.gameVersion,
          region: guild.region,
          realm: member.realmSlug,
          name: member.name,
          nameKey: nameKey(member.name),
          ...fields,
        },
        update: { name: member.name, ...fields },
        select: { id: true },
      });
      characterIds.push(character.id);
      await prisma.rosterEntry.upsert({
        where: { guildId_characterId: { guildId, characterId: character.id } },
        create: { guildId, characterId: character.id, source: "guild" },
        update: {},
      });
    }

    // Characters that left the guild (or fell below the level threshold).
    const departed = await prisma.character.findMany({
      where: { guildId, id: { notIn: characterIds } },
      select: { id: true },
    });
    if (departed.length > 0) {
      const departedIds = departed.map((c) => c.id);
      await prisma.character.updateMany({ where: { id: { in: departedIds } }, data: { guildId: null, guildRank: null } });
      await prisma.rosterEntry.deleteMany({ where: { guildId, source: "guild", characterId: { in: departedIds } } });
    }

    await prisma.guild.update({
      where: { id: guildId },
      data: {
        name: info.name || guild.name,
        faction: info.faction ?? guild.faction,
        blizzardId: info.blizzardId ?? guild.blizzardId,
        lastSyncedAt: new Date(),
        syncError: null,
      },
    });

    return { staleCharacterIds: await staleRosterCharacters(ctx, guildId, guild.syncIntervalMinutes) };
  } catch (error) {
    const message = error instanceof BlizzardApiError ? `blizzard_${error.status}` : String(error);
    await prisma.guild.update({ where: { id: guildId }, data: { syncError: message } });
    throw error;
  }
}

/** Slots that carry no item level of their own. */
const COSMETIC_SLOTS = new Set(["SHIRT", "TABARD"]);

/**
 * Average item level of the equipped gear, for versions whose character summary does not report one
 * (Classic): each item counts once, so a two-hander with an empty off hand weighs a little less than
 * in game. Undefined without gear that has item levels.
 */
export function averageEquippedItemLevel(equipment: { slot: string; itemLevel?: number }[] | undefined): number | undefined {
  const levels = (equipment ?? []).filter((i) => !COSMETIC_SLOTS.has(i.slot) && i.itemLevel).map((i) => i.itemLevel!);
  if (levels.length === 0) return undefined;
  return Math.round((levels.reduce((a, b) => a + b, 0) / levels.length) * 10) / 10;
}

function summaryFields(profile: GameProfile, summary: CharacterSummary, details?: CharacterProfile) {
  const activeSetup = details?.talents?.find((t) => t.active);
  const specRef = summary.activeSpec ?? { id: activeSetup?.specId, name: activeSetup?.specName };
  const spec = resolveSpec(profile, summary.classId, specRef);
  return {
    name: summary.name,
    blizzardId: summary.blizzardId,
    level: summary.level,
    classId: summary.classId ?? null,
    raceId: summary.raceId ?? null,
    gender: summary.gender ?? null,
    faction: summary.faction ?? null,
    specId: specRef.id ?? spec?.blizzardIds[0] ?? null,
    specName: spec?.key ?? specRef.name ?? null,
    averageItemLevel: summary.averageItemLevel ?? null,
    equippedItemLevel: summary.equippedItemLevel ?? averageEquippedItemLevel(details?.equipment) ?? null,
    lastLoginAt: summary.lastLoginAt ? new Date(summary.lastLoginAt) : null,
  };
}

export type CharacterSyncResult = "updated" | "unchanged" | "not_found";

/** Where each character endpoint of a game profile lands in the stored CharacterProfile. */
const ENDPOINT_KEYS = {
  equipment: "equipment",
  specializations: "talents",
  media: "media",
  statistics: "statistics",
  professions: "professions",
  reputations: "reputations",
  raids: "raids",
  dungeons: "dungeons",
  mythicPlus: "mythicPlus",
  encounterStatistics: "encounterStatistics",
} as const satisfies Record<GameProfile["api"]["characterEndpoints"][number], keyof CharacterProfile>;

/**
 * Whether a stored profile lacks data the game version now provides: an endpoint added to the profile after
 * the last full sync (e.g. Mythic+), or one that failed then for a reason other than "the character has no
 * such data" (404). Such profiles are refetched even when the character has not logged in since.
 */
export function profileIncomplete(profile: GameProfile, stored: Partial<CharacterProfile> | null): boolean {
  if (!stored) return true;
  // Mythic+ profiles stored before season bests were fetched, or whose season request failed.
  if (stored.mythicPlus && stored.mythicPlus.seasonRuns === undefined) return true;
  if (profile.api.raiderIo && stored.raiderIo === undefined && stored.missing?.raiderIo !== "404") return true;
  return profile.api.characterEndpoints.some((endpoint) => {
    if (stored[ENDPOINT_KEYS[endpoint]] !== undefined) return false;
    const reason = stored.missing?.[endpoint];
    return reason !== "404" && reason !== "unsupported";
  });
}

/**
 * The character's recent boss kills from Warcraft Logs, for versions that read raids from there. A character the
 * site does not know gets an empty result, so it is asked again only after the TTL; other failures are retried.
 */
async function fetchWarcraftLogs(
  ctx: CoreContext,
  profile: GameProfile,
  character: { region: string; realm: string; name: string },
): Promise<{ data?: WarcraftLogsProfile; missing?: string }> {
  const host = profile.api.warcraftLogs?.host;
  if (!host || !ctx.warcraftLogs) return {};
  try {
    return { data: await ctx.warcraftLogs.getCharacterKills(host, character.region, character.realm, character.name) };
  } catch (error) {
    if (error instanceof WarcraftLogsError && error.notFound) {
      return { data: { url: `https://${host}/character/${character.region}/${character.realm}/${character.name.toLowerCase()}`, fetchedAt: new Date().toISOString(), kills: [] } };
    }
    return { missing: error instanceof WarcraftLogsError ? String(error.status) : "error" };
  }
}

/** Raid progress from Warcraft Logs where the version's API gives none (neither /encounters nor statistics). */
const raidsFromLogs = (profile: GameProfile, stored: Partial<CharacterProfile>) =>
  !profile.api.characterEndpoints.includes("raids") && !stored.encounterStatistics && stored.warcraftLogs
    ? instancesFromWarcraftLogs(profile, stored.warcraftLogs)
    : stored.raids;

/**
 * Refreshes one character. When it has not logged in since the last full sync,
 * only the summary is stored to save API quota.
 */
export async function syncCharacter(ctx: CoreContext, characterId: string, force = false): Promise<CharacterSyncResult> {
  const { prisma } = ctx;
  const character = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
  const profile = gameVersion(ctx, character.gameVersion);
  const client = ctx.blizzard(character.gameVersion, character.region);
  const ref = { realm: character.realm, name: character.name };

  let summary: CharacterSummary;
  try {
    summary = await client.getCharacterSummary(ref);
  } catch (error) {
    if (error instanceof BlizzardApiError && error.notFound) {
      await prisma.character.update({
        where: { id: characterId },
        data: { syncError: "not_found", lastSyncedAt: new Date() },
      });
      return "not_found";
    }
    throw error;
  }

  const unchanged =
    !force &&
    !profileIncomplete(profile, character.profile as Partial<CharacterProfile> | null) &&
    character.lastLoginAt !== null &&
    summary.lastLoginAt !== undefined &&
    new Date(summary.lastLoginAt).getTime() === character.lastLoginAt.getTime();

  if (unchanged) {
    let stored = character.profile as Partial<CharacterProfile> | null;
    // Logs are uploaded after the raid, often once the players have logged out: they are refreshed on their own.
    if (profile.api.warcraftLogs && ctx.warcraftLogs && stored && warcraftLogsStale(stored)) {
      const logs = await fetchWarcraftLogs(ctx, profile, character);
      if (logs.data) {
        stored = { ...stored, warcraftLogs: logs.data, missing: { ...stored.missing } };
        delete stored.missing!.warcraftLogs;
        stored.raids = raidsFromLogs(profile, stored);
      }
    }
    const updated = await prisma.character.update({
      where: { id: characterId },
      data: {
        // The stored profile keeps the gear-based item level for versions whose summary has none.
        ...summaryFields(profile, summary, (stored ?? undefined) as CharacterProfile | undefined),
        ...(stored !== character.profile ? { profile: JSON.parse(JSON.stringify(stored)) as Prisma.InputJsonValue } : {}),
        lastSyncedAt: new Date(),
        syncError: null,
      },
    });
    // A new week starts with nothing done, even for characters that have not logged in.
    await recordWeek(ctx, updated, stored);
    await persistWarcraftLogsReports(ctx, updated, stored?.warcraftLogs, profile);
    if (character.lastSyncedAt) {
      // Logs refreshed above can add raid kills even when the character did not log in.
      const events = detectProgressEvents(profile, progressSnapshot(character, character.profile as Partial<CharacterProfile> | null), progressSnapshot(updated, stored));
      await announceProgress(ctx, updated, events);
    }
    return "unchanged";
  }

  const details = await client.getCharacterProfile(ref, summary);
  // Versions without /encounters get their raid and dungeon progress from the boss kill statistics.
  if (details.encounterStatistics && !profile.api.characterEndpoints.includes("raids")) {
    const fromStats = instancesFromStatistics(profile, details.encounterStatistics);
    details.raids = fromStats.raids;
    details.dungeons = fromStats.dungeons;
  }
  if (profile.api.raiderIo && ctx.raiderIo) {
    try {
      details.raiderIo = await ctx.raiderIo.getProfile(character.region, character.realm, character.name);
    } catch (error) {
      // Best effort: Blizzard's data still covers the rating and weekly bests. Unknown characters are not retried.
      details.missing.raiderIo = error instanceof RaiderIoError ? (error.notFound ? "404" : String(error.status)) : "error";
    }
  }
  if (profile.api.warcraftLogs && ctx.warcraftLogs) {
    const previous = (character.profile as Partial<CharacterProfile> | null)?.warcraftLogs;
    const logs = await fetchWarcraftLogs(ctx, profile, character);
    // A failed request keeps the kills already known rather than wiping the raid progress.
    details.warcraftLogs = logs.data ?? previous;
    if (logs.missing) details.missing.warcraftLogs = logs.missing;
    details.raids = raidsFromLogs(profile, details);
  }
  await enrichProfile(ctx, { version: character.gameVersion, region: character.region }, details);
  const { summary: _summary, ...stored } = details;
  const updated = await prisma.character.update({
    where: { id: characterId },
    data: {
      ...summaryFields(profile, summary, details),
      avatarUrl: details.media?.avatar ?? character.avatarUrl,
      // Round-trip through JSON to drop undefined values, which Prisma rejects in Json columns.
      profile: JSON.parse(JSON.stringify(stored)) as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
      syncError: null,
    },
  });
  await recordWeek(ctx, updated, stored);
  await persistWarcraftLogsReports(ctx, updated, stored.warcraftLogs, profile);
  if (character.lastSyncedAt) {
    const events = detectProgressEvents(profile, progressSnapshot(character, character.profile as Partial<CharacterProfile> | null), progressSnapshot(updated, stored));
    await announceProgress(ctx, updated, events);
  }
  return "updated";
}

/**
 * Records the characters of a Battle.net account in one game version as owned by the user and
 * releases characters the account no longer has in that version and region.
 */
/**
 * Whether a character can belong to a game version: its class exists there and its level fits the cap.
 * The account endpoint of one game version's namespace can list characters of other versions (an
 * Evoker in Classic, a level 70 in Classic Era): those must not be stored under the wrong version.
 */
export function fitsGameVersion(profile: GameProfile, character: { classId?: number | null; level?: number | null }): boolean {
  if (character.classId != null && !profile.classes.some((c) => c.id === character.classId)) return false;
  return (character.level ?? 0) <= profile.maxLevel;
}

export async function claimAccountCharacters(
  ctx: CoreContext,
  userId: string,
  target: { version: string; region: string },
  characters: AccountCharacter[],
): Promise<{ id: string; level: number }[]> {
  const { version: versionId, region } = target;
  const profile = gameVersion(ctx, versionId);
  const { prisma } = ctx;
  const claimed: { id: string; level: number }[] = [];
  for (const c of characters.filter((c) => fitsGameVersion(profile, c))) {
    const fields = {
      blizzardId: c.blizzardId,
      level: c.level,
      classId: c.classId ?? null,
      raceId: c.raceId ?? null,
      faction: c.faction ?? null,
      ownerId: userId,
    };
    const character = await prisma.character.upsert({
      where: { gameVersion_region_realm_nameKey: { gameVersion: versionId, region, realm: c.realmSlug, nameKey: nameKey(c.name) } },
      create: { gameVersion: versionId, region, realm: c.realmSlug, name: c.name, nameKey: nameKey(c.name), ...fields },
      update: { name: c.name, ...fields },
      select: { id: true },
    });
    claimed.push({ id: character.id, level: c.level });
  }
  // Characters no longer on the account, or listed under a version they do not belong to, are released.
  await prisma.character.updateMany({
    where: { ownerId: userId, gameVersion: versionId, region, id: { notIn: claimed.map((c) => c.id) } },
    data: { ownerId: null, isMain: false },
  });
  return claimed;
}

export { nameKey };
