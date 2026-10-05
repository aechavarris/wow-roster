import { findClass, localize, type GameClass } from "@wow/config";
import type { PublicConfig } from "./types";

type Profile = PublicConfig["profile"];

export function classOf(profile: Profile, classId: number | null | undefined): GameClass | undefined {
  return findClass(profile, classId);
}

export function className(profile: Profile, classId: number | null | undefined, locale: string) {
  return localize(classOf(profile, classId)?.name, locale) || "?";
}

export function classColor(profile: Profile, classId: number | null | undefined) {
  return classOf(profile, classId)?.color ?? "var(--muted)";
}

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

export function characterPath(c: { region: string; realm: string; name: string }) {
  return `/character/${c.region}/${encodeURIComponent(c.realm)}/${encodeURIComponent(c.name.toLowerCase())}`;
}

export function wowheadUrl(domain: string, type: "item" | "spell", id: number) {
  return `https://www.wowhead.com/${domain ? `${domain}/` : ""}${type}=${id}`;
}

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
