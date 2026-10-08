"use client";

import { localize } from "@wow/config";
import { useLocale, useTranslations } from "next-intl";
import type { GameVersion } from "@/lib/types";

interface Props {
  id: string;
  versions: GameVersion[];
  defaultValue?: string;
  value?: string;
  onChange?: (id: string) => void;
  /** Only versions Blizzard has an API for (searching, linking a guild). */
  requireApi?: boolean;
  disabled?: boolean;
}

/** Picks the game version of a roster or a search: each one has its own classes, specs, buffs and API. */
export function VersionSelect({ id, versions, defaultValue, value, onChange, requireApi, disabled }: Props) {
  const t = useTranslations("versions");
  const locale = useLocale();
  const options = versions.filter((v) => !requireApi || v.apiAvailable);
  return (
    <div>
      <label className="label" htmlFor={id}>{t("label")}</label>
      <select
        id={id}
        name="gameVersion"
        className="input"
        disabled={disabled}
        {...(value !== undefined ? { value } : { defaultValue: defaultValue ?? options[0]?.id })}
        onChange={(e) => onChange?.(e.target.value)}
      >
        {options.map((v) => (
          <option key={v.id} value={v.id}>
            {localize(v.name, locale)}
            {v.apiAvailable ? "" : ` (${t("plannedOnly")})`}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Small badge with the version's short name. */
export function VersionBadge({ version }: { version: GameVersion }) {
  const locale = useLocale();
  const t = useTranslations("versions");
  const badge = <span className="badge border border-accent/40 text-accent">{localize(version.name, locale)}</span>;
  if (!version.apiStandIn) return badge;
  // Test mode: the characters are real, but from another version's API (Forever before its API is public).
  const source = localize(version.apiStandIn.name, locale);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {badge}
      <span className="badge border border-dashed border-warning/60 text-warning" title={t("standInHint", { source })}>
        {t("standIn", { source })}
      </span>
    </span>
  );
}
