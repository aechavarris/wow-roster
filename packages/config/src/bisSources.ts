import { z } from "zod";

/**
 * Configurable catalog of third-party best-in-slot *sources*. The BiS list is no longer filled by searching items
 * on our side (Wowhead's finder is Cloudflare-blocked server-side); instead ready-made BiS sets are imported from
 * external planners. This registry is data-driven so operators can choose which sources to show and add new ones
 * without code: a source is a config entry, and a new *format* only needs a new `adapter` (a small parser).
 *
 * The first adapter, `wowsims`, reads a WoWSims(-fork) GitHub repo's gear-set JSON (`ui/<spec>/gear_sets/*.gear.json`):
 * `{ "items": [{ "id": 12640, "enchant": 1506 }, …] }`, one entry per equipment slot in WoWSims' fixed slot order,
 * so the slot comes from the array position (there is no slot field). GitHub raw is reachable server-side, unlike
 * Wowhead's finder.
 */

/** WoWSims' fixed gear-array order (17 slots) mapped to our BiS slot keys. Finger1/2 and Trinket1/2 share a key. */
export const WOWSIMS_GEAR_SLOT_ORDER = [
  "head", "neck", "shoulder", "back", "chest", "wrist", "hands", "waist", "legs", "feet",
  "finger", "finger", "trinket", "trinket", "mainHand", "offHand", "ranged",
] as const;

/** One WoWSims gear-set file to pull, with the label and phase it represents in the UI. */
export const wowsimsGearSetSchema = z.object({
  /** Display label, e.g. "P1 BiS", "Pre-raid". */
  label: z.string(),
  /** Progression phase/tier this set targets (1-based); used to order and group sets. */
  phase: z.number().int().min(0).default(1),
  /** Repo-relative path to the gear-set JSON, e.g. "ui/warrior/gear_sets/phase_1.gear.json". */
  path: z.string().min(1),
});
export type WowsimsGearSet = z.infer<typeof wowsimsGearSetSchema>;

/** The `wowsims` adapter's config: a GitHub repo and, per class/spec, the gear-set files to pull. */
export const wowsimsAdapterSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1).default("main"),
  specs: z
    .array(
      z.object({
        classId: z.number().int(),
        /** Our spec key for this class (matches the version profile's spec keys). */
        spec: z.string().min(1),
        sets: z.array(wowsimsGearSetSchema).min(1),
      }),
    )
    .default([]),
});

/** A configurable BiS source. Toggle `enabled` to show/hide it; add a source by adding an entry. */
export const bisTemplateSourceSchema = z.object({
  /** Stable id, used in cache keys and the enabled-override env. */
  key: z.string().min(1),
  /** Display name shown next to each imported list, e.g. "WoW Forever Sim". */
  name: z.string().min(1),
  /** Link to the source, shown to users for attribution. */
  url: z.string().url(),
  /** How to ingest this source. A new format adds a new adapter value + parser. */
  adapter: z.enum(["wowsims"]),
  /** Default on/off. The runtime can override the enabled set (see `enabledTemplateSources`). */
  enabled: z.boolean().default(true),
  /** Game version ids this source feeds (e.g. ["forever"], ["classic-era"]). */
  gameVersions: z.array(z.string()).min(1),
  /** Optional popularity/visits where the source exposes it; shown as a hint when present. */
  popularity: z.number().int().nonnegative().optional(),
  /** Adapter config. Present for `adapter: "wowsims"`. */
  wowsims: wowsimsAdapterSchema.optional(),
});
export type BisTemplateSource = z.infer<typeof bisTemplateSourceSchema>;

/** One imported BiS set, ready to preview per slot and import into a character's list. */
export interface BisTemplate {
  sourceKey: string;
  sourceName: string;
  sourceUrl: string;
  popularity?: number;
  gameVersion: string;
  classId: number;
  spec: string;
  phase: number;
  label: string;
  items: { slot: string; itemId: number }[];
}

/**
 * The seed registry. Forever is pre-launch, so its BiS data is modelled/provisional; these are community WoWSims
 * forks that publish Forever (level 60) gear sets. Specs/sets are filled in over time — a source with no sets for a
 * spec simply yields nothing for it. Operators add sources here (or a future admin UI writes to the same shape).
 */
export const BIS_TEMPLATE_SOURCES: BisTemplateSource[] = [
  {
    key: "forever-sim-gunba",
    name: "WoW Forever Sim (gunba)",
    url: "https://github.com/gunba/wow-forever-sim",
    adapter: "wowsims",
    enabled: true,
    gameVersions: ["forever"],
    wowsims: { owner: "gunba", repo: "wow-forever-sim", branch: "forever", specs: [] },
  },
];

/**
 * The sources to offer for a version. Starts from the registry filtered by `gameVersions`, then applies the
 * operator's choice: when `enabledKeys` is given (e.g. from a `BIS_SOURCES_ENABLED` env list), only those keys are
 * shown; otherwise each source's own `enabled` flag decides. This is how "configure which sources to show" works.
 */
export function enabledTemplateSources(
  version: string,
  enabledKeys?: readonly string[],
  sources: readonly BisTemplateSource[] = BIS_TEMPLATE_SOURCES,
): BisTemplateSource[] {
  const allow = enabledKeys ? new Set(enabledKeys) : null;
  return sources.filter((s) => s.gameVersions.includes(version) && (allow ? allow.has(s.key) : s.enabled));
}

/** Raw shape of a WoWSims gear-set JSON file. Only `id` is needed; `enchant`/other fields are ignored. */
interface WowsimsGearSetJson {
  items?: ({ id?: number } | null)[];
}

/**
 * Maps a WoWSims gear-set JSON to our `{ slot, itemId }` list by array position (WoWSims has no slot field). Empty
 * slots (no `id`) are skipped but still consume their position, so a set that includes placeholders for unused
 * slots stays aligned. Positions beyond the 17 known slots, and non-positive ids, are ignored.
 */
export function parseWowsimsGearSet(json: unknown): { slot: string; itemId: number }[] {
  const items = (json as WowsimsGearSetJson | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: { slot: string; itemId: number }[] = [];
  for (let i = 0; i < items.length && i < WOWSIMS_GEAR_SLOT_ORDER.length; i++) {
    const id = items[i]?.id;
    if (typeof id === "number" && id > 0) out.push({ slot: WOWSIMS_GEAR_SLOT_ORDER[i]!, itemId: id });
  }
  return out;
}
