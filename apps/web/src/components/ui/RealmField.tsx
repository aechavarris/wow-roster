"use client";

import { localize } from "@wow/config";
import { useLocale } from "next-intl";
import type { GameVersion } from "@/lib/types";

/**
 * The realm of a character or guild: free text where the version has realms, a pick of its rulesets where it has
 * none (Forever), so the opaque realm key always matches one of them.
 */
export function RealmField({
  version,
  id,
  className = "input",
  label,
}: {
  version: Pick<GameVersion, "rulesets">;
  id?: string;
  className?: string;
  /** Accessible name and placeholder when there is no visible label. */
  label?: string;
}) {
  const locale = useLocale();
  if (version.rulesets.length === 0) {
    return <input id={id} name="realm" required className={className} placeholder={label} aria-label={label} />;
  }
  return (
    <select id={id} name="realm" required className={className} aria-label={label} defaultValue={version.rulesets[0]!.key}>
      {version.rulesets.map((r) => (
        <option key={r.key} value={r.key}>
          {localize(r.name, locale)}
        </option>
      ))}
    </select>
  );
}
