"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import { tr } from "@/lib/text";
import type { GameVersion, ManualProfession } from "@/lib/types";

type Draft = { id: number | null; skill: string };

/** Owner-only editor for professions the game version's API does not provide. */
export function ManualProfessionsForm({ game, manual, characterId }: { game: GameVersion; manual: ManualProfession[]; characterId: string }) {
  const t = useTranslations("character");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const router = useRouter();
  const primaries = game.professions.filter((p) => p.kind === "primary");
  const secondaries = game.professions.filter((p) => p.kind === "secondary");
  const kindOf = (id: number) => game.professions.find((p) => p.id === id)?.kind;
  const skillText = (m?: ManualProfession) => (m?.skill != null ? String(m.skill) : "");

  const initial = () => {
    const own = manual.filter((m) => kindOf(m.id) === "primary");
    return {
      primary: Array.from({ length: game.maxPrimaryProfessions }, (_, i): Draft => ({ id: own[i]?.id ?? null, skill: skillText(own[i]) })),
      secondary: Object.fromEntries(
        secondaries.map((s) => {
          const m = manual.find((x) => x.id === s.id);
          return [s.id, { on: Boolean(m), skill: skillText(m) }];
        }),
      ) as Record<number, { on: boolean; skill: string }>,
    };
  };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxOf = (id: number | null) => game.professions.find((p) => p.id === id)?.maxSkill;
  const toSkill = (value: string) => (value.trim() === "" ? null : Number(value));

  async function save() {
    setSaving(true);
    setError(null);
    const professions = [
      ...draft.primary.filter((p) => p.id !== null).map((p) => ({ id: p.id!, skill: toSkill(p.skill) })),
      ...secondaries.filter((s) => draft.secondary[s.id]?.on).map((s) => ({ id: s.id, skill: toSkill(draft.secondary[s.id]!.skill) })),
    ];
    try {
      await apiSend("PUT", `/characters/${characterId}/professions`, { professions });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => (setDraft(initial()), setOpen(true))}>
        {t("editProfessions")}
      </button>
    );
  }

  const skillInput = (id: number | null, value: string, onChange: (v: string) => void, label: string) => (
    <input
      type="number"
      min={1}
      max={maxOf(id)}
      inputMode="numeric"
      className="input w-24"
      aria-label={label}
      placeholder={t("skill")}
      value={value}
      disabled={id === null}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {draft.primary.map((p, i) => {
        const label = t("primaryProfession", { number: i + 1 });
        // A primary already picked in the other slot is not offered again.
        const taken = new Set(draft.primary.filter((_, j) => j !== i).map((x) => x.id));
        return (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label className="label" htmlFor={`prof-primary-${i}`}>{label}</label>
              <select
                id={`prof-primary-${i}`}
                className="input"
                value={p.id ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setDraft((d) => ({ ...d, primary: d.primary.map((x, j) => (j === i ? { id, skill: id ? x.skill : "" } : x)) }));
                }}
              >
                <option value="">{t("noProfession")}</option>
                {primaries
                  .filter((o) => !taken.has(o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>{tr(o.name, locale)}</option>
                  ))}
              </select>
            </div>
            {skillInput(p.id, p.skill, (v) => setDraft((d) => ({ ...d, primary: d.primary.map((x, j) => (j === i ? { ...x, skill: v } : x)) })), `${label}: ${t("skill")}`)}
          </div>
        );
      })}
      {secondaries.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="label">{t("secondaryProfessions")}</legend>
          {secondaries.map((s) => {
            const state = draft.secondary[s.id]!;
            const name = tr(s.name, locale);
            return (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={state.on}
                    onChange={(e) => setDraft((d) => ({ ...d, secondary: { ...d.secondary, [s.id]: { ...state, on: e.target.checked } } }))}
                  />
                  {name}
                </label>
                {skillInput(state.on ? s.id : null, state.skill, (v) => setDraft((d) => ({ ...d, secondary: { ...d.secondary, [s.id]: { ...state, skill: v } } })), `${name}: ${t("skill")}`)}
              </div>
            );
          })}
        </fieldset>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? t("saving") : t("save")}
        </button>
        <button type="button" className="btn" disabled={saving} onClick={() => setOpen(false)}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
