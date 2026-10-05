import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GameVersionForm } from "@/components/GameVersionForm";
import { GuildSettingsForm } from "@/components/GuildSettingsForm";
import { MembersPanel } from "@/components/MembersPanel";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig, getMe } from "@/lib/api";
import { versionOf } from "@/lib/game";
import type { GuildResponse, RosterPlayer } from "@/lib/types";

export default async function GuildSettingsPage({ params }: PageProps<"/[locale]/guild/[id]/settings">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [t, config, me, data, roster] = await Promise.all([
    getTranslations("settings"),
    getConfig(),
    getMe(),
    apiGet<GuildResponse>(`/guilds/${id}`),
    apiGet<{ players: RosterPlayer[] }>(`/guilds/${id}/roster`),
  ]);
  if (!data || !me.user) notFound();
  if (data.viewerRole !== "OWNER" && data.viewerRole !== "OFFICER") notFound();
  const hasRealCharacters = (roster?.players ?? []).some((p) => [p.main, ...p.alts].some((c) => c.characterId !== null));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/guild/${id}`} className="text-sm text-muted hover:text-accent">
        ← {data.guild.name}
      </Link>
      <h1 className="heading text-2xl">{t(data.guild.kind === "custom" ? "titleCustom" : "title")}</h1>
      {data.viewerRole === "OWNER" && (
        <GameVersionForm guild={data.guild} versions={config.versions} hasRealCharacters={hasRealCharacters} />
      )}
      <GuildSettingsForm guild={data.guild} ranks={data.ranks} profile={versionOf(config, data.guild.gameVersion)} />
      <MembersPanel guildId={id} viewerRole={data.viewerRole} viewerUserId={me.user.id} />
    </div>
  );
}
