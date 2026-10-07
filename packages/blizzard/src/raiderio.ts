/* eslint-disable @typescript-eslint/no-explicit-any -- raw Raider.IO payloads are validated field by field here. */
import type { RaiderIoProfile, RaiderIoRun } from "./types";

type Raw = any;

const RAIDER_IO = "https://raider.io/api/v1";
const FIELDS = [
  "mythic_plus_scores_by_season:current",
  "mythic_plus_weekly_highest_level_runs",
  "mythic_plus_recent_runs",
  "mythic_plus_best_runs",
].join(",");

/** Raider.IO answered with an error; 400 and 404 mean it does not know the character. */
export class RaiderIoError extends Error {
  constructor(readonly status: number) {
    super(`Raider.IO responded ${status}`);
  }
  get notFound() {
    return this.status === 400 || this.status === 404;
  }
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v : []);

function normalizeRun(run: Raw): RaiderIoRun {
  const upgrades = num(run.num_keystone_upgrades) ?? 0;
  return {
    dungeon: str(run.dungeon) ?? "",
    shortName: str(run.short_name),
    level: num(run.mythic_level) ?? 0,
    timed: upgrades > 0,
    upgrades,
    completedAt: str(run.completed_at),
    score: num(run.score),
    url: str(run.url),
  };
}

/** Raider.IO /characters/profile with the Mythic+ fields; field names as checked against the live API. */
export function normalizeRaiderIo(raw: Raw): RaiderIoProfile {
  const season = list(raw.mythic_plus_scores_by_season)[0];
  return {
    profileUrl: str(raw.profile_url),
    season: str(season?.season),
    score: num(season?.segments?.all?.score) ?? num(season?.scores?.all),
    color: str(season?.segments?.all?.color),
    weeklyRuns: list(raw.mythic_plus_weekly_highest_level_runs).map(normalizeRun),
    recentRuns: list(raw.mythic_plus_recent_runs).map(normalizeRun),
    bestRuns: list(raw.mythic_plus_best_runs).map(normalizeRun),
  };
}

/** Public Raider.IO API (no key needed); used for retail Mythic+ runs, which Blizzard only reports as weekly bests. */
export class RaiderIoClient {
  private readonly fetchImpl: typeof fetch;

  constructor(options: { fetch?: typeof fetch } = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async getProfile(region: string, realm: string, name: string): Promise<RaiderIoProfile> {
    const url = new URL(`${RAIDER_IO}/characters/profile`);
    url.searchParams.set("region", region.toLowerCase());
    url.searchParams.set("realm", realm);
    url.searchParams.set("name", name);
    url.searchParams.set("fields", FIELDS);
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new RaiderIoError(response.status);
    return normalizeRaiderIo((await response.json()) as Raw);
  }
}
