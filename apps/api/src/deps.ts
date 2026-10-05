import type { BattleNetUser } from "@wow/blizzard";
import type { GameVersions } from "@wow/config";
import type { CoreContext } from "@wow/core";
import type { PrismaClient } from "@wow/db";
import type { Env } from "./env";

/** Background job operations; BullMQ in production, an in-memory fake in tests. */
export interface SyncQueue {
  scheduleGuild(guildId: string, intervalMinutes: number): Promise<void>;
  unscheduleGuild(guildId: string): Promise<void>;
  syncGuildNow(guildId: string): Promise<void>;
  syncCharacters(characterIds: string[], force?: boolean): Promise<void>;
}

export interface OAuthService {
  authorizeUrl(state: string): string;
  /** Exchanges the code and returns the user plus their access token. */
  login(code: string): Promise<{ user: BattleNetUser; accessToken: string }>;
}

export interface AppDeps {
  env: Env & { ALLOW_UNVERIFIED_GUILDS?: boolean };
  prisma: PrismaClient;
  /** Every game version; rosters and characters each belong to one. */
  versions: GameVersions;
  core: CoreContext;
  queue: SyncQueue;
  oauth: OAuthService;
}
