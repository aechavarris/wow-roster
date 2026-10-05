import { readFileSync } from "node:fs";
import { loadGameVersions, type GameVersions } from "./profile";

let cached: GameVersions | undefined;

/**
 * Loads every game version for server processes.
 * DEFAULT_GAME_VERSION picks the version offered by default (falls back to the older GAME_PROFILE,
 * then "classic-era"); GAME_PROFILE_PATH optionally adds a custom version from a JSON file that may
 * extend a built-in one.
 */
export function loadServerGameVersions(env: NodeJS.ProcessEnv = process.env): GameVersions {
  if (cached) return cached;
  const extra: Record<string, unknown> = {};
  if (env.GAME_PROFILE_PATH) {
    const custom = JSON.parse(readFileSync(env.GAME_PROFILE_PATH, "utf8")) as { id: string };
    extra[custom.id] = custom;
  }
  // `||` so empty values passed through docker compose fall back too.
  cached = loadGameVersions(env.DEFAULT_GAME_VERSION || env.GAME_PROFILE || "classic-era", extra);
  return cached;
}
