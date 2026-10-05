import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import { BlizzardClient } from "./client";

function fakeFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL) => {
    const url = new URL(input.toString());
    calls.push(url.pathname + url.search);
    if (url.pathname === "/token") return Response.json({ access_token: "app", expires_in: 3600 });
    const route = routes[url.pathname];
    if (!route) return new Response(null, { status: 404 });
    return Response.json(route.body ?? {}, { status: route.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("BlizzardClient", () => {
  const profile = resolveProfile("retail-dev");

  it("uses the namespace from the game profile", async () => {
    const { impl, calls } = fakeFetch({
      "/data/wow/guild/los-errantes/horda/roster": { body: { members: [] } },
    });
    const client = new BlizzardClient({ clientId: "id", clientSecret: "s", region: "eu", api: profile.api, fetch: impl });
    await client.getGuildRoster("los-errantes", "horda");
    expect(calls.at(-1)).toContain("namespace=profile-eu");
  });

  it("records missing detail endpoints instead of failing", async () => {
    const { impl } = fakeFetch({
      "/profile/wow/character/realm/thrall": { body: { id: 1, name: "Thrall", level: 60 } },
      "/profile/wow/character/realm/thrall/equipment": { body: { equipped_items: [] } },
    });
    const client = new BlizzardClient({
      clientId: "id",
      clientSecret: "s",
      region: "eu",
      api: { ...profile.api, characterEndpoints: ["equipment", "professions", "media"] },
      fetch: impl,
    });
    const result = await client.getCharacterProfile({ realm: "realm", name: "Thrall" });
    expect(result.summary.name).toBe("Thrall");
    expect(result.equipment).toEqual([]);
    expect(result.missing).toMatchObject({ professions: "404", media: "404", statistics: "unsupported" });
  });
});
