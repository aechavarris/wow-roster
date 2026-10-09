import { namespaceFor, type ApiConfig } from "@wow/config";
import {
  normalizeAccountCharacters,
  normalizeEncounters,
  normalizeEquipment,
  normalizeGuild,
  normalizeGuildRoster,
  normalizeIcon,
  normalizeItem,
  normalizeItemSearch,
  normalizeJournalEncounter,
  normalizeJournalIndex,
  normalizeJournalInstance,
  normalizeMedia,
  normalizeMythicPlus,
  normalizeMythicPlusSeason,
  normalizeEncounterStatistics,
  normalizeProfessions,
  normalizeReputations,
  normalizeSpecializations,
  normalizeStatistics,
  normalizeSummary,
  normalizeTalentTree,
} from "./normalize";
import { BLIZZARD_LOCALES } from "./text";
import type {
  AccountCharacter,
  CharacterProfile,
  CharacterRef,
  CharacterSummary,
  GuildInfo,
  GuildRosterMember,
  ItemResult,
  JournalEncounter,
  JournalInstance,
  JournalInstanceRef,
  TalentTreeLayout,
} from "./types";

export const OAUTH_HOST = "https://oauth.battle.net";

export class BlizzardApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message?: string,
  ) {
    super(message ?? `Blizzard API ${status} on ${path}`);
    this.name = "BlizzardApiError";
  }

  get notFound() {
    return this.status === 404;
  }
}

export interface BlizzardClientOptions {
  clientId: string;
  clientSecret: string;
  region: string;
  api: ApiConfig;
  /** Locale for names in responses; English keeps spec matching stable. */
  locale?: string;
  fetch?: typeof fetch;
  /** Base wait before retrying a throttled or failed request; tests set it to 0. */
  retryDelayMs?: number;
}

type NamespaceKind = "profile" | "static" | "dynamic";

interface RequestOptions {
  namespace: NamespaceKind;
  /** User OAuth token for account-scoped endpoints; the app token is used otherwise. */
  userToken?: string;
  /** Overrides the client locale; null omits it so Blizzard returns every locale. */
  locale?: string | null;
}

/** Gateway and server errors Blizzard returns now and then under load; worth one more try. */
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const MAX_RETRIES = 3;

const encodeName = (name: string) => encodeURIComponent(name.trim().toLowerCase());

export class BlizzardClient {
  private appToken?: { value: string; expiresAt: number };
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: BlizzardClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  get region() {
    return this.options.region;
  }

  private get apiHost() {
    return `https://${this.options.region}.api.blizzard.com`;
  }

  private namespace(kind: NamespaceKind) {
    const { api } = this.options;
    const template =
      kind === "profile" ? api.profileNamespace : kind === "static" ? api.staticNamespace : api.dynamicNamespace;
    return namespaceFor(template, this.options.region);
  }

  async getAppToken(): Promise<string> {
    if (this.appToken && this.appToken.expiresAt > Date.now() + 60_000) return this.appToken.value;
    const response = await this.fetchImpl(`${OAUTH_HOST}/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) throw new BlizzardApiError(response.status, "/token", "Could not obtain Blizzard app token");
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.appToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  async request<T>(path: string, options: RequestOptions, attempt = 0): Promise<T> {
    const { namespace, userToken } = options;
    const url = new URL(path, this.apiHost);
    url.searchParams.set("namespace", this.namespace(namespace));
    const locale = options.locale === undefined ? (this.options.locale ?? "en_US") : options.locale;
    if (locale) url.searchParams.set("locale", locale);
    const token = userToken ?? (await this.getAppToken());
    const baseDelay = this.options.retryDelayMs ?? 1000;
    const retry = async (waitMs: number) => {
      await new Promise((resolve) => setTimeout(resolve, waitMs * (attempt + 1)));
      return this.request<T>(path, options, attempt + 1);
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      // Dropped connections and DNS hiccups: retry, then surface as a gateway error.
      if (attempt < MAX_RETRIES) return retry(baseDelay);
      throw new BlizzardApiError(502, path, `Blizzard API unreachable on ${path}: ${(error as Error).message}`);
    }

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("retry-after"));
      return retry(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : baseDelay);
    }
    if (TRANSIENT_STATUSES.has(response.status) && attempt < MAX_RETRIES) return retry(baseDelay);
    if (response.status === 401 && !userToken && attempt === 0) {
      this.appToken = undefined;
      return this.request<T>(path, options, attempt + 1);
    }
    if (!response.ok) throw new BlizzardApiError(response.status, path);
    return (await response.json()) as T;
  }

  private characterPath(ref: CharacterRef, suffix = "") {
    return `/profile/wow/character/${encodeURIComponent(ref.realm)}/${encodeName(ref.name)}${suffix}`;
  }

  async getGuild(realm: string, guildSlug: string): Promise<GuildInfo> {
    const raw = await this.request(`/data/wow/guild/${encodeURIComponent(realm)}/${encodeURIComponent(guildSlug)}`, {
      namespace: "profile",
    });
    return normalizeGuild(raw);
  }

  async getGuildRoster(realm: string, guildSlug: string): Promise<GuildRosterMember[]> {
    const raw = await this.request(
      `/data/wow/guild/${encodeURIComponent(realm)}/${encodeURIComponent(guildSlug)}/roster`,
      { namespace: "profile" },
    );
    return normalizeGuildRoster(raw);
  }

  async getAccountCharacters(userToken: string): Promise<AccountCharacter[]> {
    const raw = await this.request("/profile/user/wow", { namespace: "profile", userToken });
    return normalizeAccountCharacters(raw);
  }

  async getCharacterSummary(ref: CharacterRef) {
    return normalizeSummary(await this.request(this.characterPath(ref), { namespace: "profile" }));
  }

  /**
   * Fetches the summary plus every detail endpoint the game profile declares.
   * Detail failures are recorded in `missing` instead of failing the whole sync.
   */
  async getCharacterProfile(ref: CharacterRef, knownSummary?: CharacterSummary): Promise<CharacterProfile> {
    const summary = knownSummary ?? (await this.getCharacterSummary(ref));
    const profile: CharacterProfile = { summary, missing: {} };
    const endpoints = this.options.api.characterEndpoints;

    const fetchDetail = async <K extends keyof CharacterProfile>(
      key: K,
      endpoint: (typeof endpoints)[number],
      suffix: string,
      normalize: (raw: unknown) => CharacterProfile[K],
      locale?: null,
    ) => {
      if (!endpoints.includes(endpoint)) {
        profile.missing[endpoint] = "unsupported";
        return;
      }
      try {
        profile[key] = normalize(await this.request(this.characterPath(ref, suffix), { namespace: "profile", locale }));
      } catch (error) {
        profile.missing[endpoint] = error instanceof BlizzardApiError ? String(error.status) : "error";
      }
    };

    await Promise.all([
      // All locales in one call so item tooltips can be shown in every UI language.
      fetchDetail("equipment", "equipment", "/equipment", normalizeEquipment, null),
      fetchDetail("talents", "specializations", "/specializations", normalizeSpecializations),
      fetchDetail("media", "media", "/character-media", normalizeMedia),
      fetchDetail("statistics", "statistics", "/statistics", normalizeStatistics),
      fetchDetail("professions", "professions", "/professions", normalizeProfessions, null),
      fetchDetail("reputations", "reputations", "/reputations", normalizeReputations, null),
      // Instance and boss names in every locale, like the gear.
      fetchDetail("raids", "raids", "/encounters/raids", normalizeEncounters, null),
      fetchDetail("dungeons", "dungeons", "/encounters/dungeons", normalizeEncounters, null),
      fetchDetail("mythicPlus", "mythicPlus", "/mythic-keystone-profile", normalizeMythicPlus, null),
      // Every locale: boss and instance names come from the statistic names.
      fetchDetail("encounterStatistics", "encounterStatistics", "/achievements/statistics", normalizeEncounterStatistics, null),
    ]);
    const mythicPlus = profile.mythicPlus;
    if (mythicPlus) {
      // Season bests are best effort: without them the rating and this week's runs still show.
      if (mythicPlus.seasonId === undefined) mythicPlus.seasonRuns = [];
      else {
        try {
          const raw = await this.request(this.characterPath(ref, `/mythic-keystone-profile/season/${mythicPlus.seasonId}`), {
            namespace: "profile",
            locale: null,
          });
          mythicPlus.seasonRuns = normalizeMythicPlusSeason(raw);
        } catch (error) {
          // No run in the current season yet.
          if (error instanceof BlizzardApiError && error.notFound) mythicPlus.seasonRuns = [];
        }
      }
    }
    return profile;
  }

  /** Retail talent tree for one spec, fetched once per UI locale and merged. */
  async getTalentTree(treeId: number, specId: number): Promise<TalentTreeLayout> {
    const entries = await Promise.all(
      Object.entries(BLIZZARD_LOCALES).map(async ([ui, blizzard]) => [
        ui,
        await this.request(`/data/wow/talent-tree/${treeId}/playable-specialization/${specId}`, {
          namespace: "static",
          locale: blizzard,
        }),
      ]),
    );
    return normalizeTalentTree(Object.fromEntries(entries));
  }

  /**
   * Searches the version's item database for the BiS picker. `query` matches the item name in the client locale;
   * `minLevel`/`maxLevel` bound the required level (the 10-level bracket the UI defaults to). Items are returned
   * highest item level first. Returns the page's items and the total page count for simple paging.
   */
  async searchItems(opts: {
    query?: string;
    minLevel?: number;
    maxLevel?: number;
    /** Restrict to a Blizzard item class (2 = weapon, 4 = armor). */
    itemClassId?: number;
    /** Restrict to an item subclass within the class (armour type or weapon type). */
    itemSubclassId?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: ItemResult[]; page: number; pageCount: number }> {
    const params = new URLSearchParams();
    params.set("_page", String(opts.page ?? 1));
    if (opts.pageSize) params.set("_pageSize", String(opts.pageSize));
    params.set("orderby", "level:desc");
    if (opts.query) {
      const blizzardLocale = BLIZZARD_LOCALES[this.options.locale ?? "en"] ?? "en_US";
      params.set(`name.${blizzardLocale}`, opts.query);
    }
    if (opts.itemClassId !== undefined) params.set("item_class.id", String(opts.itemClassId));
    if (opts.itemSubclassId !== undefined) params.set("item_subclass.id", String(opts.itemSubclassId));
    if (opts.minLevel !== undefined || opts.maxLevel !== undefined) {
      params.set("required_level", `[${opts.minLevel ?? 0},${opts.maxLevel ?? 999}]`);
    }
    // No locale so search results carry every language for the stored name.
    const raw = await this.request<{ page?: number; pageCount?: number }>(`/data/wow/search/item?${params.toString()}`, {
      namespace: "static",
      locale: null,
    });
    return {
      items: normalizeItemSearch(raw),
      page: typeof raw.page === "number" ? raw.page : (opts.page ?? 1),
      pageCount: typeof raw.pageCount === "number" ? raw.pageCount : 1,
    };
  }

  /** One item's details for the BiS picker; undefined when the version's API does not know it. */
  async getItem(itemId: number): Promise<ItemResult | undefined> {
    try {
      return normalizeItem(await this.request(`/data/wow/item/${itemId}`, { namespace: "static", locale: null }));
    } catch (error) {
      if (error instanceof BlizzardApiError && error.notFound) return undefined;
      throw error;
    }
  }

  /** Every raid and dungeon in the journal (Adventure Guide); the roots of the BiS source index. */
  async getJournalInstances(): Promise<JournalInstanceRef[]> {
    return normalizeJournalIndex(await this.request("/data/wow/journal-instance/index", { namespace: "static", locale: null }));
  }

  /** One journal instance with its encounter ids. */
  async getJournalInstance(id: number): Promise<JournalInstance | undefined> {
    try {
      return normalizeJournalInstance(await this.request(`/data/wow/journal-instance/${id}`, { namespace: "static", locale: null }));
    } catch (error) {
      if (error instanceof BlizzardApiError && error.notFound) return undefined;
      throw error;
    }
  }

  /** One journal encounter (boss) with the items it drops. */
  async getJournalEncounter(id: number): Promise<JournalEncounter | undefined> {
    try {
      return normalizeJournalEncounter(await this.request(`/data/wow/journal-encounter/${id}`, { namespace: "static", locale: null }));
    } catch (error) {
      if (error instanceof BlizzardApiError && error.notFound) return undefined;
      throw error;
    }
  }

  /** Icon URL for an item, spell or profession; undefined when the game version has no media for it. */
  async getIcon(kind: "item" | "spell" | "profession", id: number): Promise<string | undefined> {
    try {
      return normalizeIcon(await this.request(`/data/wow/media/${kind}/${id}`, { namespace: "static", locale: null }));
    } catch (error) {
      if (error instanceof BlizzardApiError && error.notFound) return undefined;
      throw error;
    }
  }
}
