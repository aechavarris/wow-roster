"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { apiSend } from "@/lib/client-api";
import { tr } from "@/lib/text";
import type { GameVersion } from "@/lib/types";

/**
 * Attunements of the character's game version. No API reports them, so the owner ticks them here (each tick is
 * saved at once); everyone else sees which ones the character has.
 */
export function RequirementsPanel({ game, done, characterId, canEdit }: { game: GameVersion; done: string[] | null; characterId: string; canEdit: boolean }) {
  const t = useTranslations("character");
  const locale = useLocale();
  const router = useRouter();
  const [checked, setChecked] = useState(() => new Set(done ?? []));
  const [saving, setSaving] = useState(false);
  if (game.requirements.length === 0) return null;
  const raidName = (key?: string) => tr(game.raids.find((r) => r.key === key)?.name, locale);

  async function toggle(key: string, on: boolean) {
    const next = new Set(checked);
    if (on) next.add(key);
    else next.delete(key);
    setChecked(next);
    setSaving(true);
    try {
      await apiSend("PUT", `/characters/${characterId}/requirements`, { requirements: [...next] });
      router.refresh();
    } catch {
      setChecked(checked);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="heading text-lg">{t("requirements")}</h2>
        <p className="text-xs text-muted">{t(canEdit ? "requirementsHelpOwner" : "requirementsHelp")}</p>
      </div>
      <ul className="space-y-1.5 text-sm">
        {game.requirements.map((r) => {
          const has = checked.has(r.key);
          const label = (
            <>
              <span>{tr(r.name, locale)}</span>
              {r.raid && <span className="text-xs text-muted"> · {raidName(r.raid)}</span>}
            </>
          );
          return (
            <li key={r.key}>
              {canEdit ? (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={has} disabled={saving} onChange={(e) => void toggle(r.key, e.target.checked)} />
                  <span>{label}</span>
                </label>
              ) : (
                <span className="flex items-center gap-2">
                  <span className={has ? "text-success" : "text-muted"} aria-label={has ? t("requirementDone") : t("requirementMissing")}>
                    {has ? "✓" : "✗"}
                  </span>
                  <span>{label}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
