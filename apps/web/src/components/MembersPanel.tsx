"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiSend } from "@/lib/client-api";
import type { RosterInvite, RosterMember, ViewerRole } from "@/lib/types";

/** Roster members and invite links (officers); only the owner promotes officers. */
export function MembersPanel({ guildId, viewerRole, viewerUserId }: { guildId: string; viewerRole: ViewerRole; viewerUserId: string }) {
  const t = useTranslations("members");
  const tHome = useTranslations("home");
  const tErrors = useTranslations("errors");
  const format = useFormatter();
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [invites, setInvites] = useState<RosterInvite[]>([]);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = viewerRole === "OWNER";

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([
      fetch(`/api/guilds/${guildId}/members`).then((r) => r.json()),
      fetch(`/api/guilds/${guildId}/invites`).then((r) => r.json()),
    ]);
    setMembers(m.members ?? []);
    setInvites(i.invites ?? []);
  }, [guildId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="heading text-lg">{t("title")}</h2>
        <p className="text-xs text-muted">{t("help")}</p>
      </div>

      <ul className="divide-y divide-border text-sm">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="font-medium">{m.battletag}</span>
            <span className="flex items-center gap-2">
              {isOwner && m.role !== "OWNER" ? (
                <select
                  aria-label={t("role")}
                  className="input w-auto py-0.5"
                  value={m.role}
                  onChange={(e) => act(() => apiSend("PATCH", `/guilds/${guildId}/members/${m.userId}`, { role: e.target.value }))}
                >
                  <option value="OFFICER">{tHome("roles.OFFICER")}</option>
                  <option value="MEMBER">{tHome("roles.MEMBER")}</option>
                </select>
              ) : (
                <span className="badge bg-surface-2">{tHome(`roles.${m.role}`)}</span>
              )}
              {m.role !== "OWNER" && (isOwner || m.role === "MEMBER" || m.userId === viewerUserId) && (
                <button
                  type="button"
                  className="btn px-2 py-0.5"
                  aria-label={m.userId === viewerUserId ? t("leave") : t("remove", { name: m.battletag })}
                  onClick={() => {
                    if (window.confirm(m.userId === viewerUserId ? t("confirmLeave") : t("confirmRemove", { name: m.battletag }))) {
                      void act(() => apiSend("DELETE", `/guilds/${guildId}/members/${m.userId}`));
                    }
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <form
        className="space-y-2 rounded-md border border-border bg-surface-2 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void act(async () => {
            const result = await apiSend<{ url: string }>("POST", `/guilds/${guildId}/invites`, {
              role: data.get("role"),
              expiresInDays: Number(data.get("days")),
              maxUses: data.get("maxUses") ? Number(data.get("maxUses")) : undefined,
            });
            setCreated(result.url);
          });
        }}
      >
        <h3 className="font-semibold">{t("inviteTitle")}</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="inv-role">{t("role")}</label>
            <select id="inv-role" name="role" className="input" defaultValue="MEMBER">
              <option value="MEMBER">{tHome("roles.MEMBER")}</option>
              {isOwner && <option value="OFFICER">{tHome("roles.OFFICER")}</option>}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="inv-days">{t("days")}</label>
            <input id="inv-days" name="days" type="number" min={1} max={30} defaultValue={7} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="inv-uses">{t("maxUses")}</label>
            <input id="inv-uses" name="maxUses" type="number" min={1} max={500} placeholder={t("unlimited")} className="input" />
          </div>
        </div>
        <button type="submit" className="btn btn-primary">{t("createInvite")}</button>
        {created && (
          <div className="flex items-center gap-2">
            <input readOnly value={created} aria-label={t("inviteLink")} className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn shrink-0" onClick={() => navigator.clipboard.writeText(created)}>
              {t("copy")}
            </button>
          </div>
        )}
        {created && <p className="text-xs text-muted">{t("inviteOnce")}</p>}
      </form>

      {invites.length > 0 && (
        <div>
          <h3 className="mb-1 font-semibold">{t("activeInvites")}</h3>
          <ul className="divide-y divide-border text-sm">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                <span>
                  {tHome(`roles.${i.role}`)} · {t("expires", { when: format.relativeTime(new Date(i.expiresAt)) })} ·{" "}
                  {t("uses", { uses: i.uses, max: i.maxUses ?? "∞" })}
                </span>
                <button type="button" className="btn px-2 py-0.5" onClick={() => act(() => apiSend("DELETE", `/guilds/${guildId}/invites/${i.id}`))}>
                  {t("revoke")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
