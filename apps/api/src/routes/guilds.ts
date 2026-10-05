import { BlizzardApiError } from "@wow/blizzard";
import { REGIONS, blizzardSlug } from "@wow/config";
import { buildRoster, defaultStatusForRank, nameKey, syncCharacter } from "@wow/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { HttpError, forbidden, notFound, unauthorized } from "../errors";
import { atLeast, loadVisibleGuild, requireGuildRole } from "../permissions";

const idParams = z.object({ id: z.string() });

export async function guildRoutes(app: FastifyInstance, deps: AppDeps) {
  const { prisma, profile, core, queue, env } = deps;
  const statusKeys = profile.rosterStatuses.map((s) => s.key) as [string, ...string[]];
  const roleKeys = profile.roles.map((r) => r.key) as [string, ...string[]];

  const serializeGuild = (guild: Awaited<ReturnType<typeof loadVisibleGuild>>["guild"]) => ({
    id: guild.id,
    kind: guild.kind,
    region: guild.region,
    realm: guild.realm,
    slug: guild.slug,
    name: guild.name,
    faction: guild.faction,
    public: guild.public,
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
      .object({ region: z.enum(REGIONS), realm: z.string().min(1), name: z.string().min(1) })
      .parse(request.body);
    const realm = blizzardSlug(body.realm);
    const slug = blizzardSlug(body.name);

    const existing = await prisma.guild.findUnique({
      where: { region_realm_slug: { region: body.region, realm, slug } },
    });
    if (existing) throw new HttpError(409, "guild_already_registered", existing.id);

    const client = core.blizzard(body.region);
    let info, members;
    try {
      [info, members] = await Promise.all([client.getGuild(realm, slug), client.getGuildRoster(realm, slug)]);
    } catch (error) {
      if (error instanceof BlizzardApiError && error.notFound) throw notFound("guild_not_found_in_game");
      throw error;
    }

    const owned = await prisma.character.findMany({
      where: { ownerId: user.id, region: body.region },
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
      .object({ name: z.string().trim().min(1).max(60), region: z.enum(REGIONS), public: z.boolean().optional() })
      .parse(request.body);
    const guild = await prisma.guild.create({
      data: {
        kind: "custom",
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
    const { guild } = await requireGuildRole(prisma, id, request.user, "OFFICER");
    const body = z
      .object({
        // Linked rosters take their name from the in-game guild.
        name: z.string().trim().min(1).max(60).optional(),
        public: z.boolean().optional(),
        syncIntervalMinutes: z.number().int().min(profile.sync.minIntervalMinutes).max(24 * 60).optional(),
        minLevel: z.number().int().min(1).max(profile.maxLevel).optional(),
        officerMaxRank: z.number().int().min(0).max(9).optional(),
      })
      .parse(request.body);
    if (body.name !== undefined && guild.kind === "guild") throw new HttpError(400, "name_from_game");
    const updated = await prisma.guild.update({ where: { id }, data: body });
    if (body.syncIntervalMinutes && body.syncIntervalMinutes !== guild.syncIntervalMinutes) {
      await queue.scheduleGuild(id, body.syncIntervalMinutes);
    }
    return { guild: serializeGuild(updated) };
  });

  app.put("/guilds/:id/ranks", async (request) => {
    const { id } = idParams.parse(request.params);
    const { guild } = await requireGuildRole(prisma, id, request.user, "OFFICER");
    if (guild.kind !== "guild") throw new HttpError(400, "custom_roster_has_no_ranks");
    const body = z
      .array(z.object({ rank: z.number().int().min(0).max(9), label: z.string().max(40).nullable().optional(), status: z.enum(statusKeys) }))
      .parse(request.body);
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

  app.get("/guilds/:id/roster", async (request) => {
    const { id } = idParams.parse(request.params);
    await loadVisibleGuild(prisma, id, request.user);
    const [ranks, entries] = await Promise.all([
      prisma.guildRank.findMany({ where: { guildId: id } }),
      prisma.rosterEntry.findMany({
        where: { guildId: id },
        include: {
          character: {
            select: {
              id: true,
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
    const players = buildRoster(
      profile,
      ranks,
      entries.map((e) => ({ ...e, character: e.character && { ...e.character, avatar: e.character.avatarUrl } })),
    );
    return { players };
  });

  /** Finds a game character, looking it up in the game (and syncing it) when it is new to the app. */
  async function findOrSyncCharacter(region: string, realmInput: string, name: string) {
    const realm = blizzardSlug(realmInput);
    const key = nameKey(name);
    let character = await prisma.character.findUnique({
      where: { region_realm_nameKey: { region, realm, nameKey: key } },
    });
    const created = !character;
    character ??= await prisma.character.create({ data: { region, realm, name: name.trim(), nameKey: key } });
    const result = await syncCharacter(core, character.id, true);
    if (result === "not_found") {
      if (created) await prisma.character.delete({ where: { id: character.id } });
      throw notFound("character_not_found_in_game");
    }
    return character;
  }

  /** Validates a planned class/spec pair against the game profile. */
  function plannedClass(classId: number, specKey: string | null | undefined) {
    const gameClass = profile.classes.find((c) => c.id === classId);
    if (!gameClass) throw new HttpError(400, "unknown_class");
    if (specKey && !gameClass.specs.some((s) => s.key === specKey)) throw new HttpError(400, "unknown_spec");
  }

  /** Adds a character that is not in the in-game guild (e.g. an alt in another guild). */
  app.post("/guilds/:id/roster", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { guild } = await requireGuildRole(prisma, id, request.user, "OFFICER");
    const body = z.object({ realm: z.string().min(1), name: z.string().min(1) }).parse(request.body);
    const character = await findOrSyncCharacter(guild.region, body.realm, body.name);

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
    const { guild } = await requireGuildRole(prisma, id, user, "MEMBER");
    const body = z.object({ characterIds: z.array(z.string()).min(1).max(50) }).parse(request.body);
    const owned = await prisma.character.findMany({
      where: { id: { in: body.characterIds }, ownerId: user!.id, region: guild.region },
      select: { id: true },
    });
    if (owned.length !== body.characterIds.length) throw new HttpError(400, "not_your_characters");
    await prisma.rosterEntry.createMany({
      data: owned.map((c) => ({ guildId: id, characterId: c.id, source: "manual" })),
      skipDuplicates: true,
    });
    await queue.syncCharacters(owned.map((c) => c.id));
    return reply.status(201).send({ added: owned.length });
  });

  /**
   * Adds a character that does not exist in the game yet, to plan a roster ahead of time.
   * Officers can plan for anyone; members plan their own entries.
   */
  app.post("/guilds/:id/roster/planned", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { role } = await requireGuildRole(prisma, id, request.user, "MEMBER");
    const body = z
      .object({
        classId: z.number().int(),
        specKey: z.string().nullable().optional(),
        role: z.enum(roleKeys).nullable().optional(),
        plannedName: z.string().trim().max(40).nullable().optional(),
        playerName: z.string().trim().max(40).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
        status: z.enum(statusKeys).nullable().optional(),
        /** Assign the entry to the requesting user (always the case for members). */
        forSelf: z.boolean().optional(),
      })
      .parse(request.body);
    plannedClass(body.classId, body.specKey);
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
    if (entry.characterId) throw new HttpError(400, "entry_already_linked");
    if (!atLeast(role, "OFFICER") && entry.userId !== request.user!.id) throw forbidden();
    const character = await findOrSyncCharacter(guild.region, body.realm, body.name);
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
    const { role: viewerRole } = await requireGuildRole(prisma, id, request.user, "MEMBER");
    const body = z
      .object({
        status: z.enum(statusKeys).nullable().optional(),
        role: z.enum(roleKeys).nullable().optional(),
        note: z.string().max(500).nullable().optional(),
        mainEntryId: z.string().nullable().optional(),
        plannedName: z.string().trim().max(40).nullable().optional(),
        plannedClassId: z.number().int().optional(),
        plannedSpec: z.string().nullable().optional(),
        playerName: z.string().trim().max(40).nullable().optional(),
      })
      .parse(request.body);

    const entry = await prisma.rosterEntry.findFirst({ where: { id: entryId, guildId: id } });
    if (!entry) throw notFound("roster_entry_not_found");
    const officer = atLeast(viewerRole, "OFFICER");
    if (!officer) {
      const ownPlanned = entry.userId === request.user!.id && !entry.characterId;
      if (!ownPlanned || body.status !== undefined || body.mainEntryId !== undefined) throw forbidden();
    }
    const planningFields = [body.plannedName, body.plannedClassId, body.plannedSpec].some((v) => v !== undefined);
    if (planningFields && entry.characterId) throw new HttpError(400, "entry_already_linked");
    if (body.plannedClassId !== undefined || body.plannedSpec !== undefined) {
      plannedClass(body.plannedClassId ?? entry.plannedClassId ?? -1, body.plannedSpec ?? (body.plannedClassId !== undefined ? null : entry.plannedSpec));
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
    const { role } = await requireGuildRole(prisma, id, request.user, "MEMBER");
    const entry = await prisma.rosterEntry.findFirst({
      where: { id: entryId, guildId: id },
      include: { character: { select: { ownerId: true } } },
    });
    if (!entry) throw notFound("roster_entry_not_found");
    const removable = entry.source === "manual" || entry.source === "planned";
    const own = (entry.character?.ownerId ?? entry.userId) === request.user!.id;
    if (!atLeast(role, "OFFICER") && !(removable && own)) throw forbidden();
    if (removable) {
      await prisma.rosterEntry.delete({ where: { id: entryId } });
      return { removed: true };
    }
    const hidden = profile.rosterStatuses.find((s) => s.hidden);
    if (!hidden) throw new HttpError(400, "no_hidden_status_configured");
    await prisma.rosterEntry.update({ where: { id: entryId }, data: { status: hidden.key } });
    return { removed: false, status: hidden.key };
  });

  app.post("/guilds/:id/sync", async (request) => {
    const { id } = idParams.parse(request.params);
    await requireGuildRole(prisma, id, request.user, "OFFICER");
    await queue.syncGuildNow(id);
    return { queued: true };
  });
}
