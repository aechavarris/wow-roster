/* eslint-disable @typescript-eslint/no-explicit-any -- raw Warcraft Logs payloads are validated field by field here. */
import type { WarcraftLogsKill, WarcraftLogsProfile } from "./types";

type Raw = any;

const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";

/** Warcraft Logs answered with an error, or (404) does not know the character on that host. */
export class WarcraftLogsError extends Error {
  constructor(readonly status: number, detail?: string) {
    super(`Warcraft Logs responded ${status}${detail ? `: ${detail}` : ""}`);
  }
  get notFound() {
    return this.status === 404;
  }
}

/**
 * The character's recent reports with their boss kills and which players took part in each, so only the kills the
 * character was in count. One query per character: the API charges points per request and field.
 */
const CHARACTER_QUERY = `query($name: String, $server: String, $region: String, $limit: Int) {
  characterData { character(name: $name, serverSlug: $server, serverRegion: $region) { id
    recentReports(limit: $limit) { data { code startTime zone { id name }
      fights(killType: Kills) { encounterID name difficulty size endTime friendlyPlayers }
      masterData { actors(type: "Player") { id name } } } } } } }`;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v : []);

/**
 * Boss kills of the character from a /api/v2/client character payload. Fight times are relative to the report
 * start; kills are stored with absolute times so the weekly audit can place them in a game week.
 */
export function normalizeWarcraftLogs(raw: Raw, characterName: string, url: string): WarcraftLogsProfile {
  const kills: WarcraftLogsKill[] = [];
  for (const report of list(raw?.recentReports?.data)) {
    const start = num(report.startTime);
    if (start === undefined) continue;
    const self = list(report.masterData?.actors).find((a) => str(a.name)?.toLowerCase() === characterName.toLowerCase());
    for (const fight of list(report.fights)) {
      const encounterId = num(fight.encounterID);
      // Without the character among the fight's players (benched, swapped out) the kill is not theirs.
      if (!encounterId || (self && !list(fight.friendlyPlayers).includes(self.id))) continue;
      const zoneName = str(report.zone?.name);
      kills.push({
        report: str(report.code) ?? "",
        zoneId: num(report.zone?.id),
        zoneName: zoneName ? { en: zoneName } : undefined,
        encounterId,
        name: str(fight.name) ?? String(encounterId),
        difficulty: num(fight.difficulty),
        size: num(fight.size),
        killedAt: new Date(start + (num(fight.endTime) ?? 0)).toISOString(),
      });
    }
  }
  return { url, fetchedAt: new Date().toISOString(), kills };
}

/**
 * Warcraft Logs API v2 (client credentials). Classic versions have no raid progress in Blizzard's API, but most
 * raiding guilds upload logs: their boss kills give the raid progress and the weekly audit.
 */
export class WarcraftLogsClient {
  private readonly fetchImpl: typeof fetch;
  private token?: { value: string; expiresAt: number };

  constructor(private readonly options: { clientId: string; clientSecret: string; fetch?: typeof fetch }) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new WarcraftLogsError(response.status, "token");
    const body = (await response.json()) as { access_token: string; expires_in?: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  /** Recent boss kills of a character on one site (`vanilla.warcraftlogs.com` for Classic Era…). */
  async getCharacterKills(host: string, region: string, realm: string, name: string, limit = 10): Promise<WarcraftLogsProfile> {
    const response = await this.fetchImpl(`https://${host}/api/v2/client`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: CHARACTER_QUERY, variables: { name, server: realm, region: region.toUpperCase(), limit } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new WarcraftLogsError(response.status);
    const body = (await response.json()) as Raw;
    if (body?.errors?.length) throw new WarcraftLogsError(400, str(body.errors[0]?.message));
    const character = body?.data?.characterData?.character;
    if (!character) throw new WarcraftLogsError(404);
    return normalizeWarcraftLogs(character, name, `https://${host}/character/${region.toLowerCase()}/${realm}/${encodeURIComponent(name.toLowerCase())}`);
  }
}
