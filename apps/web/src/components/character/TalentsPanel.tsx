"use client";

import type { TalentSetup, TalentTreeLayout } from "@wow/blizzard";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { tr } from "@/lib/text";
import { GameTooltip } from "../ui/GameTooltip";
import { TalentTreeCanvas } from "./TalentTreeCanvas";
import { Unavailable } from "./Unavailable";

type LayoutState = { status: "loading" } | { status: "ready"; layout: TalentTreeLayout } | { status: "error" };

/** One tab per talent setup: spec loadouts in retail, dual-spec groups in Classic/Forever. */
export function TalentsPanel({ setups, missing, version, region }: { setups?: TalentSetup[]; missing?: string; version: string; region: string }) {
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
          <div role="tablist" className="mb-4 flex flex-wrap gap-2">
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
          {setup && (setup.treeId && setup.specId && setup.selected ? <RetailTrees setup={setup} version={version} region={region} /> : <ClassicTrees setup={setup} />)}
        </>
      )}
    </section>
  );
}

function RetailTrees({ setup, version, region }: { setup: TalentSetup; version: string; region: string }) {
  const t = useTranslations("character");
  const locale = useLocale();
  const [state, setState] = useState<LayoutState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/talent-trees/${version}/${region}/${setup.treeId}/${setup.specId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { layout: TalentTreeLayout }) => !cancelled && setState({ status: "ready", layout: data.layout }))
      .catch(() => !cancelled && setState({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, [version, region, setup.treeId, setup.specId]);

  const picks = useMemo(() => new Map((setup.selected ?? []).map((s) => [s.nodeId, s])), [setup.selected]);

  if (state.status === "loading") return <p className="text-sm text-muted">{t("loadingTalents")}</p>;
  if (state.status === "error") return <Unavailable />;

  const { layout } = state;
  const hero = layout.heroTrees.find((h) => h.id === setup.heroTreeId);
  return (
    <div className="space-y-4">
      {setup.loadoutCode && (
        <div className="flex items-center gap-2">
          <input readOnly value={setup.loadoutCode} className="input font-mono text-xs" aria-label={t("loadoutCode")} />
          <button type="button" className="btn shrink-0" onClick={() => navigator.clipboard.writeText(setup.loadoutCode!)}>
            {t("copy")}
          </button>
        </div>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <TalentTreeCanvas title={tr(layout.className, locale) || t("trees.class")} nodes={layout.classNodes} selected={picks} />
        {hero ? (
          <TalentTreeCanvas title={tr(hero.name, locale)} nodes={hero.nodes} selected={picks} />
        ) : (
          <div className="hidden xl:block" />
        )}
        <TalentTreeCanvas title={tr(layout.specName, locale) || t("trees.spec")} nodes={layout.specNodes} selected={picks} />
      </div>
    </div>
  );
}

/**
 * Classic-style APIs return the learned talents with descriptions but no tree layout or icons,
 * so each tree is listed with its points and talents (tooltips carry the descriptions).
 */
function ClassicTrees({ setup }: { setup: TalentSetup }) {
  const t = useTranslations("character");
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {setup.trees.map((tree) => (
        <div key={tree.name} className="rounded-md border border-border bg-surface-2 p-3">
          <h3 className="mb-2 flex justify-between text-sm font-semibold">
            <span>{t.has(`trees.${tree.name}`) ? t(`trees.${tree.name}`) : tree.name}</span>
            {tree.points != null && <span className="tabular-nums text-accent">{tree.points}</span>}
          </h3>
          {tree.talents.length === 0 ? (
            <p className="text-xs text-muted">—</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {tree.talents.map((talent, i) => (
                <li key={`${talent.id}-${i}`}>
                  <GameTooltip
                    label={talent.name}
                    className="flex w-full justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-white/5"
                    content={
                      <div>
                        <p className="font-semibold">{talent.name}</p>
                        {talent.rank != null && <p className="tt-green">{t("rank", { rank: talent.rank })}</p>}
                        {talent.description && <p className="tt-yellow">{talent.description}</p>}
                      </div>
                    }
                  >
                    <span className="truncate">{talent.name || `#${talent.id}`}</span>
                    {talent.rank != null && <span className="tabular-nums text-muted">{talent.rank}</span>}
                  </GameTooltip>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
