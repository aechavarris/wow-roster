import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { BisPanel } from "@/components/character/BisPanel";
import { GearPanel } from "@/components/character/GearPanel";
import { ProfessionsPanel, ReputationsPanel } from "@/components/character/ProfessionsPanel";
import { RefreshCharacterButton } from "@/components/character/RefreshCharacterButton";
import { RequirementsPanel } from "@/components/character/RequirementsPanel";
import { StatsPanel } from "@/components/character/StatsPanel";
import { TalentsPanel } from "@/components/character/TalentsPanel";
import { VersionBadge } from "@/components/VersionSelect";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig, getMe } from "@/lib/api";
import { classColor, className, classText, specName, versionOf } from "@/lib/game";
import type { CharacterDetail } from "@/lib/types";

type Props = PageProps<"/[locale]/character/[version]/[region]/[realm]/[name]">;

export async function generateMetadata({ params }: Props) {
  const { name } = await params;
  return { title: decodeURIComponent(name) };
}

export default async function CharacterPage({ params }: Props) {
  const { locale, version, region, realm, name } = await params;
  setRequestLocale(locale);
  const [t, format, config, me, data] = await Promise.all([
    getTranslations("character"),
    getFormatter(),
    getConfig(),
    getMe(),
    apiGet<{ character: CharacterDetail }>(`/characters/${version}/${region}/${realm}/${name}`),
  ]);
  if (!data) notFound();
  const c = data.character;
  const profile = c.profile;
  // Classes, specs and the stats layout come from the character's game version.
  const game = versionOf(config, c.gameVersion);
  const missing = profile?.missing ?? {};
  const color = classColor(game, c.classId);

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center gap-4">
        {c.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- Blizzard renders are already sized thumbnails.
          <img src={c.avatarUrl} alt="" width={64} height={64} className="rounded-lg border-2" style={{ borderColor: color }} />
        )}
        <div className="min-w-0">
          <h1 className="heading text-class text-3xl" style={classText(color)}>
            {c.name}
          </h1>
          <p className="text-sm">
            {t("summary", { level: c.level })} · {specName(game, c.classId, c.specName, locale)} {className(game, c.classId, locale)}
          </p>
          <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted">
            <VersionBadge version={game} />
            {c.realm} · {c.region.toUpperCase()}
            {c.guild && (
              <>
                {" · "}
                <Link href={`/guild/${c.guild.id}`} className="hover:text-accent">
                  &lt;{c.guild.name}&gt;
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-muted">
            {c.lastSyncedAt ? t("updated", { when: format.relativeTime(new Date(c.lastSyncedAt)) }) : t("neverUpdated")}
          </p>
          {me.user && <RefreshCharacterButton characterId={c.id} />}
        </div>
      </section>

      {!profile ? (
        <p className="card text-muted">{t("noData")}</p>
      ) : (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <GearPanel items={profile.equipment} missing={missing.equipment} media={profile.media} classColor={color} />
            <StatsPanel stats={profile.statistics} missing={missing.statistics} panel={game.statPanel} itemLevel={c.equippedItemLevel} />
          </div>
          <TalentsPanel setups={profile.talents} missing={missing.specializations} version={c.gameVersion} region={c.region} />
          <div className="grid items-start gap-4 md:grid-cols-2">
            <ProfessionsPanel
              game={game}
              professions={profile.professions}
              missing={missing.professions}
              manual={c.manualProfessions}
              characterId={c.id}
              canEdit={me.characters?.some((own) => own.id === c.id) ?? false}
            />
            <ReputationsPanel reputations={profile.reputations} missing={missing.reputations} />
          </div>
          <RequirementsPanel
            game={game}
            done={c.manualRequirements}
            characterId={c.id}
            canEdit={me.characters?.some((own) => own.id === c.id) ?? false}
          />
        </>
      )}
      <BisPanel
        version={game}
        region={c.region}
        bis={c.bis ?? []}
        canEdit={me.characters?.some((own) => own.id === c.id) ?? false}
        endpoint={`/characters/${c.id}/bis`}
        level={c.level}
        classId={c.classId}
      />
    </div>
  );
}
