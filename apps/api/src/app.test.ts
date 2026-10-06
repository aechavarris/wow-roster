import { BlizzardClient } from "@wow/blizzard";
import { loadGameVersions } from "@wow/config";
import { ApiUnavailableError, syncCharacter, syncGuild, type CoreContext } from "@wow/core";
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
const versions = loadGameVersions("retail");

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
  "/profile/wow/character/los-errantes/garrosh/equipment": {
    equipped_items: [{ slot: { type: "HEAD" }, item: { id: 500 }, name: { en_US: "Helm", es_ES: "Yelmo" }, quality: { type: "EPIC" } }],
  },
  "/profile/wow/character/los-errantes/garrosh/character-media": { assets: [{ key: "avatar", value: "https://render/avatar.jpg" }] },
  "/profile/wow/character/los-errantes/garrosh/specializations": {
    active_specialization: { id: 73 },
    specializations: [
      {
        specialization: { id: 73, name: "Protection" },
        loadouts: [
          {
            is_active: true,
            selected_class_talents: [{ id: 1, rank: 1 }],
            selected_class_talent_tree: { key: { href: "https://eu.api.blizzard.com/data/wow/talent-tree/790?namespace=static-eu" } },
          },
        ],
      },
    ],
  },
  "/data/wow/talent-tree/790/playable-specialization/73": {
    id: 790,
    playable_specialization: { id: 73, name: "Protection" },
    class_talent_nodes: [
      { id: 1, node_type: { type: "ACTIVE" }, display_row: 1, display_col: 1, ranks: [{ rank: 1, tooltip: { talent: { id: 9, name: "Taunt" }, spell_tooltip: { spell: { id: 355 }, description: "Taunts." } } }] },
    ],
    spec_talent_nodes: [],
    hero_talent_trees: [],
  },
  "/data/wow/talent-tree/790/playable-specialization/71": {
    id: 790,
    playable_specialization: { id: 71, name: "Arms" },
    class_talent_nodes: [
      { id: 1, node_type: { type: "ACTIVE" }, display_row: 1, display_col: 1, ranks: [{ rank: 1, tooltip: { talent: { id: 9, name: "Taunt" }, spell_tooltip: { spell: { id: 355 } } } }] },
    ],
    spec_talent_nodes: [
      { id: 2, node_type: { type: "PASSIVE" }, display_row: 2, display_col: 1, ranks: [{ rank: 1, tooltip: { talent: { id: 10, name: "Overpower" }, spell_tooltip: { spell: { id: 7384 } } } }] },
    ],
    hero_talent_trees: [],
  },
  "/data/wow/media/spell/7384": { assets: [{ key: "icon", value: "https://render/icons/overpower.jpg" }] },
  "/data/wow/media/item/500": { assets: [{ key: "icon", value: "https://render/icons/helm.jpg" }] },
  "/data/wow/media/spell/355": { assets: [{ key: "icon", value: "https://render/icons/taunt.jpg" }] },
};

/** The fake game data lives in retail; every other game version's namespace answers 404. */
const RETAIL_NAMESPACES = new Set(["profile-eu", "static-eu", "dynamic-eu"]);

/** Paths that answer with an error status, to simulate Blizzard outages per endpoint. */
const failingRoutes = new Map<string, number>();
/** Every Blizzard path requested, to check what each API route costs. */
const blizzardCalls: string[] = [];

const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(input.toString());
  if (url.pathname === "/token") return Response.json({ access_token: "app", expires_in: 3600 });
  blizzardCalls.push(url.pathname);
  // The account characters belong to Battle.net user 1001; every other user has none.
  const userToken = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "");
  if (url.pathname === "/profile/user/wow" && userToken !== "user-token-1001" && !failingRoutes.has(url.pathname)) {
    return Response.json({ wow_accounts: [] });
  }
  const failure = failingRoutes.get(url.pathname);
  if (failure) return new Response(null, { status: failure });
  const namespace = url.searchParams.get("namespace");
  if (namespace && !RETAIL_NAMESPACES.has(namespace)) return new Response(null, { status: 404 });
  const body = blizzardRoutes[url.pathname];
  return body ? Response.json(body) : new Response(null, { status: 404 });
}) as typeof fetch;

const core: CoreContext = {
  prisma,
  versions,
  blizzard: (version, region) => {
    const api = versions.byId.get(version)?.api;
    if (!api?.available) throw new ApiUnavailableError(version);
    return new BlizzardClient({ clientId: "id", clientSecret: "secret", region, api, fetch: fakeFetch, retryDelayMs: 0 });
  },
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
    versions,
    core,
    queue,
    oauth: {
      authorizeUrl: (state) => `https://oauth.example/authorize?state=${state}`,
      login: async (code) => ({ user: { id: Number(code), battletag: `Player#${code}` }, accessToken: `user-token-${code}` }),
    },
  }, { rateLimit: 10_000 });
});

beforeEach(async () => {
  calls.length = 0;
  blizzardCalls.length = 0;
  failingRoutes.clear();
  await prisma.$executeRawUnsafe(
    'TRUNCATE "RosterInvite", "RosterEntry", "Character", "GuildRank", "GuildMembership", "Guild", "Session", "User", "StaticCache" CASCADE',
  );
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("config", () => {
  it("exposes every game version without API namespaces", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/config" })).json();
    expect(body.loginEnabled).toBe(true);
    expect(body.defaultVersion).toBe("retail");
    type Version = { id: string; apiAvailable: boolean; raidSizes: { size: number; enabled: boolean }[]; api?: unknown };
    const byId = Object.fromEntries((body.versions as Version[]).map((v) => [v.id, v]));
    expect(Object.keys(byId)).toEqual(["forever", "classic-era", "anniversary", "progression", "retail"]);
    expect(byId.forever!.apiAvailable).toBe(false);
    expect(byId.forever!.raidSizes.filter((r) => r.enabled).map((r) => r.size)).toEqual([10, 20]);
    expect(byId.retail!.api).toBeUndefined();
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
      payload: { gameVersion: "retail", region: "eu", realm: "Los Errantes", name: "Horda Eterna" },
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

describe("custom rosters and planned characters", () => {
  const send = (method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, session: string | null, payload?: object) =>
    app.inject({ method, url, payload, cookies: session ? { wr_session: session } : {} });
  const roster = async (id: string) =>
    (await app.inject({ method: "GET", url: `/api/guilds/${id}/roster` })).json().players as {
      main: { entryId: string; name: string; planned: boolean; classId: number; specKey: string | null; role: string; userId: string | null; characterId: string | null };
      alts: unknown[];
    }[];

  it("plans a roster without a guild, invites a member and links a planned entry to a real character", async () => {
    const owner = await login(1001);
    const created = await send("POST", "/api/rosters", owner, { name: "Equipo Forever", gameVersion: "retail", region: "eu" });
    expect(created.statusCode).toBe(201);
    const { guild } = created.json();
    expect(guild).toMatchObject({ kind: "custom", name: "Equipo Forever", realm: null, slug: null });
    expect(calls).toContain(`schedule:${guild.id}:60`);

    // The owner plans entries for other players.
    const tank = await send("POST", `/api/guilds/${guild.id}/roster/planned`, owner, {
      classId: 1,
      specKey: "protection",
      playerName: "Patxi",
      plannedName: "Tanque principal",
    });
    expect(tank.statusCode).toBe(201);
    expect((await send("POST", `/api/guilds/${guild.id}/roster/planned`, owner, { classId: 8, specKey: "protection" })).statusCode).toBe(400);
    let players = await roster(guild.id);
    expect(players[0]!.main).toMatchObject({ name: "Tanque principal", planned: true, classId: 1, specKey: "protection", role: "tank" });

    // Ranks only exist for guild-linked rosters.
    expect((await send("PUT", `/api/guilds/${guild.id}/ranks`, owner, [{ rank: 0, status: "raider" }])).statusCode).toBe(400);

    // A member joins through an invite link.
    expect((await send("POST", `/api/guilds/${guild.id}/invites`, null, { role: "MEMBER" })).statusCode).toBe(401);
    const invite = (await send("POST", `/api/guilds/${guild.id}/invites`, owner, { role: "MEMBER", maxUses: 1 })).json();
    expect(invite.url).toBe(`http://localhost:3000/invite/${invite.token}`);
    const preview = (await app.inject({ method: "GET", url: `/api/invites/${invite.token}` })).json();
    expect(preview).toMatchObject({ roster: { name: "Equipo Forever", kind: "custom" }, role: "MEMBER", usable: true, currentRole: null });
    const member = await login(2002);
    expect((await send("POST", `/api/invites/${invite.token}/accept`, member)).json()).toMatchObject({ guildId: guild.id, role: "MEMBER" });
    expect((await send("POST", `/api/invites/${invite.token}/accept`, await login(3003))).statusCode).toBe(410);

    // Members plan only for themselves and cannot manage other entries or invites.
    const mine = (await send("POST", `/api/guilds/${guild.id}/roster/planned`, member, { classId: 5, specKey: "holy", forSelf: false })).json().entry;
    expect(mine).toMatchObject({ playerName: "Player", status: null });
    expect(mine.userId).not.toBeNull();
    expect((await send("PATCH", `/api/guilds/${guild.id}/roster/${mine.id}`, member, { plannedSpec: "shadow" })).statusCode).toBe(200);
    expect((await send("PATCH", `/api/guilds/${guild.id}/roster/${mine.id}`, member, { status: "bench" })).statusCode).toBe(403);
    expect((await send("DELETE", `/api/guilds/${guild.id}/roster/${tank.json().entry.id}`, member)).statusCode).toBe(403);
    expect((await send("POST", `/api/guilds/${guild.id}/invites`, member, { role: "MEMBER" })).statusCode).toBe(403);
    players = await roster(guild.id);
    expect(players.find((p) => p.main.userId === mine.userId)!.main).toMatchObject({ specKey: "shadow", role: "rdps" });

    // When the character exists in the game, the planned entry is linked to it.
    const linked = await send("POST", `/api/guilds/${guild.id}/roster/${tank.json().entry.id}/link`, owner, { realm: "Los Errantes", name: "Garrosh" });
    expect(linked.statusCode).toBe(200);
    players = await roster(guild.id);
    expect(players.find((p) => p.main.name === "Garrosh")!.main).toMatchObject({ planned: false, classId: 1, specKey: "protection" });

    // Syncing a custom roster refreshes its characters without guild API calls.
    const { staleCharacterIds } = await syncGuild(core, guild.id);
    expect(staleCharacterIds).toEqual([]);

    // Custom rosters can be renamed; the member list shows both users.
    expect((await send("PATCH", `/api/guilds/${guild.id}`, owner, { name: "Forever 20" })).json().guild.name).toBe("Forever 20");
    const members = (await app.inject({ method: "GET", url: `/api/guilds/${guild.id}/members`, cookies: { wr_session: owner } })).json().members;
    expect(members.map((m: { role: string }) => m.role)).toEqual(["OWNER", "MEMBER"]);
  });
});

describe("characters", () => {
  it("serves synced character pages and 404s unknown ones for anonymous users", async () => {
    const session = await login();
    const page = await app.inject({
      method: "GET",
      url: "/api/characters/retail/eu/los-errantes/Garrosh",
      cookies: { wr_session: session },
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().character).toMatchObject({ name: "Garrosh", specName: "protection", equippedItemLevel: 700 });
    expect((await app.inject({ method: "GET", url: "/api/characters/retail/eu/los-errantes/Nobody" })).statusCode).toBe(404);
  });

  it("enriches synced characters with icons and serves the cached talent tree", async () => {
    const session = await login();
    const page = await app.inject({ method: "GET", url: "/api/characters/retail/eu/los-errantes/Garrosh", cookies: { wr_session: session } });
    const { profile } = page.json().character;
    expect(profile.equipment[0]).toMatchObject({ name: { en: "Helm", es: "Yelmo" }, icon: "https://render/icons/helm.jpg" });
    expect(profile.talents[0]).toMatchObject({ treeId: 790, specId: 73, selected: [{ nodeId: 1, rank: 1 }] });

    // Cached during the sync, so anonymous visitors can read it.
    const tree = await app.inject({ method: "GET", url: "/api/talent-trees/retail/eu/790/73" });
    expect(tree.statusCode).toBe(200);
    expect(tree.json().layout.classNodes[0].options[0]).toMatchObject({ name: { en: "Taunt" }, icon: "https://render/icons/taunt.jpg" });

    // Uncached trees are only built for signed-in users.
    expect((await app.inject({ method: "GET", url: "/api/talent-trees/retail/eu/790/71" })).statusCode).toBe(404);
  });
});

describe("game versions", () => {
  const send = (method: "POST" | "PATCH", url: string, session: string, payload?: object) =>
    app.inject({ method, url, cookies: { wr_session: session }, payload });

  it("claims characters per game version and keeps the same name apart across versions", async () => {
    const session = await login();
    const me = (await app.inject({ method: "GET", url: "/api/me", cookies: { wr_session: session } })).json();
    // Only retail has data in the fake API; the Classic versions answered 404 and were skipped.
    expect(me.characters.map((c: { name: string; gameVersion: string }) => `${c.gameVersion}:${c.name}`)).toEqual(["retail:Thrall"]);

    await prisma.character.create({
      data: { gameVersion: "classic-era", region: "eu", realm: "los-errantes", name: "Thrall", nameKey: "thrall" },
    });
    expect(await prisma.character.count({ where: { nameKey: "thrall" } })).toBe(2);
  });

  it("applies each version's own classes and specs to planned characters", async () => {
    const owner = await login(1001);
    const era = (await send("POST", "/api/rosters", owner, { name: "Vanilla", gameVersion: "classic-era", region: "eu" })).json().guild;
    expect(era.gameVersion).toBe("classic-era");
    // Combat exists in Classic; Outlaw and monks do not.
    expect((await send("POST", `/api/guilds/${era.id}/roster/planned`, owner, { classId: 4, specKey: "combat" })).statusCode).toBe(201);
    expect((await send("POST", `/api/guilds/${era.id}/roster/planned`, owner, { classId: 4, specKey: "outlaw" })).statusCode).toBe(400);
    expect((await send("POST", `/api/guilds/${era.id}/roster/planned`, owner, { classId: 10 })).statusCode).toBe(400);

    const retail = (await send("POST", "/api/rosters", owner, { name: "Retail", gameVersion: "retail", region: "eu" })).json().guild;
    expect((await send("POST", `/api/guilds/${retail.id}/roster/planned`, owner, { classId: 4, specKey: "outlaw" })).statusCode).toBe(201);
    expect((await send("POST", `/api/guilds/${retail.id}/roster/planned`, owner, { classId: 4, specKey: "combat" })).statusCode).toBe(400);

    expect((await send("POST", "/api/rosters", owner, { name: "X", gameVersion: "wotlk", region: "eu" })).statusCode).toBe(400);
  });

  it("only lets the owner change the version of a custom roster without real characters", async () => {
    const owner = await login(1001);
    const roster = (await send("POST", "/api/rosters", owner, { name: "Plan", gameVersion: "retail", region: "eu" })).json().guild;
    await send("POST", `/api/guilds/${roster.id}/roster/planned`, owner, { classId: 4, specKey: "outlaw" });

    const invite = (await send("POST", `/api/guilds/${roster.id}/invites`, owner, { role: "OFFICER" })).json();
    const officer = await login(2002);
    await send("POST", `/api/invites/${invite.token}/accept`, officer);
    expect((await send("PATCH", `/api/guilds/${roster.id}`, officer, { gameVersion: "classic-era" })).statusCode).toBe(403);

    const changed = await send("PATCH", `/api/guilds/${roster.id}`, owner, { gameVersion: "classic-era" });
    expect(changed.json().guild.gameVersion).toBe("classic-era");
    // Outlaw does not exist in Classic: the planned spec is cleared, the class stays.
    const entry = await prisma.rosterEntry.findFirstOrThrow({ where: { guildId: roster.id } });
    expect(entry).toMatchObject({ plannedClassId: 4, plannedSpec: null });

    await send("PATCH", `/api/guilds/${roster.id}`, owner, { gameVersion: "retail" });
    expect((await send("POST", `/api/guilds/${roster.id}/roster`, owner, { realm: "Los Errantes", name: "Garrosh" })).statusCode).toBe(201);
    expect((await send("PATCH", `/api/guilds/${roster.id}`, owner, { gameVersion: "classic-era" })).statusCode).toBe(409);
  });

  it("keeps Forever rosters to planned characters until Blizzard publishes its API", async () => {
    const owner = await login(1001);
    const roster = (await send("POST", "/api/rosters", owner, { name: "Forever", gameVersion: "forever", region: "eu" })).json().guild;
    expect((await send("POST", `/api/guilds/${roster.id}/roster/planned`, owner, { classId: 2, specKey: "holy" })).statusCode).toBe(201);
    const real = await send("POST", `/api/guilds/${roster.id}/roster`, owner, { realm: "Los Errantes", name: "Garrosh" });
    expect(real.statusCode).toBe(409);
    expect(real.json().error).toBe("game_version_without_api");
    expect((await app.inject({ method: "GET", url: "/api/characters/forever/eu/x/Garrosh", cookies: { wr_session: owner } })).statusCode).toBe(409);
  });
});

describe("published rosters", () => {
  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, session: string | null, payload?: object) =>
    app.inject({ method, url, payload, cookies: session ? { wr_session: session } : {} });
  type Pending = { entryId: string; name: string; submittedBy: string | null };

  it("lets signed-in users propose characters that stay pending until the owner accepts them", async () => {
    const owner = await login(1001);
    const roster = (await send("POST", "/api/rosters", owner, { name: "Abierto", gameVersion: "retail", region: "eu", public: false })).json().guild;
    const stranger = await login(3003);

    // Private and unpublished: invisible to outsiders, and they cannot propose anything.
    expect((await send("GET", `/api/guilds/${roster.id}/roster`, stranger)).statusCode).toBe(404);
    // Only the owner publishes.
    const invite = (await send("POST", `/api/guilds/${roster.id}/invites`, owner, { role: "OFFICER" })).json();
    const officer = await login(2002);
    await send("POST", `/api/invites/${invite.token}/accept`, officer);
    expect((await send("PATCH", `/api/guilds/${roster.id}`, officer, { published: true })).statusCode).toBe(403);
    expect((await send("PATCH", `/api/guilds/${roster.id}`, owner, { published: true })).json().guild.published).toBe(true);

    // Listed for signed-in users only.
    expect((await send("GET", "/api/rosters/published", null)).statusCode).toBe(401);
    const listed = (await send("GET", "/api/rosters/published?gameVersion=retail", stranger)).json().rosters;
    expect(listed).toEqual([expect.objectContaining({ id: roster.id, name: "Abierto", owner: "Player", entries: 0 })]);
    expect((await send("GET", "/api/rosters/published?gameVersion=classic-era", stranger)).json().rosters).toEqual([]);

    // A stranger proposes: pending, not in the roster, and cannot edit it.
    const proposal = await send("POST", `/api/guilds/${roster.id}/roster/planned`, stranger, { classId: 2, specKey: "holy", status: "raider" });
    expect(proposal.statusCode).toBe(201);
    expect(proposal.json().entry).toMatchObject({ pending: true, status: null });
    const strangerView = (await send("GET", `/api/guilds/${roster.id}/roster`, stranger)).json();
    expect(strangerView.players).toEqual([]);
    expect(strangerView.pending.map((p: Pending) => p.submittedBy)).toEqual(["Player#3003"]);
    const entryId = strangerView.pending[0].entryId as string;
    expect((await send("PATCH", `/api/guilds/${roster.id}/roster/${entryId}`, stranger, { note: "hola" })).statusCode).toBe(403);

    // Others only see their own proposals; the owner sees all of them.
    const other = await login(4004);
    expect((await send("GET", `/api/guilds/${roster.id}/roster`, other)).json().pending).toEqual([]);
    expect((await send("GET", `/api/guilds/${roster.id}/roster`, owner)).json().pending).toHaveLength(1);
    // Officers cannot accept nor reject; strangers cannot touch others' proposals.
    expect((await send("POST", `/api/guilds/${roster.id}/roster/${entryId}/approve`, officer)).statusCode).toBe(403);
    expect((await send("DELETE", `/api/guilds/${roster.id}/roster/${entryId}`, officer)).statusCode).toBe(403);
    expect((await send("DELETE", `/api/guilds/${roster.id}/roster/${entryId}`, other)).statusCode).toBe(403);

    // Accepting adds it to the roster and makes the author a member.
    expect((await send("POST", `/api/guilds/${roster.id}/roster/${entryId}/approve`, owner)).statusCode).toBe(200);
    const after = (await send("GET", `/api/guilds/${roster.id}/roster`, owner)).json();
    expect(after.pending).toEqual([]);
    expect(after.players[0].main).toMatchObject({ classId: 2, specKey: "holy", planned: true });
    const members = (await send("GET", `/api/guilds/${roster.id}/members`, owner)).json().members;
    expect(members.find((m: { battletag: string }) => m.battletag === "Player#3003")?.role).toBe("MEMBER");
    // As a member now, the next entries go straight in.
    expect((await send("POST", `/api/guilds/${roster.id}/roster/planned`, stranger, { classId: 8 })).json().entry.pending).toBe(false);
  });

  it("lets the owner reject and the author withdraw, and caps pending proposals", async () => {
    const owner = await login(1001);
    const roster = (await send("POST", "/api/rosters", owner, { name: "Cola", gameVersion: "retail", region: "eu" })).json().guild;
    await send("PATCH", `/api/guilds/${roster.id}`, owner, { published: true });
    const stranger = await login(3003);

    for (let i = 0; i < 10; i++) {
      expect((await send("POST", `/api/guilds/${roster.id}/roster/planned`, stranger, { classId: 1 })).statusCode).toBe(201);
    }
    const capped = await send("POST", `/api/guilds/${roster.id}/roster/planned`, stranger, { classId: 1 });
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error).toBe("too_many_pending");

    const pending = (await send("GET", `/api/guilds/${roster.id}/roster`, owner)).json().pending as Pending[];
    expect((await send("DELETE", `/api/guilds/${roster.id}/roster/${pending[0]!.entryId}`, owner)).statusCode).toBe(200);
    expect((await send("DELETE", `/api/guilds/${roster.id}/roster/${pending[1]!.entryId}`, stranger)).statusCode).toBe(200);
    expect((await send("GET", `/api/guilds/${roster.id}/roster`, owner)).json().pending).toHaveLength(8);
    // The author never became a member.
    expect((await send("GET", `/api/guilds/${roster.id}/members`, owner)).json().members).toHaveLength(1);
  });
});

describe("meta and session", () => {
  it("answers the health check", async () => {
    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ ok: true });
  });

  it("reports unhealthy when the database is unreachable, so the container gets restarted", async () => {
    const deadPrisma = createPrismaClient("postgresql://wow:wow@127.0.0.1:1/nothing");
    const broken = await buildApp({
      env: { DATABASE_URL: "unused", REDIS_URL: "redis://unused", BLIZZARD_CLIENT_ID: "id", BLIZZARD_CLIENT_SECRET: "secret", BLIZZARD_REGION: "eu", PUBLIC_URL: "http://localhost:3000", API_PORT: 0 },
      prisma: deadPrisma,
      versions,
      core: { ...core, prisma: deadPrisma },
      queue,
      oauth: { authorizeUrl: () => "https://oauth.example", login: async () => ({ user: { id: 1, battletag: "x" }, accessToken: "t" }) },
    });
    try {
      const response = await broken.inject({ method: "GET", url: "/api/health" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ ok: false, error: "database_unavailable" });
    } finally {
      await broken.close();
      await deadPrisma.$disconnect();
    }
  });

  it("starts the Battle.net login with a state cookie and only same-site redirects", async () => {
    const start = await app.inject({ method: "GET", url: "/api/auth/login?region=us&redirect=/en/guild/1" });
    expect(start.statusCode).toBe(302);
    const cookie = start.cookies.find((c) => c.name === "wr_oauth_state")!;
    const stored = JSON.parse(cookie.value);
    expect(stored).toMatchObject({ region: "us", redirect: "/en/guild/1" });
    expect(start.headers.location).toBe(`https://oauth.example/authorize?state=${stored.state}`);
    expect(cookie).toMatchObject({ httpOnly: true, path: "/api/auth" });

    for (const redirect of ["//evil.example", "https://evil.example"]) {
      const response = await app.inject({ method: "GET", url: `/api/auth/login?redirect=${encodeURIComponent(redirect)}` });
      expect(JSON.parse(response.cookies.find((c) => c.name === "wr_oauth_state")!.value).redirect).toBe("/");
    }
    expect((await app.inject({ method: "GET", url: "/api/auth/login?region=xx" })).statusCode).toBe(400);
  });

  it("rejects a callback without the state cookie", async () => {
    expect((await app.inject({ method: "GET", url: "/api/auth/callback?code=1&state=abc" })).statusCode).toBe(400);
  });

  it("still logs in when the account characters cannot be loaded", async () => {
    failingRoutes.set("/profile/user/wow", 500);
    const session = await login(5005);
    const me = (await app.inject({ method: "GET", url: "/api/me", cookies: { wr_session: session } })).json();
    expect(me.user.battletag).toBe("Player#5005");
    expect(me.characters).toEqual([]);
  });

  it("logs out by deleting the session", async () => {
    const session = await login();
    const logout = await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { wr_session: session } });
    expect(logout.json()).toEqual({ ok: true });
    expect(logout.cookies.find((c) => c.name === "wr_session")?.value).toBe("");
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: { wr_session: session } })).json()).toEqual({ user: null });
    expect(await prisma.session.count()).toBe(0);
  });

  it("ignores expired sessions", async () => {
    const session = await login();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await app.inject({ method: "GET", url: "/api/me", cookies: { wr_session: session } })).json()).toEqual({ user: null });
  });
});

describe("me", () => {
  const send = (method: "GET" | "PATCH" | "POST", url: string, session: string | null, payload?: object) =>
    app.inject({ method, url, payload, cookies: session ? { wr_session: session } : {} });

  it("changes the UI locale of the signed-in user only", async () => {
    const session = await login();
    expect((await send("PATCH", "/api/me", session, { locale: "en" })).json().user.locale).toBe("en");
    expect((await send("GET", "/api/me", session)).json().user.locale).toBe("en");
    expect((await send("PATCH", "/api/me", session, { locale: "fr" })).statusCode).toBe(400);
    expect((await send("PATCH", "/api/me", null, { locale: "en" })).statusCode).toBe(401);
  });

  it("marks one main per game version and only among the user's own characters", async () => {
    const session = await login();
    const user = await prisma.user.findFirstOrThrow({ where: { bnetId: 1001 } });
    const make = (name: string, gameVersion = "retail") =>
      prisma.character.create({ data: { gameVersion, region: "eu", realm: "los-errantes", name, nameKey: name.toLowerCase(), ownerId: user.id } });
    const [alt, era] = [await make("Altdethrall"), await make("Thrall", "classic-era")];
    const thrall = await prisma.character.findFirstOrThrow({ where: { gameVersion: "retail", nameKey: "thrall" } });

    expect((await send("POST", `/api/me/characters/${thrall.id}/main`, session)).json()).toEqual({ ok: true });
    await send("POST", `/api/me/characters/${era.id}/main`, session);
    await send("POST", `/api/me/characters/${alt.id}/main`, session);
    const mains = await prisma.character.findMany({ where: { isMain: true }, orderBy: { name: "asc" } });
    expect(mains.map((c) => `${c.gameVersion}:${c.name}`)).toEqual(["retail:Altdethrall", "classic-era:Thrall"]);

    const other = await login(2002);
    expect((await send("POST", `/api/me/characters/${thrall.id}/main`, other)).statusCode).toBe(404);
    expect((await send("POST", `/api/me/characters/${thrall.id}/main`, null)).statusCode).toBe(401);
  });
});

describe("character lookups and refreshes", () => {
  it("looks up unknown characters in the game for signed-in users and forgets ones that do not exist", async () => {
    const session = await login();
    const missing = await app.inject({ method: "GET", url: "/api/characters/retail/eu/los-errantes/Nobody", cookies: { wr_session: session } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe("character_not_found_in_game");
    expect(await prisma.character.count({ where: { nameKey: "nobody" } })).toBe(0);
    expect((await app.inject({ method: "GET", url: "/api/characters/wotlk/eu/los-errantes/Garrosh" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/characters/retail/xx/los-errantes/Garrosh" })).statusCode).toBe(400);
  });

  it("refreshes a character on demand with a cooldown", async () => {
    const session = await login();
    const { character } = (await app.inject({ method: "GET", url: "/api/characters/retail/eu/los-errantes/Garrosh", cookies: { wr_session: session } })).json();
    const url = `/api/characters/${character.id}/sync`;

    expect((await app.inject({ method: "POST", url })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/characters/nope/sync", cookies: { wr_session: session } })).statusCode).toBe(404);
    const tooSoon = await app.inject({ method: "POST", url, cookies: { wr_session: session } });
    expect(tooSoon.statusCode).toBe(429);
    expect(tooSoon.json().error).toBe("refresh_cooldown");

    await prisma.character.update({ where: { id: character.id }, data: { lastSyncedAt: new Date(Date.now() - 3 * 60_000) } });
    const refreshed = await app.inject({ method: "POST", url, cookies: { wr_session: session } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json()).toMatchObject({ result: "updated", character: { name: "Garrosh", equippedItemLevel: 700 } });
  });
});

describe("talent trees", () => {
  const tree = (session?: string) =>
    app.inject({ method: "GET", url: "/api/talent-trees/retail/eu/790/71", cookies: session ? { wr_session: session } : {} });
  const cached = () => prisma.staticCache.findUnique({ where: { key: "retail:eu:talent-tree:790:71" } });

  it("builds a missing tree for signed-in users and caches it for everyone", async () => {
    const session = await login();
    expect((await tree()).statusCode).toBe(404);
    const built = await tree(session);
    expect(built.statusCode).toBe(200);
    expect(built.headers["cache-control"]).toBe("public, max-age=86400");
    const { layout } = built.json();
    expect(layout).toMatchObject({ treeId: 790, specId: 71, specName: { en: "Arms" } });
    expect(layout.specNodes[0].options[0]).toMatchObject({ name: { en: "Overpower" }, icon: "https://render/icons/overpower.jpg" });
    expect((await tree()).statusCode).toBe(200);
  });

  it("still serves the tree when some icons fail, and fills them in on a later visit", async () => {
    const session = await login();
    failingRoutes.set("/data/wow/media/spell/7384", 500);
    const partial = await tree(session);
    expect(partial.statusCode).toBe(200);
    expect(partial.json().layout.specNodes[0].options[0].icon).toBeUndefined();
    expect(partial.json().layout.classNodes[0].options[0].icon).toBe("https://render/icons/taunt.jpg");
    // Not cached with the gap, and the failed icon was not remembered as missing.
    expect(await cached()).toBeNull();

    failingRoutes.clear();
    blizzardCalls.length = 0;
    expect((await tree(session)).json().layout.specNodes[0].options[0].icon).toBe("https://render/icons/overpower.jpg");
    // The icon that worked before came from the cache.
    expect(blizzardCalls.filter((p) => p.startsWith("/data/wow/media/"))).toEqual(["/data/wow/media/spell/7384"]);
    expect(await cached()).not.toBeNull();
  });

  it("falls back to an expired copy while the API is down, and errors without one", async () => {
    const session = await login();
    failingRoutes.set("/data/wow/talent-tree/790/playable-specialization/71", 503);
    expect((await tree(session)).statusCode).toBe(500);

    failingRoutes.clear();
    await tree(session);
    await prisma.staticCache.update({ where: { key: "retail:eu:talent-tree:790:71" }, data: { fetchedAt: new Date(0) } });
    failingRoutes.set("/data/wow/talent-tree/790/playable-specialization/71", 503);
    const stale = await tree(session);
    expect(stale.statusCode).toBe(200);
    expect(stale.json().layout.specId).toBe(71);
  });

  it("validates the tree parameters", async () => {
    expect((await app.inject({ method: "GET", url: "/api/talent-trees/retail/eu/abc/71" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/talent-trees/wotlk/eu/790/71" })).statusCode).toBe(400);
  });
});

describe("guild management", () => {
  const send = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, session: string | null, payload?: unknown) =>
    app.inject({ method, url, payload: payload as object, cookies: session ? { wr_session: session } : {} });
  const register = (session: string, name = "Horda Eterna") =>
    send("POST", "/api/guilds", session, { gameVersion: "retail", region: "eu", realm: "Los Errantes", name });

  it("refuses guilds that do not exist in the game and guilds of versions without an API", async () => {
    const session = await login();
    const missing = await register(session, "Nadie");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe("guild_not_found_in_game");
    const forever = await send("POST", "/api/guilds", session, { gameVersion: "forever", region: "eu", realm: "normal", name: "X" });
    expect(forever.statusCode).toBe(409);
    expect((await send("POST", "/api/guilds", null, { gameVersion: "retail", region: "eu", realm: "a", name: "b" })).statusCode).toBe(401);
  });

  it("edits rank statuses, queues syncs and hides synced entries instead of deleting them", async () => {
    const owner = await login();
    const { guild } = (await register(owner)).json();
    await syncGuild(core, guild.id);

    const ranks = await send("PUT", `/api/guilds/${guild.id}/ranks`, owner, [{ rank: 6, label: "Social", status: "trial" }]);
    expect(ranks.statusCode).toBe(200);
    expect(ranks.json().ranks.find((r: { rank: number }) => r.rank === 6)).toMatchObject({ label: "Social", status: "trial" });
    expect((await send("PUT", `/api/guilds/${guild.id}/ranks`, owner, [{ rank: 6, status: "nope" }])).statusCode).toBe(400);
    expect((await send("PATCH", `/api/guilds/${guild.id}`, owner, { name: "Otro" })).statusCode).toBe(400);
    expect((await send("PATCH", `/api/guilds/${guild.id}`, owner, { gameVersion: "classic-era" })).statusCode).toBe(400);

    calls.length = 0;
    expect((await send("POST", `/api/guilds/${guild.id}/sync`, owner)).json()).toEqual({ queued: true });
    expect(calls).toEqual([`guild:${guild.id}`]);
    const outsider = await login(2002);
    expect((await send("POST", `/api/guilds/${guild.id}/sync`, outsider)).statusCode).toBe(403);
    expect((await send("PUT", `/api/guilds/${guild.id}/ranks`, outsider, [])).statusCode).toBe(403);

    expect((await send("PATCH", `/api/guilds/${guild.id}`, owner, { syncIntervalMinutes: 120 })).statusCode).toBe(200);
    expect(calls).toContain(`schedule:${guild.id}:120`);

    const roster = (await send("GET", `/api/guilds/${guild.id}/roster`, owner)).json();
    const rexxar = roster.players.find((p: { main: { name: string } }) => p.main.name === "Rexxar").main;
    const removed = await send("DELETE", `/api/guilds/${guild.id}/roster/${rexxar.entryId}`, owner);
    expect(removed.json()).toEqual({ removed: false, status: "ignored" });
    expect(await prisma.rosterEntry.count({ where: { id: rexxar.entryId } })).toBe(1);
  });

  it("links alts to mains one level deep", async () => {
    const owner = await login();
    const { guild } = (await send("POST", "/api/rosters", owner, { name: "Alts", gameVersion: "retail", region: "eu" })).json();
    const add = async (classId: number) => (await send("POST", `/api/guilds/${guild.id}/roster/planned`, owner, { classId })).json().entry.id as string;
    const [main, alt, third] = [await add(1), await add(2), await add(3)];
    const patch = (id: string, payload: object) => send("PATCH", `/api/guilds/${guild.id}/roster/${id}`, owner, payload);

    expect((await patch(alt, { mainEntryId: main })).statusCode).toBe(200);
    expect((await patch(third, { mainEntryId: alt })).json().error).toBe("main_is_alt");
    expect((await patch(main, { mainEntryId: main })).json().error).toBe("invalid_main");
    expect((await patch(main, { mainEntryId: "nope" })).json().error).toBe("invalid_main");
    // Making the main an alt of another entry moves its own alts along.
    expect((await patch(main, { mainEntryId: third })).statusCode).toBe(200);
    expect((await prisma.rosterEntry.findUniqueOrThrow({ where: { id: alt } })).mainEntryId).toBe(third);

    const players = (await send("GET", `/api/guilds/${guild.id}/roster`, owner)).json().players;
    expect(players).toHaveLength(1);
    expect(players[0].alts).toHaveLength(2);

    // Changing the planned class clears a spec of the old class; unknown roles and statuses are refused.
    await patch(third, { plannedSpec: "fury" });
    expect((await patch(third, { plannedClassId: 2 })).json().entry).toMatchObject({ plannedClassId: 2, plannedSpec: null });
    expect((await patch(third, { role: "dancer" })).json().error).toBe("unknown_role");
    expect((await patch(third, { status: "maybe" })).json().error).toBe("unknown_status");
    expect((await patch("nope", { note: "x" })).statusCode).toBe(404);
  });

  it("lets members add their own Battle.net characters and outsiders propose them to published rosters", async () => {
    const owner = await login();
    const { guild } = (await send("POST", "/api/rosters", owner, { name: "Mios", gameVersion: "retail", region: "eu" })).json();
    const thrall = await prisma.character.findFirstOrThrow({ where: { nameKey: "thrall" } });

    const added = await send("POST", `/api/guilds/${guild.id}/roster/mine`, owner, { characterIds: [thrall.id] });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toEqual({ added: 1, pending: false });
    expect(calls).toContain("characters:1");
    // Adding it again is harmless.
    expect((await send("POST", `/api/guilds/${guild.id}/roster/mine`, owner, { characterIds: [thrall.id] })).statusCode).toBe(201);
    expect(await prisma.rosterEntry.count({ where: { guildId: guild.id } })).toBe(1);

    const stranger = await login(2002);
    const strangerUser = await prisma.user.findFirstOrThrow({ where: { bnetId: 2002 } });
    const strangerChar = await prisma.character.create({
      data: { gameVersion: "retail", region: "eu", realm: "los-errantes", name: "Jaina", nameKey: "jaina", ownerId: strangerUser.id },
    });
    expect((await send("POST", `/api/guilds/${guild.id}/roster/mine`, stranger, { characterIds: [strangerChar.id] })).statusCode).toBe(403);
    await send("PATCH", `/api/guilds/${guild.id}`, owner, { published: true });
    expect((await send("POST", `/api/guilds/${guild.id}/roster/mine`, stranger, { characterIds: [thrall.id] })).json().error).toBe("not_your_characters");
    const proposed = await send("POST", `/api/guilds/${guild.id}/roster/mine`, stranger, { characterIds: [strangerChar.id] });
    expect(proposed.json()).toEqual({ added: 1, pending: true });
    expect((await send("GET", `/api/guilds/${guild.id}/roster`, owner)).json().pending).toHaveLength(1);
    expect((await send("POST", `/api/guilds/${guild.id}/roster/mine`, null, { characterIds: [thrall.id] })).statusCode).toBe(401);
  });

  it("refuses to edit or link pending proposals and to link entries twice", async () => {
    const owner = await login();
    const { guild } = (await send("POST", "/api/rosters", owner, { name: "Links", gameVersion: "retail", region: "eu" })).json();
    await send("PATCH", `/api/guilds/${guild.id}`, owner, { published: true });
    const stranger = await login(2002);
    const pending = (await send("POST", `/api/guilds/${guild.id}/roster/planned`, stranger, { classId: 1 })).json().entry.id;
    expect((await send("PATCH", `/api/guilds/${guild.id}/roster/${pending}`, owner, { note: "x" })).json().error).toBe("entry_pending");
    expect((await send("POST", `/api/guilds/${guild.id}/roster/${pending}/link`, owner, { realm: "Los Errantes", name: "Garrosh" })).json().error).toBe("entry_pending");

    const planned = (await send("POST", `/api/guilds/${guild.id}/roster/planned`, owner, { classId: 1 })).json().entry.id;
    const other = (await send("POST", `/api/guilds/${guild.id}/roster/planned`, owner, { classId: 1 })).json().entry.id;
    expect((await send("POST", `/api/guilds/${guild.id}/roster/${planned}/link`, owner, { realm: "Los Errantes", name: "Garrosh" })).statusCode).toBe(200);
    expect((await send("POST", `/api/guilds/${guild.id}/roster/${planned}/link`, owner, { realm: "Los Errantes", name: "Garrosh" })).json().error).toBe("entry_already_linked");
    expect((await send("POST", `/api/guilds/${guild.id}/roster/${other}/link`, owner, { realm: "Los Errantes", name: "Garrosh" })).json().error).toBe("character_already_in_roster");
    expect((await send("POST", `/api/guilds/${guild.id}/roster/${other}/link`, owner, { realm: "Los Errantes", name: "Nobody" })).statusCode).toBe(404);
    expect((await send("POST", `/api/guilds/${guild.id}/roster/approve-nothing/approve`, owner)).statusCode).toBe(404);
  });

  it("validates the published roster filter", async () => {
    const session = await login();
    expect((await send("GET", "/api/rosters/published?gameVersion=wotlk", session)).statusCode).toBe(400);
    expect((await send("GET", "/api/guilds/nope", session)).statusCode).toBe(404);
  });
});

describe("members and invites", () => {
  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, session: string | null, payload?: object) =>
    app.inject({ method, url, payload, cookies: session ? { wr_session: session } : {} });

  async function setup() {
    const owner = await login(1001);
    const { guild } = (await send("POST", "/api/rosters", owner, { name: "Equipo", gameVersion: "retail", region: "eu", public: false })).json();
    const join = async (bnetId: number, role: "OFFICER" | "MEMBER") => {
      const { token } = (await send("POST", `/api/guilds/${guild.id}/invites`, owner, { role })).json();
      const session = await login(bnetId);
      await send("POST", `/api/invites/${token}/accept`, session);
      const user = await prisma.user.findFirstOrThrow({ where: { bnetId } });
      return { session, userId: user.id };
    };
    const ownerId = (await prisma.user.findFirstOrThrow({ where: { bnetId: 1001 } })).id;
    return { owner, ownerId, guild, officer: await join(2002, "OFFICER"), member: await join(3003, "MEMBER"), join };
  }

  it("lets only the owner change roles, never their own", async () => {
    const { owner, ownerId, guild, officer, member } = await setup();
    const role = (session: string, userId: string, value: string) => send("PATCH", `/api/guilds/${guild.id}/members/${userId}`, session, { role: value });

    expect((await role(officer.session, member.userId, "OFFICER")).statusCode).toBe(403);
    expect((await send("GET", `/api/guilds/${guild.id}/members`, member.session)).statusCode).toBe(403);
    expect((await role(owner, member.userId, "OFFICER")).json()).toEqual({ ok: true });
    expect((await role(owner, ownerId, "MEMBER")).json().error).toBe("cannot_change_owner");
    expect((await role(owner, "nobody", "MEMBER")).statusCode).toBe(404);
    expect((await role(owner, member.userId, "OWNER")).statusCode).toBe(400);

    const members = (await send("GET", `/api/guilds/${guild.id}/members`, officer.session)).json().members;
    expect(members.map((m: { role: string }) => m.role)).toEqual(["OWNER", "OFFICER", "OFFICER"]);
  });

  it("lets anyone leave, officers remove members and nobody remove the owner", async () => {
    const { owner, ownerId, guild, officer, member, join } = await setup();
    const remove = (session: string, userId: string) => send("DELETE", `/api/guilds/${guild.id}/members/${userId}`, session);

    expect((await remove(member.session, officer.userId)).statusCode).toBe(403);
    expect((await remove(officer.session, ownerId)).json().error).toBe("cannot_remove_owner");
    expect((await remove(officer.session, member.userId)).json()).toEqual({ ok: true });
    // Once out of a private roster, it is hidden again.
    expect((await send("GET", `/api/guilds/${guild.id}`, member.session)).statusCode).toBe(404);

    const second = await join(4004, "OFFICER");
    expect((await remove(officer.session, second.userId)).statusCode).toBe(403);
    expect((await remove(second.session, second.userId)).json()).toEqual({ ok: true });
    expect((await remove(owner, officer.userId)).json()).toEqual({ ok: true });
    expect((await remove(owner, officer.userId)).statusCode).toBe(404);
    expect((await send("DELETE", `/api/guilds/${guild.id}/members/${ownerId}`, null)).statusCode).toBe(401);
  });

  it("lists and revokes invites, and only owners invite officers", async () => {
    const { owner, guild, officer, member } = await setup();
    const created = (await send("POST", `/api/guilds/${guild.id}/invites`, officer.session, { role: "MEMBER", expiresInDays: 2, maxUses: 3 })).json();
    expect(created.invite).toMatchObject({ role: "MEMBER", maxUses: 3, uses: 0 });
    expect((await send("POST", `/api/guilds/${guild.id}/invites`, officer.session, { role: "OFFICER" })).statusCode).toBe(403);
    expect((await send("POST", `/api/guilds/${guild.id}/invites`, owner, { role: "MEMBER", expiresInDays: 90 })).statusCode).toBe(400);

    const listed = (await send("GET", `/api/guilds/${guild.id}/invites`, owner)).json().invites as { id: string }[];
    // The two invites used during setup plus the new one; the raw token is never listed.
    expect(listed).toHaveLength(3);
    expect(listed.every((i) => i.id.length === 12)).toBe(true);
    expect((await send("GET", `/api/guilds/${guild.id}/invites`, member.session)).statusCode).toBe(403);

    expect((await send("DELETE", `/api/guilds/${guild.id}/invites/${created.invite.id}`, owner)).json()).toEqual({ ok: true });
    expect((await send("DELETE", `/api/guilds/${guild.id}/invites/${created.invite.id}`, owner)).statusCode).toBe(404);
    expect((await send("GET", `/api/invites/${created.token}`, null)).statusCode).toBe(404);
  });

  it("previews invites publicly and never downgrades on accept", async () => {
    const { owner, guild, officer } = await setup();
    const { token } = (await send("POST", `/api/guilds/${guild.id}/invites`, owner, { role: "MEMBER" })).json();
    expect((await send("GET", `/api/invites/${token}`, null)).json()).toMatchObject({
      roster: { id: guild.id, name: "Equipo", kind: "custom", gameVersion: "retail" },
      role: "MEMBER",
      usable: true,
      currentRole: null,
    });
    expect((await send("GET", `/api/invites/${token}`, officer.session)).json().currentRole).toBe("OFFICER");
    expect((await send("POST", `/api/invites/${token}/accept`, officer.session)).json()).toEqual({ guildId: guild.id, role: "OFFICER" });
    expect((await send("POST", `/api/invites/${token}/accept`, null)).statusCode).toBe(401);

    await prisma.rosterInvite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await send("GET", `/api/invites/${token}`, null)).json().usable).toBe(false);
    expect((await send("POST", `/api/invites/${token}/accept`, await login(5005))).json().error).toBe("invite_expired");
  });
});

describe("professions", () => {
  it("exposes each version's own profession catalog", async () => {
    type Version = { id: string; apiProfessions: boolean; professions: { key: string; maxSkill?: number }[] };
    const body = (await app.inject({ method: "GET", url: "/api/config" })).json();
    const byId = Object.fromEntries((body.versions as Version[]).map((v) => [v.id, v]));
    expect(byId.retail!.apiProfessions).toBe(true);
    expect(byId["classic-era"]!.apiProfessions).toBe(false);
    expect(byId["classic-era"]!.professions.map((p) => p.key)).not.toContain("jewelcrafting");
    expect(byId.anniversary!.professions.find((p) => p.key === "jewelcrafting")?.maxSkill).toBe(375);
  });

  it("lets owners of Classic characters record their professions within the version's rules", async () => {
    const session = await login();
    const user = await prisma.user.findFirstOrThrow({ where: { bnetId: 1001 } });
    const character = await prisma.character.create({
      data: { gameVersion: "classic-era", region: "eu", realm: "mirage-raceway", name: "Dracatxi", nameKey: "dracatxi", ownerId: user.id },
    });
    const put = (professions: object[], who = session) =>
      app.inject({ method: "PUT", url: `/api/characters/${character.id}/professions`, cookies: { wr_session: who }, payload: { professions } });

    const saved = await put([{ id: 186, skill: 300 }, { id: 164, skill: 275 }, { id: 185 }]);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().character.manualProfessions).toEqual([
      { id: 186, skill: 300 },
      { id: 164, skill: 275 },
      { id: 185, skill: null },
    ]);
    // Jewelcrafting arrived with TBC; Classic Era caps at 300 and two primaries.
    expect((await put([{ id: 755, skill: 10 }])).json().error).toBe("unknown_profession");
    expect((await put([{ id: 186, skill: 301 }])).json().error).toBe("invalid_profession_skill");
    expect((await put([{ id: 186 }, { id: 186 }])).json().error).toBe("unknown_profession");
    expect((await put([{ id: 186 }, { id: 164 }, { id: 171 }])).json().error).toBe("too_many_primary_professions");
    expect((await put([{ id: 186 }], await login(2002))).statusCode).toBe(403);

    // Clearing them stores nothing.
    expect((await put([])).json().character.manualProfessions).toBeNull();
  });

  it("keeps API-provided professions read-only", async () => {
    const session = await login();
    const thrall = await prisma.character.findFirstOrThrow({ where: { gameVersion: "retail", nameKey: "thrall" } });
    const response = await app.inject({
      method: "PUT",
      url: `/api/characters/${thrall.id}/professions`,
      cookies: { wr_session: session },
      payload: { professions: [{ id: 755, skill: 100 }] },
    });
    expect(response.json().error).toBe("professions_from_api");
    expect((await app.inject({ method: "PUT", url: `/api/characters/${thrall.id}/professions`, payload: { professions: [] } })).statusCode).toBe(401);
  });
});
