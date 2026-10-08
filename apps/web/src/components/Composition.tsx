"use client";

import { computeComposition, localize } from "@wow/config";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { className, classText, specName } from "@/lib/game";
import type { GameVersion, RosterPlayer } from "@/lib/types";

type Profile = GameVersion;

/**
 * Raid composition of the raiding players (their mains): roles, classes and which unique
 * buffs, debuffs and utilities are covered. The buff list comes from the game profile.
 */
export function Composition({ players, profile }: { players: RosterPlayer[]; profile: Profile }) {
  const t = useTranslations("composition");
  const locale = useLocale();
  const [includePlanned, setIncludePlanned] = useState(true);

  const [showText, setShowText] = useState(false);
  const [copied, setCopied] = useState(false);

  const raiders = useMemo(() => {
    const raiding = new Set(profile.rosterStatuses.filter((s) => s.raiding).map((s) => s.key));
    return players.map((p) => p.main).filter((c) => raiding.has(c.status) && (includePlanned || !c.planned));
  }, [players, profile, includePlanned]);

  const composition = useMemo(() => {
    const members = raiders
      .map((c) => ({ classId: c.classId, specKey: c.specKey, role: c.role, offRole: c.offRole, planned: c.planned }));
    return computeComposition(profile, members);
  }, [raiders, profile]);

  /**
   * The composition as plain text for Discord or an in-game note: addons will be restricted in Forever, so nothing
   * here depends on one. One line per role with each raider's spec and off-spec, then the buffs nobody brings.
   */
  const text = useMemo(() => {
    const describe = (c: (typeof raiders)[number]) => {
      const spec = [specName(profile, c.classId, c.specKey, locale), className(profile, c.classId, locale)].filter(Boolean).join(" ");
      const off = c.offSpecKey ? `, ${t("offSpecShort")} ${specName(profile, c.classId, c.offSpecKey, locale)}` : "";
      return `${c.name}${c.planned ? "*" : ""} (${spec}${off})`;
    };
    const lines = profile.roles.map((r) => {
      const inRole = raiders.filter((c) => c.role === r.key).sort((a, b) => a.name.localeCompare(b.name));
      return `${localize(r.name, locale)} (${inRole.length}): ${inRole.map(describe).join(", ") || "—"}`;
    });
    const missing = composition.buffs.filter((b) => b.providers === 0).map((b) => localize(b.buff.name, locale));
    if (missing.length > 0) lines.push(`${t("missingList")}: ${missing.join(", ")}`);
    if (composition.planned > 0) lines.push(`* ${t("plannedMark")}`);
    return [t("raiders", { count: composition.total }), ...lines].join("\n");
  }, [raiders, composition, profile, locale, t]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied: the text stays visible to copy by hand.
      setShowText(true);
    }
  }

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
          <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setShowText((v) => !v)} aria-expanded={showText}>
            {t("asText")}
          </button>
          {hasPlanned && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includePlanned} onChange={(e) => setIncludePlanned(e.target.checked)} />
              {t("includePlanned")}
            </label>
          )}
        </div>
      </div>

      {showText && (
        <div className="space-y-2">
          <textarea readOnly value={text} rows={Math.min(12, text.split("\n").length + 1)} aria-label={t("asText")} className="input w-full font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-primary px-3 py-1 text-sm" onClick={copy}>
            {copied ? t("copied") : t("copy")}
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          <ul className="space-y-1.5 text-sm">
            {profile.roles.map((r) => {
              const count = composition.byRole[r.key] ?? 0;
              const flex = composition.flexByRole[r.key] ?? 0;
              const share = composition.total > 0 ? (count / composition.total) * 100 : 0;
              return (
                <li key={r.key}>
                  <div className="flex justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                      {localize(r.name, locale)}
                    </span>
                    <span className="tabular-nums">
                      <strong>{count}</strong>
                      {flex > 0 && (
                        <span className="text-xs text-muted" title={t("offSpecFlex", { count: flex })}>
                          {" "}+{flex}
                        </span>
                      )}
                    </span>
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
