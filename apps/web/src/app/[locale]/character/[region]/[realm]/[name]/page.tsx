import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GearPanel } from "@/components/character/GearPanel";
import { ProfessionsPanel, ReputationsPanel } from "@/components/character/ProfessionsPanel";
import { RefreshCharacterButton } from "@/components/character/RefreshCharacterButton";
import { StatsPanel } from "@/components/character/StatsPanel";
import { TalentsPanel } from "@/components/character/TalentsPanel";
import { WowheadRefresh } from "@/components/WowheadRefresh";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig, getMe } from "@/lib/api";
import { classColor, className, specName } from "@/lib/game";
import type { CharacterDetail } from "@/lib/types";

type Props = PageProps<"/[locale]/character/[region]/[realm]/[name]">;

export async function generateMetadata({ params }: Props) {
  const { name } = await params;
  return { title: decodeURIComponent(name) };
}

export default async function CharacterPage({ params }: Props) {
  const { locale, region, realm, name } = await params;
  setRequestLocale(locale);
  const [t, format, config, me, data] = await Promise.all([
    getTranslations("character"),
    getFormatter(),
    getConfig(),
    getMe(),
    apiGet<{ character: CharacterDetail }>(`/characters/${region}/${realm}/${name}`),
  ]);
  if (!data) notFound();
  const c = data.character;
  const profile = c.profile;
  const { profile: game } = config;
  const missing = profile?.missing ?? {};

  return (
    <div className="space-y-4">
      <section
        className="card relative overflow-hidden"
        style={profile?.media?.main ? { backgroundImage: `linear-gradient(90deg, var(--surface) 45%, transparent), url(${profile.media.main})`, backgroundSize: "cover", backgroundPosition: "center right" } : undefined}
      >
        <div className="flex flex-wrap items-center gap-4">
          {c.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- Blizzard renders are already sized thumbnails.
            <img src={c.avatarUrl} alt="" width={72} height={72} className="rounded-lg border border-border" />
          )}
          <div>
            <h1 className="heading text-3xl" style={{ color: classColor(game, c.classId) }}>
              {c.name}
            </h1>
            <p className="text-sm">
              {t("summary", { level: c.level })} · {specName(game, c.classId, c.specName, locale)} {className(game, c.classId, locale)}
            </p>
            <p className="text-sm text-muted">
              {c.realm} · {c.region.toUpperCase()}
              {c.guild && (
                <>
                  {" · "}
                  <Link href={`/guild/${c.guild.id}`} className="hover:text-accent">&lt;{c.guild.name}&gt;</Link>
                </>
              )}
            </p>
          </div>
          <div className="ml-auto text-right">
            {c.equippedItemLevel != null && (
              <p className="text-2xl font-semibold tabular-nums">
                {Math.round(c.equippedItemLevel)} <span className="text-sm font-normal text-muted">{t("itemLevel")}</span>
              </p>
            )}
            <p className="text-xs text-muted">
              {c.lastSyncedAt ? t("updated", { when: format.relativeTime(new Date(c.lastSyncedAt)) }) : t("neverUpdated")}
            </p>
            {me.user && <RefreshCharacterButton characterId={c.id} />}
          </div>
        </div>
      </section>

      {!profile ? (
        <p className="card text-muted">{t("noData")}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <GearPanel items={profile.equipment} missing={missing.equipment} wowheadDomain={game.wowheadDomain} />
            <TalentsPanel setups={profile.talents} missing={missing.specializations} wowheadDomain={game.wowheadDomain} />
          </div>
          <div className="space-y-4">
            <StatsPanel stats={profile.statistics} missing={missing.statistics} />
            <ProfessionsPanel professions={profile.professions} missing={missing.professions} />
            <ReputationsPanel reputations={profile.reputations} missing={missing.reputations} />
          </div>
        </div>
      )}
      <WowheadRefresh deps={[c.id, c.lastSyncedAt]} />
    </div>
  );
}
