/**
 * Server-side admin CLI for maintenance the app UI does not expose, where only a roster's own owner can act.
 * It talks straight to the database (and Redis, to drop the sync schedule), so run it on the server with the
 * same DATABASE_URL / REDIS_URL the worker uses.
 *
 * In the Docker production stack:
 *   docker compose -f docker-compose.prod.yml -f docker-compose.home.yml exec worker node dist/admin.js list
 *   docker compose -f docker-compose.prod.yml -f docker-compose.home.yml exec worker node dist/admin.js delete <id> ["Exact name"]
 *
 * Locally from the repo:
 *   pnpm --filter @wow/worker admin list
 *   pnpm --filter @wow/worker admin delete <id> ["Exact name"]
 *
 * `delete` removes any roster regardless of its owner. Its entries, ranks, memberships, invites and webhooks
 * cascade; the characters stay (their guild link is cleared), since they belong to the players. Passing the
 * exact roster name as a second argument makes the delete refuse unless it matches, as a typo guard.
 */
import { Queue } from "bullmq";
import { QUEUES, createRedis, guildSchedulerId } from "@wow/core";
import { createPrismaClient } from "@wow/db";

const prisma = createPrismaClient();

async function list() {
  const guilds = await prisma.guild.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      memberships: { where: { role: "OWNER" }, select: { user: { select: { battletag: true } } } },
      _count: { select: { roster: true } },
    },
  });
  if (guilds.length === 0) {
    console.log("No rosters.");
    return;
  }
  for (const g of guilds) {
    const owner = g.memberships[0]?.user.battletag ?? "—";
    const visibility = g.public ? "public" : g.published ? "published" : "draft";
    console.log(
      `${g.id}  ${g.kind.padEnd(6)} ${g.gameVersion.padEnd(12)} ${visibility.padEnd(9)} ${String(g._count.roster).padStart(3)} entries  owner=${owner}  "${g.name}"`,
    );
  }
  console.log(`\n${guilds.length} roster(s).`);
}

async function remove(id: string, expectedName?: string) {
  const guild = await prisma.guild.findUnique({ where: { id }, include: { _count: { select: { roster: true } } } });
  if (!guild) {
    console.error(`No roster with id ${id}.`);
    process.exitCode = 1;
    return;
  }
  if (expectedName !== undefined && expectedName !== guild.name) {
    console.error(`Name mismatch: roster ${id} is "${guild.name}", not "${expectedName}". Aborting.`);
    process.exitCode = 1;
    return;
  }
  // Drop the worker's repeating sync schedule first, so a deleted roster stops being polled. Best-effort:
  // a missing Redis should not block removing the row.
  const queue = new Queue(QUEUES.guildSync, { connection: createRedis(process.env.REDIS_URL ?? "redis://localhost:6379") });
  try {
    await queue.removeJobScheduler(guildSchedulerId(id));
  } catch (err) {
    console.warn(`Warning: could not remove the sync schedule (${(err as Error).message}). The row will still be deleted.`);
  } finally {
    await queue.close();
  }
  await prisma.guild.delete({ where: { id } });
  console.log(`Deleted roster ${id} "${guild.name}" (${guild._count.roster} entries removed; characters kept).`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "list":
      await list();
      break;
    case "delete":
      if (!args[0]) {
        console.error('Usage: admin delete <id> ["Exact name"]');
        process.exitCode = 1;
        break;
      }
      await remove(args[0], args[1]);
      break;
    default:
      console.error('Usage: admin <list | delete <id> ["Exact name"]>');
      process.exitCode = 1;
  }
}

await main();
await prisma.$disconnect();
// ioredis connections opened above keep the event loop alive; exit explicitly once the work is done.
process.exit(process.exitCode ?? 0);
