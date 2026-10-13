"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";
import type { Guild } from "@/lib/types";

// The two visibility flags collapse into three mutually exclusive states the owner picks from. "public" is a
// superset of "published" (anyone, signed in or not), so it keeps "published" set too and the model stays monotonic.
type Visibility = "draft" | "published" | "public";
const STATES: Visibility[] = ["draft", "published", "public"];
const FLAGS: Record<Visibility, { public: boolean; published: boolean }> = {
  draft: { public: false, published: false },
  published: { public: false, published: true },
  public: { public: true, published: true },
};
const current = (guild: Guild): Visibility => (guild.public ? "public" : guild.published ? "published" : "draft");

/** Owner-only: whether the roster is a hidden draft, listed to signed-in users, or public to everyone. */
export function VisibilityForm({ guild }: { guild: Guild }) {
  const t = useTranslations("visibility");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  // Shown at once and rolled back if the save fails, so the choice reacts to the click.
  const [value, setValue] = useState<Visibility>(current(guild));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: Visibility) {
    const prev = value;
    setValue(next);
    setPending(true);
    setError(null);
    try {
      await apiSend("PATCH", `/guilds/${guild.id}`, FLAGS[next]);
      router.refresh();
    } catch (err) {
      setValue(prev);
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="heading text-lg">{t("title")}</h2>
        <p className="text-xs text-muted">{t("help")}</p>
      </div>
      <fieldset className="space-y-2" disabled={pending}>
        {STATES.map((state) => (
          <label key={state} className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="visibility"
              className="mt-1"
              value={state}
              checked={value === state}
              onChange={() => choose(state)}
            />
            <span>
              <span className="font-medium">{t(`options.${state}.label`)}</span>
              <span className="block text-xs text-muted">{t(`options.${state}.help`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
