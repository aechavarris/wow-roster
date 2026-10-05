import { DEFAULT_LOCALE, REGIONS, SUPPORTED_LOCALES } from "@wow/config";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps";

export async function metaRoutes(app: FastifyInstance, { profile, env }: AppDeps) {
  app.get("/health", async () => ({ ok: true }));

  /** Public game configuration the web app renders from (no secrets). */
  app.get("/config", async () => ({
    profile: {
      id: profile.id,
      label: profile.label,
      maxLevel: profile.maxLevel,
      hasRealms: profile.api.hasRealms,
      wowheadDomain: profile.wowheadDomain,
      roles: profile.roles,
      classes: profile.classes,
      raidSizes: profile.raidSizes,
      raids: profile.raids,
      rosterStatuses: profile.rosterStatuses,
      sync: profile.sync,
    },
    regions: REGIONS,
    defaultRegion: env.BLIZZARD_REGION,
    locales: SUPPORTED_LOCALES,
    defaultLocale: DEFAULT_LOCALE,
    loginEnabled: Boolean(env.BLIZZARD_CLIENT_ID && env.BLIZZARD_CLIENT_SECRET),
  }));
}
