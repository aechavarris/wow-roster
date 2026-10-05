import type { Profession, Reputation } from "@wow/blizzard";
import { useLocale, useTranslations } from "next-intl";
import { tr } from "@/lib/text";
import { Unavailable } from "./Unavailable";

export function ProfessionsPanel({ professions, missing }: { professions?: Profession[]; missing?: string }) {
  const t = useTranslations("character");
  const locale = useLocale();
  return (
    <section className="card">
      <h2 className="heading mb-3 text-lg">{t("professions")}</h2>
      {!professions ? (
        <Unavailable reason={missing} />
      ) : professions.length === 0 ? (
        <p className="text-sm text-muted">{t("none")}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {professions.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              {p.icon ? (
                // eslint-disable-next-line @next/next/no-img-element -- Blizzard icon CDN, already sized.
                <img src={p.icon} alt="" width={32} height={32} className="icon-frame h-8 w-8" />
              ) : (
                <span className="icon-frame h-8 w-8" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2">
                  <span className={p.secondary ? "text-muted" : "font-medium"}>{tr(p.name, locale)}</span>
                  {p.skill != null && (
                    <span className="tabular-nums text-muted">
                      {p.skill}/{p.maxSkill ?? "?"}
                    </span>
                  )}
                </div>
                {p.skill != null && p.maxSkill ? (
                  <div className="mt-1 h-1.5 rounded bg-border">
                    <div className="h-1.5 rounded bg-accent" style={{ width: `${Math.min(100, (p.skill / p.maxSkill) * 100)}%` }} />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReputationsPanel({ reputations, missing }: { reputations?: Reputation[]; missing?: string }) {
  const t = useTranslations("character");
  const locale = useLocale();
  const sorted = [...(reputations ?? [])].sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0) || tr(a.name, locale).localeCompare(tr(b.name, locale)));
  const preview = sorted.slice(0, 8);
  const rest = sorted.slice(8);

  const row = (r: Reputation) => (
    <li key={r.factionId} className="flex justify-between gap-2">
      <span className="truncate">{tr(r.name, locale)}</span>
      <span className="shrink-0 text-muted">{tr(r.standing, locale)}</span>
    </li>
  );

  return (
    <section className="card">
      <h2 className="heading mb-3 text-lg">{t("reputations")}</h2>
      {!reputations ? (
        <Unavailable reason={missing} />
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted">{t("none")}</p>
      ) : (
        <>
          <ul className="space-y-1 text-sm">{preview.map(row)}</ul>
          {rest.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-muted hover:text-accent">{t("showAll", { count: sorted.length })}</summary>
              <ul className="mt-1 space-y-1">{rest.map(row)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
