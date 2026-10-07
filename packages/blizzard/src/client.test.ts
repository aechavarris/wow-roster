import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import { BlizzardApiError, BlizzardClient } from "./client";
import { authorizeUrl, exchangeCode, getUserInfo } from "./oauth";

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | ((url: URL) => Response | Promise<Response>);

interface Call {
  path: string;
  query: URLSearchParams;
  auth: string | null;
  method: string;
  body?: string;
}

/**
 * Fake Blizzard: answers by pathname, records every call (path, query, Authorization header).
 * A route given as an array replies with its items in turn, so retries can be scripted.
 */
function fakeFetch(routes: Record<string, Reply | Reply[]>, token = { status: 200, expiresIn: 3600 }) {
  const calls: Call[] = [];
  const served = new Map<string, number>();
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    const headers = new Headers(init?.headers);
    calls.push({
      path: url.pathname,
      query: url.searchParams,
      auth: headers.get("authorization"),
      method: init?.method ?? "GET",
      body: init?.body?.toString(),
    });
    if (url.pathname === "/token" && !routes["/token"]) {
      if (token.status !== 200) return new Response(null, { status: token.status });
      return Response.json({ access_token: `app-${calls.length}`, expires_in: token.expiresIn });
    }
    const route = routes[url.pathname];
    if (!route) return new Response(null, { status: 404 });
    let reply: Reply;
    if (Array.isArray(route)) {
      const index = served.get(url.pathname) ?? 0;
      served.set(url.pathname, index + 1);
      reply = route[Math.min(index, route.length - 1)]!;
    } else reply = route;
    if (typeof reply === "function") return reply(url);
    return Response.json(reply.body ?? {}, { status: reply.status ?? 200, headers: reply.headers });
  }) as typeof fetch;
  const apiCalls = () => calls.filter((c) => c.path !== "/token");
  return { impl, calls, apiCalls };
}

const retail = resolveProfile("retail");
const clientFor = (impl: typeof fetch, api = retail.api, region = "eu") =>
  new BlizzardClient({ clientId: "id", clientSecret: "secret", region, api, fetch: impl, retryDelayMs: 0 });

describe("BlizzardClient requests", () => {
  it("uses each game version's namespaces and the client region", async () => {
    const routes = { "/data/wow/guild/los-errantes/horda/roster": { body: { members: [] } } };
    const cases: [string, string, string][] = [
      ["retail", "eu", "profile-eu"],
      ["classic-era", "eu", "profile-classic1x-eu"],
      ["anniversary", "us", "profile-classicann-us"],
      ["progression", "eu", "profile-classic-eu"],
    ];
    for (const [version, region, namespace] of cases) {
      const { impl, apiCalls } = fakeFetch(routes);
      await clientFor(impl, resolveProfile(version).api, region).getGuildRoster("los-errantes", "horda");
      expect(apiCalls()[0]!.query.get("namespace")).toBe(namespace);
    }
  });

  it("gets an app token with the client credentials once and reuses it", async () => {
    const { impl, calls } = fakeFetch({ "/profile/wow/character/realm/thrall": { body: { id: 1, name: "Thrall" } } });
    const client = clientFor(impl);
    await client.getCharacterSummary({ realm: "realm", name: "Thrall" });
    await client.getCharacterSummary({ realm: "realm", name: "Thrall" });
    const tokenCalls = calls.filter((c) => c.path === "/token");
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]).toMatchObject({ method: "POST", body: "grant_type=client_credentials" });
    expect(tokenCalls[0]!.auth).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    expect(calls.filter((c) => c.path !== "/token").every((c) => c.auth === "Bearer app-1")).toBe(true);
  });

  it("renews the app token when it is about to expire", async () => {
    const { impl, calls } = fakeFetch({ "/profile/wow/character/realm/thrall": { body: { id: 1 } } }, { status: 200, expiresIn: 30 });
    const client = clientFor(impl);
    await client.getCharacterSummary({ realm: "realm", name: "Thrall" });
    await client.getCharacterSummary({ realm: "realm", name: "Thrall" });
    expect(calls.filter((c) => c.path === "/token")).toHaveLength(2);
  });

  it("fails clearly when Blizzard refuses the client credentials", async () => {
    const { impl } = fakeFetch({}, { status: 401, expiresIn: 0 });
    await expect(clientFor(impl).getCharacterSummary({ realm: "r", name: "x" })).rejects.toMatchObject({ status: 401, path: "/token" });
  });

  it("refreshes a rejected app token once", async () => {
    const { impl, calls } = fakeFetch({
      "/profile/wow/character/realm/thrall": [{ status: 401 }, { body: { id: 1, name: "Thrall" } }],
    });
    const summary = await clientFor(impl).getCharacterSummary({ realm: "realm", name: "Thrall" });
    expect(summary.name).toBe("Thrall");
    expect(calls.filter((c) => c.path === "/token")).toHaveLength(2);
  });

  it("retries throttled requests, honouring Retry-After", async () => {
    const { impl, apiCalls } = fakeFetch({
      "/profile/wow/character/realm/thrall": [{ status: 429, headers: { "retry-after": "0" } }, { status: 429 }, { body: { id: 1, name: "Thrall" } }],
    });
    expect((await clientFor(impl).getCharacterSummary({ realm: "realm", name: "Thrall" })).name).toBe("Thrall");
    expect(apiCalls()).toHaveLength(3);
  });

  it("retries transient server errors and dropped connections", async () => {
    const { impl, apiCalls } = fakeFetch({
      "/profile/wow/character/realm/thrall": [
        { status: 503 },
        () => Promise.reject(new TypeError("fetch failed")),
        { status: 504 },
        { body: { id: 1, name: "Thrall" } },
      ],
    });
    expect((await clientFor(impl).getCharacterSummary({ realm: "realm", name: "Thrall" })).name).toBe("Thrall");
    expect(apiCalls()).toHaveLength(4);
  });

  it("gives up after a few retries", async () => {
    const down = fakeFetch({ "/profile/wow/character/realm/thrall": { status: 500 } });
    await expect(clientFor(down.impl).getCharacterSummary({ realm: "realm", name: "Thrall" })).rejects.toMatchObject({ status: 500 });
    expect(down.apiCalls()).toHaveLength(4);

    const offline = fakeFetch({ "/profile/wow/character/realm/thrall": () => Promise.reject(new TypeError("fetch failed")) });
    const error = await clientFor(offline.impl).getCharacterSummary({ realm: "realm", name: "Thrall" }).catch((e) => e);
    expect(error).toBeInstanceOf(BlizzardApiError);
    expect(error.status).toBe(502);
  });

  it("does not retry client errors such as 404", async () => {
    const { impl, apiCalls } = fakeFetch({});
    const error = await clientFor(impl).getCharacterSummary({ realm: "realm", name: "Nobody" }).catch((e) => e);
    expect(error).toBeInstanceOf(BlizzardApiError);
    expect(error.notFound).toBe(true);
    expect(apiCalls()).toHaveLength(1);
  });
});

describe("BlizzardClient endpoints", () => {
  it("reads a guild and its roster", async () => {
    const { impl, apiCalls } = fakeFetch({
      "/data/wow/guild/los-errantes/horda-eterna": {
        body: { id: 9, name: "Horda Eterna", realm: { slug: "los-errantes" }, faction: { type: "HORDE" }, member_count: 2 },
      },
      "/data/wow/guild/los-errantes/horda-eterna/roster": {
        body: { members: [{ character: { id: 1, name: "Thrall", level: 80, realm: { slug: "los-errantes" }, playable_class: { id: 7 } }, rank: 0 }] },
      },
    });
    const client = clientFor(impl);
    expect(await client.getGuild("los-errantes", "horda-eterna")).toMatchObject({ blizzardId: 9, name: "Horda Eterna", faction: "HORDE", memberCount: 2 });
    expect(await client.getGuildRoster("los-errantes", "horda-eterna")).toEqual([
      expect.objectContaining({ blizzardId: 1, name: "Thrall", realmSlug: "los-errantes", level: 80, classId: 7, rank: 0 }),
    ]);
    expect(apiCalls().map((c) => c.query.get("locale"))).toEqual(["en_US", "en_US"]);
  });

  it("lists account characters with the user's token, not the app token", async () => {
    const { impl, calls } = fakeFetch({
      "/profile/user/wow": { body: { wow_accounts: [{ characters: [{ id: 1, name: "Thrall", level: 80, realm: { slug: "r" } }] }, { characters: [{ id: 2, name: "Jaina", level: 70, realm: { slug: "r" } }] }] } },
    });
    const characters = await clientFor(impl).getAccountCharacters("user-token");
    expect(characters.map((c) => c.name)).toEqual(["Thrall", "Jaina"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.auth).toBe("Bearer user-token");
  });

  it("does not retry a rejected user token with the app token", async () => {
    const { impl, calls } = fakeFetch({ "/profile/user/wow": { status: 401 } });
    await expect(clientFor(impl).getAccountCharacters("expired")).rejects.toMatchObject({ status: 401 });
    expect(calls.filter((c) => c.path === "/token")).toHaveLength(0);
  });

  it("lower-cases and encodes character names", async () => {
    const { impl, apiCalls } = fakeFetch({ "/profile/wow/character/los-errantes/%C3%A1rthas": { body: { id: 3, name: "Árthas", level: 80 } } });
    const summary = await clientFor(impl).getCharacterSummary({ realm: "los-errantes", name: " Árthas " });
    expect(summary).toMatchObject({ blizzardId: 3, name: "Árthas", level: 80 });
    expect(apiCalls()[0]!.path).toBe("/profile/wow/character/los-errantes/%C3%A1rthas");
  });

  it("fetches every declared detail endpoint, multi-locale where tooltips need it", async () => {
    const base = "/profile/wow/character/realm/thrall";
    const { impl, apiCalls } = fakeFetch({
      [base]: { body: { id: 1, name: "Thrall", level: 80 } },
      [`${base}/equipment`]: { body: { equipped_items: [] } },
      [`${base}/specializations`]: { body: { specializations: [] } },
      [`${base}/character-media`]: { body: { assets: [{ key: "avatar", value: "https://render/a.jpg" }] } },
      [`${base}/statistics`]: { body: {} },
      [`${base}/professions`]: { body: {} },
      [`${base}/reputations`]: { body: { reputations: [] } },
      [`${base}/encounters/raids`]: { body: { expansions: [] } },
      [`${base}/encounters/dungeons`]: { body: { expansions: [] } },
      [`${base}/mythic-keystone-profile`]: { body: { current_mythic_rating: { rating: 1500 }, seasons: [{ id: 13 }, { id: 15 }, { id: 14 }] } },
      [`${base}/achievements/statistics`]: { body: { categories: [] } },
      [`${base}/mythic-keystone-profile/season/15`]: {
        body: { best_runs: [{ keystone_level: 10, dungeon: { id: 1, name: { en_US: "Ara-Kara" } }, is_completed_within_time: true }] },
      },
    });
    const profile = await clientFor(impl, { ...retail.api, characterEndpoints: ["equipment", "specializations", "media", "statistics", "professions", "reputations", "raids", "dungeons", "mythicPlus", "encounterStatistics"] })
      .getCharacterProfile({ realm: "realm", name: "Thrall" });
    expect(profile.missing).toEqual({});
    expect(profile.media?.avatar).toBe("https://render/a.jpg");
    const locales = Object.fromEntries(apiCalls().map((c) => [c.path.replace(base, "") || "/", c.query.get("locale")]));
    expect(locales).toEqual({
      "/": "en_US",
      "/equipment": null,
      "/specializations": "en_US",
      "/character-media": "en_US",
      "/statistics": "en_US",
      "/professions": null,
      "/reputations": null,
      "/encounters/raids": null,
      "/encounters/dungeons": null,
      "/mythic-keystone-profile": null,
      "/mythic-keystone-profile/season/15": null,
      "/achievements/statistics": null,
    });
    expect(profile).toMatchObject({ raids: [], dungeons: [], mythicPlus: { rating: 1500, weeklyRuns: [], seasonId: 15 } });
    expect(profile.mythicPlus?.seasonRuns?.map((r) => r.level)).toEqual([10]);
  });

  it("records missing detail endpoints instead of failing", async () => {
    const { impl, apiCalls } = fakeFetch({
      "/profile/wow/character/realm/thrall": { body: { id: 1, name: "Thrall", level: 60 } },
      "/profile/wow/character/realm/thrall/equipment": { body: { equipped_items: [] } },
      "/profile/wow/character/realm/thrall/character-media": { status: 403 },
    });
    const client = clientFor(impl, { ...retail.api, characterEndpoints: ["equipment", "professions", "media"] });
    const result = await client.getCharacterProfile({ realm: "realm", name: "Thrall" });
    expect(result.summary.name).toBe("Thrall");
    expect(result.equipment).toEqual([]);
    expect(result.missing).toMatchObject({ professions: "404", media: "403", statistics: "unsupported", specializations: "unsupported" });
    // Unsupported endpoints are never requested.
    expect(apiCalls().some((c) => c.path.endsWith("/statistics"))).toBe(false);
  });

  it("reuses a known summary instead of fetching it again", async () => {
    const { impl, apiCalls } = fakeFetch({});
    const summary = { blizzardId: 1, name: "Thrall", realmSlug: "realm", level: 80 };
    const profile = await clientFor(impl, { ...retail.api, characterEndpoints: [] }).getCharacterProfile({ realm: "realm", name: "Thrall" }, summary);
    expect(profile.summary).toBe(summary);
    expect(apiCalls()).toHaveLength(0);
  });

  it("builds a talent tree from one request per UI locale", async () => {
    const tree = (name: string, talent: string) => ({
      id: 672,
      playable_class: { name },
      playable_specialization: { id: 1473, name: `${name} spec` },
      class_talent_nodes: [{ id: 5, display_row: 1, display_col: 2, ranks: [{ tooltip: { talent: { id: 50, name: talent }, spell_tooltip: { spell: { id: 500 } } } }] }],
      spec_talent_nodes: [],
      hero_talent_trees: [],
    });
    const { impl, apiCalls } = fakeFetch({
      "/data/wow/talent-tree/672/playable-specialization/1473": (url) =>
        Response.json(url.searchParams.get("locale") === "es_ES" ? tree("Evocador", "Talento") : tree("Evoker", "Talent")),
    });
    const layout = await clientFor(impl).getTalentTree(672, 1473);
    expect(apiCalls().map((c) => [c.query.get("namespace"), c.query.get("locale")]).sort()).toEqual([
      ["static-eu", "en_US"],
      ["static-eu", "es_ES"],
    ]);
    expect(layout).toMatchObject({ treeId: 672, specId: 1473, className: { en: "Evoker", es: "Evocador" } });
    expect(layout.classNodes[0]!.options[0]).toMatchObject({ talentId: 50, spellId: 500, name: { en: "Talent", es: "Talento" } });
  });

  it("propagates a failed talent tree request", async () => {
    const { impl } = fakeFetch({ "/data/wow/talent-tree/672/playable-specialization/1473": { status: 404 } });
    await expect(clientFor(impl).getTalentTree(672, 1473)).rejects.toMatchObject({ status: 404 });
  });

  it("reads icons from static media, treating missing media as no icon", async () => {
    const { impl, apiCalls } = fakeFetch({
      "/data/wow/media/spell/355": { body: { assets: [{ key: "icon", value: "https://render/taunt.jpg" }] } },
      "/data/wow/media/item/500": { status: 500 },
    });
    const client = clientFor(impl);
    expect(await client.getIcon("spell", 355)).toBe("https://render/taunt.jpg");
    expect(await client.getIcon("profession", 164)).toBeUndefined();
    await expect(client.getIcon("item", 500)).rejects.toMatchObject({ status: 500 });
    expect(apiCalls()[0]!.query.get("namespace")).toBe("static-eu");
    expect(apiCalls()[0]!.query.has("locale")).toBe(false);
  });
});

describe("Battle.net OAuth", () => {
  const config = { clientId: "id", clientSecret: "secret", redirectUri: "https://roster.example/api/auth/callback" };

  it("builds the authorize URL with the profile scope and state", () => {
    const url = new URL(authorizeUrl(config, "xyz"));
    expect(url.origin + url.pathname).toBe("https://oauth.battle.net/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "id",
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "openid wow.profile",
      state: "xyz",
    });
  });

  it("exchanges the code for a user token with the registered redirect URI", async () => {
    const { impl, calls } = fakeFetch({ "/token": { body: { access_token: "user", expires_in: 86400 } } });
    expect(await exchangeCode(config, "the-code", impl)).toEqual({ access_token: "user", expires_in: 86400 });
    const body = new URLSearchParams(calls[0]!.body);
    expect(calls[0]).toMatchObject({ method: "POST", auth: `Basic ${Buffer.from("id:secret").toString("base64")}` });
    expect(Object.fromEntries(body)).toEqual({ grant_type: "authorization_code", code: "the-code", redirect_uri: config.redirectUri });
  });

  it("reports a refused code exchange", async () => {
    const { impl } = fakeFetch({ "/token": { status: 400 } });
    await expect(exchangeCode(config, "bad", impl)).rejects.toThrow("(400)");
  });

  it("reads the Battle.net user with the user token", async () => {
    const { impl, calls } = fakeFetch({ "/userinfo": { body: { id: 42, battletag: "Thrall#1234", sub: "42" } } });
    expect(await getUserInfo("user", impl)).toEqual({ id: 42, battletag: "Thrall#1234" });
    expect(calls[0]!.auth).toBe("Bearer user");
    const failing = fakeFetch({ "/userinfo": { status: 401 } });
    await expect(getUserInfo("user", failing.impl)).rejects.toThrow("(401)");
  });
});
