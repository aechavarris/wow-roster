"use client";

import type { TalentSetup } from "@wow/blizzard";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { wowheadUrl } from "@/lib/game";
import { Unavailable } from "./Unavailable";
import { WowheadRefresh } from "../WowheadRefresh";

/** One tab per talent setup: dual-spec groups in Classic/Forever, spec loadouts in retail. */
export function TalentsPanel({ setups, missing, wowheadDomain }: { setups?: TalentSetup[]; missing?: string; wowheadDomain: string }) {
  const t = useTranslations("character");
  const [selected, setSelected] = useState(() => Math.max(0, setups?.findIndex((s) => s.active) ?? 0));
  const setup = setups?.[selected];

  return (
    <section className="card">
      <h2 className="heading mb-3 text-lg">{t("talents")}</h2>
      {!setups || setups.length === 0 ? (
        <Unavailable reason={missing} />
      ) : (
        <>
          <div role="tablist" className="mb-3 flex flex-wrap gap-2">
            {setups.map((s, i) => (
              <button
                key={i}
                role="tab"
                type="button"
                aria-selected={i === selected}
                onClick={() => setSelected(i)}
                className={`btn ${i === selected ? "border-accent text-accent" : ""}`}
              >
                {s.specName ?? t("setup", { number: i + 1 })}
                {s.trees.some((tree) => tree.points != null) && (
                  <span className="text-xs text-muted">{s.trees.map((tree) => tree.points ?? 0).join("/")}</span>
                )}
                {s.active && <span className="badge bg-accent text-accent-contrast">{t("active")}</span>}
              </button>
            ))}
          </div>
          {setup && (
            <div className="space-y-3">
              {setup.loadoutCode && (
                <div className="flex items-center gap-2">
                  <input readOnly value={setup.loadoutCode} className="input font-mono text-xs" aria-label={t("loadoutCode")} />
                  <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(setup.loadoutCode!)}>
                    {t("copy")}
                  </button>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                {setup.trees.map((tree) => (
                  <div key={tree.name} className="rounded-md border border-border bg-surface-2 p-2">
                    <h3 className="mb-1 flex justify-between text-sm font-semibold">
                      <span>{t.has(`trees.${tree.name}`) ? t(`trees.${tree.name}`) : tree.name}</span>
                      {tree.points != null && <span className="tabular-nums text-accent">{tree.points}</span>}
                    </h3>
                    {tree.talents.length === 0 ? (
                      <p className="text-xs text-muted">—</p>
                    ) : (
                      <ul className="space-y-0.5 text-xs">
                        {tree.talents.map((talent, i) => (
                          <li key={`${talent.id}-${i}`} className="flex justify-between gap-2">
                            {talent.spellId ? (
                              <a href={wowheadUrl(wowheadDomain, "spell", talent.spellId)} target="_blank" rel="noreferrer" className="truncate hover:text-accent">
                                {talent.name}
                              </a>
                            ) : (
                              <span className="truncate">{talent.name}</span>
                            )}
                            {talent.rank != null && <span className="tabular-nums text-muted">{talent.rank}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <WowheadRefresh deps={[selected]} />
        </>
      )}
    </section>
  );
}
