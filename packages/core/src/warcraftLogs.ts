import type { EncounterProgress, InstanceProgress, WarcraftLogsProfile } from "@wow/blizzard";
import type { GameProfile, Localized } from "@wow/config";
import { Prisma } from "@wow/db";
import type { CoreContext } from "./context";

/** How long Warcraft Logs kills are reused before asking again: logs are uploaded after the raid, not live. */
export const WARCRAFT_LOGS_TTL_MS = 6 * 3_600_000;

/**
 * Raid progress built from the character's Warcraft Logs kills, in the shape the encounters API gives: one instance
 * per configured raid with kills in its zone, each boss with its kill count and last kill. Only recent reports are
 * read, so this is recent progress, which is what a roster audits (and the weekly audit needs the kill times).
 */
export function instancesFromWarcraftLogs(profile: Pick<GameProfile, "raids">, logs: WarcraftLogsProfile): InstanceProgress[] {
  const instances: InstanceProgress[] = [];
  for (const raid of profile.raids) {
    if (!raid.warcraftLogsZone) continue;
    const bosses = new Map<number, EncounterProgress>();
    const ofRaid = logs.kills.filter(
      (k) => k.zoneId === raid.warcraftLogsZone && (!raid.warcraftLogsEncounters || raid.warcraftLogsEncounters.includes(k.encounterId)),
    );
    for (const kill of ofRaid) {
      const boss = bosses.get(kill.encounterId) ?? { id: kill.encounterId, name: { en: kill.name }, kills: 0 };
      boss.kills++;
      if (!boss.lastKillAt || kill.killedAt > boss.lastKillAt) boss.lastKillAt = kill.killedAt;
      bosses.set(kill.encounterId, boss);
    }
    if (bosses.size === 0) continue;
    const encounters = [...bosses.values()];
    instances.push({
      id: raid.warcraftLogsZone,
      name: raid.name,
      modes: [
        {
          difficulty: "NORMAL",
          difficultyName: { en: `${raid.size}-player`, es: `${raid.size} j.` },
          completed: encounters.length,
          // Only killed bosses are known; the total comes from the profile.
          total: Math.max(raid.bossCount ?? 0, encounters.length),
          encounters,
        },
      ],
    });
  }
  return instances;
}

/** One roster character that took part in a log. */
export interface RosterLogMember {
  characterId: string;
  name: string;
  classId: number | null;
}

/** One Warcraft Logs report a roster character appears in, with every roster member seen in it. */
export interface RosterLog {
  /** Warcraft Logs report code. */
  report: string;
  /** The report's page on the site. */
  url: string;
  type: "raid" | "dungeon";
  zoneName: Localized;
  /** Earliest boss kill in the report, as the log's date (ISO). */
  date: string;
  members: RosterLogMember[];
}

/**
 * Persists the reports a character appears in, so a roster's Logs view is a growing history rather than only the
 * handful of recent reports the API returns. One row per report (deduped from the character's kills); the character
 * is linked to each. Raids are told from dungeons by the version's `raids[].warcraftLogsZone`. Best effort: a
 * failure here never breaks a sync.
 */
export async function persistWarcraftLogsReports(
  ctx: CoreContext,
  character: { id: string },
  logs: WarcraftLogsProfile | null | undefined,
  profile: Pick<GameProfile, "raids" | "api">,
): Promise<void> {
  const host = profile.api.warcraftLogs?.host;
  if (!host || !logs?.kills?.length) return;
  const raidByZone = new Map(profile.raids.filter((r) => r.warcraftLogsZone).map((r) => [r.warcraftLogsZone!, r]));
  // Also match by the report's zone name, so a raid is recognised even without a mapped Warcraft Logs zone id (MoP).
  const en = (name: Localized | undefined) => (name?.en ?? Object.values(name ?? {})[0] ?? "").trim().toLowerCase();
  const raidByName = new Map(profile.raids.map((r) => [en(r.name), r] as const).filter(([name]) => name));
  const byReport = new Map<string, { zoneId?: number; zoneName: Localized; type: string; date: string }>();
  for (const kill of logs.kills) {
    if (!kill.report) continue;
    const existing = byReport.get(kill.report);
    if (existing) {
      if (kill.killedAt < existing.date) existing.date = kill.killedAt;
      continue;
    }
    const raid = (kill.zoneId !== undefined ? raidByZone.get(kill.zoneId) : undefined) ?? (kill.zoneName ? raidByName.get(en(kill.zoneName)) : undefined);
    byReport.set(kill.report, {
      zoneId: kill.zoneId,
      zoneName: raid ? raid.name : (kill.zoneName ?? { en: kill.zoneId ? `Zone ${kill.zoneId}` : "—" }),
      type: raid ? "raid" : "dungeon",
      date: kill.killedAt,
    });
  }
  try {
    for (const [code, r] of byReport) {
      await ctx.prisma.warcraftLogsReport.upsert({
        where: { code },
        create: { code, host, zoneId: r.zoneId ?? null, zoneName: r.zoneName as Prisma.InputJsonValue, type: r.type, date: new Date(r.date) },
        // The report's facts are stable; only touch updatedAt so re-syncs do not flip the first-seen date.
        update: {},
      });
      await ctx.prisma.warcraftLogsReportCharacter.upsert({
        where: { reportCode_characterId: { reportCode: code, characterId: character.id } },
        create: { reportCode: code, characterId: character.id },
        update: {},
      });
    }
  } catch {
    // History is best effort and must never fail a sync.
  }
}

/** A persisted report linked to one roster character, as groupReportLinks expects (already filtered to the roster). */
export interface ReportLink {
  report: { code: string; host: string; zoneName: Localized; type: string; date: string };
  character: RosterLogMember;
}

/**
 * Groups report-character links into the roster's logs: one entry per report, listing every roster member seen in
 * it ("this log is those players'"), newest first. Links must already be limited to the roster's characters.
 */
export function groupReportLinks(links: ReportLink[]): RosterLog[] {
  const byCode = new Map<string, RosterLog>();
  for (const link of links) {
    let log = byCode.get(link.report.code);
    if (!log) {
      log = {
        report: link.report.code,
        url: `https://${link.report.host}/reports/${link.report.code}`,
        type: link.report.type === "raid" ? "raid" : "dungeon",
        zoneName: link.report.zoneName,
        date: link.report.date,
        members: [],
      };
      byCode.set(link.report.code, log);
    }
    if (!log.members.some((m) => m.characterId === link.character.characterId)) log.members.push(link.character);
  }
  return [...byCode.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** Whether stored Warcraft Logs kills should be fetched again (missing, or older than the TTL). */
export function warcraftLogsStale(stored: { warcraftLogs?: WarcraftLogsProfile; missing?: Record<string, string> } | null, now = Date.now()) {
  if (stored?.warcraftLogs) return now - Date.parse(stored.warcraftLogs.fetchedAt) > WARCRAFT_LOGS_TTL_MS;
  return true;
}
