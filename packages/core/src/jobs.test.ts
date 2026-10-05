import { Queue } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";
import { characterJobId, createRedis, guildNowJobId } from "./jobs";

/** Needs a real Redis (docker compose up -d redis); BullMQ validates custom ids when adding jobs. */
const queue = new Queue("jobs-test", { connection: createRedis(process.env.REDIS_URL ?? "redis://localhost:6379") });

afterAll(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
});

describe("job ids", () => {
  it("are accepted by BullMQ when adding jobs", async () => {
    const jobs = await queue.addBulk([
      { name: "character", data: {}, opts: { jobId: characterJobId("cmuv0r3f00007l8uducdexi13") } },
      { name: "guild", data: {}, opts: { jobId: guildNowJobId("cmuv0r3dn0000l8udtvo5eur8") } },
    ]);
    expect(jobs.map((j) => j.id)).toEqual(["character-cmuv0r3f00007l8uducdexi13", "guild-now-cmuv0r3dn0000l8udtvo5eur8"]);
  });

  it("deduplicates a character that is already queued", async () => {
    const id = characterJobId("dup");
    await queue.add("character", {}, { jobId: id });
    await queue.add("character", {}, { jobId: id });
    expect((await queue.getJobs(["wait"])).filter((j) => j.id === id)).toHaveLength(1);
  });
});
