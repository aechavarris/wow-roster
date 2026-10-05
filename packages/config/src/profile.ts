import foreverProfile from "../profiles/forever.json" with { type: "json" };
import retailDevProfile from "../profiles/retail-dev.json" with { type: "json" };
import {
  gameProfileSchema,
  profileFileSchema,
  type GameProfile,
  type ProfileFile,
} from "./schema";

export const BUILTIN_PROFILES: Record<string, unknown> = {
  forever: foreverProfile,
  "retail-dev": retailDevProfile,
};

/** Array keys merged entry-by-entry when a profile extends another, keyed by the given field. */
const MERGE_KEYS: Record<string, string> = {
  roles: "key",
  classes: "id",
  raidSizes: "size",
  raids: "key",
  rosterStatuses: "key",
};

function mergeArray(base: unknown[], override: unknown[], key: string): unknown[] {
  const result = [...base];
  for (const entry of override) {
    const id = (entry as Record<string, unknown>)[key];
    const index = result.findIndex((e) => (e as Record<string, unknown>)[key] === id);
    if (index >= 0) result[index] = entry;
    else result.push(entry);
  }
  return result;
}

function mergeProfiles(base: Record<string, unknown>, override: ProfileFile): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [field, value] of Object.entries(override)) {
    if (field === "extends" || value === undefined) continue;
    const mergeKey = MERGE_KEYS[field];
    const current = merged[field];
    merged[field] =
      mergeKey && Array.isArray(current) && Array.isArray(value)
        ? mergeArray(current, value, mergeKey)
        : value;
  }
  return merged;
}

/**
 * Resolves a profile by id, following `extends` chains.
 * `extra` lets callers register additional profiles (e.g. loaded from disk).
 */
export function resolveProfile(id: string, extra: Record<string, unknown> = {}): GameProfile {
  const sources = { ...BUILTIN_PROFILES, ...extra };
  const seen = new Set<string>();

  const resolveRaw = (profileId: string): Record<string, unknown> => {
    if (seen.has(profileId)) throw new Error(`Circular profile inheritance at "${profileId}"`);
    seen.add(profileId);
    const raw = sources[profileId];
    if (!raw) throw new Error(`Unknown game profile "${profileId}"`);
    const file = profileFileSchema.parse(raw);
    const base = file.extends ? resolveRaw(file.extends) : {};
    return mergeProfiles(base, file);
  };

  return gameProfileSchema.parse(resolveRaw(id));
}

export function namespaceFor(template: string, region: string): string {
  return template.replaceAll("{region}", region.toLowerCase());
}
