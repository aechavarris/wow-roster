"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { characterPath } from "@/lib/game";

interface Props {
  regions: string[];
  defaultRegion: string;
  hasRealms: boolean;
}

export function CharacterSearch({ regions, defaultRegion, hasRealms }: Props) {
  const t = useTranslations("characterSearch");
  const router = useRouter();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const realm = String(form.get("realm")).trim().toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "-");
    router.push(characterPath({ region: String(form.get("region")), realm, name: String(form.get("name")).trim() }));
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3">
      <h2 className="heading text-lg">{t("title")}</h2>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label" htmlFor="cs-region">{t("region")}</label>
          <select id="cs-region" name="region" defaultValue={defaultRegion} className="input">
            {regions.map((r) => (
              <option key={r} value={r}>{r.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="cs-realm">{hasRealms ? t("realm") : t("ruleset")}</label>
          <input id="cs-realm" name="realm" required className="input" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="cs-name">{t("name")}</label>
        <input id="cs-name" name="name" required className="input" />
      </div>
      <button type="submit" className="btn w-full">{t("submit")}</button>
    </form>
  );
}
