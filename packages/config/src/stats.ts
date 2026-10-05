import type { Localized, StatSection } from "./schema";

/** Same shape as the stored character statistics (see @wow/blizzard StatValue). */
type RawStat = number | { base?: number; effective?: number; value?: number; rating?: number; ratingBonus?: number };

export interface StatRow {
  key: string;
  label: Localized;
  value: number;
  format: "number" | "percent";
  /** Rating behind a percentage, shown in the row tooltip like the game does. */
  rating?: number;
  /** Base value when gear/buffs change it (e.g. strength 617 → 641). */
  base?: number;
}

export interface StatPanelSection {
  key: string;
  name: Localized;
  rows: StatRow[];
}

function valueOf(stat: RawStat | undefined): number | undefined {
  if (stat === undefined) return undefined;
  if (typeof stat === "number") return stat;
  return stat.effective ?? stat.value;
}

/**
 * Lays out a character's statistics following the game profile's panel definition.
 * Rows whose stats the API did not return are skipped, so one panel works across game versions.
 */
export function computeStatPanel(sections: StatSection[], stats: Record<string, RawStat>): StatPanelSection[] {
  return sections
    .map((section) => {
      const rows: StatRow[] = [];
      for (const entry of section.entries) {
        const candidates = entry.stats
          .map((key) => ({ key, value: valueOf(stats[key]), raw: stats[key] }))
          .filter((c): c is { key: string; value: number; raw: RawStat } => c.value !== undefined);
        if (candidates.length === 0) continue;
        const best = candidates.reduce((a, b) => (b.value > a.value ? b : a));
        if (entry.hideIfZero && best.value === 0) continue;
        const raw = typeof best.raw === "object" ? best.raw : undefined;
        const ratingSource = entry.ratingStat ? stats[entry.ratingStat] : undefined;
        const rating = ratingSource !== undefined ? valueOf(ratingSource) : raw?.rating;
        rows.push({
          key: entry.key,
          label: entry.labels?.[best.key] ?? entry.label,
          value: best.value,
          format: entry.format,
          rating: rating || undefined,
          base: raw?.base && raw.base !== raw.effective ? raw.base : undefined,
        });
      }
      return { key: section.key, name: section.name, rows };
    })
    .filter((section) => section.rows.length > 0);
}
