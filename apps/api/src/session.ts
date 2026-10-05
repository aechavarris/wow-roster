import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient, User } from "@wow/db";

export const SESSION_COOKIE = "wr_session";
export const STATE_COOKIE = "wr_oauth_state";
export const SESSION_TTL_DAYS = 30;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/** Creates a session and returns the raw token for the cookie; only its hash is stored. */
export async function createSession(prisma: PrismaClient, userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await prisma.session.create({ data: { id: hash(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function findSessionUser(prisma: PrismaClient, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { id: hash(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export async function deleteSession(prisma: PrismaClient, token: string | undefined) {
  if (token) await prisma.session.deleteMany({ where: { id: hash(token) } });
}
