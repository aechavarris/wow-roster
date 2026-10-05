"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { ApiError, apiSend } from "@/lib/client-api";

interface Props {
  regions: string[];
  defaultRegion: string;
  hasRealms: boolean;
}

export function GuildRegisterForm({ regions, defaultRegion, hasRealms }: Props) {
  const t = useTranslations("guildRegister");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { guild } = await apiSend<{ guild: { id: string } }>("POST", "/guilds", {
        region: form.get("region"),
        realm: form.get("realm"),
        name: form.get("name"),
      });
      router.push(`/guild/${guild.id}`);
    } catch (err) {
      setError(err instanceof ApiError && tErrors.has(err.code) ? tErrors(err.code) : tErrors("unknown_error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3">
      <h2 className="heading text-lg">{t("title")}</h2>
      <p className="text-xs text-muted">{t("help")}</p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label" htmlFor="gr-region">{t("region")}</label>
          <select id="gr-region" name="region" defaultValue={defaultRegion} className="input">
            {regions.map((r) => (
              <option key={r} value={r}>{r.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="gr-realm">{hasRealms ? t("realm") : t("ruleset")}</label>
          <input id="gr-realm" name="realm" required className="input" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="gr-name">{t("name")}</label>
        <input id="gr-name" name="name" required className="input" />
      </div>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
