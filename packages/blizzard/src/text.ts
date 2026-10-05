/** Localized text keyed by UI locale ("en", "es"), extracted from Blizzard's multi-locale responses. */
export type LocalizedText = Record<string, string>;

/** UI locale -> Blizzard locale used to pick strings from multi-locale responses. */
export const BLIZZARD_LOCALES: Record<string, string> = { en: "en_US", es: "es_ES" };

/**
 * Removes WoW client escape sequences from display strings:
 * colors (|cffRRGGBB…|r), atlas and texture icons (|A…|a, |T…|t), hyperlinks (|H…|h) and CRLF.
 */
export function cleanWowText(value: string): string {
  return value
    .replace(/\|c[0-9a-fA-F]{8}/g, "")
    .replace(/\|r/g, "")
    .replace(/\|A[^|]*\|a/g, "")
    .replace(/\|T[^|]*\|t/g, "")
    .replace(/\|H[^|]*\|h/g, "")
    .replace(/\|h/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * Normalizes a Blizzard string field into LocalizedText. Responses requested without a
 * locale contain every locale ({ en_US, es_ES, … }); single-locale strings are stored under "en".
 */
export function localized(value: unknown): LocalizedText | undefined {
  if (typeof value === "string") return value ? { en: cleanWowText(value) } : undefined;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const result: LocalizedText = {};
  for (const [ui, blizzard] of Object.entries(BLIZZARD_LOCALES)) {
    const text = record[blizzard];
    if (typeof text === "string" && text) result[ui] = cleanWowText(text);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Merges per-locale strings fetched in separate requests into one LocalizedText. */
export function mergeLocalized(parts: Record<string, string | undefined>): LocalizedText | undefined {
  const result: LocalizedText = {};
  for (const [locale, text] of Object.entries(parts)) if (text) result[locale] = cleanWowText(text);
  return Object.keys(result).length > 0 ? result : undefined;
}

export function rgbToHex(color: unknown): string | undefined {
  if (!color || typeof color !== "object") return undefined;
  const { r, g, b } = color as { r?: number; g?: number; b?: number };
  if (r === undefined || g === undefined || b === undefined) return undefined;
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}
