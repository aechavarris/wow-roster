"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { apiSend } from "@/lib/client-api";
import { characterPath, classColor, className, classText, specName } from "@/lib/game";
import type { MeResponse, PublicConfig } from "@/lib/types";

interface Props {
  characters: NonNullable<MeResponse["characters"]>;
  profile: PublicConfig["profile"];
}

export function MyCharacters({ characters, profile }: Props) {
  const t = useTranslations("myCharacters");
  const locale = useLocale();
  const router = useRouter();

  async function setMain(id: string) {
    await apiSend("POST", `/me/characters/${id}/main`);
    router.refresh();
  }

  return (
    <div className="card">
      <h2 className="heading mb-1 text-lg">{t("title")}</h2>
      <p className="mb-3 text-xs text-muted">{t("help")}</p>
      {characters.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {characters.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-md border border-border bg-surface-2 p-2">
              {c.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Blizzard renders are already sized thumbnails.
                <img src={c.avatarUrl} alt="" width={40} height={40} className="rounded" />
              ) : (
                <div className="h-10 w-10 rounded bg-border" />
              )}
              <div className="min-w-0 flex-1">
                <Link href={characterPath(c)} className="text-class block truncate font-medium" style={classText(classColor(profile, c.classId))}>
                  {c.name}
                </Link>
                <p className="truncate text-xs text-muted">
                  {c.level} · {specName(profile, c.classId, c.specName, locale)} {className(profile, c.classId, locale)}
                  {c.equippedItemLevel ? ` · ${t("ilvl", { value: Math.round(c.equippedItemLevel) })}` : ""}
                  {c.guild ? ` · ${c.guild.name}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMain(c.id)}
                className={`text-lg ${c.isMain ? "text-accent" : "text-muted hover:text-accent"}`}
                title={c.isMain ? t("isMain") : t("setMain")}
                aria-pressed={c.isMain}
              >
                {c.isMain ? "★" : "☆"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
