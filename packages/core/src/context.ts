import { BlizzardClient, RaiderIoClient, WarcraftLogsClient } from "@wow/blizzard";

export { RaiderIoClient, WarcraftLogsClient };
import { versionOf, type GameProfile, type GameVersions } from "@wow/config";
import type { PrismaClient } from "@wow/db";

export interface CoreContext {
  prisma: PrismaClient;
  /** Every game version; rosters and characters each belong to one. */
  versions: GameVersions;
  /** Client for a game version's API in a region. Throws ApiUnavailableError if the version has none. */
  blizzard(version: string, region: string): BlizzardClient;
  /** Raider.IO, for versions whose profile enables it; without it those versions use Blizzard's data only. */
  raiderIo?: RaiderIoClient;
  /** Warcraft Logs, when its API credentials are configured; versions that enable it read raid kills from there. */
  warcraftLogs?: WarcraftLogsClient;
}

/** The game version has no public Blizzard API yet (Forever): only planned characters are possible. */
export class ApiUnavailableError extends Error {
  constructor(readonly version: string) {
    super(`Game version "${version}" has no Blizzard API`);
  }
}

/** The rules of a game version, or of the default one for missing or unknown ids. */
export const gameVersion = (ctx: Pick<CoreContext, "versions">, id?: string | null): GameProfile => versionOf(ctx.versions, id);

/** Creates one cached Blizzard client per game version and region. */
export function blizzardFactory(versions: GameVersions, credentials: { clientId: string; clientSecret: string }) {
  const clients = new Map<string, BlizzardClient>();
  return (version: string, region: string) => {
    const profile = versions.byId.get(version);
    if (!profile?.api.available) throw new ApiUnavailableError(version);
    const key = `${version}:${region.toLowerCase()}`;
    let client = clients.get(key);
    if (!client) {
      client = new BlizzardClient({ ...credentials, region: region.toLowerCase(), api: profile.api });
      clients.set(key, client);
    }
    return client;
  };
}
