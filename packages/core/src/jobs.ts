import { Redis } from "ioredis";

/** Queue names and payloads shared by the API (producer) and the worker (consumer). */

export const QUEUES = {
  guildSync: "guild-sync",
  characterSync: "character-sync",
} as const;

export interface GuildSyncJob {
  guildId: string;
}

export interface CharacterSyncJob {
  characterId: string;
  /** Fetch details even if the character has not logged in since the last sync. */
  force?: boolean;
}

export const guildSchedulerId = (guildId: string) => `guild:${guildId}`;
export const characterJobId = (characterId: string) => `character:${characterId}`;

/**
 * Creates a Redis client for BullMQ. BullMQ no longer loads ioredis itself in ESM,
 * so each queue and worker gets its own constructed client.
 */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
