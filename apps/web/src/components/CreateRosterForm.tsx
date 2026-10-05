"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";

/** Creates a roster without an in-game guild, e.g. to plan a team before launch. */
export function CreateRosterForm({ regions, defaultRegion }: { regions: string[]; defaultRegion: string }) {
  const t = useTranslations("createRoster");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="card space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setPending(true);
        setError(null);
        try {
          const { guild } = await apiSend<{ guild: { id: string } }>("POST", "/rosters", {
            name: data.get("name"),
            region: data.get("region"),
          });
          router.push(`/guild/${guild.id}`);
        } catch (err) {
          setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
        } finally {
          setPending(false);
        }
      }}
    >
      <h2 className="heading text-lg">{t("title")}</h2>
      <p className="text-xs text-muted">{t("help")}</p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label" htmlFor="cr-region">{t("region")}</label>
          <select id="cr-region" name="region" defaultValue={defaultRegion} className="input">
            {regions.map((r) => (
              <option key={r} value={r}>{r.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="cr-name">{t("name")}</label>
          <input id="cr-name" name="name" required maxLength={60} className="input" />
        </div>
      </div>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
