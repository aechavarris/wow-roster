"use client";

import type { StatValue } from "@wow/blizzard";
import { computeStatPanel, type StatSection } from "@wow/config";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { tr } from "@/lib/text";
import { GameTooltip } from "../ui/GameTooltip";
import { Unavailable } from "./Unavailable";

/** Power bar colors by Blizzard power type id, as the unit frames show them. */
const POWER_COLORS: Record<number, string> = {
  0: "#2f6fd6", // mana
  1: "#c42b2b", // rage
  2: "#d9822b", // focus
  3: "#e8d24a", // energy
  6: "#00c3ff", // runic power
  8: "#3f8cff", // astral power
  11: "#2f6fd6", // maelstrom
  13: "#9b59ff", // insanity
  17: "#a34fd6", // fury
  18: "#a34fd6", // pain
};

interface Props {
  stats?: Record<string, StatValue>;
  missing?: string;
  panel: StatSection[];
  itemLevel?: number | null;
}

/** Character sheet stats in the game's layout and order, as defined by the game profile. */
export function StatsPanel({ stats, missing, panel, itemLevel }: Props) {
  const t = useTranslations("character");
  const locale = useLocale();
  const format = useFormatter();
  const number = (value: number, digits = 0) => format.number(value, { maximumFractionDigits: digits });

  if (!stats) {
    return (
      <section className="card">
        <h2 className="heading mb-3 text-lg">{t("stats")}</h2>
        <Unavailable reason={missing} />
      </section>
    );
  }

  const sections = computeStatPanel(panel, stats);
  const health = typeof stats.health === "number" ? stats.health : undefined;
  const power = typeof stats.power === "number" ? stats.power : undefined;
  const powerType = typeof stats.power_type_id === "number" ? stats.power_type_id : undefined;

  return (
    <section className="card space-y-4">
      <h2 className="heading text-lg">{t("stats")}</h2>
      {itemLevel != null && (
        <div className="rounded-md border border-border bg-surface-2 py-2 text-center">
          <p className="text-xs uppercase tracking-widest text-muted">{t("itemLevel")}</p>
          <p className="heading text-3xl text-[#a335ee] tabular-nums">{number(itemLevel, 1)}</p>
        </div>
      )}
      {(health !== undefined || power !== undefined) && (
        <div className="space-y-1">
          {health !== undefined && <Bar label={t("health")} value={number(health)} color="#2fa84f" />}
          {power !== undefined && power > 0 && (
            <Bar label={t("power")} value={number(power)} color={POWER_COLORS[powerType ?? 0] ?? "#2f6fd6"} />
          )}
        </div>
      )}
      {sections.map((section) => (
        <div key={section.key}>
          <h3 className="mb-1 border-b border-accent/40 pb-1 text-center text-sm font-semibold uppercase tracking-wider text-accent">
            {tr(section.name, locale)}
          </h3>
          <ul className="divide-y divide-border/40 text-sm">
            {section.rows.map((row) => {
              const label = tr(row.label, locale);
              const value = row.format === "percent" ? `${number(row.value, 2)}%` : number(row.value);
              return (
                <li key={row.key}>
                  <GameTooltip
                    label={`${label}: ${value}`}
                    className="flex w-full justify-between gap-2 px-1 py-1 text-left hover:bg-white/5"
                    content={
                      <div>
                        <p className="font-semibold">
                          {label} {value}
                        </p>
                        {row.rating !== undefined && <p className="tt-yellow">{t("ratingLine", { value: number(row.rating) })}</p>}
                        {row.base !== undefined && <p className="tt-grey">{t("baseLine", { value: number(row.base) })}</p>}
                      </div>
                    }
                  >
                    <span className="text-muted">{label}</span>
                    <span className="font-medium tabular-nums">{value}</span>
                  </GameTooltip>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Bar({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      className="relative flex h-6 items-center justify-between rounded px-2 text-xs font-semibold text-white"
      style={{ background: `linear-gradient(180deg, ${color}, ${color}bb)`, textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
