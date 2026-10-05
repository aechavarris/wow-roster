import { BlizzardClient } from "@wow/blizzard";
import { resolveProfile } from "@wow/config";
import { syncCharacter, syncGuild, type CoreContext } from "@wow/core";
import { createPrismaClient } from "@wow/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import type { SyncQueue } from "./deps";

/**
 * Integration tests against a real Postgres (TEST_DATABASE_URL) with the Blizzard API
 * and the job queue faked. Run `docker compose up -d postgres` first.
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://wow:wow@localhost:5432/wow_roster_test";
const prisma = createPrismaClient(DATABASE_URL);
const profile = resolveProfile("retail-dev");

const member = (id: number, name: string, rank: number, classId = 1) => ({
  character: { id, name, level: 80, realm: { slug: "los-errantes" }, playable_class: { id: classId } },
  rank,
});

const blizzardRoutes: Record<string, unknown> = {
  "/profile/user/wow": {
    wow_accounts: [
      { characters: [{ id: 1, name: "Thrall", level: 80, realm: { slug: "los-errantes" }, playable_class: { id: 7 } }] },
    ],
  },
  "/data/wow/guild/los-errantes/horda-eterna": { id: 900, name: "Horda Eterna", realm: { slug: "los-errantes" }, faction: { type: "HORDE" } },
  "/data/wow/guild/los-errantes/horda-eterna/roster": {
    members: [member(1, "Thrall", 0, 7), member(2, "Garrosh", 1), member(3, "Rexxar", 6, 3)],
  },
  "/profile/wow/character/los-errantes/garrosh": {
    id: 2,
    name: "Garrosh",
    level: 80,
    realm: { slug: "los-errantes" },
    character_class: { id: 1 },
    active_spec: { id: 73, name: "Protection" },
    equipped_item_level: 700,
    last_login_timestamp: 1_760_000_000_000,
  },
  "/profile/wow/character/los-errantes/garrosh/equipment": { equipped_items: [] },
  "/profile/wow/character/los-errantes/garrosh/character-media": { assets: [{ key: "avatar", value: "https://render/avatar.jpg" }] },
};

const fakeFetch = (async (input: string | URL) => {
  const url = new URL(input.toString());
  if (url.pathname === "/token") return Response.json({ access_token: "app", expires_in: 3600 });
  const body = blizzardRoutes[url.pathname];
  return body ? Response.json(body) : new Response(null, { status: 404 });
}) as typeof fetch;

const core: CoreContext = {
  prisma,
  profile,
  blizzard: (region) => new BlizzardClient({ clientId: "id", clientSecret: "secret", region, api: profile.api, fetch: fakeFetch }),
};

const calls: string[] = [];
const queue: SyncQueue = {
  scheduleGuild: async (id, minutes) => void calls.push(`schedule:${id}:${minutes}`),
  unscheduleGuild: async (id) => void calls.push(`unschedule:${id}`),
  syncGuildNow: async (id) => void calls.push(`guild:${id}`),
  syncCharacters: async (ids) => void calls.push(`characters:${ids.length}`),
};

let app: FastifyInstance;

async function login(bnetId = 1001): Promise<string> {
  const start = await app.inject({ method: "GET", url: "/api/auth/login?region=eu&redirect=/es" });
  const stateCookie = start.cookies.find((c) => c.name === "wr_oauth_state")!;
  const state = JSON.parse(stateCookie.value).state as string;
  const callback = await app.inject({
    method: "GET",
    url: `/api/auth/callback?code=${bnetId}&state=${state}`,
    cookies: { wr_oauth_state: stateCookie.value },
  });
  expect(callback.statusCode).toBe(302);
  expect(callback.headers.location).toBe("http://localhost:3000/es");
  return callback.cookies.find((c) => c.name === "wr_session")!.value;
}

beforeAll(async () => {
  app = await buildApp({
    env: {
      DATABASE_URL,
      REDIS_URL: "redis://unused",
      BLIZZARD_CLIENT_ID: "id",
      BLIZZARD_CLIENT_SECRET: "secret",
      BLIZZARD_REGION: "eu",
      PUBLIC_URL: "http://localhost:3000",
      API_PORT: 0,
    },
    prisma,
    profile,
    core,
    queue,
    oauth: {
      authorizeUrl: (state) => `https://oauth.example/authorize?state=${state}`,
      login: async (code) => ({ user: { id: Number(code), battletag: `Player#${code}` }, accessToken: "user-token" }),
    },
  });
});

beforeEach(async () => {
  calls.length = 0;
  await prisma.$executeRawUnsafe(
    'TRUNCATE "RosterEntry", "Character", "GuildRank", "GuildMembership", "Guild", "Session", "User" CASCADE',
  );
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("config", () => {
  it("exposes the game profile with only 10 and 20 player raid sizes enabled", async () => {
    const response = await app.inject({ method: "GET", url: "/api/config" });
    const body = response.json();
    expect(body.loginEnabled).toBe(true);
    expect(body.profile.raidSizes.filter((r: { enabled: boolean }) => r.enabled).map((r: { size: number }) => r.size)).toEqual([10, 20]);
  });
});

describe("auth", () => {
  it("logs in with Battle.net and claims the account characters", async () => {
    const session = await login();
    const me = (await app.inject({ method: "GET", url: "/api/me", cookies: { wr_session: session } })).json();
    expect(me.user.battletag).toBe("Player#1001");
    expect(me.characters.map((c: { name: string }) => c.name)).toEqual(["Thrall"]);
    expect(calls).toContain("characters:1");
  });

  it("rejects a callback with a mismatched state", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/callback?code=1&state=wrong",
      cookies: { wr_oauth_state: JSON.stringify({ state: "right", region: "eu", redirect: "/" }) },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns no user without a session", async () => {
    expect((await app.inject({ method: "GET", url: "/api/me" })).json()).toEqual({ user: null });
  });
});

describe("guilds", () => {
  async function registerGuild(session: string) {
    return app.inject({
      method: "POST",
      url: "/api/guilds",
      cookies: { wr_session: session },
      payload: { region: "eu", realm: "Los Errantes", name: "Horda Eterna" },
    });
  }

  it("registers a guild for an officer and schedules its sync", async () => {
    const session = await login();
    const response = await registerGuild(session);
    expect(response.statusCode).toBe(201);
    const { guild } = response.json();
    expect(guild).toMatchObject({ realm: "los-errantes", slug: "horda-eterna", name: "Horda Eterna", syncIntervalMinutes: 60 });
    expect(calls).toEqual(expect.arrayContaining([`schedule:${guild.id}:60`, `guild:${guild.id}`]));

    const ranks = await prisma.guildRank.findMany({ where: { guildId: guild.id }, orderBy: { rank: "asc" } });
    expect(ranks.map((r) => [r.rank, r.status])).toEqual([
      [0, "raider"],
      [1, "raider"],
      [6, "social"],
    ]);
    expect((await registerGuild(session)).statusCode).toBe(409);
  });

  it("refuses users without an officer character", async () => {
    blizzardRoutes["/profile/user/wow"] = { wow_accounts: [] };
    try {
      const session = await login(2002);
      expect((await registerGuild(session)).statusCode).toBe(403);
    } finally {
      blizzardRoutes["/profile/user/wow"] = {
        wow_accounts: [
          { characters: [{ id: 1, name: "Thrall", level: 80, realm: { slug: "los-errantes" }, playable_class: { id: 7 } }] },
        ],
      };
    }
  });

  it("syncs the roster, applies overrides and hides private guilds", async () => {
    const session = await login();
    const { guild } = (await registerGuild(session)).json();

    const { staleCharacterIds } = await syncGuild(core, guild.id);
    expect(staleCharacterIds).toHaveLength(3);
    const garrosh = await prisma.character.findFirstOrThrow({ where: { nameKey: "garrosh" } });
    expect(await syncCharacter(core, garrosh.id)).toBe("updated");

    const roster = (await app.inject({ method: "GET", url: `/api/guilds/${guild.id}/roster` })).json();
    const names = roster.players.map((p: { main: { name: string } }) => p.main.name);
    expect(names).toEqual(["Garrosh", "Rexxar", "Thrall"]);
    const garroshView = roster.players[0].main;
    expect(garroshView).toMatchObject({ role: "tank", specKey: "protection", status: "raider", itemLevel: 700, avatar: "https://render/avatar.jpg" });
    expect(roster.players[1].main.status).toBe("social");
    expect(roster.players[2].claimed).toBe(true);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/guilds/${guild.id}/roster/${garroshView.entryId}`,
      cookies: { wr_session: session },
      payload: { status: "bench", role: "mdps" },
    });
    expect(patch.statusCode).toBe(200);
    const updated = (await app.inject({ method: "GET", url: `/api/guilds/${guild.id}/roster` })).json();
    expect(updated.players[0].main).toMatchObject({ status: "bench", role: "mdps", statusOverridden: true });

    // Anonymous visitors cannot edit.
    const anonymous = await app.inject({
      method: "PATCH",
      url: `/api/guilds/${guild.id}/roster/${garroshView.entryId}`,
      payload: { status: "raider" },
    });
    expect(anonymous.statusCode).toBe(401);

    await app.inject({ method: "PATCH", url: `/api/guilds/${guild.id}`, cookies: { wr_session: session }, payload: { public: false } });
    expect((await app.inject({ method: "GET", url: `/api/guilds/${guild.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/guilds/${guild.id}`, cookies: { wr_session: session } })).json().viewerRole).toBe("OWNER");
  });

  it("validates sync interval against the profile minimum", async () => {
    const session = await login();
    const { guild } = (await registerGuild(session)).json();
    const response = await app.inject({
      method: "PATCH",
      url: `/api/guilds/${guild.id}`,
      cookies: { wr_session: session },
      payload: { syncIntervalMinutes: 5 },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("characters", () => {
  it("serves synced character pages and 404s unknown ones for anonymous users", async () => {
    const session = await login();
    const page = await app.inject({
      method: "GET",
      url: "/api/characters/eu/los-errantes/Garrosh",
      cookies: { wr_session: session },
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().character).toMatchObject({ name: "Garrosh", specName: "protection", equippedItemLevel: 700 });
    expect((await app.inject({ method: "GET", url: "/api/characters/eu/los-errantes/Nobody" })).statusCode).toBe(404);
  });
});
