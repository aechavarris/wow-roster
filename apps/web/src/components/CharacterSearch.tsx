"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { characterPath } from "@/lib/game";
import type { GameVersion } from "@/lib/types";
import { VersionSelect } from "./VersionSelect";

interface Props {
  regions: string[];
  defaultRegion: string;
  /** Versions with a Blizzard API; the first one is preselected. */
  versions: GameVersion[];
}

export function CharacterSearch({ regions, defaultRegion, versions }: Props) {
  const t = useTranslations("characterSearch");
  const router = useRouter();
  const [version, setVersion] = useState(versions[0]!);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const realm = String(form.get("realm")).trim().toLowerCase().replace(/['’]/g, "").replace(/\s+/g, "-");
    router.push(characterPath({ gameVersion: version.id, region: String(form.get("region")), realm, name: String(form.get("name")).trim() }));
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-3">
      <h2 className="heading text-lg">{t("title")}</h2>
      <VersionSelect id="cs-version" versions={versions} value={version.id} onChange={(id) => setVersion(versions.find((v) => v.id === id)!)} />
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
          <label className="label" htmlFor="cs-realm">{version.hasRealms ? t("realm") : t("ruleset")}</label>
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
