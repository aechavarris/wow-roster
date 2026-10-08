"use client";

import { PROGRESS_EVENTS, localize } from "@wow/config";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import { classColor, classText } from "@/lib/game";
import type { GameVersion, RosterWebhook } from "@/lib/types";

interface Character {
  id: string;
  name: string;
  classId: number | null;
}

/** Officer settings for the Discord webhooks that announce roster progress. */
export function WebhooksPanel({ guildId, profile, webhooks, characters }: { guildId: string; profile: GameVersion; webhooks: RosterWebhook[]; characters: Character[] }) {
  const t = useTranslations("webhooks");
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="heading text-lg">{t("title")}</h2>
        <p className="text-xs text-muted">{t("help")}</p>
      </div>

      {webhooks.length === 0 && !adding && <p className="text-sm text-muted">{t("empty")}</p>}

      <ul className="space-y-2">
        {webhooks.map((w) =>
          editing === w.id ? (
            <li key={w.id}>
              <WebhookForm guildId={guildId} profile={profile} characters={characters} webhook={w} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={w.id} className="rounded border border-border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{w.label}</span>
                {!w.enabled && <span className="badge bg-surface-2 text-muted">{t("disabled")}</span>}
                <span className="text-xs text-muted">{w.urlMasked}</span>
                <span className="ml-auto flex gap-2">
                  <TestButton guildId={guildId} id={w.id} />
                  <button type="button" className="btn" onClick={() => setEditing(w.id)}>{t("edit")}</button>
                  <DeleteButton guildId={guildId} id={w.id} label={w.label} />
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {w.allCharacters ? t("allCharacters") : t("someCharacters", { count: w.characterIds.length })} ·{" "}
                {w.events.length === 0 ? t("noEvents") : w.events.map((e) => localize(PROGRESS_EVENTS.find((p) => p.key === e)?.name ?? { en: e }, locale)).join(", ")}
              </p>
            </li>
          ),
        )}
      </ul>

      {adding ? (
        <WebhookForm guildId={guildId} profile={profile} characters={characters} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>{t("add")}</button>
      )}
    </section>
  );
}

function TestButton({ guildId, id }: { guildId: string; id: string }) {
  const t = useTranslations("webhooks");
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await apiSend("POST", `/guilds/${guildId}/webhooks/${id}/test`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("test")}
    </button>
  );
}

function DeleteButton({ guildId, id, label }: { guildId: string; id: string; label: string }) {
  const t = useTranslations("webhooks");
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn text-danger"
      onClick={async () => {
        if (!window.confirm(t("confirmDelete", { label }))) return;
        await apiSend("DELETE", `/guilds/${guildId}/webhooks/${id}`);
        router.refresh();
      }}
    >
      {t("delete")}
    </button>
  );
}

function WebhookForm({ guildId, profile, characters, webhook, onDone }: { guildId: string; profile: GameVersion; characters: Character[]; webhook?: RosterWebhook; onDone: () => void }) {
  const t = useTranslations("webhooks");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const [label, setLabel] = useState(webhook?.label ?? "");
  const [url, setUrl] = useState("");
  const [msgLocale, setMsgLocale] = useState(webhook?.locale ?? locale);
  const [events, setEvents] = useState<Set<string>>(new Set(webhook?.events ?? PROGRESS_EVENTS.map((e) => e.key)));
  const [allCharacters, setAllCharacters] = useState(webhook?.allCharacters ?? true);
  const [charIds, setCharIds] = useState<Set<string>>(new Set(webhook?.characterIds ?? []));
  const [enabled, setEnabled] = useState(webhook?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  async function save() {
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = { label, locale: msgLocale, events: [...events], allCharacters, characterIds: [...charIds], enabled };
    // On edit the URL is sent only when changed, so the stored secret is kept otherwise.
    if (!webhook || url.trim()) body.url = url.trim();
    try {
      if (webhook) await apiSend("PATCH", `/guilds/${guildId}/webhooks/${webhook.id}`, body);
      else await apiSend("POST", `/guilds/${guildId}/webhooks`, body);
      router.refresh();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded border border-accent/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="wh-label">{t("label")}</label>
          <input id="wh-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} required />
        </div>
        <div>
          <label className="label" htmlFor="wh-locale">{t("messageLanguage")}</label>
          <select id="wh-locale" className="input" value={msgLocale} onChange={(e) => setMsgLocale(e.target.value)}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="wh-url">{t("url")}</label>
        <input id="wh-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={webhook ? t("urlKeep") : "https://discord.com/api/webhooks/…"} required={!webhook} />
        <p className="text-xs text-muted">{t("urlHelp")}</p>
      </div>

      <fieldset>
        <legend className="label">{t("events")}</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {PROGRESS_EVENTS.map((e) => (
            <label key={e.key} className="flex items-center gap-2 text-sm" title={localize(e.description, locale)}>
              <input type="checkbox" checked={events.has(e.key)} onChange={() => setEvents((s) => toggle(s, e.key))} />
              {localize(e.name, locale)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">{t("characters")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allCharacters} onChange={(e) => setAllCharacters(e.target.checked)} />
          {t("allCharacters")}
        </label>
        {!allCharacters && (
          <ul className="mt-1 grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
            {characters.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={charIds.has(c.id)} onChange={() => setCharIds((s) => toggle(s, c.id))} />
                  <span className="text-class" style={classText(classColor(profile, c.classId))}>{c.name}</span>
                </label>
              </li>
            ))}
            {characters.length === 0 && <li className="text-xs text-muted">{t("noCharacters")}</li>}
          </ul>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {t("enabled")}
      </label>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t("saving") : t("save")}</button>
        <button type="button" className="btn" onClick={onDone}>{t("cancel")}</button>
      </div>
    </form>
  );
}
