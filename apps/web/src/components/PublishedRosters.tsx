"use client";

import { localize } from "@wow/config";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/routing";
import { versionOf } from "@/lib/game";
import type { PublicConfig, PublishedRoster } from "@/lib/types";
import { VersionBadge } from "./VersionSelect";

const ALL = "";

/** Rosters their owners published: any signed-in user can open them and propose characters. */
export function PublishedRosters({ rosters, config }: { rosters: PublishedRoster[]; config: PublicConfig }) {
  const t = useTranslations("published");
  const tHome = useTranslations("home");
  const locale = useLocale();
  const [version, setVersion] = useState(ALL);
  const shown = rosters.filter((r) => version === ALL || r.gameVersion === version);

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="heading text-lg">{t("title")}</h2>
          <p className="text-xs text-muted">{t("help")}</p>
        </div>
        <div>
          <label className="label" htmlFor="published-version">{t("filter")}</label>
          <select id="published-version" className="input w-auto" value={version} onChange={(e) => setVersion(e.target.value)}>
            <option value={ALL}>{t("all")}</option>
            {config.versions.map((v) => (
              <option key={v.id} value={v.id}>{localize(v.name, locale)}</option>
            ))}
          </select>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex flex-wrap items-center gap-2">
                <Link href={`/guild/${r.id}`} className="font-medium hover:text-accent">
                  {r.name}
                </Link>
                <span className="badge bg-surface-2 text-muted">{tHome(r.kind === "custom" ? "kindCustom" : "kindGuild")}</span>
                <VersionBadge version={versionOf(config, r.gameVersion)} />
              </span>
              <span className="text-xs text-muted">
                {r.realm ? `${r.realm} · ` : ""}
                {r.region.toUpperCase()} · {t("entries", { count: r.entries })}
                {r.owner ? ` · ${t("by", { name: r.owner })}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
