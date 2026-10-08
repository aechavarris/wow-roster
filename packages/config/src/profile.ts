import anniversaryProfile from "../profiles/anniversary.json" with { type: "json" };
import classicEraProfile from "../profiles/classic-era.json" with { type: "json" };
import foreverProfile from "../profiles/forever.json" with { type: "json" };
import progressionProfile from "../profiles/progression.json" with { type: "json" };
import retailProfile from "../profiles/retail.json" with { type: "json" };
import {
  gameProfileSchema,
  profileFileSchema,
  type GameProfile,
  type ProfileFile,
} from "./schema";

/** Built-in game versions, in the order they are offered. Each roster and character belongs to one. */
export const BUILTIN_PROFILES: Record<string, unknown> = {
  forever: foreverProfile,
  "classic-era": classicEraProfile,
  anniversary: anniversaryProfile,
  progression: progressionProfile,
  retail: retailProfile,
};

/** Old profile ids still accepted in configuration. */
const ALIASES: Record<string, string> = { "retail-dev": "retail" };

/** Array keys merged entry-by-entry when a profile extends another, keyed by the given field. */
const MERGE_KEYS: Record<string, string> = {
  roles: "key",
  classes: "id",
  raidSizes: "size",
  raids: "key",
  rulesets: "key",
  dungeons: "key",
  timeline: "key",
  rosterStatuses: "key",
  professions: "key",
  // statPanel is replaced as a whole: a different game version means a different panel.
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
  id = ALIASES[id] ?? id;
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

export interface GameVersions {
  /** Every version, in display order. */
  list: GameProfile[];
  byId: Map<string, GameProfile>;
  /** Version used for new rosters, searches and data without one. */
  defaultId: string;
}

/**
 * Loads every built-in version plus custom ones (e.g. a profile file that extends a built-in
 * version under a new id). `defaultId` accepts the old profile aliases.
 */
export function loadGameVersions(defaultId: string, extra: Record<string, unknown> = {}): GameVersions {
  const ids = [...new Set([...Object.keys(BUILTIN_PROFILES), ...Object.keys(extra)])];
  const list = ids.map((id) => resolveProfile(id, extra));
  const byId = new Map(list.map((p) => [p.id, p]));
  const resolvedDefault = ALIASES[defaultId] ?? defaultId;
  if (!byId.has(resolvedDefault)) throw new Error(`Unknown default game version "${defaultId}"`);
  return { list, byId, defaultId: resolvedDefault };
}

/**
 * Test mode for versions without a public API (Forever): `spec` ("forever=classic-era,…") makes each target read
 * real characters from the source version's API and Warcraft Logs, keeping its own rules (classes, buffs, raids…).
 * The source's log-mapped raids are added disabled so its kills still show as raid progress. A target that has
 * its own API keeps it, so a forgotten setting cannot hide the real data once it is published.
 */
export function withApiStandIns(versions: GameVersions, spec: string | undefined): GameVersions {
  const pairs = (spec ?? "")
    .split(",")
    .map((pair) => pair.split("=").map((s) => s.trim()))
    .filter((pair): pair is [string, string] => pair.length === 2 && Boolean(pair[0]) && Boolean(pair[1]));
  if (pairs.length === 0) return versions;
  const list = versions.list.map((target) => {
    const sourceId = pairs.find(([targetId]) => targetId === target.id)?.[1];
    if (!sourceId || target.api.available) return target;
    const source = versions.byId.get(sourceId);
    if (!source?.api.available) throw new Error(`API stand-in "${sourceId}" for "${target.id}" is not a version with an API`);
    return {
      ...target,
      api: { ...source.api, standIn: source.id },
      // Item ids come from the source's game data, so tooltips must too.
      wowheadDomain: source.wowheadDomain,
      raids: [
        ...target.raids,
        ...source.raids.filter((r) => r.warcraftLogsZone).map((r) => ({ ...r, key: `standin-${r.key}`, enabled: false })),
      ],
    };
  });
  return { ...versions, list, byId: new Map(list.map((p) => [p.id, p])) };
}

/** The version with that id, or the default one for unknown or missing ids (older data). */
export function versionOf(versions: GameVersions, id?: string | null): GameProfile {
  return (id ? versions.byId.get(id) : undefined) ?? versions.byId.get(versions.defaultId)!;
}
