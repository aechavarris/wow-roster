import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { RosterLogs } from "@/components/RosterLogs";
import { VersionBadge } from "@/components/VersionSelect";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig } from "@/lib/api";
import { versionOf } from "@/lib/game";
import type { GuildResponse, RosterLogsResponse } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/[locale]/guild/[id]/logs">) {
  const { id } = await params;
  const data = await apiGet<GuildResponse>(`/guilds/${id}`);
  return { title: data?.guild.name };
}

/** Recent Warcraft Logs reports of every roster character (Classic Era, Anniversary, Forever via stand-in). */
export default async function RosterLogsPage({ params }: PageProps<"/[locale]/guild/[id]/logs">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [t, config, data, logs] = await Promise.all([
    getTranslations("logs"),
    getConfig(),
    apiGet<GuildResponse>(`/guilds/${id}`),
    apiGet<RosterLogsResponse>(`/guilds/${id}/logs`),
  ]);
  if (!data) notFound();
  const version = versionOf(config, data.guild.gameVersion);

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/guild/${id}`} className="text-sm text-muted hover:text-accent">
          ← {data.guild.name}
        </Link>
      </div>
      <div>
        <h1 className="heading flex flex-wrap items-center gap-3 text-2xl">
          {t("title")}
          <VersionBadge version={version} />
        </h1>
        <p className="text-sm text-muted">{t("help")}</p>
      </div>
      {!logs?.available ? <p className="card text-muted">{t("unavailable")}</p> : <RosterLogs version={version} logs={logs.logs} />}
    </div>
  );
}
