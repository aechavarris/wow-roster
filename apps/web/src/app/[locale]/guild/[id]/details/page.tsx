import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { RosterDetails, type DetailsRow } from "@/components/RosterDetails";
import { VersionBadge } from "@/components/VersionSelect";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig } from "@/lib/api";
import { versionOf } from "@/lib/game";
import type { GuildResponse, RosterDetailsResponse, RosterResponse } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/[locale]/guild/[id]/details">) {
  const { id } = await params;
  const data = await apiGet<GuildResponse>(`/guilds/${id}`);
  return { title: data?.guild.name };
}

/** Every real character of the roster side by side, one tab per kind of data the game version provides. */
export default async function RosterDetailsPage({ params }: PageProps<"/[locale]/guild/[id]/details">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [t, config, data, roster, details] = await Promise.all([
    getTranslations("details"),
    getConfig(),
    apiGet<GuildResponse>(`/guilds/${id}`),
    apiGet<RosterResponse>(`/guilds/${id}/roster`),
    apiGet<RosterDetailsResponse>(`/guilds/${id}/details`),
  ]);
  if (!data || !roster) notFound();
  const version = versionOf(config, data.guild.gameVersion);
  // Planned entries have no game data yet: only real characters get a row, alts under their main.
  const rows: DetailsRow[] = roster.players.flatMap((p) =>
    [p.main, ...p.alts]
      .filter((c) => c.characterId !== null)
      .map((c) => ({ character: c, alt: c !== p.main, details: details?.characters[c.characterId!] })),
  );

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/guild/${id}`} className="text-sm text-muted hover:text-accent">
          ← {data.guild.name}
        </Link>
        <h1 className="heading mt-1 flex flex-wrap items-center gap-3 text-2xl">
          {t("title")}
          <VersionBadge version={version} />
        </h1>
        <p className="text-sm text-muted">{t("help")}</p>
      </div>
      {!version.apiAvailable ? (
        <p className="card text-sm text-muted">{t("noApi")}</p>
      ) : (
        <RosterDetails version={version} rows={rows} />
      )}
    </div>
  );
}
