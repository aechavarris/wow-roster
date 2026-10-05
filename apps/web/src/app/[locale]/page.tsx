import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginButton } from "@/components/AuthButtons";
import { CharacterSearch } from "@/components/CharacterSearch";
import { CreateRosterForm } from "@/components/CreateRosterForm";
import { GuildRegisterForm } from "@/components/GuildRegisterForm";
import { MyCharacters } from "@/components/MyCharacters";
import { Link } from "@/i18n/routing";
import { getConfig, getMe } from "@/lib/api";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const [config, me] = await Promise.all([getConfig(), getMe()]);

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
        <MyCharacters characters={me.characters ?? []} profile={config.profile} />
      </section>
      <aside className="space-y-6">
        <CreateRosterForm regions={config.regions} defaultRegion={config.defaultRegion} />
        <GuildRegisterForm regions={config.regions} defaultRegion={config.defaultRegion} hasRealms={config.profile.hasRealms} />
        <CharacterSearch regions={config.regions} defaultRegion={config.defaultRegion} hasRealms={config.profile.hasRealms} />
      </aside>
    </div>
  );
}
