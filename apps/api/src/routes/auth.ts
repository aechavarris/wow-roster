import { REGIONS } from "@wow/config";
import { claimAccountCharacters } from "@wow/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { HttpError } from "../errors";
import { SESSION_COOKIE, STATE_COOKIE, createSession, deleteSession, randomToken } from "../session";

/** Only same-site relative paths are accepted as post-login redirects. */
const safeRedirect = (value: string | undefined) =>
  value && value.startsWith("/") && !value.startsWith("//") ? value : "/";

export async function authRoutes(app: FastifyInstance, deps: AppDeps) {
  const { env, prisma, versions, core, queue, oauth } = deps;
  const secure = env.PUBLIC_URL.startsWith("https://");

  app.get("/auth/login", async (request, reply) => {
    if (!env.BLIZZARD_CLIENT_ID) throw new HttpError(503, "login_not_configured");
    const query = z
      .object({ region: z.enum(REGIONS).optional(), redirect: z.string().optional() })
      .parse(request.query);
    const state = randomToken(16);
    reply.setCookie(
      STATE_COOKIE,
      JSON.stringify({ state, region: query.region ?? env.BLIZZARD_REGION, redirect: safeRedirect(query.redirect) }),
      { path: "/api/auth", httpOnly: true, sameSite: "lax", secure, maxAge: 600 },
    );
    return reply.redirect(oauth.authorizeUrl(state));
  });

  app.get("/auth/callback", async (request, reply) => {
    const query = z.object({ code: z.string(), state: z.string() }).parse(request.query);
    const stored = z
      .object({ state: z.string(), region: z.enum(REGIONS), redirect: z.string() })
      .safeParse(JSON.parse(request.cookies[STATE_COOKIE] ?? "null"));
    reply.clearCookie(STATE_COOKIE, { path: "/api/auth" });
    if (!stored.success || stored.data.state !== query.state) throw new HttpError(400, "invalid_oauth_state");

    const { user: bnetUser, accessToken } = await oauth.login(query.code);
    const user = await prisma.user.upsert({
      where: { bnetId: bnetUser.id },
      create: { bnetId: bnetUser.id, battletag: bnetUser.battletag, lastLoginAt: new Date() },
      update: { battletag: bnetUser.battletag, lastLoginAt: new Date() },
    });

    // Claiming characters is best effort and per game version: login still succeeds if a version's
    // profile API is unavailable or the account has no characters there.
    const region = stored.data.region;
    for (const version of versions.list.filter((v) => v.api.available)) {
      try {
        const characters = await core.blizzard(version.id, region).getAccountCharacters(accessToken);
        const claimed = await claimAccountCharacters(core, user.id, { version: version.id, region }, characters);
        const toSync = claimed
          .filter((c) => c.level >= version.sync.defaultMinLevel)
          .map((c) => c.id);
        await queue.syncCharacters(toSync);
      } catch (error) {
        request.log.warn({ err: error, gameVersion: version.id }, "could not load account characters");
      }
    }

    const session = await createSession(prisma, user.id);
    reply.setCookie(SESSION_COOKIE, session.token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure,
      expires: session.expiresAt,
    });
    return reply.redirect(`${env.PUBLIC_URL}${stored.data.redirect}`);
  });

  app.post("/auth/logout", async (request, reply) => {
    await deleteSession(prisma, request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}
