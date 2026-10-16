"use client";

import { PROGRESS_EVENTS, defaultProgressProfessions, defaultProgressSettings, localize, type ProgressSettings, type Threshold } from "@wow/config";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import { classColor, classText } from "@/lib/game";
import type { GameVersion, RosterWebhook } from "@/lib/types";

interface Character {
  id: string;
  name: string;
  classId: number | null;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Short description of a threshold for the webhook list: "every 10, at 60, 70". */
function thresholdSummary(t: Translate, rule: Threshold) {
  const parts = [];
  if (rule.every) parts.push(t("summaryEvery", { n: rule.every }));
  if (rule.at.length > 0) parts.push(t("summaryAt", { values: rule.at.join(", ") }));
  return parts.join(", ");
}

/** One line per enabled event with its settings, so officers see what each webhook announces at a glance. */
function eventSummary(t: Translate, profile: GameVersion, key: string, s: ProgressSettings, locale: string) {
  const name = localize(PROGRESS_EVENTS.find((p) => p.key === key)?.name ?? { en: key }, locale);
  const detail = (() => {
    switch (key) {
      case "level_up":
        return [thresholdSummary(t, s.level), s.level.atMax ? t("summaryMax") : ""].filter(Boolean).join(", ");
      case "item_level":
        return thresholdSummary(t, s.itemLevel);
      case "mythic_rating":
        return thresholdSummary(t, s.mythicRating);
      case "mythic_plus":
        return t("summaryFrom", { n: s.mythicPlus.minKey });
      case "profession":
        return t("summaryProfessions", { count: (s.profession.professions ?? defaultProgressProfessions(profile)).length });
      case "reputation":
        return s.reputation.standings
          .map((k) => localize(profile.reputation.standings.find((st) => st.key === k)?.name ?? { en: k }, locale))
          .join(", ");
      default:
        return "";
    }
  })();
  return detail ? `${name} (${detail})` : name;
}

/** Officer settings for the Discord webhooks that announce roster progress. */
export function WebhooksPanel({ guildId, profile, webhooks, characters }: { guildId: string; profile: GameVersion; webhooks: RosterWebhook[]; characters: Character[] }) {
  const t = useTranslations("webhooks");
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const available = new Set(profile.progressEvents);

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
                {w.events.filter((e) => available.has(e)).length === 0
                  ? t("noEvents")
                  : w.events
                      .filter((e) => available.has(e))
                      .map((e) => eventSummary(t, profile, e, w.settings, locale))
                      .join(" · ")}
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
  const [state, setState] = useState<"idle" | "busy" | "sent" | "failed">("idle");
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        className="btn"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          try {
            await apiSend("POST", `/guilds/${guildId}/webhooks/${id}/test`);
            setState("sent");
          } catch {
            setState("failed");
          }
        }}
      >
        {t("test")}
      </button>
      {state === "sent" && <span role="status" className="text-xs text-success">{t("testSent")}</span>}
      {state === "failed" && <span role="alert" className="text-xs text-danger">{t("testFailed")}</span>}
    </span>
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

/** "Every N" plus a free list of exact values, as typed; parsed on save. */
interface ThresholdDraft {
  every: string;
  at: string;
}
const toDraft = (rule: Threshold): ThresholdDraft => ({ every: rule.every ? String(rule.every) : "", at: rule.at.join(", ") });
const fromDraft = (draft: ThresholdDraft): Threshold => ({
  every: Number(draft.every) > 0 ? Math.floor(Number(draft.every)) : null,
  at: [...new Set(draft.at.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b),
});
const draftEmpty = (draft: ThresholdDraft) => !fromDraft(draft).every && fromDraft(draft).at.length === 0;

function ThresholdFields({ id, draft, onChange, unit, placeholder }: { id: string; draft: ThresholdDraft; onChange: (d: ThresholdDraft) => void; unit: string; placeholder: string }) {
  const t = useTranslations("webhooks");
  return (
    <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-end">
      <div>
        <label className="label" htmlFor={`${id}-every`}>{t("every")}</label>
        <div className="flex items-center gap-2">
          <input
            id={`${id}-every`}
            type="number"
            min={1}
            inputMode="numeric"
            className="input w-24"
            value={draft.every}
            onChange={(e) => onChange({ ...draft, every: e.target.value })}
          />
          <span className="text-sm text-muted">{unit}</span>
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`${id}-at`}>{t("atValues")}</label>
        <input id={`${id}-at`} className="input" value={draft.at} placeholder={placeholder} onChange={(e) => onChange({ ...draft, at: e.target.value })} />
      </div>
    </div>
  );
}

/** An event's checkbox with its settings underneath, shown only while it is enabled. */
function EventCard({ eventKey, enabled, onToggle, locale, children }: { eventKey: string; enabled: boolean; onToggle: () => void; locale: string; children?: ReactNode }) {
  const def = PROGRESS_EVENTS.find((e) => e.key === eventKey)!;
  return (
    <div className={`rounded border p-2 ${enabled ? "border-accent/40" : "border-border"}`}>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={enabled} onChange={onToggle} />
        <span>
          <span className="font-medium">{localize(def.name, locale)}</span>
          <span className="block text-xs text-muted">{localize(def.description, locale)}</span>
        </span>
      </label>
      {enabled && children && <div className="mt-2 space-y-2 pl-6">{children}</div>}
    </div>
  );
}

function WebhookForm({ guildId, profile, characters, webhook, onDone }: { guildId: string; profile: GameVersion; characters: Character[]; webhook?: RosterWebhook; onDone: () => void }) {
  const t = useTranslations("webhooks");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const initial = webhook?.settings ?? defaultProgressSettings();
  const available = profile.progressEvents;

  const [label, setLabel] = useState(webhook?.label ?? "");
  const [url, setUrl] = useState("");
  const [msgLocale, setMsgLocale] = useState(webhook?.locale ?? locale);
  const [events, setEvents] = useState<Set<string>>(new Set(webhook?.events ?? available));
  const [allCharacters, setAllCharacters] = useState(webhook?.allCharacters ?? true);
  const [charIds, setCharIds] = useState<Set<string>>(new Set(webhook?.characterIds ?? []));
  const [enabled, setEnabled] = useState(webhook?.enabled ?? true);

  const [level, setLevel] = useState(toDraft(initial.level));
  const [atMax, setAtMax] = useState(initial.level.atMax);
  const [itemLevel, setItemLevel] = useState(toDraft(initial.itemLevel));
  const [rating, setRating] = useState(toDraft(initial.mythicRating));
  const [minKey, setMinKey] = useState(String(initial.mythicPlus.minKey));
  const [professions, setProfessions] = useState<Set<string>>(new Set(initial.profession.professions ?? defaultProgressProfessions(profile)));
  const [profSteps, setProfSteps] = useState(toDraft(initial.profession));
  const [profAtMax, setProfAtMax] = useState(initial.profession.atMax);
  const [profOnLearn, setProfOnLearn] = useState(initial.profession.onLearn);
  const [standings, setStandings] = useState<Set<string>>(new Set(initial.reputation.standings));
  const [renown, setRenown] = useState(toDraft(initial.reputation.renown));
  const [friendship, setFriendship] = useState(initial.reputation.friendship);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  const on = (key: string) => events.has(key);

  // Enabled events whose settings can never fire, flagged before saving instead of silently announcing nothing.
  const inert = [
    on("level_up") && draftEmpty(level) && !atMax,
    on("item_level") && draftEmpty(itemLevel),
    on("mythic_rating") && draftEmpty(rating),
    on("profession") && (professions.size === 0 || (draftEmpty(profSteps) && !profAtMax && !profOnLearn)),
    on("reputation") && standings.size === 0 && (!profile.reputation.renown || draftEmpty(renown)) && !(profile.reputation.friendship && friendship),
  ].some(Boolean);

  async function save() {
    setSaving(true);
    setError(null);
    const settings: ProgressSettings = {
      level: { ...fromDraft(level), atMax },
      itemLevel: fromDraft(itemLevel),
      mythicRating: fromDraft(rating),
      mythicPlus: { minKey: Math.min(40, Math.max(2, Math.floor(Number(minKey)) || 2)) },
      profession: { ...fromDraft(profSteps), professions: [...professions], atMax: profAtMax, onLearn: profOnLearn },
      reputation: { standings: [...standings], renown: fromDraft(renown), friendship },
    };
    const body: Record<string, unknown> = {
      label,
      locale: msgLocale,
      events: [...events].filter((e) => available.includes(e)),
      settings,
      allCharacters,
      characterIds: [...charIds],
      enabled,
    };
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

  const primaries = profile.professions.filter((p) => p.kind === "primary");
  const secondaries = profile.professions.filter((p) => p.kind === "secondary");
  const professionCheckbox = (p: GameVersion["professions"][number]) => (
    <label key={p.key} className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={professions.has(p.key)} onChange={() => setProfessions((s) => toggle(s, p.key))} />
      {localize(p.name, locale)}
      {p.gathering && <span className="text-xs text-muted">({t("gathering")})</span>}
    </label>
  );

  const card = (key: string, children?: ReactNode) =>
    available.includes(key) && (
      <EventCard key={key} eventKey={key} enabled={on(key)} onToggle={() => setEvents((s) => toggle(s, key))} locale={locale}>
        {children}
      </EventCard>
    );

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

      <fieldset className="space-y-2">
        <legend className="label">{t("events")}</legend>
        {card(
          "level_up",
          <>
            <ThresholdFields id="wh-level" draft={level} onChange={setLevel} unit={t("unitLevels")} placeholder={t("atPlaceholderLevel")} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={atMax} onChange={(e) => setAtMax(e.target.checked)} />
              {t("atMaxLevel", { max: profile.maxLevel })}
            </label>
          </>,
        )}
        {card("item_level", <ThresholdFields id="wh-ilvl" draft={itemLevel} onChange={setItemLevel} unit={t("unitItemLevels")} placeholder={t("atPlaceholderItemLevel")} />)}
        {card("raid_boss")}
        {card("raid_cleared")}
        {card(
          "mythic_plus",
          <div>
            <label className="label" htmlFor="wh-minkey">{t("minKey")}</label>
            <div className="flex items-center gap-1">
              <span className="text-sm">+</span>
              <input id="wh-minkey" type="number" min={2} max={40} className="input w-20" value={minKey} onChange={(e) => setMinKey(e.target.value)} />
            </div>
          </div>,
        )}
        {card("mythic_rating", <ThresholdFields id="wh-rating" draft={rating} onChange={setRating} unit={t("unitPoints")} placeholder={t("atPlaceholderRating")} />)}
        {card(
          "profession",
          <>
            <div>
              <p className="label">{t("professions")}</p>
              <div className="grid gap-1 sm:grid-cols-3">{primaries.map(professionCheckbox)}</div>
              {secondaries.length > 0 && (
                <>
                  <p className="mt-2 text-xs text-muted">{t("secondaryProfessions")}</p>
                  <div className="grid gap-1 sm:grid-cols-3">{secondaries.map(professionCheckbox)}</div>
                </>
              )}
            </div>
            <ThresholdFields id="wh-prof" draft={profSteps} onChange={setProfSteps} unit={t("unitSkill")} placeholder={t("atPlaceholderSkill")} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={profAtMax} onChange={(e) => setProfAtMax(e.target.checked)} />
              {t("professionAtMax")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={profOnLearn} onChange={(e) => setProfOnLearn(e.target.checked)} />
              {t("professionOnLearn")}
            </label>
            {!profile.apiProfessions && <p className="text-xs text-muted">{t("manualProfessionsNote")}</p>}
          </>,
        )}
        {card(
          "reputation",
          <>
            <div>
              <p className="label">{t("standings")}</p>
              <div className="grid gap-1 sm:grid-cols-4">
                {profile.reputation.standings.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={standings.has(s.key)} onChange={() => setStandings((set) => toggle(set, s.key))} />
                    {localize(s.name, locale)}
                  </label>
                ))}
              </div>
            </div>
            {profile.reputation.renown && (
              <div>
                <p className="label">{t("renown")}</p>
                <ThresholdFields id="wh-renown" draft={renown} onChange={setRenown} unit={t("unitRenown")} placeholder={t("atPlaceholderRenown")} />
              </div>
            )}
            {profile.reputation.friendship && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={friendship} onChange={(e) => setFriendship(e.target.checked)} />
                {t("friendship")}
              </label>
            )}
          </>,
        )}
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

      {inert && <p className="text-sm text-warning" role="status">{t("inertWarning")}</p>}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t("saving") : t("save")}</button>
        <button type="button" className="btn" onClick={onDone}>{t("cancel")}</button>
      </div>
    </form>
  );
}
