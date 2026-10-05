"use client";

import { computeComposition, localize } from "@wow/config";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { classText } from "@/lib/game";
import type { PublicConfig, RosterPlayer } from "@/lib/types";

type Profile = PublicConfig["profile"];

/**
 * Raid composition of the raiding players (their mains): roles, classes and which unique
 * buffs, debuffs and utilities are covered. The buff list comes from the game profile.
 */
export function Composition({ players, profile }: { players: RosterPlayer[]; profile: Profile }) {
  const t = useTranslations("composition");
  const locale = useLocale();
  const [includePlanned, setIncludePlanned] = useState(true);

  const composition = useMemo(() => {
    const raiding = new Set(profile.rosterStatuses.filter((s) => s.raiding).map((s) => s.key));
    const members = players
      .map((p) => p.main)
      .filter((c) => raiding.has(c.status) && (includePlanned || !c.planned))
      .map((c) => ({ classId: c.classId, specKey: c.specKey, role: c.role, planned: c.planned }));
    return computeComposition(profile, members);
  }, [players, profile, includePlanned]);

  const categories = (["buff", "debuff", "utility"] as const)
    .map((category) => ({ category, items: composition.buffs.filter((b) => b.buff.category === category) }))
    .filter((c) => c.items.length > 0);
  const hasPlanned = players.some((p) => p.main.planned || p.alts.some((a) => a.planned));

  return (
    <section className="card space-y-4" aria-labelledby="composition-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="composition-title" className="heading text-lg">
          {t("title")}
        </h2>
        <div className="flex items-center gap-4 text-sm">
          <span>
            <strong>{t("raiders", { count: composition.total })}</strong>
            {composition.planned > 0 && <span className="text-muted"> · {t("plannedCount", { count: composition.planned })}</span>}
          </span>
          {hasPlanned && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includePlanned} onChange={(e) => setIncludePlanned(e.target.checked)} />
              {t("includePlanned")}
            </label>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          <ul className="space-y-1.5 text-sm">
            {profile.roles.map((r) => {
              const count = composition.byRole[r.key] ?? 0;
              const share = composition.total > 0 ? (count / composition.total) * 100 : 0;
              return (
                <li key={r.key}>
                  <div className="flex justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                      {localize(r.name, locale)}
                    </span>
                    <strong className="tabular-nums">{count}</strong>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded bg-border">
                    <div className="h-1.5 rounded" style={{ width: `${share}%`, background: r.color }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <ul className="flex flex-wrap gap-1.5">
            {profile.classes.map((c) => {
              const count = composition.byClass[c.id] ?? 0;
              return (
                <li
                  key={c.id}
                  className={`badge text-class border ${count > 0 ? "border-transparent bg-surface-2" : "border-border opacity-40"}`}
                  style={classText(c.color)}
                >
                  {localize(c.name, locale)} {count}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {categories.map(({ category, items }) => (
            <div key={category}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t(`categories.${category}`)}</h3>
              <ul className="space-y-0.5 text-sm">
                {items.map(({ buff, providers, planned }) => (
                  <li key={buff.key} className="flex items-center justify-between gap-2" title={buff.note}>
                    <span className={`flex min-w-0 items-center gap-1.5 ${providers === 0 ? "text-muted" : ""}`}>
                      <span aria-hidden="true" className={providers > 0 ? "text-success" : "text-danger"}>
                        {providers > 0 ? "✓" : "✗"}
                      </span>
                      <span className="truncate">{localize(buff.name, locale)}</span>
                      <span className="sr-only">{providers > 0 ? t("covered") : t("missing")}</span>
                    </span>
                    {providers > 0 && (
                      <span className="shrink-0 text-xs tabular-nums text-muted" title={planned > 0 ? t("plannedProviders", { count: planned }) : undefined}>
                        ×{providers}
                        {planned > 0 && "*"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      {composition.planned > 0 && <p className="text-xs text-muted">{t("plannedFootnote")}</p>}
    </section>
  );
}
