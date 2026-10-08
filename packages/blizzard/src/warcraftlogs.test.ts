import { describe, expect, it } from "vitest";
import { WarcraftLogsClient, WarcraftLogsError, normalizeWarcraftLogs } from "./warcraftlogs";

/** Shape of a real /api/v2/client character payload (vanilla.warcraftlogs.com, Naxxramas, October 2026), trimmed. */
const CHARACTER = {
  id: 96260370,
  recentReports: {
    data: [
      {
        code: "TptbCL6ax3XGHwQD",
        startTime: 1_772_053_044_043,
        zone: { id: 2006, name: "Naxxramas" },
        fights: [
          { encounterID: 51107, name: "Anub'Rekhan", difficulty: 3, size: 40, endTime: 849_457, friendlyPlayers: [1, 2] },
          { encounterID: 51118, name: "Patchwerk", difficulty: 3, size: 40, endTime: 1_906_887, friendlyPlayers: [2] },
        ],
        masterData: { actors: [{ id: 1, name: "Koldskaal" }, { id: 2, name: "Other" }] },
      },
    ],
  },
};

describe("normalizeWarcraftLogs", () => {
  it("keeps the kills the character took part in, with absolute times", () => {
    const logs = normalizeWarcraftLogs(CHARACTER, "koldskaal", "https://x");
    expect(logs.kills).toEqual([
      {
        report: "TptbCL6ax3XGHwQD",
        zoneId: 2006,
        encounterId: 51107,
        name: "Anub'Rekhan",
        difficulty: 3,
        size: 40,
        killedAt: new Date(1_772_053_044_043 + 849_457).toISOString(),
      },
    ]);
    expect(normalizeWarcraftLogs({}, "x", "u").kills).toEqual([]);
  });
});

describe("WarcraftLogsClient", () => {
  const client = (character: unknown, calls: { url: string; body?: string }[] = []) =>
    new WarcraftLogsClient({
      clientId: "id",
      clientSecret: "secret",
      fetch: (async (input: string | URL, init?: RequestInit) => {
        calls.push({ url: input.toString(), body: init?.body?.toString() });
        if (input.toString().endsWith("/oauth/token")) return Response.json({ access_token: "t", expires_in: 3600 });
        return Response.json({ data: { characterData: { character } } });
      }) as typeof fetch,
    });

  it("asks the given site for the character, reusing the token", async () => {
    const calls: { url: string; body?: string }[] = [];
    const wcl = client(CHARACTER, calls);
    const logs = await wcl.getCharacterKills("vanilla.warcraftlogs.com", "eu", "firemaw", "Koldskaal");
    await wcl.getCharacterKills("vanilla.warcraftlogs.com", "eu", "firemaw", "Koldskaal");
    expect(logs.url).toBe("https://vanilla.warcraftlogs.com/character/eu/firemaw/koldskaal");
    expect(logs.kills).toHaveLength(1);
    expect(calls.map((c) => c.url)).toEqual([
      "https://www.warcraftlogs.com/oauth/token",
      "https://vanilla.warcraftlogs.com/api/v2/client",
      "https://vanilla.warcraftlogs.com/api/v2/client",
    ]);
    expect(JSON.parse(calls[1]!.body!).variables).toEqual({ name: "Koldskaal", server: "firemaw", region: "EU", limit: 10 });
  });

  it("reports unknown characters as not found", async () => {
    const error = await client(null).getCharacterKills("vanilla.warcraftlogs.com", "eu", "firemaw", "Nadie").catch((e) => e);
    expect(error).toBeInstanceOf(WarcraftLogsError);
    expect(error.notFound).toBe(true);
  });
});
