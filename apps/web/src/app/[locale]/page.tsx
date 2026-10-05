import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginButton } from "@/components/AuthButtons";
import { CharacterSearch } from "@/components/CharacterSearch";
import { CreateRosterForm } from "@/components/CreateRosterForm";
import { GuildRegisterForm } from "@/components/GuildRegisterForm";
import { MyCharacters } from "@/components/MyCharacters";
import { VersionBadge } from "@/components/VersionSelect";
import { Link } from "@/i18n/routing";
import { getConfig, getMe } from "@/lib/api";
import { versionOf } from "@/lib/game";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const [config, me] = await Promise.all([getConfig(), getMe()]);
  // Linking a guild or searching needs the version's API; the default version goes first.
  const withApi = config.versions
    .filter((v) => v.apiAvailable)
    .sort((a, b) => Number(b.id === config.defaultVersion) - Number(a.id === config.defaultVersion));

  if (!me.user) {
    return (
      <section className="mx-auto max-w-3xl py-12 text-center">
        <h1 className="heading text-4xl text-accent">{t("heroTitle")}</h1>
        <p className="mt-4 text-lg text-muted">{t("heroText")}</p>
        <div className="mt-8">
          {config.loginEnabled ? <LoginButton className="btn btn-primary px-6 py-2 text-base" /> : <p className="text-warning">{t("loginDisabled")}</p>}
        </div>
        <ul className="mt-12 grid gap-4 text-left sm:grid-cols-3">
          {(["roster", "armory", "sheet"] as const).map((key) => (
            <li key={key} className="card">
              <h2 className="heading text-accent">{t(`features.${key}.title`)}</h2>
              <p className="mt-2 text-sm text-muted">{t(`features.${key}.text`)}</p>
            </li>
          ))}
        </ul>
      </section>
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
        <MyCharacters characters={me.characters ?? []} config={config} />
      </section>
      <aside className="space-y-6">
        <CreateRosterForm regions={config.regions} defaultRegion={config.defaultRegion} versions={config.versions} defaultVersion={config.defaultVersion} />
        <GuildRegisterForm regions={config.regions} defaultRegion={config.defaultRegion} versions={withApi} />
        <CharacterSearch regions={config.regions} defaultRegion={config.defaultRegion} versions={withApi} />
      </aside>
    </div>
  );
}
