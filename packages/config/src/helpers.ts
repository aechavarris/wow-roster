import type { GameClass, GameProfile, GameSpec, Localized } from "./schema";

export const SUPPORTED_LOCALES = ["es", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

export const REGIONS = ["eu", "us", "kr", "tw"] as const;
export type Region = (typeof REGIONS)[number];

export function localize(text: Localized | undefined, locale: string): string {
  if (!text) return "";
  return text[locale] ?? text.en ?? Object.values(text)[0] ?? "";
}

type WithClasses = Pick<GameProfile, "classes">;

export function findClass(profile: WithClasses, classId: number | null | undefined): GameClass | undefined {
  if (classId == null) return undefined;
  return profile.classes.find((c) => c.id === classId);
}

/** Finds a spec by Blizzard id first, then by English name, inside the character's class. */
export function resolveSpec(
  profile: WithClasses,
  classId: number | null | undefined,
  spec: { id?: number | null; name?: string | null },
): GameSpec | undefined {
  const gameClass = findClass(profile, classId);
  if (!gameClass) return undefined;
  if (spec.id != null) {
    const byId = gameClass.specs.find((s) => s.blizzardIds.includes(spec.id!));
    if (byId) return byId;
  }
  if (spec.name) {
    const name = spec.name.toLowerCase();
    return gameClass.specs.find((s) => s.apiNames.some((n) => n.toLowerCase() === name));
  }
  return undefined;
}

export function defaultRoleForSpec(spec: GameSpec | undefined): string | undefined {
  return spec?.roles[0];
}

export function enabledRaidSizes(profile: Pick<GameProfile, "raidSizes">) {
  return profile.raidSizes.filter((r) => r.enabled);
}

/** Slug used by Blizzard for realms and guild names: lowercase, spaces to dashes, no apostrophes. */
export function blizzardSlug(value: string): string {
  return value.trim().toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "-");
}
