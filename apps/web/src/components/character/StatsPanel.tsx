import { useFormatter, useTranslations } from "next-intl";
import { Unavailable } from "./Unavailable";

/** Known stats come first in this order; anything else the API returns is listed after them. */
const ORDER = [
  "health", "power", "strength", "agility", "intellect", "stamina", "spirit", "armor",
  "attack_power", "spell_power", "melee_crit", "ranged_crit", "spell_crit", "melee_haste", "spell_haste",
  "mastery", "versatility", "dodge", "parry", "block", "defense",
];

const humanize = (key: string) => key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function StatsPanel({ stats, missing }: { stats?: Record<string, number>; missing?: string }) {
  const t = useTranslations("character");
  const tStats = useTranslations("stats");
  const format = useFormatter();
  const entries = Object.entries(stats ?? {}).sort(([a], [b]) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
  });

  return (
    <section className="card">
      <h2 className="heading mb-3 text-lg">{t("stats")}</h2>
      {!stats ? (
        <Unavailable reason={missing} />
      ) : (
        <dl className="grid gap-y-1 text-sm">
          {entries.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-2 border-b border-border/50 py-0.5">
              <dt className="truncate text-muted">{tStats.has(key) ? tStats(key) : humanize(key)}</dt>
              <dd className="tabular-nums">{format.number(value, { maximumFractionDigits: 2 })}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
