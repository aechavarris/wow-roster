import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { RosterTable } from "@/components/RosterTable";
import { SyncGuildButton } from "@/components/SyncGuildButton";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig } from "@/lib/api";
import type { GuildResponse, RosterPlayer } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/[locale]/guild/[id]">) {
  const { id } = await params;
  const data = await apiGet<GuildResponse>(`/guilds/${id}`);
  return { title: data?.guild.name };
}

export default async function GuildPage({ params }: PageProps<"/[locale]/guild/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [t, format, config, data, roster] = await Promise.all([
    getTranslations("guild"),
    getFormatter(),
    getConfig(),
    apiGet<GuildResponse>(`/guilds/${id}`),
    apiGet<{ players: RosterPlayer[] }>(`/guilds/${id}/roster`),
  ]);
  if (!data || !roster) notFound();
  const { guild, viewerRole } = data;
  const isOfficer = viewerRole === "OWNER" || viewerRole === "OFFICER";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="heading text-3xl">{guild.name}</h1>
          <p className="text-sm text-muted">
            {guild.realm} · {guild.region.toUpperCase()}
            {guild.faction ? ` · ${t(`faction.${guild.faction}`)}` : ""}
            {" · "}
            {guild.lastSyncedAt ? t("lastSync", { when: format.relativeTime(new Date(guild.lastSyncedAt)) }) : t("neverSynced")}
          </p>
          {guild.syncError && <p className="text-sm text-danger">{t("syncError", { error: guild.syncError })}</p>}
        </div>
        {isOfficer && (
          <div className="flex gap-2">
            <SyncGuildButton guildId={guild.id} />
            <Link href={`/guild/${guild.id}/settings`} className="btn">
              {t("settings")}
            </Link>
          </div>
        )}
      </div>
      <RosterTable guildId={guild.id} players={roster.players} profile={config.profile} canEdit={isOfficer} hasRealms={config.profile.hasRealms} />
    </div>
  );
}
