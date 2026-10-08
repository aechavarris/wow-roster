"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { classColor, classText } from "@/lib/game";
import { tr } from "@/lib/text";
import type { GameVersion, RosterLog } from "@/lib/types";

/** Recent Warcraft Logs reports of a roster, grouped by character (a shared log shows under each member) or flat. */
export function RosterLogs({ version, logs }: { version: GameVersion; logs: RosterLog[] }) {
  const t = useTranslations("logs");
  const locale = useLocale();
  const format = useFormatter();
  const [mode, setMode] = useState<"character" | "time">("character");

  // Characters that appear in any log, in name order, each with the logs they took part in (newest first).
  const byCharacter = useMemo(() => {
    const map = new Map<string, { name: string; classId: number | null; logs: RosterLog[] }>();
    for (const log of logs) {
      for (const m of log.members) {
        const entry = map.get(m.characterId) ?? { name: m.name, classId: m.classId, logs: [] };
        entry.logs.push(log);
        map.set(m.characterId, entry);
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [logs]);

  if (logs.length === 0) return <p className="card text-muted">{t("empty")}</p>;

  const Members = ({ log, exclude }: { log: RosterLog; exclude?: string }) => {
    const shown = log.members.filter((m) => m.name !== exclude);
    if (shown.length === 0) return null;
    return (
      <span className="flex flex-wrap items-center gap-1">
        {exclude && <span className="text-xs text-muted">{t("with")}</span>}
        {shown.map((m) => (
          <span key={m.characterId} className="text-class text-xs font-medium" style={classText(classColor(version, m.classId))}>
            {m.name}
          </span>
        ))}
      </span>
    );
  };

  const LogRow = ({ log, exclude }: { log: RosterLog; exclude?: string }) => (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="text-sm text-muted">{format.dateTime(new Date(log.date), { dateStyle: "medium" })}</span>
      <a href={log.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
        {tr(log.zoneName, locale)}
      </a>
      <span className={`badge ${log.type === "raid" ? "border border-accent/60 text-accent" : "bg-surface-2 text-muted"}`}>
        {t(log.type)}
      </span>
      <span className="text-xs text-muted">{t("bosses", { count: log.bosses.length })}</span>
      <Members log={log} exclude={exclude} />
    </li>
  );

  return (
    <div className="space-y-3">
      <div className="flex rounded-md border border-border text-sm">
        <button type="button" className={`px-3 py-1 ${mode === "character" ? "bg-white/10" : ""}`} onClick={() => setMode("character")}>
          {t("byCharacter")}
        </button>
        <button type="button" className={`px-3 py-1 ${mode === "time" ? "bg-white/10" : ""}`} onClick={() => setMode("time")}>
          {t("chronological")}
        </button>
      </div>

      {mode === "time" ? (
        <ul className="card divide-y divide-border">
          {logs.map((log) => (
            <LogRow key={log.report} log={log} />
          ))}
        </ul>
      ) : (
        <div className="space-y-4">
          {byCharacter.map((c) => (
            <section key={c.name} className="card space-y-1">
              <h2 className="text-class heading text-base" style={classText(classColor(version, c.classId))}>
                {c.name}
              </h2>
              <ul className="divide-y divide-border">
                {c.logs.map((log) => (
                  <LogRow key={log.report} log={log} exclude={c.name} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
