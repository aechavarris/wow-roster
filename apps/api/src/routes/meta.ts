import { DEFAULT_LOCALE, REGIONS, SUPPORTED_LOCALES, type GameProfile, type GameVersions } from "@wow/config";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps";

/** What the web app needs from a game version's rules (no API namespaces). */
const publicVersion = (v: GameProfile, all: GameVersions) => ({
  id: v.id,
  label: v.label,
  name: v.name,
  maxLevel: v.maxLevel,
  apiAvailable: v.api.available,
  /** Which character data the version's API provides; the web shows a details tab per kind. */
  // Raid and dungeon progress built from the boss kill statistics count as raids and dungeons data (MoP Classic).
  characterEndpoints: !v.api.available
    ? []
    : v.api.characterEndpoints.includes("encounterStatistics")
      ? [...new Set([...v.api.characterEndpoints, "raids", "dungeons"])]
      : // Raid kills read from Warcraft Logs count as raids data (Classic versions without progress in the API).
        v.api.warcraftLogs
        ? [...new Set([...v.api.characterEndpoints, "raids"])]
        : v.api.characterEndpoints,
  /** Site the version's raid kills come from, if any (shown as the data source). */
  warcraftLogsHost: v.api.warcraftLogs?.host ?? null,
  /** Sections not shown even though the API provides the data (still synced: other sections may use it). */
  hiddenDetails: v.hiddenDetails,
  details: v.details,
  requirements: v.requirements.filter((r) => r.enabled),
  hasRealms: v.api.hasRealms,
  /** Offered instead of a free-text realm where the version has no realms (Forever). */
  rulesets: v.rulesets.filter((r) => r.enabled),
  /** Version whose API stands in for this one while it has none (testing only), or null. */
  apiStandIn: v.api.standIn ? { id: v.api.standIn, name: all.byId.get(v.api.standIn)?.name ?? { en: v.api.standIn } } : null,
  wowheadDomain: v.wowheadDomain,
  roles: v.roles,
  classes: v.classes,
  raidSizes: v.raidSizes,
  // Stand-in raids only map the source version's logs; they are not this version's content.
  raids: v.raids.filter((r) => !r.key.startsWith("standin-")),
  dungeons: v.dungeons,
  timeline: v.timeline,
  rosterStatuses: v.rosterStatuses,
  statPanel: v.statPanel,
  buffs: v.buffs,
  professions: v.professions,
  /** Secondary stats the BiS picker can filter by (crit, haste…); empty where the version has none. */
  secondaryStats: v.secondaryStats,
  maxPrimaryProfessions: v.maxPrimaryProfessions,
  /** False where professions are entered by hand (the version's API has none). */
  apiProfessions: v.api.available && v.api.characterEndpoints.includes("professions"),
  sync: v.sync,
});

export async function metaRoutes(app: FastifyInstance, { versions, env, prisma }: AppDeps) {
  /**
   * Used by the container healthcheck. It also pings the database, so an API whose connections
   * died (e.g. after the host slept) reports unhealthy and gets restarted instead of serving errors.
   */
  app.get("/health", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false, error: "database_unavailable" });
    }
  });

  /** Public game configuration the web app renders from (no secrets). */
  app.get("/config", async () => ({
    versions: versions.list.map((v) => publicVersion(v, versions)),
    defaultVersion: versions.defaultId,
    regions: REGIONS,
    defaultRegion: env.BLIZZARD_REGION,
    locales: SUPPORTED_LOCALES,
    defaultLocale: DEFAULT_LOCALE,
    loginEnabled: Boolean(env.BLIZZARD_CLIENT_ID && env.BLIZZARD_CLIENT_SECRET),
  }));
}
