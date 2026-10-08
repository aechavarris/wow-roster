import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Composition } from "@/components/Composition";
import { PendingPanel } from "@/components/PendingPanel";
import { RosterTable } from "@/components/RosterTable";
import { RosterTools } from "@/components/RosterTools";
import { SyncGuildButton } from "@/components/SyncGuildButton";
import { VersionBadge } from "@/components/VersionSelect";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig, getMe } from "@/lib/api";
import { versionOf } from "@/lib/game";
import type { GuildResponse, RosterResponse } from "@/lib/types";

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
    apiGet<RosterResponse>(`/guilds/${id}/roster`),
  ]);
  if (!data || !roster) notFound();
  const { guild, viewerRole } = data;
  const isOfficer = viewerRole === "OWNER" || viewerRole === "OFFICER";
  // Classes, specs, buffs and the API all come from the roster's game version.
  const version = versionOf(config, guild.gameVersion);

  // Non-members of a roster open to proposals (public or published) send entries as proposals: signed in they
  // can also propose a real own character; anonymous visitors can only propose a planned one. (If the page
  // rendered for an anonymous visitor the roster is public, since private ones 404 for outsiders.)
  const proposing = viewerRole === null && (guild.public || guild.published);

  const inRoster = new Set(
    [...roster.players.flatMap((p) => [p.main, ...p.alts]), ...roster.pending].flatMap((c) => (c.characterId ? [c.characterId] : [])),
  );
  // Only the viewer's characters of this roster's game version that its API actually found.
  const myCharacters = (me.characters ?? []).filter(
    (c) =>
      c.gameVersion === guild.gameVersion &&
      c.region === guild.region &&
      c.syncError !== "not_found" &&
      !inRoster.has(c.id) &&
      c.level >= 10,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="heading flex flex-wrap items-center gap-3 text-3xl">
            {guild.name}
            <VersionBadge version={version} />
            {guild.published && <span className="badge border border-success/60 text-success">{t("published")}</span>}
          </h1>
          <p className="text-sm text-muted">
            {guild.kind === "custom" ? t("customRoster") : `${guild.realm} · ${t("linkedRoster")}`} · {guild.region.toUpperCase()}
            {guild.faction ? ` · ${t(`faction.${guild.faction}`)}` : ""}
            {" · "}
            {guild.lastSyncedAt ? t("lastSync", { when: format.relativeTime(new Date(guild.lastSyncedAt)) }) : t("neverSynced")}
          </p>
          {guild.syncError && <p className="text-sm text-danger">{t("syncError", { error: guild.syncError })}</p>}
        </div>
        <div className="flex gap-2">
          {/* Anyone who sees the roster can open the details table; only versions with an API have data. */}
          {version.apiAvailable && (
            <>
              <Link href={`/guild/${guild.id}/details`} className="btn">
                {t("details")}
              </Link>
              <Link href={`/guild/${guild.id}/weekly`} className="btn">
                {t("weekly")}
              </Link>
            </>
          )}
          {isOfficer && version.apiAvailable && <SyncGuildButton guildId={guild.id} />}
          {isOfficer && (
            <Link href={`/guild/${guild.id}/settings`} className="btn">
              {t("settings")}
            </Link>
          )}
        </div>
      </div>
      <PendingPanel guildId={guild.id} profile={version} entries={roster.pending} canModerate={isOfficer} />
      <Composition players={roster.players} profile={version} />
      <RosterTable
        guildId={guild.id}
        players={roster.players}
        profile={version}
        viewerRole={viewerRole}
        viewerUserId={me.user?.id ?? null}
        showRank={guild.kind === "guild"}
      />
      {(viewerRole || proposing) && (
        <RosterTools
          guildId={guild.id}
          region={guild.region}
          profile={version}
          viewerRole={viewerRole}
          myCharacters={myCharacters}
          proposing={proposing}
          isLoggedIn={me.user !== null}
        />
      )}
    </div>
  );
}
