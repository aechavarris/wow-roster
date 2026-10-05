import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import { buildRoster, type RosterInputEntry } from "./roster";
import { defaultStatusForRank } from "./sync";

const profile = resolveProfile("retail-dev");

type EntryOverrides = Partial<Omit<RosterInputEntry, "character">> & { character?: Partial<RosterInputEntry["character"]> };

function entry(id: string, overrides: EntryOverrides = {}): RosterInputEntry {
  const { character, ...rest } = overrides;
  return {
    id,
    source: "guild",
    status: null,
    role: null,
    note: null,
    mainEntryId: null,
    ...rest,
    character: {
      id: `c-${id}`,
      region: "eu",
      realm: "realm",
      name: id,
      level: 60,
      classId: 1,
      specId: 73,
      specName: null,
      averageItemLevel: null,
      equippedItemLevel: null,
      guildRank: 2,
      ownerId: null,
      isMain: false,
      lastSyncedAt: null,
      syncError: null,
      ...character,
    },
  };
}

describe("buildRoster", () => {
  const ranks = [
    { rank: 2, status: "raider" },
    { rank: 5, status: "social" },
  ];

  it("derives status from rank and role from spec", () => {
    const [player] = buildRoster(profile, ranks, [entry("Tank")]);
    expect(player!.main).toMatchObject({ status: "raider", role: "tank", specKey: "protection", statusOverridden: false });
  });

  it("applies officer overrides", () => {
    const [player] = buildRoster(profile, ranks, [entry("Tank", { status: "bench", role: "mdps" })]);
    expect(player!.main).toMatchObject({ status: "bench", role: "mdps", statusOverridden: true, roleOverridden: true });
  });

  it("groups characters of the same Battle.net owner and uses the chosen main", () => {
    const players = buildRoster(profile, ranks, [
      entry("Alt", { character: { ownerId: "u1", level: 60 } }),
      entry("Main", { character: { ownerId: "u1", isMain: true, level: 50 } }),
      entry("Other"),
    ]);
    expect(players).toHaveLength(2);
    const owned = players.find((p) => p.claimed)!;
    expect(owned.main.name).toBe("Main");
    expect(owned.alts.map((a) => a.name)).toEqual(["Alt"]);
  });

  it("groups officer-linked alts under their main entry", () => {
    const players = buildRoster(profile, ranks, [entry("Main"), entry("Alt", { mainEntryId: "Main", character: { level: 70 } })]);
    expect(players).toHaveLength(1);
    expect(players[0]!.main.name).toBe("Main");
  });
});

describe("defaultStatusForRank", () => {
  it("maps high ranks to raiding and low ranks to social", () => {
    expect(defaultStatusForRank(profile, 0)).toBe("raider");
    expect(defaultStatusForRank(profile, 7)).toBe("social");
  });
});
