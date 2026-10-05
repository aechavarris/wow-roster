import { BlizzardClient } from "@wow/blizzard";
import type { GameProfile } from "@wow/config";
import type { PrismaClient } from "@wow/db";

export interface CoreContext {
  prisma: PrismaClient;
  profile: GameProfile;
  blizzard(region: string): BlizzardClient;
}

/** Creates one cached Blizzard client per region. */
export function blizzardFactory(profile: GameProfile, credentials: { clientId: string; clientSecret: string }) {
  const clients = new Map<string, BlizzardClient>();
  return (region: string) => {
    const key = region.toLowerCase();
    let client = clients.get(key);
    if (!client) {
      client = new BlizzardClient({ ...credentials, region: key, api: profile.api });
      clients.set(key, client);
    }
    return client;
  };
}
