import { Queue, Worker } from "bullmq";
import { loadServerGameVersions } from "@wow/config/node";
import {
  QUEUES,
  blizzardFactory,
  characterJobId,
  guildSchedulerId,
  createRedis,
  syncCharacter,
  syncGuild,
  type CharacterSyncJob,
  type CoreContext,
  type GuildSyncJob,
} from "@wow/core";
import { createPrismaClient } from "@wow/db";

const env = process.env;
const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
const versions = loadServerGameVersions();
const prisma = createPrismaClient();

if (!env.BLIZZARD_CLIENT_ID || !env.BLIZZARD_CLIENT_SECRET) {
  console.warn("[worker] BLIZZARD_CLIENT_ID/SECRET missing: sync jobs will fail until they are set.");
}

const ctx: CoreContext = {
  prisma,
  versions,
  blizzard: blizzardFactory(versions, {
    clientId: env.BLIZZARD_CLIENT_ID ?? "",
    clientSecret: env.BLIZZARD_CLIENT_SECRET ?? "",
  }),
};

const characterQueue = new Queue<CharacterSyncJob>(QUEUES.characterSync, { connection: createRedis(redisUrl) });
const guildQueue = new Queue<GuildSyncJob>(QUEUES.guildSync, { connection: createRedis(redisUrl) });

const guildWorker = new Worker<GuildSyncJob>(
  QUEUES.guildSync,
  async (job) => {
    const { staleCharacterIds } = await syncGuild(ctx, job.data.guildId);
    await characterQueue.addBulk(
      staleCharacterIds.map((characterId) => ({
        name: "character",
        data: { characterId },
        // A stable job id deduplicates characters already waiting in the queue.
        opts: { jobId: characterJobId(characterId), removeOnComplete: true, removeOnFail: 100, attempts: 2, backoff: { type: "exponential", delay: 30_000 } },
      })),
    );
    return { queued: staleCharacterIds.length };
  },
  { connection: createRedis(redisUrl), concurrency: 2 },
);

const jobsPerSecond = Math.max(1, Number(env.SYNC_CHARACTER_JOBS_PER_SECOND ?? 1));
const characterWorker = new Worker<CharacterSyncJob>(
  QUEUES.characterSync,
  async (job) => syncCharacter(ctx, job.data.characterId, job.data.force),
  { connection: createRedis(redisUrl), concurrency: jobsPerSecond * 2, limiter: { max: jobsPerSecond, duration: 1000 } },
);

for (const worker of [guildWorker, characterWorker]) {
  worker.on("failed", (job, error) => console.error(`[worker] ${worker.name} job ${job?.id} failed:`, error.message));
}

/** Makes sure every guild has a repeat schedule matching its configured interval. */
async function reconcileSchedules() {
  const guilds = await prisma.guild.findMany({ select: { id: true, syncIntervalMinutes: true } });
  for (const guild of guilds) {
    await guildQueue.upsertJobScheduler(
      guildSchedulerId(guild.id),
      { every: guild.syncIntervalMinutes * 60_000 },
      { name: "guild", data: { guildId: guild.id } },
    );
  }
  console.log(`[worker] versions=${versions.list.map((v) => v.id).join(",")} default=${versions.defaultId} schedules=${guilds.length} characterJobsPerSecond=${jobsPerSecond}`);
}

await reconcileSchedules();

async function shutdown() {
  await Promise.all([guildWorker.close(), characterWorker.close()]);
  await Promise.all([guildQueue.close(), characterQueue.close()]);
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
