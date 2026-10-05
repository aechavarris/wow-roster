import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { ApiUnavailableError } from "@wow/core";
import type { User } from "@wow/db";
import Fastify from "fastify";
import { ZodError } from "zod";
import type { AppDeps } from "./deps";
import { HttpError } from "./errors";
import { authRoutes } from "./routes/auth";
import { characterRoutes } from "./routes/characters";
import { guildRoutes } from "./routes/guilds";
import { memberRoutes } from "./routes/members";
import { meRoutes } from "./routes/me";
import { metaRoutes } from "./routes/meta";
import { SESSION_COOKIE, findSessionUser } from "./session";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

/** `rateLimit` is requests per minute and client IP; tests raise it since every request comes from one address. */
export async function buildApp(deps: AppDeps, options: { logger?: boolean; rateLimit?: number } = {}) {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true });

  await app.register(cookie);
  await app.register(rateLimit, { max: options.rateLimit ?? 300, timeWindow: "1 minute" });

  app.decorateRequest("user", null);
  app.addHook("preHandler", async (request) => {
    request.user = await findSessionUser(deps.prisma, request.cookies[SESSION_COOKIE]);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof ApiUnavailableError) {
      return reply.status(409).send({ error: "game_version_without_api", message: error.message });
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: "invalid_request", issues: error.issues });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) {
      return reply.status(statusCode).send({ error: "request_error", message: (error as Error).message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: "internal_error" });
  });

  await app.register(
    async (api) => {
      await metaRoutes(api, deps);
      await authRoutes(api, deps);
      await meRoutes(api, deps);
      await guildRoutes(api, deps);
      await memberRoutes(api, deps);
      await characterRoutes(api, deps);
    },
    { prefix: "/api" },
  );

  return app;
}
