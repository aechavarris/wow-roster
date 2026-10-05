import { authorizeUrl, exchangeCode, getUserInfo } from "@wow/blizzard";
import { loadGameProfile } from "@wow/config/node";
import {
  QUEUES,
  blizzardFactory,
  characterJobId,
  guildSchedulerId,
  createRedis,
  type CharacterSyncJob,
  type GuildSyncJob,
} from "@wow/core";
import { createPrismaClient } from "@wow/db";
import { Queue } from "bullmq";
import { buildApp } from "./app";
import type { SyncQueue } from "./deps";
import { loadEnv } from "./env";

const env = loadEnv();
const profile = loadGameProfile();
const prisma = createPrismaClient(env.DATABASE_URL);
const redisUrl = env.REDIS_URL;
const guildQueue = new Queue<GuildSyncJob>(QUEUES.guildSync, { connection: createRedis(redisUrl) });
const characterQueue = new Queue<CharacterSyncJob>(QUEUES.characterSync, { connection: createRedis(redisUrl) });

const queue: SyncQueue = {
  async scheduleGuild(guildId, intervalMinutes) {
    await guildQueue.upsertJobScheduler(
      guildSchedulerId(guildId),
      { every: intervalMinutes * 60_000 },
      { name: "guild", data: { guildId } },
    );
  },
  async unscheduleGuild(guildId) {
    await guildQueue.removeJobScheduler(guildSchedulerId(guildId));
  },
  async syncGuildNow(guildId) {
    await guildQueue.add("guild", { guildId }, { jobId: `guild-now:${guildId}`, removeOnComplete: true, removeOnFail: 50 });
  },
  async syncCharacters(characterIds, force = false) {
    await characterQueue.addBulk(
      characterIds.map((characterId) => ({
        name: "character",
        data: { characterId, force },
        opts: { jobId: characterJobId(characterId), removeOnComplete: true, removeOnFail: 100 },
      })),
    );
  },
};

const oauthConfig = {
  clientId: env.BLIZZARD_CLIENT_ID,
  clientSecret: env.BLIZZARD_CLIENT_SECRET,
  redirectUri: `${env.PUBLIC_URL}/api/auth/callback`,
};

const app = await buildApp(
  {
    env: { ...env, ALLOW_UNVERIFIED_GUILDS: process.env.ALLOW_UNVERIFIED_GUILDS === "true" },
    prisma,
    profile,
    core: { prisma, profile, blizzard: blizzardFactory(profile, oauthConfig) },
    queue,
    oauth: {
      authorizeUrl: (state) => authorizeUrl(oauthConfig, state),
      async login(code) {
        const token = await exchangeCode(oauthConfig, code);
        return { user: await getUserInfo(token.access_token), accessToken: token.access_token };
      },
    },
  },
  { logger: true },
);

await app.listen({ host: "0.0.0.0", port: env.API_PORT });

async function shutdown() {
  await app.close();
  await Promise.all([guildQueue.close(), characterQueue.close()]);
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
