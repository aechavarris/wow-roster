import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { GuildSettingsForm } from "@/components/GuildSettingsForm";
import { MembersPanel } from "@/components/MembersPanel";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig, getMe } from "@/lib/api";
import type { GuildResponse } from "@/lib/types";

export default async function GuildSettingsPage({ params }: PageProps<"/[locale]/guild/[id]/settings">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const [t, config, me, data] = await Promise.all([getTranslations("settings"), getConfig(), getMe(), apiGet<GuildResponse>(`/guilds/${id}`)]);
  if (!data || !me.user) notFound();
  if (data.viewerRole !== "OWNER" && data.viewerRole !== "OFFICER") notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/guild/${id}`} className="text-sm text-muted hover:text-accent">
        ← {data.guild.name}
      </Link>
      <h1 className="heading text-2xl">{t("title")}</h1>
      <GuildSettingsForm guild={data.guild} ranks={data.ranks} profile={config.profile} />
      <MembersPanel guildId={id} viewerRole={data.viewerRole} viewerUserId={me.user.id} />
    </div>
  );
}
