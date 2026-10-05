import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { HttpError, forbidden, notFound, unauthorized } from "../errors";
import { atLeast, guildRole, requireGuildRole, type ViewerRole } from "../permissions";
import { hashToken, randomToken } from "../session";

const RANK: Record<Exclude<ViewerRole, null>, number> = { OWNER: 3, OFFICER: 2, MEMBER: 1 };

/** Roster memberships and invite links, for guild-linked and custom rosters alike. */
export async function memberRoutes(app: FastifyInstance, { prisma, env }: AppDeps) {
  const params = z.object({ id: z.string() });

  app.get("/guilds/:id/members", async (request) => {
    const { id } = params.parse(request.params);
    await requireGuildRole(prisma, id, request.user, "OFFICER");
    const members = await prisma.guildMembership.findMany({
      where: { guildId: id },
      include: { user: { select: { battletag: true } } },
    });
    return {
      members: members
        .map((m) => ({ userId: m.userId, battletag: m.user.battletag, role: m.role }))
        .sort((a, b) => RANK[b.role] - RANK[a.role] || a.battletag.localeCompare(b.battletag)),
    };
  });

  /** Only the owner promotes or demotes; ownership itself is not transferable here. */
  app.patch("/guilds/:id/members/:userId", async (request) => {
    const { id, userId } = z.object({ id: z.string(), userId: z.string() }).parse(request.params);
    await requireGuildRole(prisma, id, request.user, "OWNER");
    const body = z.object({ role: z.enum(["OFFICER", "MEMBER"]) }).parse(request.body);
    const membership = await prisma.guildMembership.findUnique({ where: { userId_guildId: { userId, guildId: id } } });
    if (!membership) throw notFound("member_not_found");
    if (membership.role === "OWNER") throw new HttpError(400, "cannot_change_owner");
    await prisma.guildMembership.update({ where: { userId_guildId: { userId, guildId: id } }, data: { role: body.role } });
    return { ok: true };
  });

  /** Officers remove members, the owner removes anyone but themselves, and anyone can leave. */
  app.delete("/guilds/:id/members/:userId", async (request) => {
    const { id, userId } = z.object({ id: z.string(), userId: z.string() }).parse(request.params);
    if (!request.user) throw unauthorized();
    const membership = await prisma.guildMembership.findUnique({ where: { userId_guildId: { userId, guildId: id } } });
    if (!membership) throw notFound("member_not_found");
    if (membership.role === "OWNER") throw new HttpError(400, "cannot_remove_owner");
    if (userId !== request.user.id) {
      const { role } = await requireGuildRole(prisma, id, request.user, "OFFICER");
      if (RANK[role!] <= RANK[membership.role]) throw forbidden();
    }
    await prisma.guildMembership.delete({ where: { userId_guildId: { userId, guildId: id } } });
    return { ok: true };
  });

  app.get("/guilds/:id/invites", async (request) => {
    const { id } = params.parse(request.params);
    await requireGuildRole(prisma, id, request.user, "OFFICER");
    const invites = await prisma.rosterInvite.findMany({
      where: { guildId: id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    return {
      invites: invites.map((i) => ({ id: i.id.slice(0, 12), role: i.role, expiresAt: i.expiresAt, uses: i.uses, maxUses: i.maxUses })),
    };
  });

  /** The raw token is only returned here; the database keeps its hash. */
  app.post("/guilds/:id/invites", async (request, reply) => {
    const { id } = params.parse(request.params);
    const { role } = await requireGuildRole(prisma, id, request.user, "OFFICER");
    const body = z
      .object({
        role: z.enum(["OFFICER", "MEMBER"]),
        expiresInDays: z.number().int().min(1).max(30).default(7),
        maxUses: z.number().int().min(1).max(500).optional(),
      })
      .parse(request.body);
    if (body.role === "OFFICER" && role !== "OWNER") throw forbidden();
    const token = randomToken(24);
    const invite = await prisma.rosterInvite.create({
      data: {
        id: hashToken(token),
        guildId: id,
        role: body.role,
        createdById: request.user!.id,
        expiresAt: new Date(Date.now() + body.expiresInDays * 86_400_000),
        maxUses: body.maxUses,
      },
    });
    return reply.status(201).send({
      invite: { id: invite.id.slice(0, 12), role: invite.role, expiresAt: invite.expiresAt, maxUses: invite.maxUses, uses: 0 },
      token,
      url: `${env.PUBLIC_URL}/invite/${token}`,
    });
  });

  app.delete("/guilds/:id/invites/:inviteId", async (request) => {
    const { id, inviteId } = z.object({ id: z.string(), inviteId: z.string().min(12) }).parse(request.params);
    await requireGuildRole(prisma, id, request.user, "OFFICER");
    const { count } = await prisma.rosterInvite.deleteMany({ where: { guildId: id, id: { startsWith: inviteId } } });
    if (count === 0) throw notFound("invite_not_found");
    return { ok: true };
  });

  const loadInvite = async (token: string) => {
    const invite = await prisma.rosterInvite.findUnique({ where: { id: hashToken(token) }, include: { guild: true } });
    if (!invite) throw notFound("invite_not_found");
    const usable = invite.expiresAt > new Date() && (invite.maxUses == null || invite.uses < invite.maxUses);
    return { invite, usable };
  };

  /** Public preview so the invite page can show what is being joined. */
  app.get("/invites/:token", async (request) => {
    const { token } = z.object({ token: z.string() }).parse(request.params);
    const { invite, usable } = await loadInvite(token);
    return {
      roster: {
        id: invite.guild.id,
        name: invite.guild.name,
        kind: invite.guild.kind,
        gameVersion: invite.guild.gameVersion,
        region: invite.guild.region,
      },
      role: invite.role,
      usable,
      currentRole: await guildRole(prisma, invite.guild, request.user),
    };
  });

  /** Joining never downgrades an existing role. */
  app.post("/invites/:token/accept", async (request) => {
    if (!request.user) throw unauthorized();
    const { token } = z.object({ token: z.string() }).parse(request.params);
    const { invite, usable } = await loadInvite(token);
    if (!usable) throw new HttpError(410, "invite_expired");
    const current = await guildRole(prisma, invite.guild, request.user);
    if (!atLeast(current, invite.role)) {
      await prisma.$transaction([
        prisma.guildMembership.upsert({
          where: { userId_guildId: { userId: request.user.id, guildId: invite.guildId } },
          create: { userId: request.user.id, guildId: invite.guildId, role: invite.role },
          update: { role: invite.role },
        }),
        prisma.rosterInvite.update({ where: { id: invite.id }, data: { uses: { increment: 1 } } }),
      ]);
    }
    return { guildId: invite.guildId, role: atLeast(current, invite.role) ? current : invite.role };
  });
}
