import { BlizzardApiError, type CharacterProfile, type CharacterSummary, type AccountCharacter } from "@wow/blizzard";
import { resolveSpec, type GameProfile } from "@wow/config";
import type { Prisma } from "@wow/db";
import type { CoreContext } from "./context";
import { enrichProfile } from "./static";

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

const isStale = (lastSyncedAt: Date | null, intervalMinutes: number) =>
  !lastSyncedAt || Date.now() - lastSyncedAt.getTime() >= intervalMinutes * 60_000;

/**
 * Mirrors the in-game guild roster: upserts members above the guild's minimum level,
 * detaches characters that left, and returns the characters whose details are stale.
 */
export async function syncGuild(ctx: CoreContext, guildId: string): Promise<{ staleCharacterIds: string[] }> {
  const { prisma, profile } = ctx;
  const guild = await prisma.guild.findUniqueOrThrow({ where: { id: guildId }, include: { ranks: true } });
  const client = ctx.blizzard(guild.region);

  try {
    const [info, members] = await Promise.all([
      client.getGuild(guild.realm, guild.slug),
      client.getGuildRoster(guild.realm, guild.slug),
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
          region_realm_nameKey: { region: guild.region, realm: member.realmSlug, nameKey: nameKey(member.name) },
        },
        create: { region: guild.region, realm: member.realmSlug, name: member.name, nameKey: nameKey(member.name), ...fields },
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

    const roster = await prisma.rosterEntry.findMany({
      where: { guildId },
      select: { character: { select: { id: true, lastSyncedAt: true } } },
    });
    return {
      staleCharacterIds: roster
        .filter((e) => isStale(e.character.lastSyncedAt, guild.syncIntervalMinutes))
        .map((e) => e.character.id),
    };
  } catch (error) {
    const message = error instanceof BlizzardApiError ? `blizzard_${error.status}` : String(error);
    await prisma.guild.update({ where: { id: guildId }, data: { syncError: message } });
    throw error;
  }
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
    equippedItemLevel: summary.equippedItemLevel ?? null,
    lastLoginAt: summary.lastLoginAt ? new Date(summary.lastLoginAt) : null,
  };
}

export type CharacterSyncResult = "updated" | "unchanged" | "not_found";

/**
 * Refreshes one character. When it has not logged in since the last full sync,
 * only the summary is stored to save API quota.
 */
export async function syncCharacter(ctx: CoreContext, characterId: string, force = false): Promise<CharacterSyncResult> {
  const { prisma, profile } = ctx;
  const character = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
  const client = ctx.blizzard(character.region);
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
    character.profile !== null &&
    character.lastLoginAt !== null &&
    summary.lastLoginAt !== undefined &&
    new Date(summary.lastLoginAt).getTime() === character.lastLoginAt.getTime();

  if (unchanged) {
    await prisma.character.update({
      where: { id: characterId },
      data: { ...summaryFields(profile, summary), lastSyncedAt: new Date(), syncError: null },
    });
    return "unchanged";
  }

  const details = await client.getCharacterProfile(ref, summary);
  await enrichProfile(ctx, character.region, details);
  const { summary: _summary, ...stored } = details;
  await prisma.character.update({
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
  return "updated";
}

/**
 * Records the characters of a Battle.net account as owned by the user and
 * releases characters the account no longer has in that region.
 */
export async function claimAccountCharacters(
  ctx: CoreContext,
  userId: string,
  region: string,
  characters: AccountCharacter[],
): Promise<string[]> {
  const { prisma } = ctx;
  const ids: string[] = [];
  for (const c of characters) {
    const fields = {
      blizzardId: c.blizzardId,
      level: c.level,
      classId: c.classId ?? null,
      raceId: c.raceId ?? null,
      faction: c.faction ?? null,
      ownerId: userId,
    };
    const character = await prisma.character.upsert({
      where: { region_realm_nameKey: { region, realm: c.realmSlug, nameKey: nameKey(c.name) } },
      create: { region, realm: c.realmSlug, name: c.name, nameKey: nameKey(c.name), ...fields },
      update: { name: c.name, ...fields },
      select: { id: true },
    });
    ids.push(character.id);
  }
  await prisma.character.updateMany({
    where: { ownerId: userId, region, id: { notIn: ids } },
    data: { ownerId: null, isMain: false },
  });
  return ids;
}

export { nameKey };
