/**
 * Picks the visitor's language from a localized API string. Older synced data stored
 * plain strings, which are returned as they are.
 */
export function tr(value: Record<string, string> | string | undefined | null, locale: string): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[locale] ?? value.en ?? Object.values(value)[0] ?? "";
}
