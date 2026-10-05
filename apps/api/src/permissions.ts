import type { Guild, PrismaClient, User } from "@wow/db";
import { forbidden, notFound, unauthorized } from "./errors";

export type ViewerRole = "OWNER" | "OFFICER" | "MEMBER" | null;

const RANKING: Record<Exclude<ViewerRole, null>, number> = { OWNER: 3, OFFICER: 2, MEMBER: 1 };

/**
 * Explicit memberships win; otherwise the role follows the in-game rank of the user's
 * characters in the guild, so officers need no manual setup.
 */
export async function guildRole(prisma: PrismaClient, guild: Guild, user: User | null): Promise<ViewerRole> {
  if (!user) return null;
  const membership = await prisma.guildMembership.findUnique({
    where: { userId_guildId: { userId: user.id, guildId: guild.id } },
  });
  const characters = await prisma.character.findMany({
    where: { ownerId: user.id, guildId: guild.id },
    select: { guildRank: true },
  });
  const bestRank = Math.min(...characters.map((c) => c.guildRank ?? Number.POSITIVE_INFINITY));
  const derived: ViewerRole =
    characters.length === 0 ? null : bestRank <= guild.officerMaxRank ? "OFFICER" : "MEMBER";
  const explicit = (membership?.role ?? null) as ViewerRole;
  if (!explicit) return derived;
  if (!derived) return explicit;
  return RANKING[explicit] >= RANKING[derived] ? explicit : derived;
}

export function atLeast(role: ViewerRole, required: Exclude<ViewerRole, null>) {
  return role !== null && RANKING[role] >= RANKING[required];
}

/**
 * Loads a guild the viewer may see, or throws 404 (private guilds are hidden from outsiders).
 * Public rosters are visible to everyone; published ones to every signed-in user.
 */
export async function loadVisibleGuild(prisma: PrismaClient, guildId: string, user: User | null) {
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) throw notFound("guild_not_found");
  const role = await guildRole(prisma, guild, user);
  const visible = guild.public || role !== null || (guild.published && user !== null);
  if (!visible) throw notFound("guild_not_found");
  return { guild, role };
}

export async function requireGuildRole(
  prisma: PrismaClient,
  guildId: string,
  user: User | null,
  required: Exclude<ViewerRole, null>,
) {
  if (!user) throw unauthorized();
  const result = await loadVisibleGuild(prisma, guildId, user);
  if (!atLeast(result.role, required)) throw forbidden();
  return result;
}
