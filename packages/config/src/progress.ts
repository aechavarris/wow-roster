import { z } from "zod";
import type { GameProfile, Localized } from "./schema";

/**
 * Character progress events a roster can announce to a Discord channel (via webhook). Sync detects every raw
 * transition (level 58 → 61, Honored → Revered…); each webhook then keeps the ones its settings ask for (every 10
 * levels, keys from +10…). This file is the source of truth for the catalog, the settings schema and that filter,
 * shared by the API (validation), the worker (announcements) and the settings UI.
 */
export interface ProgressEventDef {
  key: string;
  name: Localized;
  description: Localized;
}

export const PROGRESS_EVENTS: ProgressEventDef[] = [
  {
    key: "level_up",
    name: { en: "Level", es: "Nivel" },
    description: { en: "The character reached a configured level, or the level cap.", es: "El personaje alcanzó un nivel configurado o el nivel máximo." },
  },
  {
    key: "item_level",
    name: { en: "Item level", es: "Nivel de objeto" },
    description: { en: "The equipped item level reached a configured value.", es: "El nivel de objeto equipado alcanzó un valor configurado." },
  },
  {
    key: "raid_boss",
    name: { en: "Raid boss", es: "Jefe de banda" },
    description: { en: "A raid boss was killed for the first time.", es: "Se derrotó por primera vez a un jefe de banda." },
  },
  {
    key: "raid_cleared",
    name: { en: "Raid cleared", es: "Banda completada" },
    description: { en: "A raid was cleared fully.", es: "Se completó una banda al 100%." },
  },
  {
    key: "mythic_plus",
    name: { en: "Best Mythic+ key", es: "Mejor llave M+" },
    description: { en: "A new best Mythic+ key this season, from the configured level.", es: "Nueva mejor llave Mítica+ de la temporada, a partir del nivel configurado." },
  },
  {
    key: "mythic_rating",
    name: { en: "Mythic+ rating", es: "Puntuación M+" },
    description: { en: "The Mythic+ rating reached a configured value.", es: "La puntuación de Mítica+ alcanzó un valor configurado." },
  },
  {
    key: "profession",
    name: { en: "Profession", es: "Profesión" },
    description: { en: "A selected profession was learned or reached a configured skill.", es: "Una profesión elegida se aprendió o alcanzó una habilidad configurada." },
  },
  {
    key: "reputation",
    name: { en: "Reputation", es: "Reputación" },
    description: { en: "A faction reached a selected standing or renown level.", es: "Una facción alcanzó un nivel de reputación o de renombre elegido." },
  },
];

export const PROGRESS_EVENT_KEYS = PROGRESS_EVENTS.map((e) => e.key);
const KEY_SET = new Set(PROGRESS_EVENT_KEYS);

/** A list of progress event keys, validated against the catalog. */
export const progressEventsSchema = z.array(z.string().refine((k) => KEY_SET.has(k), "unknown progress event")).max(PROGRESS_EVENT_KEYS.length);
export type ProgressEventKey = (typeof PROGRESS_EVENT_KEYS)[number];

/**
 * A raw progress transition found by comparing two syncs. `from` is the previous value (0 for something new, like
 * a profession just learned) and `value` the new one, so thresholds can tell whether a boundary was crossed.
 */
export interface ProgressEvent {
  type: ProgressEventKey;
  /** Main subject (zone, faction, profession). */
  title?: Localized;
  /** Secondary subject (boss within a raid, reputation standing). */
  subtitle?: Localized;
  value?: number;
  from?: number;
  /** Profession events: which profession and its skill cap. */
  professionId?: number;
  cap?: number;
  /** Reputation events: which ladder the faction is on and, for the standard ladder, the standing reached. */
  reputation?: { kind: "standard" | "friendship" | "renown"; standingKey?: string };
}

/** "Every N" and/or a list of exact values. Empty both ways means nothing is announced for that rule. */
const thresholdShape = {
  every: z.number().int().min(1).max(100_000).nullable().default(null),
  at: z.array(z.number().int().min(0).max(100_000)).max(30).default([]),
};
export const thresholdSchema = z.object(thresholdShape);
export type Threshold = z.infer<typeof thresholdSchema>;

/**
 * Per-webhook announcement settings. Every block has defaults, so webhooks created before a block existed (or with
 * no settings at all) keep a sensible behaviour; `prefault` runs the inner defaults on missing blocks.
 */
export const progressSettingsSchema = z.object({
  level: z.object({ ...thresholdShape, atMax: z.boolean().default(true) }).prefault({ every: 10 }),
  itemLevel: z.object(thresholdShape).prefault({ every: 10 }),
  mythicRating: z.object(thresholdShape).prefault({ every: 250 }),
  mythicPlus: z.object({ minKey: z.number().int().min(2).max(40).default(10) }).prefault({}),
  profession: z
    .object({
      ...thresholdShape,
      /** Profession keys of the version; null means the default set (primary, non-gathering). */
      professions: z.array(z.string().max(40)).max(40).nullable().default(null),
      atMax: z.boolean().default(true),
      onLearn: z.boolean().default(false),
    })
    .prefault({}),
  reputation: z
    .object({
      /** Standard-ladder standing keys (see the version's `reputation.standings`). */
      standings: z.array(z.string().max(40)).max(20).default(["honored", "revered", "exalted"]),
      renown: z.object(thresholdShape).prefault({ every: 5 }),
      friendship: z.boolean().default(false),
    })
    .prefault({}),
});
export type ProgressSettings = z.infer<typeof progressSettingsSchema>;

export const defaultProgressSettings = (): ProgressSettings => progressSettingsSchema.parse({});

/** Reads stored settings leniently: anything invalid falls back to the defaults instead of breaking announcements. */
export function readProgressSettings(raw: unknown): ProgressSettings {
  const parsed = progressSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : defaultProgressSettings();
}

/** True when going from `from` to `to` reaches a configured value: a multiple of `every` or one of `at`. */
export function crossesThreshold(from: number, to: number, rule: Threshold): boolean {
  if (!(to > from)) return false;
  if (rule.every && Math.floor(to / rule.every) > Math.floor(from / rule.every)) return true;
  return rule.at.some((v) => v > from && v <= to);
}

/** Professions announced when a webhook leaves the choice at its default: primary crafting ones. */
export function defaultProgressProfessions(profile: { professions: { key: string; kind: string; gathering?: boolean }[] }): string[] {
  return profile.professions.filter((p) => p.kind === "primary" && !p.gathering).map((p) => p.key);
}

/** Progress events a version can produce, given which data its API (or Warcraft Logs) provides. */
export function availableProgressEvents(profile: Pick<GameProfile, "api" | "professions">): ProgressEventKey[] {
  const endpoints = new Set(profile.api.available ? profile.api.characterEndpoints : []);
  const raids = endpoints.has("raids") || endpoints.has("encounterStatistics") || Boolean(profile.api.warcraftLogs);
  return PROGRESS_EVENT_KEYS.filter((key) => {
    switch (key) {
      case "raid_boss":
      case "raid_cleared":
        return raids;
      case "mythic_plus":
      case "mythic_rating":
        return endpoints.has("mythicPlus");
      case "profession":
        return profile.professions.length > 0;
      case "reputation":
        return endpoints.has("reputations");
      default:
        return true;
    }
  });
}

/** Keeps the events a webhook's settings ask for. The event type itself must also be enabled on the webhook. */
export function selectProgressEvents(
  profile: Pick<GameProfile, "maxLevel" | "professions">,
  settings: ProgressSettings,
  events: ProgressEvent[],
): ProgressEvent[] {
  const professionKeys = new Set(settings.profession.professions ?? defaultProgressProfessions(profile));
  return events.filter((event) => {
    const from = event.from ?? 0;
    const value = event.value ?? 0;
    switch (event.type) {
      case "level_up":
        return (
          crossesThreshold(from, value, settings.level) ||
          (settings.level.atMax && value >= profile.maxLevel && from < profile.maxLevel)
        );
      case "item_level":
        return crossesThreshold(from, value, settings.itemLevel);
      case "mythic_rating":
        return crossesThreshold(from, value, settings.mythicRating);
      case "mythic_plus":
        return value >= settings.mythicPlus.minKey;
      case "profession": {
        const key = profile.professions.find((p) => p.id === event.professionId)?.key;
        if (!key || !professionKeys.has(key)) return false;
        const p = settings.profession;
        const cap = event.cap ?? 0;
        return (
          (p.onLearn && from === 0 && value > 0) ||
          crossesThreshold(from, value, p) ||
          (p.atMax && cap > 0 && value >= cap && from < cap)
        );
      }
      case "reputation": {
        const rep = event.reputation;
        if (rep?.kind === "standard") return rep.standingKey !== undefined && settings.reputation.standings.includes(rep.standingKey);
        if (rep?.kind === "renown") return crossesThreshold(from, value, settings.reputation.renown);
        if (rep?.kind === "friendship") return settings.reputation.friendship;
        return false;
      }
      default:
        return true;
    }
  });
}
