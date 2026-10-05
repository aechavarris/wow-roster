import { namespaceFor, type ApiConfig } from "@wow/config";
import {
  normalizeAccountCharacters,
  normalizeEquipment,
  normalizeGuild,
  normalizeGuildRoster,
  normalizeIcon,
  normalizeMedia,
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
}

type NamespaceKind = "profile" | "static" | "dynamic";

interface RequestOptions {
  namespace: NamespaceKind;
  /** User OAuth token for account-scoped endpoints; the app token is used otherwise. */
  userToken?: string;
  /** Overrides the client locale; null omits it so Blizzard returns every locale. */
  locale?: string | null;
}

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
    const response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });

    if (response.status === 429 && attempt < 3) {
      const wait = Number(response.headers.get("retry-after") ?? 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, wait * (attempt + 1)));
      return this.request<T>(path, options, attempt + 1);
    }
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
    ]);
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
