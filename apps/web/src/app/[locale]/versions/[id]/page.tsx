import { localize } from "@wow/config";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { VersionBadge } from "@/components/VersionSelect";
import { Link } from "@/i18n/routing";
import { getConfig } from "@/lib/api";
import { classText } from "@/lib/game";
import type { DataSource } from "@/lib/types";

/** Colour of each confidence level: only Blizzard's own word is green. */
const SOURCE_CLASS: Record<DataSource, string> = {
  official: "border-success/60 text-success",
  reported: "border-warning/60 text-warning",
  datamined: "border-accent/60 text-accent",
  estimate: "border-border text-muted",
};

/**
 * What is known about a game version, from its profile: timeline, raids, dungeons, rules and the state of its API.
 * Made for Forever before launch, when details arrive piecemeal; each fact shows how sure it is.
 */
export default async function VersionPage({ params }: PageProps<"/[locale]/versions/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [t, format, config] = await Promise.all([getTranslations("versionInfo"), getFormatter(), getConfig()]);
  const version = config.versions.find((v) => v.id === id);
  if (!version) notFound();

  const day = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: "long", timeZone: "UTC" });
  const today = new Date().toISOString().slice(0, 10);
  const Source = ({ source }: { source?: DataSource }) =>
    source ? (
      <span className={`badge border ${SOURCE_CLASS[source]}`} title={t(`sourceHint.${source}`)}>
        {t(`source.${source}`)}
      </span>
    ) : null;
  const apiState = version.apiStandIn ? "standIn" : version.apiAvailable ? "available" : "missing";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link href="/" className="text-sm text-muted hover:text-accent">← {t("back")}</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="heading text-3xl">{version.label}</h1>
          <VersionBadge version={version} />
        </div>
        <p className="text-sm text-muted">{t("intro")}</p>
      </header>

      <section className="card space-y-2" aria-labelledby="api-title">
        <h2 id="api-title" className="heading text-lg">{t("apiTitle")}</h2>
        <p className="text-sm">
          {t(`api.${apiState}`, { source: version.apiStandIn ? localize(version.apiStandIn.name, locale) : "" })}
        </p>
        <p className="text-xs text-muted">{t("apiNext")}</p>
      </section>

      {version.timeline.length > 0 && (
        <section className="card" aria-labelledby="timeline-title">
          <h2 id="timeline-title" className="heading mb-3 text-lg">{t("timeline")}</h2>
          <ol className="space-y-2">
            {version.timeline.map((e) => {
              const past = Boolean(e.date && (e.endDate ?? e.date) < today);
              return (
                <li key={e.key} className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${past ? "opacity-60" : ""}`}>
                  <span className="w-full text-sm tabular-nums text-muted sm:w-48 sm:shrink-0">
                    {e.date ? (e.endDate ? `${day(e.date)} – ${day(e.endDate)}` : day(e.date)) : localize(e.period, locale)}
                  </span>
                  <span className="min-w-0 flex-1">{localize(e.name, locale)}</span>
                  <Source source={e.source} />
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card" aria-labelledby="raids-title">
          <h2 id="raids-title" className="heading mb-3 text-lg">{t("raids")}</h2>
          <ul className="divide-y divide-border">
            {version.raids.map((r) => (
              <li key={r.key} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${r.enabled ? "" : "opacity-60"}`}>
                <span className="min-w-0 basis-full font-medium sm:flex-1 sm:basis-0">{localize(r.name, locale)}</span>
                <span className="text-sm tabular-nums text-muted">
                  {t("players", { count: r.size })}
                  {r.bossCount ? ` · ${t("bosses", { count: r.bossCount })}` : ""}
                </span>
                {!r.enabled && <span className="badge border border-dashed border-border text-muted">{t("unconfirmed")}</span>}
                <Source source={r.source} />
              </li>
            ))}
          </ul>
        </section>

        {version.dungeons.length > 0 && (
          <section className="card" aria-labelledby="dungeons-title">
            <h2 id="dungeons-title" className="heading mb-3 text-lg">{t("dungeons")}</h2>
            <ul className="divide-y divide-border">
              {version.dungeons.map((d) => (
                <li key={d.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-0 basis-full sm:flex-1 sm:basis-0">{localize(d.name, locale)}</span>
                  {d.minLevel && <span className="text-sm tabular-nums text-muted">{t("levels", { min: d.minLevel, max: d.maxLevel ?? d.minLevel })}</span>}
                  <Source source={d.source} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <section className="card space-y-3" aria-labelledby="rules-title">
        <h2 id="rules-title" className="heading text-lg">{t("rules")}</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">{t("maxLevel")}</dt>
          <dd>{version.maxLevel}</dd>
          <dt className="text-muted">{t("raidSizes")}</dt>
          <dd>{version.raidSizes.filter((s) => s.enabled).map((s) => s.size).join(" · ")}</dd>
          {version.rulesets.length > 0 && (
            <>
              <dt className="text-muted">{t("rulesets")}</dt>
              <dd>{version.rulesets.map((r) => localize(r.name, locale)).join(" · ")}</dd>
            </>
          )}
          <dt className="text-muted">{t("classes")}</dt>
          <dd className="flex flex-wrap gap-1.5">
            {version.classes.map((c) => (
              <span key={c.id} className="badge text-class bg-surface-2" style={classText(c.color)}>
                {localize(c.name, locale)}
              </span>
            ))}
          </dd>
        </dl>
      </section>

      <section className="card space-y-2" aria-labelledby="app-title">
        <h2 id="app-title" className="heading text-lg">{t("inApp")}</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {(["plan", "composition", "export", "later"] as const).map((key) => (
            <li key={key}>{t(`inAppItems.${key}`)}</li>
          ))}
        </ul>
      </section>
      <p className="text-xs text-muted">{t("sourcesLegend")}</p>
    </div>
  );
}
