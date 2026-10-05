import { localize } from "@wow/config";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AcceptInviteButton } from "@/components/AcceptInviteButton";
import { LoginButton } from "@/components/AuthButtons";
import { Link } from "@/i18n/routing";
import { apiGet, getConfig, getMe } from "@/lib/api";
import { versionOf } from "@/lib/game";
import type { RosterKind, ViewerRole } from "@/lib/types";

interface InvitePreview {
  roster: { id: string; name: string; kind: RosterKind; gameVersion: string; region: string };
  role: "OFFICER" | "MEMBER";
  usable: boolean;
  currentRole: ViewerRole;
}

const RANK = { OWNER: 3, OFFICER: 2, MEMBER: 1 } as const;

export default async function InvitePage({ params }: PageProps<"/[locale]/invite/[token]">) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const [t, tHome, config, me, invite] = await Promise.all([
    getTranslations("invite"),
    getTranslations("home"),
    getConfig(),
    getMe(),
    apiGet<InvitePreview>(`/invites/${encodeURIComponent(token)}`),
  ]);
  if (!invite) notFound();
  const alreadyIn = invite.currentRole !== null && RANK[invite.currentRole] >= RANK[invite.role];

  return (
    <section className="card mx-auto max-w-md space-y-4 text-center">
      <p className="text-sm text-muted">{t("youAreInvited")}</p>
      <h1 className="heading text-2xl text-accent">{invite.roster.name}</h1>
      <p className="text-sm">
        {tHome(invite.roster.kind === "custom" ? "kindCustom" : "kindGuild")} ·{" "}
        {localize(versionOf(config, invite.roster.gameVersion).name, locale)} · {invite.roster.region.toUpperCase()} ·{" "}
        {t("asRole", { role: tHome(`roles.${invite.role}`) })}
      </p>
      {alreadyIn ? (
        <Link href={`/guild/${invite.roster.id}`} className="btn btn-primary">
          {t("alreadyIn")}
        </Link>
      ) : !invite.usable ? (
        <p className="text-danger">{t("expired")}</p>
      ) : !me.user ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">{t("loginFirst")}</p>
          <LoginButton />
        </div>
      ) : (
        <AcceptInviteButton token={token} />
      )}
    </section>
  );
}
