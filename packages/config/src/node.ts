import { readFileSync } from "node:fs";
import { resolveProfile } from "./profile";
import type { GameProfile } from "./schema";

let cached: GameProfile | undefined;

/**
 * Loads the active game profile for server processes.
 * GAME_PROFILE selects a built-in or custom profile id (default "retail-dev");
 * GAME_PROFILE_PATH optionally points to a JSON file that may extend a built-in profile.
 */
export function loadGameProfile(env: NodeJS.ProcessEnv = process.env): GameProfile {
  if (cached) return cached;
  const extra: Record<string, unknown> = {};
  let id = env.GAME_PROFILE ?? "retail-dev";
  if (env.GAME_PROFILE_PATH) {
    const custom = JSON.parse(readFileSync(env.GAME_PROFILE_PATH, "utf8")) as { id: string };
    extra[custom.id] = custom;
    id = env.GAME_PROFILE ?? custom.id;
  }
  cached = resolveProfile(id, extra);
  return cached;
}
