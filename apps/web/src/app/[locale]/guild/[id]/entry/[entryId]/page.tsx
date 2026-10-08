import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { BisPanel } from "@/components/character/BisPanel";
import { VersionBadge } from "@/components/VersionSelect";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig } from "@/lib/api";
import { classColor, className, classText, specName, versionOf } from "@/lib/game";
import type { GuildResponse, RosterEntryDetail } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/[locale]/guild/[id]/entry/[entryId]">) {
  const { id, entryId } = await params;
  const entry = await apiGet<{ entry: RosterEntryDetail }>(`/guilds/${id}/roster/${entryId}`);
  return { title: entry?.entry.plannedName ?? entry?.entry.character?.name };
}

/**
 * A planned entry's details. Planned characters have no game data, so the page shows only the BiS list; a real
 * character redirects to its full character page. The entry's player or an officer can edit the list.
 */
export default async function RosterEntryPage({ params }: PageProps<"/[locale]/guild/[id]/entry/[entryId]">) {
  const { locale, id, entryId } = await params;
  setRequestLocale(locale);
  const [t, config, guild, data] = await Promise.all([
    getTranslations("bis"),
    getConfig(),
    apiGet<GuildResponse>(`/guilds/${id}`),
    apiGet<{ entry: RosterEntryDetail }>(`/guilds/${id}/roster/${entryId}`),
  ]);
  if (!guild || !data) notFound();
  const entry = data.entry;
  // Real characters have a full page of their own; send the viewer there.
  if (entry.character) {
    const ch = entry.character;
    redirect(`/${locale}/character/${ch.version}/${ch.region}/${encodeURIComponent(ch.realm)}/${encodeURIComponent(ch.name.toLowerCase())}`);
  }
  const version = versionOf(config, entry.gameVersion);
  const color = classColor(version, entry.plannedClassId);
  const title = entry.plannedName || entry.playerName || className(version, entry.plannedClassId, locale);

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/guild/${id}`} className="text-sm text-muted hover:text-accent">
          ← {guild.guild.name}
        </Link>
      </div>
      <section className="card flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="heading text-class text-2xl" style={classText(color)}>
            {title}
          </h1>
          <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted">
            <VersionBadge version={version} />
            {specName(version, entry.plannedClassId, entry.plannedSpec, locale)} {className(version, entry.plannedClassId, locale)} · {t("plannedBadge")}
          </p>
          {entry.note && <p className="text-sm text-muted">{entry.note}</p>}
        </div>
      </section>
      <BisPanel
        version={version}
        region={entry.region}
        bis={entry.bis ?? []}
        canEdit={entry.canEdit}
        endpoint={`/guilds/${id}/roster/${entryId}/bis`}
        level={version.maxLevel}
      />
    </div>
  );
}
