import type { BlizzardClient, JournalEncounter, JournalInstance, JournalInstanceRef } from "@wow/blizzard";
import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import { buildBisSourceIndex, lookupBisSource } from "./bis";

const era = resolveProfile("classic-era");

/** A Blizzard client stub answering only the journal methods the index builder uses. */
function fakeClient(opts: {
  instances?: JournalInstanceRef[] | (() => never);
  instance?: Record<number, JournalInstance>;
  encounter?: Record<number, JournalEncounter>;
}): BlizzardClient {
  return {
    getJournalInstances: async () => {
      if (typeof opts.instances === "function") opts.instances();
      return opts.instances ?? [];
    },
    getJournalInstance: async (id: number) => opts.instance?.[id],
    getJournalEncounter: async (id: number) => opts.encounter?.[id],
  } as unknown as BlizzardClient;
}

describe("buildBisSourceIndex", () => {
  it("maps items to the profile zone that drops them, keeping the first zone and the boss name", async () => {
    const client = fakeClient({
      instances: [
        { id: 741, name: { en: "Molten Core" } },
        { id: 742, name: { en: "Unknown Raid" } },
      ],
      instance: { 741: { id: 741, name: { en: "Molten Core", es: "Núcleo de Magma" }, type: "RAID", encounterIds: [332] } },
      encounter: { 332: { id: 332, name: { en: "Ragnaros", es: "Ragnaros" }, instanceId: 741, itemIds: [17182, 18563] } },
    });
    const index = await buildBisSourceIndex(client, era);
    expect(index.available).toBe(true);
    expect(index.items["17182"]).toEqual({
      zoneKey: "molten-core",
      type: "raid",
      zoneName: { en: "Molten Core", es: "Núcleo de Magma" },
      bossName: { en: "Ragnaros", es: "Ragnaros" },
    });
    expect(lookupBisSource(index, 18563)).toEqual({
      type: "raid",
      zoneKey: "molten-core",
      zoneName: { en: "Molten Core", es: "Núcleo de Magma" },
      bossName: { en: "Ragnaros", es: "Ragnaros" },
      auto: true,
    });
    expect(lookupBisSource(index, 999)).toBeUndefined();
  });

  it("reports the journal as unavailable when it 404s (Classic namespaces), so zones stay manual", async () => {
    const client = fakeClient({
      instances: () => {
        throw new Error("404");
      },
    });
    const index = await buildBisSourceIndex(client, era);
    expect(index).toEqual({ items: {}, available: false });
    expect(lookupBisSource(index, 17182)).toBeUndefined();
  });
});
