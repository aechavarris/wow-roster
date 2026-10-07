import { findClass, localize, type GameClass } from "@wow/config";
import type { CSSProperties } from "react";
import type { GameVersion, PublicConfig } from "./types";

type Profile = GameVersion;

/** The rules of a game version, or of the default one for missing or unknown ids. */
export function versionOf(config: PublicConfig, id: string | null | undefined): GameVersion {
  return config.versions.find((v) => v.id === id) ?? config.versions.find((v) => v.id === config.defaultVersion)!;
}

export function classOf(profile: Profile, classId: number | null | undefined): GameClass | undefined {
  return findClass(profile, classId);
}

export function className(profile: Profile, classId: number | null | undefined, locale: string) {
  return localize(classOf(profile, classId)?.name, locale) || "?";
}

export function classColor(profile: Profile, classId: number | null | undefined) {
  return classOf(profile, classId)?.color ?? "var(--muted)";
}

/** Style for text in a class color; pair it with the `text-class` utility so it stays readable in the light theme. */
export const classText = (color: string) => ({ "--class-color": color }) as CSSProperties;

export function specName(profile: Profile, classId: number | null | undefined, specKey: string | null, locale: string) {
  if (!specKey) return "";
  const spec = classOf(profile, classId)?.specs.find((s) => s.key === specKey);
  return spec ? localize(spec.name, locale) : specKey;
}

export function roleOf(profile: Profile, key: string | null) {
  return profile.roles.find((r) => r.key === key);
}

export function statusOf(profile: Profile, key: string) {
  return profile.rosterStatuses.find((s) => s.key === key);
}

export function characterPath(c: { gameVersion: string; region: string; realm: string; name: string }) {
  return `/character/${c.gameVersion}/${c.region}/${encodeURIComponent(c.realm)}/${encodeURIComponent(c.name.toLowerCase())}`;
}

/** Exact in-game quality colors, used inside the always-dark game tooltips and icon frames. */
export const GAME_QUALITY_COLORS: Record<string, string> = {
  POOR: "#9d9d9d",
  COMMON: "#ffffff",
  UNCOMMON: "#1eff00",
  RARE: "#0070dd",
  EPIC: "#a335ee",
  LEGENDARY: "#ff8000",
  ARTIFACT: "#e6cc80",
  HEIRLOOM: "#00ccff",
};

/** Theme-aware quality colors for text on the page background. */
export const QUALITY_COLORS: Record<string, string> = {
  POOR: "var(--q-poor)",
  COMMON: "var(--q-common)",
  UNCOMMON: "var(--q-uncommon)",
  RARE: "var(--q-rare)",
  EPIC: "var(--q-epic)",
  LEGENDARY: "var(--q-legendary)",
  ARTIFACT: "var(--q-artifact)",
  HEIRLOOM: "var(--q-heirloom)",
};

/**
 * Wowhead page of an item in the game version's database ("" for retail, "classic", "tbc"…), in the
 * UI language, with the bonus ids so the upgrade level and stats match what the character wears.
 */
export function wowheadItemUrl(profile: { wowheadDomain: string }, locale: string, item: { itemId: number; bonusIds?: number[] }) {
  const path = [profile.wowheadDomain, locale === "en" ? "" : locale].filter(Boolean).join("/");
  const bonus = item.bonusIds && item.bonusIds.length > 0 ? `?bonus=${item.bonusIds.join(":")}` : "";
  return `https://www.wowhead.com/${path ? `${path}/` : ""}item=${item.itemId}${bonus}`;
}
