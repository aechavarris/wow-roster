import { DEFAULT_LOCALE, REGIONS, SUPPORTED_LOCALES, type GameProfile } from "@wow/config";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps";

/** What the web app needs from a game version's rules (no API namespaces). */
const publicVersion = (v: GameProfile) => ({
  id: v.id,
  label: v.label,
  name: v.name,
  maxLevel: v.maxLevel,
  apiAvailable: v.api.available,
  hasRealms: v.api.hasRealms,
  wowheadDomain: v.wowheadDomain,
  roles: v.roles,
  classes: v.classes,
  raidSizes: v.raidSizes,
  raids: v.raids,
  rosterStatuses: v.rosterStatuses,
  statPanel: v.statPanel,
  buffs: v.buffs,
  professions: v.professions,
  maxPrimaryProfessions: v.maxPrimaryProfessions,
  /** False where professions are entered by hand (the version's API has none). */
  apiProfessions: v.api.available && v.api.characterEndpoints.includes("professions"),
  sync: v.sync,
});

export async function metaRoutes(app: FastifyInstance, { versions, env }: AppDeps) {
  app.get("/health", async () => ({ ok: true }));

  /** Public game configuration the web app renders from (no secrets). */
  app.get("/config", async () => ({
    versions: versions.list.map(publicVersion),
    defaultVersion: versions.defaultId,
    regions: REGIONS,
    defaultRegion: env.BLIZZARD_REGION,
    locales: SUPPORTED_LOCALES,
    defaultLocale: DEFAULT_LOCALE,
    loginEnabled: Boolean(env.BLIZZARD_CLIENT_ID && env.BLIZZARD_CLIENT_SECRET),
  }));
}
