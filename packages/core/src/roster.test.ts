import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import { buildRoster, type RosterInputEntry } from "./roster";
import { defaultStatusForRank } from "./sync";

const profile = resolveProfile("retail");

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
      gameVersion: "retail",
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

describe("planned entries", () => {
  const ranks: { rank: number; status: string }[] = [];
  const planned = (id: string, extra: Partial<RosterInputEntry> = {}): RosterInputEntry => ({
    id,
    source: "planned",
    status: null,
    role: null,
    note: null,
    mainEntryId: null,
    character: null,
    ...extra,
  });

  it("uses the planned class and spec for name, role and spec", () => {
    const [player] = buildRoster(profile, ranks, [planned("p1", { plannedName: "Futuro tanque", plannedClassId: 1, plannedSpec: "protection", playerName: "Patxi" })]);
    expect(player!.main).toMatchObject({
      planned: true,
      characterId: null,
      name: "Futuro tanque",
      playerName: "Patxi",
      classId: 1,
      specKey: "protection",
      role: "tank",
      status: "raider",
    });
  });

  it("groups a user's planned entries with their real characters", () => {
    const players = buildRoster(profile, ranks, [
      planned("p1", { plannedClassId: 5, plannedSpec: "holy", userId: "u1", playerName: "Ana" }),
      entry("Real", { character: { ownerId: "u1", isMain: true } }),
    ]);
    expect(players).toHaveLength(1);
    expect(players[0]!.main.name).toBe("Real");
    expect(players[0]!.alts[0]).toMatchObject({ planned: true, name: "Ana", userId: "u1" });
  });

  it("ignores a planned spec that does not belong to the class", () => {
    const [player] = buildRoster(profile, ranks, [planned("p1", { plannedClassId: 8, plannedSpec: "protection" })]);
    expect(player!.main).toMatchObject({ classId: 8, specKey: null, role: null, name: "?" });
  });
});

describe("defaultStatusForRank", () => {
  it("maps high ranks to raiding and low ranks to social", () => {
    expect(defaultStatusForRank(profile, 0)).toBe("raider");
    expect(defaultStatusForRank(profile, 7)).toBe("social");
  });
});
