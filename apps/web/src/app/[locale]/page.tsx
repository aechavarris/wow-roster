import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginButton } from "@/components/AuthButtons";
import { CharacterSearch } from "@/components/CharacterSearch";
import { CreateRosterForm } from "@/components/CreateRosterForm";
import { GuildRegisterForm } from "@/components/GuildRegisterForm";
import { MyCharacters } from "@/components/MyCharacters";
import { PublishedRosters } from "@/components/PublishedRosters";
import { VersionBadge } from "@/components/VersionSelect";
import { Link } from "@/i18n/routing";
import { localize } from "@wow/config";
import { apiGet, getConfig, getMe } from "@/lib/api";
import { versionOf } from "@/lib/game";
import type { PublishedRoster } from "@/lib/types";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tInfo = await getTranslations("versionInfo");
  const [config, me] = await Promise.all([getConfig(), getMe()]);
  // Public rosters are listed for everyone; a signed-in user also gets the ones merely published to members.
  const published = (await apiGet<{ rosters: PublishedRoster[] }>("/rosters/published"))?.rosters ?? [];
  // Linking a guild or searching needs the version's API; the default version goes first.
  const withApi = config.versions
    .filter((v) => v.apiAvailable)
    .sort((a, b) => Number(b.id === config.defaultVersion) - Number(a.id === config.defaultVersion));
  // Versions still being revealed (Forever) have an overview page with what is known so far.
  const overviews = (
    <>
      {config.versions
        .filter((v) => v.timeline.length > 0)
        .map((v) => (
          <Link key={v.id} href={`/versions/${v.id}`} className="card block font-medium hover:border-accent hover:text-accent">
            {tInfo("homeLink", { name: localize(v.name, locale) })} →
          </Link>
        ))}
    </>
  );

  if (!me.user) {
    // The feature cards describing what the app does, in a fixed order.
    const sections = ["rosters", "characters", "progress", "composition", "bis", "integrations"] as const;
    // What each game version supports, built from its config so the list stays accurate as versions change.
    const versionCaps = (v: (typeof config.versions)[number]): string[] => {
      const out: string[] = [];
      if (v.apiAvailable && v.apiStandIn) out.push(t("caps.standin", { source: localize(v.apiStandIn.name, locale) }));
      else if (v.apiAvailable) out.push(t("caps.real"));
      else out.push(t("caps.planned"));
      const sizes = [...new Set(v.raids.filter((r) => r.enabled).map((r) => r.size))].sort((a, b) => a - b);
      if (sizes.length > 0) out.push(t("caps.raids", { sizes: sizes.join(" / ") }));
      if (v.warcraftLogsHost) out.push(t("caps.logs"));
      if (v.characterEndpoints.includes("mythicPlus")) out.push(t("caps.mythic"));
      if (v.apiAvailable) out.push(v.apiProfessions ? t("caps.autoProfessions") : t("caps.manualProfessions"));
      if (v.apiAvailable) out.push(t("caps.bis"));
      return out;
    };

    return (
      <div className="mx-auto max-w-5xl space-y-12 py-10">
        <section className="text-center">
          <h1 className="heading text-4xl text-accent">{t("heroTitle")}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">{t("heroText")}</p>
          <div className="mt-6">
            {config.loginEnabled ? <LoginButton className="btn btn-primary px-6 py-2 text-base" /> : <p className="text-warning">{t("loginDisabled")}</p>}
          </div>
        </section>

        {/* Public rosters are open to anyone: list them first so a visitor can browse and propose a planned
            character without signing in (accepting an invite to a private roster still needs a login). */}
        {published.length > 0 && <PublishedRosters rosters={published} config={config} />}

        <section>
          <h2 className="heading mb-4 text-2xl">{t("featuresTitle")}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((key) => (
              <li key={key} className="card">
                <h3 className="heading text-accent">{t(`sections.${key}.title`)}</h3>
                <p className="mt-2 text-sm text-muted">{t(`sections.${key}.text`)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="heading text-2xl">{t("versionsTitle")}</h2>
          <p className="mt-1 mb-4 text-sm text-muted">{t("versionsIntro")}</p>
          <ul className="grid gap-4 sm:grid-cols-2">
            {config.versions.map((v) => (
              <li key={v.id} className="card space-y-2">
                <div className="flex items-center gap-2">
                  <VersionBadge version={v} />
                  <h3 className="heading">{localize(v.name, locale)}</h3>
                </div>
                <ul className="space-y-1 text-sm text-muted">
                  {versionCaps(v).map((cap, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className="text-accent">
                        •
                      </span>
                      <span>{cap}</span>
                    </li>
                  ))}
                </ul>
                {v.timeline.length > 0 && (
                  <Link href={`/versions/${v.id}`} className="inline-block text-sm text-accent hover:underline">
                    {tInfo("homeLink", { name: localize(v.name, locale) })} →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="space-y-6 lg:col-span-2">
        <div className="card">
          <h2 className="heading mb-3 text-lg">{t("myGuilds")}</h2>
          {me.guilds && me.guilds.length > 0 ? (
            <ul className="divide-y divide-border">
              {me.guilds.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <Link href={`/guild/${g.id}`} className="font-medium hover:text-accent">
                      {g.name}
                    </Link>
                    <span className="badge bg-surface-2 text-muted">{t(g.kind === "custom" ? "kindCustom" : "kindGuild")}</span>
                    <VersionBadge version={versionOf(config, g.gameVersion)} />
                  </span>
                  <span className="text-xs text-muted">
                    {g.realm ? `${g.realm} · ` : ""}
                    {g.region.toUpperCase()} {g.role ? `· ${t(`roles.${g.role}`)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t("noGuilds")}</p>
          )}
        </div>
        <PublishedRosters rosters={published} config={config} />
        <MyCharacters characters={me.characters ?? []} config={config} />
      </section>
      <aside className="space-y-6">
        {overviews}
        <CreateRosterForm regions={config.regions} defaultRegion={config.defaultRegion} versions={config.versions} defaultVersion={config.defaultVersion} />
        <GuildRegisterForm regions={config.regions} defaultRegion={config.defaultRegion} versions={withApi} />
        <CharacterSearch regions={config.regions} defaultRegion={config.defaultRegion} versions={withApi} />
      </aside>
    </div>
  );
}
