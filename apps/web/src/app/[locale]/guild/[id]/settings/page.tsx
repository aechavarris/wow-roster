import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { DeleteRosterForm } from "@/components/DeleteRosterForm";
import { GameVersionForm } from "@/components/GameVersionForm";
import { GuildSettingsForm } from "@/components/GuildSettingsForm";
import { PublishForm } from "@/components/PublishForm";
import { MembersPanel } from "@/components/MembersPanel";
import { WebhooksPanel } from "@/components/WebhooksPanel";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig, getMe } from "@/lib/api";
import { versionOf } from "@/lib/game";
import type { GuildResponse, RosterResponse, RosterWebhook } from "@/lib/types";

export default async function GuildSettingsPage({ params }: PageProps<"/[locale]/guild/[id]/settings">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [t, config, me, data, roster, webhooks] = await Promise.all([
    getTranslations("settings"),
    getConfig(),
    getMe(),
    apiGet<GuildResponse>(`/guilds/${id}`),
    apiGet<RosterResponse>(`/guilds/${id}/roster`),
    apiGet<{ webhooks: RosterWebhook[] }>(`/guilds/${id}/webhooks`),
  ]);
  if (!data || !me.user) notFound();
  if (data.viewerRole !== "OWNER" && data.viewerRole !== "OFFICER") notFound();
  const hasRealCharacters = (roster?.players ?? []).some((p) => [p.main, ...p.alts].some((c) => c.characterId !== null));
  // Real characters the webhook can be scoped to.
  const realCharacters = (roster?.players ?? []).flatMap((p) =>
    [p.main, ...p.alts].filter((c) => c.characterId !== null).map((c) => ({ id: c.characterId!, name: c.name, classId: c.classId })),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/guild/${id}`} className="text-sm text-muted hover:text-accent">
        ← {data.guild.name}
      </Link>
      <h1 className="heading text-2xl">{t(data.guild.kind === "custom" ? "titleCustom" : "title")}</h1>
      {data.viewerRole === "OWNER" && (
        <>
          <GameVersionForm guild={data.guild} versions={config.versions} hasRealCharacters={hasRealCharacters} />
          <PublishForm guild={data.guild} />
        </>
      )}
      <GuildSettingsForm guild={data.guild} ranks={data.ranks} profile={versionOf(config, data.guild.gameVersion)} />
      <MembersPanel guildId={id} viewerRole={data.viewerRole} viewerUserId={me.user.id} />
      <WebhooksPanel guildId={id} profile={versionOf(config, data.guild.gameVersion)} webhooks={webhooks?.webhooks ?? []} characters={realCharacters} />
      {data.viewerRole === "OWNER" && <DeleteRosterForm guild={data.guild} />}
    </div>
  );
}
