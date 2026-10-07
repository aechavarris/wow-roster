import { BlizzardApiError, type CharacterProfile } from "@wow/blizzard";
import { REGIONS, blizzardSlug } from "@wow/config";
import {
  averageEquippedItemLevel,
  buildRoster,
  defaultStatusForRank,
  fitsGameVersion,
  gameVersion,
  nameKey,
  syncCharacter,
  toCharacterView,
  vaultSlots,
  weekStart,
  type WeekActivity,
} from "@wow/core";
import type { User } from "@wow/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { HttpError, forbidden, gameVersionSchema, notFound, unauthorized } from "../errors";
import { atLeast, loadVisibleGuild, requireGuildRole, type ViewerRole } from "../permissions";

const idParams = z.object({ id: z.string() });

/** Weeks of history the weekly audit returns, the selected week included. */
const HISTORY_WEEKS = 12;

/** Pending proposals a non-member can have in one published roster, to keep the owner's queue manageable. */
const MAX_PENDING_PER_USER = 10;

export async function guildRoutes(app: FastifyInstance, deps: AppDeps) {
  const { prisma, versions, core, queue, env } = deps;
  const versionField = gameVersionSchema(versions);
  /** The rules of the roster's game version: classes, roles, statuses, sync limits. */
  const rules = (guild: { gameVersion: string }) => gameVersion(core, guild.gameVersion);
  const requireKey = (keys: { key: string }[], value: string | null | undefined, code: string) => {
    if (value != null && !keys.some((k) => k.key === value)) throw new HttpError(400, code);
  };

  const serializeGuild = (guild: Awaited<ReturnType<typeof loadVisibleGuild>>["guild"]) => ({
    id: guild.id,
    kind: guild.kind,
    gameVersion: guild.gameVersion,
    region: guild.region,
    realm: guild.realm,
    slug: guild.slug,
    name: guild.name,
    faction: guild.faction,
    public: guild.public,
    published: guild.published,
    syncIntervalMinutes: guild.syncIntervalMinutes,
    minLevel: guild.minLevel,
    officerMaxRank: guild.officerMaxRank,
    lastSyncedAt: guild.lastSyncedAt,
    syncError: guild.syncError,
  });

  /**
   * Registers an in-game guild. The user must own a character at officer rank,
   * unless ALLOW_UNVERIFIED_GUILDS is enabled (local development).
   */
  app.post("/guilds", async (request, reply) => {
    const user = request.user;
    if (!user) throw unauthorized();
    const body = z
      .object({ gameVersion: versionField, region: z.enum(REGIONS), realm: z.string().min(1), name: z.string().min(1) })
      .parse(request.body);
    const profile = gameVersion(core, body.gameVersion);
    const realm = blizzardSlug(body.realm);
    const slug = blizzardSlug(body.name);

    const existing = await prisma.guild.findUnique({
      where: { gameVersion_region_realm_slug: { gameVersion: body.gameVersion, region: body.region, realm, slug } },
    });
    if (existing) throw new HttpError(409, "guild_already_registered", existing.id);

    const client = core.blizzard(body.gameVersion, body.region);
    let info, members;
    try {
      [info, members] = await Promise.all([client.getGuild(realm, slug), client.getGuildRoster(realm, slug)]);
    } catch (error) {
      if (error instanceof BlizzardApiError && error.notFound) throw notFound("guild_not_found_in_game");
      throw error;
    }

    const owned = await prisma.character.findMany({
      where: { ownerId: user.id, gameVersion: body.gameVersion, region: body.region },
      select: { blizzardId: true, realm: true, nameKey: true },
    });
    const officerMaxRank = 1;
    const isOfficer = members.some(
      (m) =>
        m.rank <= officerMaxRank &&
        owned.some((c) => c.blizzardId === m.blizzardId || (c.realm === m.realmSlug && c.nameKey === nameKey(m.name))),
    );
    if (!isOfficer && !env.ALLOW_UNVERIFIED_GUILDS) throw new HttpError(403, "not_guild_officer");

    const ranks = [...new Set(members.map((m) => m.rank))].sort((a, b) => a - b);
    const guild = await prisma.guild.create({
      data: {
        gameVersion: body.gameVersion,
        region: body.region,
        realm,
        slug,
        name: info.name || body.name,
        faction: info.faction,
        blizzardId: info.blizzardId,
        syncIntervalMinutes: profile.sync.defaultIntervalMinutes,
        minLevel: profile.sync.defaultMinLevel,
        officerMaxRank,
        ranks: { create: ranks.map((rank) => ({ rank, status: defaultStatusForRank(profile, rank) })) },
        memberships: { create: { userId: user.id, role: "OWNER" } },
      },
    });

    await queue.scheduleGuild(guild.id, guild.syncIntervalMinutes);
    await queue.syncGuildNow(guild.id);
    return reply.status(201).send({ guild: serializeGuild(guild) });
  });

  /** Creates a roster without an in-game guild; the creator owns it and invites others by link. */
  app.post("/rosters", async (request, reply) => {
    const user = request.user;
    if (!user) throw unauthorized();
    const body = z
      .object({
        name: z.string().trim().min(1).max(60),
        gameVersion: versionField,
        region: z.enum(REGIONS),
        public: z.boolean().optional(),
      })
      .parse(request.body);
    const profile = gameVersion(core, body.gameVersion);
    const guild = await prisma.guild.create({
      data: {
        kind: "custom",
        gameVersion: body.gameVersion,
        region: body.region,
        name: body.name,
        public: body.public ?? true,
        syncIntervalMinutes: profile.sync.defaultIntervalMinutes,
        minLevel: profile.sync.defaultMinLevel,
        memberships: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    await queue.scheduleGuild(guild.id, guild.syncIntervalMinutes);
    return reply.status(201).send({ guild: serializeGuild(guild) });
  });

  app.get("/guilds/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const { guild, role } = await loadVisibleGuild(prisma, id, request.user);
    const ranks = await prisma.guildRank.findMany({ where: { guildId: id }, orderBy: { rank: "asc" } });
    return { guild: serializeGuild(guild), ranks, viewerRole: role };
  });

  app.patch("/guilds/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const { guild, role } = await requireGuildRole(prisma, id, request.user, "OFFICER");
    const profile = rules(guild);
    const body = z
      .object({
        // Linked rosters take their name from the in-game guild.
        name: z.string().trim().min(1).max(60).optional(),
        /** Only the owner changes it, and only on custom rosters without real characters. */
        gameVersion: versionField.optional(),
        /** Only the owner publishes: signed-in users can then see the roster and propose characters. */
        published: z.boolean().optional(),
        public: z.boolean().optional(),
        syncIntervalMinutes: z.number().int().min(profile.sync.minIntervalMinutes).max(24 * 60).optional(),
        minLevel: z.number().int().min(1).max(profile.maxLevel).optional(),
        officerMaxRank: z.number().int().min(0).max(9).optional(),
      })
      .parse(request.body);
    if (body.name !== undefined && guild.kind === "guild") throw new HttpError(400, "name_from_game");
    if (body.published !== undefined && body.published !== guild.published && role !== "OWNER") throw forbidden();
    if (body.gameVersion !== undefined && body.gameVersion !== guild.gameVersion) {
      if (role !== "OWNER") throw forbidden();
      // A linked roster mirrors a guild that exists in one game version.
      if (guild.kind === "guild") throw new HttpError(400, "game_version_from_guild");
      // Real characters belong to their game version's API; only planned entries can move.
      if (await prisma.rosterEntry.count({ where: { guildId: id, characterId: { not: null } } })) {
        throw new HttpError(409, "game_version_has_characters");
      }
      // Planned specs that do not exist in the new version are cleared; classes stay so they can be re-picked.
      const target = gameVersion(core, body.gameVersion);
      const planned = await prisma.rosterEntry.findMany({ where: { guildId: id, plannedSpec: { not: null } } });
      const invalid = planned.filter(
        (e) => !target.classes.find((c) => c.id === e.plannedClassId)?.specs.some((s) => s.key === e.plannedSpec),
      );
      if (invalid.length > 0) {
        await prisma.rosterEntry.updateMany({ where: { id: { in: invalid.map((e) => e.id) } }, data: { plannedSpec: null } });
      }
    }
    const updated = await prisma.guild.update({ where: { id }, data: body });
    if (body.syncIntervalMinutes && body.syncIntervalMinutes !== guild.syncIntervalMinutes) {
      await queue.scheduleGuild(id, body.syncIntervalMinutes);
    }
    return { guild: serializeGuild(updated) };
  });

  /**
   * Only the owner deletes a roster, typing its name to confirm. Entries, ranks, memberships and
   * invites go with it; characters stay (their guild link is cleared) since they belong to players.
   */
  app.delete("/guilds/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const { guild } = await requireGuildRole(prisma, id, request.user, "OWNER");
    const body = z.object({ confirmName: z.string() }).parse(request.body ?? {});
    if (body.confirmName.trim() !== guild.name) throw new HttpError(400, "confirm_name_mismatch");
    await queue.unscheduleGuild(id);
    await prisma.guild.delete({ where: { id } });
    return { deleted: true };
  });

  app.put("/guilds/:id/ranks", async (request) => {
    const { id } = idParams.parse(request.params);
    const { guild } = await requireGuildRole(prisma, id, request.user, "OFFICER");
    if (guild.kind !== "guild") throw new HttpError(400, "custom_roster_has_no_ranks");
    const body = z
      .array(z.object({ rank: z.number().int().min(0).max(9), label: z.string().max(40).nullable().optional(), status: z.string() }))
      .parse(request.body);
    for (const r of body) requireKey(rules(guild).rosterStatuses, r.status, "unknown_status");
    await prisma.$transaction(
      body.map((r) =>
        prisma.guildRank.upsert({
          where: { guildId_rank: { guildId: id, rank: r.rank } },
          create: { guildId: id, rank: r.rank, label: r.label ?? null, status: r.status },
          update: { label: r.label ?? null, status: r.status },
        }),
      ),
    );
    return { ranks: await prisma.guildRank.findMany({ where: { guildId: id }, orderBy: { rank: "asc" } }) };
  });

  /**
   * Roster players (accepted entries only) plus pending proposals: the owner sees every proposal,
   * anyone else only their own.
   */
  app.get("/guilds/:id/roster", async (request) => {
    const { id } = idParams.parse(request.params);
    const { guild, role } = await loadVisibleGuild(prisma, id, request.user);
    const [ranks, entries] = await Promise.all([
      prisma.guildRank.findMany({ where: { guildId: id } }),
      prisma.rosterEntry.findMany({
        where: { guildId: id },
        include: {
          user: { select: { battletag: true } },
          character: {
            select: {
              id: true,
              gameVersion: true,
              region: true,
              realm: true,
              name: true,
              level: true,
              classId: true,
              specId: true,
              specName: true,
              averageItemLevel: true,
              equippedItemLevel: true,
              guildRank: true,
              ownerId: true,
              isMain: true,
              lastSyncedAt: true,
              syncError: true,
              avatarUrl: true,
            },
          },
        },
      }),
    ]);
    const inputs = entries.map((e) => ({ ...e, character: e.character && { ...e.character, avatar: e.character.avatarUrl } }));
    const players = buildRoster(rules(guild), ranks, inputs.filter((e) => !e.pending));
    const rankStatus = new Map(ranks.map((r) => [r.rank, r.status]));
    const pending = inputs
      .filter((e) => e.pending && (role === "OWNER" || (request.user !== null && e.userId === request.user.id)))
      .map((e) => ({
        ...toCharacterView(rules(guild), rankStatus, e),
        submittedBy: e.user?.battletag ?? null,
        submittedAt: e.createdAt,
      }));
    return { players, pending };
  });

  /**
   * Per-character details for the roster's details table (gear, dungeons, raids, reputations,
   * professions), keyed by character id; roster order and names come from GET /roster.
   */
  app.get("/guilds/:id/details", async (request) => {
    const { id } = idParams.parse(request.params);
    await loadVisibleGuild(prisma, id, request.user);
    const entries = await prisma.rosterEntry.findMany({
      where: { guildId: id, pending: false, characterId: { not: null } },
      select: {
        character: {
          select: {
            id: true,
            level: true,
            equippedItemLevel: true,
            averageItemLevel: true,
            lastLoginAt: true,
            lastSyncedAt: true,
            syncError: true,
            profile: true,
            manualProfessions: true,
          },
        },
      },
    });
    const characters: Record<string, unknown> = {};
    for (const { character: c } of entries) {
      if (!c) continue;
      const profile = (c.profile ?? null) as Partial<CharacterProfile> | null;
      characters[c.id] = {
        level: c.level,
        // Rows synced before the gear-based fallback existed get it computed here.
        equippedItemLevel: c.equippedItemLevel ?? averageEquippedItemLevel(profile?.equipment) ?? null,
        averageItemLevel: c.averageItemLevel,
        lastLoginAt: c.lastLoginAt,
        lastSyncedAt: c.lastSyncedAt,
        syncError: c.syncError,
        missing: profile?.missing ?? {},
        // Full items: the table shows the same in-game tooltip as the character sheet.
        equipment: profile?.equipment ?? null,
        professions: profile?.professions ?? null,
        manualProfessions: c.manualProfessions,
        reputations: profile?.reputations ?? null,
        raids: profile?.raids ?? null,
        dungeons: profile?.dungeons ?? null,
        mythicPlus: profile?.mythicPlus ?? null,
      };
    }
    return { characters };
  });

  /**
   * Weekly audit: what each roster character did in one game week (default: the current one) and a
   * short history of the previous weeks. Weeks follow the roster region's weekly reset.
   */
  app.get("/guilds/:id/weekly", async (request) => {
    const { id } = idParams.parse(request.params);
    const query = z.object({ week: z.coerce.date().optional() }).parse(request.query);
    const { guild } = await loadVisibleGuild(prisma, id, request.user);
    const rules = gameVersion(core, guild.gameVersion).weekly;
    const current = weekStart(rules, guild.region);
    const selected = query.week ? weekStart(rules, guild.region, query.week) : current;

    const entries = await prisma.rosterEntry.findMany({
      where: { guildId: id, pending: false, characterId: { not: null } },
      select: { characterId: true },
    });
    const characterIds = entries.flatMap((e) => (e.characterId ? [e.characterId] : []));
    const rows = await prisma.characterWeek.findMany({
      where: { characterId: { in: characterIds }, weekStart: { lte: current, gte: new Date(current.getTime() - (HISTORY_WEEKS - 1) * 7 * 86_400_000) } },
      orderBy: { weekStart: "desc" },
    });

    const weeks = [...new Set([current.toISOString(), ...rows.map((r) => r.weekStart.toISOString())])].sort().reverse();
    const characters: Record<string, unknown> = {};
    const history: Record<string, { weekStart: string; bosses: number; runs: number; itemLevel: number | null }[]> = {};
    for (const row of rows) {
      const activity = row.data as unknown as WeekActivity;
      const vault = vaultSlots(rules, activity);
      const bosses = new Set(activity.raids.flatMap((r) => r.bosses.map((b) => `${r.instanceId}:${b.id}`))).size;
      (history[row.characterId] ??= []).push({ weekStart: row.weekStart.toISOString(), bosses, runs: activity.mythicPlus.length, itemLevel: row.itemLevel });
      if (row.weekStart.getTime() === selected.getTime()) {
        characters[row.characterId] = { itemLevel: row.itemLevel, activity, vault, updatedAt: row.updatedAt };
      }
    }
    return { week: selected.toISOString(), current: current.toISOString(), weeks, vault: rules?.vault ?? null, characters, history };
  });

  /** Published rosters for signed-in users, newest first; optionally of one game version. */
  app.get("/rosters/published", async (request) => {
    if (!request.user) throw unauthorized();
    const query = z.object({ gameVersion: versionField.optional() }).parse(request.query);
    const rosters = await prisma.guild.findMany({
      where: { published: true, ...(query.gameVersion ? { gameVersion: query.gameVersion } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        memberships: { where: { role: "OWNER" }, select: { user: { select: { battletag: true } } } },
        _count: { select: { roster: { where: { pending: false } } } },
      },
    });
    return {
      rosters: rosters.map((g) => ({
        id: g.id,
        kind: g.kind,
        gameVersion: g.gameVersion,
        name: g.name,
        region: g.region,
        realm: g.realm,
        owner: g.memberships[0]?.user.battletag.split("#")[0] ?? null,
        entries: g._count.roster,
      })),
    };
  });

  /**
   * Who may add entries: members add directly; on a published roster any signed-in user may
   * propose entries, which stay pending until the owner accepts them.
   */
  async function contributor(guildId: string, user: User | null) {
    if (!user) throw unauthorized();
    const { guild, role } = await loadVisibleGuild(prisma, guildId, user);
    if (atLeast(role, "MEMBER")) return { guild, role, pending: false };
    if (!guild.published) throw forbidden();
    const open = await prisma.rosterEntry.count({ where: { guildId, pending: true, userId: user.id } });
    return { guild, role: null as ViewerRole, pending: true, slots: MAX_PENDING_PER_USER - open };
  }

  /**
   * Finds a character of the roster's game version, looking it up in that version's API (and
   * syncing it) when it is new to the app.
   */
  async function findOrSyncCharacter(guild: { gameVersion: string; region: string }, realmInput: string, name: string) {
    const { gameVersion: version, region } = guild;
    // Throws (409) for versions without an API before anything is stored.
    core.blizzard(version, region);
    const key = { gameVersion: version, region, realm: blizzardSlug(realmInput), nameKey: nameKey(name) };
    let character = await prisma.character.findUnique({ where: { gameVersion_region_realm_nameKey: key } });
    const created = !character;
    character ??= await prisma.character.create({ data: { ...key, name: name.trim() } });
    const result = await syncCharacter(core, character.id, true);
    if (result === "not_found") {
      if (created) await prisma.character.delete({ where: { id: character.id } });
      throw notFound("character_not_found_in_game");
    }
    return character;
  }

  /** Validates a planned class/spec pair against the roster's game version. */
  function plannedClass(guild: { gameVersion: string }, classId: number, specKey: string | null | undefined) {
    const gameClass = rules(guild).classes.find((c) => c.id === classId);
    if (!gameClass) throw new HttpError(400, "unknown_class");
    if (specKey && !gameClass.specs.some((s) => s.key === specKey)) throw new HttpError(400, "unknown_spec");
  }

  /** Adds a character that is not in the in-game guild (e.g. an alt in another guild). */
  app.post("/guilds/:id/roster", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { guild } = await requireGuildRole(prisma, id, request.user, "OFFICER");
    const body = z.object({ realm: z.string().min(1), name: z.string().min(1) }).parse(request.body);
    const character = await findOrSyncCharacter(guild, body.realm, body.name);

    const entry = await prisma.rosterEntry.upsert({
      where: { guildId_characterId: { guildId: id, characterId: character.id } },
      create: { guildId: id, characterId: character.id, source: "manual" },
      update: {},
    });
    return reply.status(201).send({ entry });
  });

  /** Members add their own (Battle.net verified) characters, e.g. to sign up for a custom roster. */
  app.post("/guilds/:id/roster/mine", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const user = request.user;
    const { guild, pending, slots } = await contributor(id, user);
    const body = z.object({ characterIds: z.array(z.string()).min(1).max(50) }).parse(request.body);
    if (pending && body.characterIds.length > slots!) throw new HttpError(429, "too_many_pending");
    // Only the user's characters of this roster's game version, and only ones that exist there:
    // a character the version's API does not know (sync "not_found") or does not fit is refused.
    const owned = (
      await prisma.character.findMany({
        where: {
          id: { in: body.characterIds },
          ownerId: user!.id,
          gameVersion: guild.gameVersion,
          region: guild.region,
          OR: [{ syncError: null }, { syncError: { not: "not_found" } }],
        },
        select: { id: true, classId: true, level: true },
      })
    ).filter((c) => fitsGameVersion(rules(guild), c));
    if (owned.length !== body.characterIds.length) throw new HttpError(400, "not_your_characters");
    await prisma.rosterEntry.createMany({
      data: owned.map((c) => ({ guildId: id, characterId: c.id, source: "manual", userId: user!.id, pending })),
      skipDuplicates: true,
    });
    await queue.syncCharacters(owned.map((c) => c.id));
    return reply.status(201).send({ added: owned.length, pending });
  });

  /**
   * Adds a character that does not exist in the game yet, to plan a roster ahead of time.
   * Officers can plan for anyone; members plan their own entries; non-members of a published
   * roster propose their own entries, pending the owner's approval.
   */
  app.post("/guilds/:id/roster/planned", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { guild, role, pending, slots } = await contributor(id, request.user);
    if (pending && slots! < 1) throw new HttpError(429, "too_many_pending");
    const body = z
      .object({
        classId: z.number().int(),
        specKey: z.string().nullable().optional(),
        role: z.string().nullable().optional(),
        plannedName: z.string().trim().max(40).nullable().optional(),
        playerName: z.string().trim().max(40).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
        status: z.string().nullable().optional(),
        /** Assign the entry to the requesting user (always the case for members). */
        forSelf: z.boolean().optional(),
      })
      .parse(request.body);
    plannedClass(guild, body.classId, body.specKey);
    requireKey(rules(guild).roles, body.role, "unknown_role");
    requireKey(rules(guild).rosterStatuses, body.status, "unknown_status");
    const officer = atLeast(role, "OFFICER");
    const forSelf = !officer || body.forSelf === true;
    const entry = await prisma.rosterEntry.create({
      data: {
        guildId: id,
        source: "planned",
        plannedClassId: body.classId,
        plannedSpec: body.specKey || null,
        plannedName: body.plannedName || null,
        playerName: body.playerName || (forSelf ? request.user!.battletag.split("#")[0]! : null),
        userId: forSelf ? request.user!.id : null,
        role: body.role ?? null,
        note: body.note ?? null,
        status: officer ? (body.status ?? null) : null,
        pending,
      },
    });
    return reply.status(201).send({ entry });
  });

  /** Replaces a planned entry's placeholder with the real character once it exists in the game. */
  app.post("/guilds/:id/roster/:entryId/link", async (request) => {
    const { id, entryId } = z.object({ id: z.string(), entryId: z.string() }).parse(request.params);
    const { guild, role } = await requireGuildRole(prisma, id, request.user, "MEMBER");
    const body = z.object({ realm: z.string().min(1), name: z.string().min(1) }).parse(request.body);
    const entry = await prisma.rosterEntry.findFirst({ where: { id: entryId, guildId: id } });
    if (!entry) throw notFound("roster_entry_not_found");
    if (entry.pending) throw new HttpError(400, "entry_pending");
    if (entry.characterId) throw new HttpError(400, "entry_already_linked");
    if (!atLeast(role, "OFFICER") && entry.userId !== request.user!.id) throw forbidden();
    const character = await findOrSyncCharacter(guild, body.realm, body.name);
    const duplicate = await prisma.rosterEntry.findUnique({
      where: { guildId_characterId: { guildId: id, characterId: character.id } },
    });
    if (duplicate) throw new HttpError(409, "character_already_in_roster");
    // The planned class/spec/name stay on the entry as history of what was planned.
    return {
      entry: await prisma.rosterEntry.update({ where: { id: entryId }, data: { characterId: character.id, source: "manual" } }),
    };
  });

  /**
   * Officers edit any entry. Members can edit the planning fields, role and note of their own
   * planned entries.
   */
  app.patch("/guilds/:id/roster/:entryId", async (request) => {
    const { id, entryId } = z.object({ id: z.string(), entryId: z.string() }).parse(request.params);
    const { guild, role: viewerRole } = await requireGuildRole(prisma, id, request.user, "MEMBER");
    const body = z
      .object({
        status: z.string().nullable().optional(),
        role: z.string().nullable().optional(),
        note: z.string().max(500).nullable().optional(),
        mainEntryId: z.string().nullable().optional(),
        plannedName: z.string().trim().max(40).nullable().optional(),
        plannedClassId: z.number().int().optional(),
        plannedSpec: z.string().nullable().optional(),
        playerName: z.string().trim().max(40).nullable().optional(),
      })
      .parse(request.body);
    requireKey(rules(guild).roles, body.role, "unknown_role");
    requireKey(rules(guild).rosterStatuses, body.status, "unknown_status");

    const entry = await prisma.rosterEntry.findFirst({ where: { id: entryId, guildId: id } });
    if (!entry) throw notFound("roster_entry_not_found");
    if (entry.pending) throw new HttpError(400, "entry_pending");
    const officer = atLeast(viewerRole, "OFFICER");
    if (!officer) {
      const ownPlanned = entry.userId === request.user!.id && !entry.characterId;
      if (!ownPlanned || body.status !== undefined || body.mainEntryId !== undefined) throw forbidden();
    }
    const planningFields = [body.plannedName, body.plannedClassId, body.plannedSpec].some((v) => v !== undefined);
    if (planningFields && entry.characterId) throw new HttpError(400, "entry_already_linked");
    if (body.plannedClassId !== undefined || body.plannedSpec !== undefined) {
      plannedClass(guild, body.plannedClassId ?? entry.plannedClassId ?? -1, body.plannedSpec ?? (body.plannedClassId !== undefined ? null : entry.plannedSpec));
    }
    if (body.mainEntryId) {
      if (body.mainEntryId === entryId) throw new HttpError(400, "invalid_main");
      const main = await prisma.rosterEntry.findFirst({ where: { id: body.mainEntryId, guildId: id } });
      if (!main) throw new HttpError(400, "invalid_main");
      // Keep links one level deep: the main must not itself be an alt.
      if (main.mainEntryId) throw new HttpError(400, "main_is_alt");
      await prisma.rosterEntry.updateMany({ where: { mainEntryId: entryId }, data: { mainEntryId: body.mainEntryId } });
    }
    // Changing the planned class resets a spec that may not belong to the new class.
    const data = body.plannedClassId !== undefined && body.plannedSpec === undefined ? { ...body, plannedSpec: null } : body;
    return { entry: await prisma.rosterEntry.update({ where: { id: entryId }, data }) };
  });

  /**
   * Manual and planned entries are removed; synced ones are hidden through the profile's hidden
   * status. Officers manage any entry; members only remove their own manual or planned entries.
   */
  app.delete("/guilds/:id/roster/:entryId", async (request) => {
    const { id, entryId } = z.object({ id: z.string(), entryId: z.string() }).parse(request.params);
    if (!request.user) throw unauthorized();
    const { guild, role } = await loadVisibleGuild(prisma, id, request.user);
    const entry = await prisma.rosterEntry.findFirst({
      where: { id: entryId, guildId: id },
      include: { character: { select: { ownerId: true } } },
    });
    if (!entry) throw notFound("roster_entry_not_found");
    // A pending proposal is rejected by the owner or withdrawn by whoever proposed it.
    if (entry.pending) {
      if (role !== "OWNER" && entry.userId !== request.user.id) throw forbidden();
      await prisma.rosterEntry.delete({ where: { id: entryId } });
      return { removed: true };
    }
    if (!atLeast(role, "MEMBER")) throw forbidden();
    const removable = entry.source === "manual" || entry.source === "planned";
    const own = (entry.character?.ownerId ?? entry.userId) === request.user!.id;
    if (!atLeast(role, "OFFICER") && !(removable && own)) throw forbidden();
    if (removable) {
      await prisma.rosterEntry.delete({ where: { id: entryId } });
      return { removed: true };
    }
    const hidden = rules(guild).rosterStatuses.find((s) => s.hidden);
    if (!hidden) throw new HttpError(400, "no_hidden_status_configured");
    await prisma.rosterEntry.update({ where: { id: entryId }, data: { status: hidden.key } });
    return { removed: false, status: hidden.key };
  });

  /** The owner accepts a proposal: it joins the roster and its author becomes a member. */
  app.post("/guilds/:id/roster/:entryId/approve", async (request) => {
    const { id, entryId } = z.object({ id: z.string(), entryId: z.string() }).parse(request.params);
    await requireGuildRole(prisma, id, request.user, "OWNER");
    const entry = await prisma.rosterEntry.findFirst({ where: { id: entryId, guildId: id, pending: true } });
    if (!entry) throw notFound("roster_entry_not_found");
    await prisma.$transaction([
      prisma.rosterEntry.update({ where: { id: entryId }, data: { pending: false } }),
      ...(entry.userId
        ? [
            prisma.guildMembership.upsert({
              where: { userId_guildId: { userId: entry.userId, guildId: id } },
              create: { userId: entry.userId, guildId: id, role: "MEMBER" },
              update: {},
            }),
          ]
        : []),
    ]);
    return { approved: true };
  });

  app.post("/guilds/:id/sync", async (request) => {
    const { id } = idParams.parse(request.params);
    await requireGuildRole(prisma, id, request.user, "OFFICER");
    await queue.syncGuildNow(id);
    return { queued: true };
  });
}
