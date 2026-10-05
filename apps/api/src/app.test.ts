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
  "/data/wow/media/item/500": { assets: [{ key: "icon", value: "https://render/icons/helm.jpg" }] },
  "/data/wow/media/spell/355": { assets: [{ key: "icon", value: "https://render/icons/taunt.jpg" }] },
};

/** The fake game data lives in retail; every other game version's namespace answers 404. */
const RETAIL_NAMESPACES = new Set(["profile-eu", "static-eu", "dynamic-eu"]);

const fakeFetch = (async (input: string | URL) => {
  const url = new URL(input.toString());
  if (url.pathname === "/token") return Response.json({ access_token: "app", expires_in: 3600 });
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
    return new BlizzardClient({ clientId: "id", clientSecret: "secret", region, api, fetch: fakeFetch });
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
      login: async (code) => ({ user: { id: Number(code), battletag: `Player#${code}` }, accessToken: "user-token" }),
    },
  });
});

beforeEach(async () => {
  calls.length = 0;
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
