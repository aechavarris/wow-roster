import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { WeeklyAudit, type WeeklyRow } from "@/components/WeeklyAudit";
import { VersionBadge } from "@/components/VersionSelect";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig } from "@/lib/api";
import { versionOf } from "@/lib/game";
import type { GuildResponse, RosterResponse, WeeklyResponse } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/[locale]/guild/[id]/weekly">) {
  const { id } = await params;
  const data = await apiGet<GuildResponse>(`/guilds/${id}`);
  return { title: data?.guild.name };
}

/** Weekly audit: what every roster character did this game week (or a past one) and the recent history. */
export default async function WeeklyPage({ params, searchParams }: PageProps<"/[locale]/guild/[id]/weekly">) {
  const { locale, id } = await params;
  const { week } = await searchParams;
  setRequestLocale(locale);
  const weekParam = typeof week === "string" ? `?week=${encodeURIComponent(week)}` : "";
  const [t, config, data, roster, weekly] = await Promise.all([
    getTranslations("weekly"),
    getConfig(),
    apiGet<GuildResponse>(`/guilds/${id}`),
    apiGet<RosterResponse>(`/guilds/${id}/roster`),
    apiGet<WeeklyResponse>(`/guilds/${id}/weekly${weekParam}`),
  ]);
  if (!data || !roster || !weekly) notFound();
  const version = versionOf(config, data.guild.gameVersion);
  const rows: WeeklyRow[] = roster.players.flatMap((p) =>
    [p.main, ...p.alts].filter((c) => c.characterId !== null).map((c) => ({ character: c, alt: c !== p.main })),
  );
  const weeklyData = ["raids", "dungeons", "mythicPlus"].some((e) => version.characterEndpoints.includes(e));

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
        <p className="text-sm text-muted">{t("help", { region: data.guild.region.toUpperCase() })}</p>
      </div>
      {!version.apiAvailable ? (
        <p className="card text-sm text-muted">{t("noApi")}</p>
      ) : !weeklyData ? (
        <p className="card text-sm text-muted">{t("noWeeklyData")}</p>
      ) : (
        <WeeklyAudit guildId={id} version={version} rows={rows} weekly={weekly} />
      )}
    </div>
  );
}
