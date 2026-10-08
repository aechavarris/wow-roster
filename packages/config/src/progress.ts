import { z } from "zod";
import type { Localized } from "./schema";

/**
 * Character progress events a roster can announce to a Discord channel (via webhook). The catalog is the same for
 * every game version; events whose data a version's API does not provide simply never fire. Each webhook picks the
 * subset it announces, so this list is the source of truth for both API validation and the settings UI labels.
 */
export interface ProgressEventDef {
  key: string;
  name: Localized;
  description: Localized;
}

export const PROGRESS_EVENTS: ProgressEventDef[] = [
  {
    key: "level_up",
    name: { en: "Level up", es: "Subir de nivel" },
    description: { en: "The character reached a new level.", es: "El personaje alcanzó un nuevo nivel." },
  },
  {
    key: "max_level",
    name: { en: "Max level", es: "Nivel máximo" },
    description: { en: "The character reached the version's level cap.", es: "El personaje llegó al nivel máximo de la versión." },
  },
  {
    key: "item_level",
    name: { en: "Item level", es: "Nivel de objeto" },
    description: { en: "The equipped item level went up.", es: "Subió el nivel de objeto equipado." },
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
    description: { en: "A new best Mythic+ key level this season.", es: "Nueva mejor llave Mítica+ de la temporada." },
  },
  {
    key: "mythic_rating",
    name: { en: "Mythic+ rating", es: "Puntuación M+" },
    description: { en: "The Mythic+ rating went up.", es: "Subió la puntuación de Mítica+." },
  },
  {
    key: "profession",
    name: { en: "Profession", es: "Profesión" },
    description: { en: "A profession was learned or leveled up.", es: "Se aprendió o subió una profesión." },
  },
  {
    key: "reputation",
    name: { en: "Reputation", es: "Reputación" },
    description: { en: "A new reputation standing was reached.", es: "Se alcanzó una nueva reputación." },
  },
];

export const PROGRESS_EVENT_KEYS = PROGRESS_EVENTS.map((e) => e.key);
const KEY_SET = new Set(PROGRESS_EVENT_KEYS);

/** A list of progress event keys, validated against the catalog. */
export const progressEventsSchema = z.array(z.string().refine((k) => KEY_SET.has(k), "unknown progress event")).max(PROGRESS_EVENT_KEYS.length);
export type ProgressEventKey = (typeof PROGRESS_EVENT_KEYS)[number];
