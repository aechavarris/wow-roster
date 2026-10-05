import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Composition } from "@/components/Composition";
import { RosterTable } from "@/components/RosterTable";
import { RosterTools } from "@/components/RosterTools";
import { SyncGuildButton } from "@/components/SyncGuildButton";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig, getMe } from "@/lib/api";
import type { GuildResponse, RosterPlayer } from "@/lib/types";

export async function generateMetadata({ params }: PageProps<"/[locale]/guild/[id]">) {
  const { id } = await params;
  const data = await apiGet<GuildResponse>(`/guilds/${id}`);
  return { title: data?.guild.name };
}

export default async function RosterPage({ params }: PageProps<"/[locale]/guild/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [t, format, config, me, data, roster] = await Promise.all([
    getTranslations("guild"),
    getFormatter(),
    getConfig(),
    getMe(),
    apiGet<GuildResponse>(`/guilds/${id}`),
    apiGet<{ players: RosterPlayer[] }>(`/guilds/${id}/roster`),
  ]);
  if (!data || !roster) notFound();
  const { guild, viewerRole } = data;
  const isOfficer = viewerRole === "OWNER" || viewerRole === "OFFICER";

  const inRoster = new Set(roster.players.flatMap((p) => [p.main, ...p.alts]).flatMap((c) => (c.characterId ? [c.characterId] : [])));
  const myCharacters = (me.characters ?? []).filter((c) => c.region === guild.region && !inRoster.has(c.id) && c.level >= 10);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="heading text-3xl">{guild.name}</h1>
          <p className="text-sm text-muted">
            {guild.kind === "custom" ? t("customRoster") : `${guild.realm} · ${t("linkedRoster")}`} · {guild.region.toUpperCase()}
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
      <Composition players={roster.players} profile={config.profile} />
      <RosterTable
        guildId={guild.id}
        players={roster.players}
        profile={config.profile}
        viewerRole={viewerRole}
        viewerUserId={me.user?.id ?? null}
        hasRealms={config.profile.hasRealms}
        showRank={guild.kind === "guild"}
      />
      <RosterTools guildId={guild.id} region={guild.region} profile={config.profile} viewerRole={viewerRole} myCharacters={myCharacters} />
    </div>
  );
}
