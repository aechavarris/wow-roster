import type { EncounterProgress, InstanceProgress, WarcraftLogsProfile } from "@wow/blizzard";
import type { GameProfile, Localized } from "@wow/config";

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

/** One Warcraft Logs report a roster character appears in, with every roster member in it and its boss kills. */
export interface RosterLog {
  /** Warcraft Logs report code. */
  report: string;
  /** The report's page on the site. */
  url: string;
  type: "raid" | "dungeon";
  zoneId?: number;
  zoneName: Localized;
  /** Profile raid key, when the zone maps to one. */
  zoneKey?: string;
  /** Earliest boss kill in the report, as the log's date. */
  date: string;
  members: RosterLogMember[];
  bosses: { encounterId: number; name: Localized; killedAt: string }[];
}

/** A roster character with its stored Warcraft Logs kills, as buildRosterLogs expects. */
export interface RosterLogCharacter extends RosterLogMember {
  warcraftLogs?: WarcraftLogsProfile | null;
}

/**
 * Builds the roster's recent logs from each character's stored Warcraft Logs kills. Reports are grouped by their
 * code across the whole roster, so a report several roster members raided together lists all of them ("this log is
 * those players'"). Within a report, bosses are deduplicated keeping the latest kill, and the date is the earliest
 * kill. Raids are told from dungeons by the version's `raids[].warcraftLogsZone`. Sorted newest first.
 */
export function buildRosterLogs(
  profile: Pick<GameProfile, "raids">,
  characters: RosterLogCharacter[],
  host: string,
): RosterLog[] {
  const raidByZone = new Map(profile.raids.filter((r) => r.warcraftLogsZone).map((r) => [r.warcraftLogsZone!, r]));
  const byReport = new Map<string, RosterLog & { seenMembers: Set<string>; seenBosses: Map<number, string> }>();

  for (const character of characters) {
    for (const kill of character.warcraftLogs?.kills ?? []) {
      if (!kill.report) continue;
      let log = byReport.get(kill.report);
      if (!log) {
        const raid = kill.zoneId !== undefined ? raidByZone.get(kill.zoneId) : undefined;
        log = {
          report: kill.report,
          url: `https://${host}/reports/${kill.report}`,
          type: raid ? "raid" : "dungeon",
          zoneId: kill.zoneId,
          zoneName: raid ? raid.name : (kill.zoneName ?? { en: kill.zoneId ? `Zone ${kill.zoneId}` : "—" }),
          zoneKey: raid?.key,
          date: kill.killedAt,
          members: [],
          bosses: [],
          seenMembers: new Set(),
          seenBosses: new Map(),
        };
        byReport.set(kill.report, log);
      }
      if (!log.seenMembers.has(character.characterId)) {
        log.seenMembers.add(character.characterId);
        log.members.push({ characterId: character.characterId, name: character.name, classId: character.classId });
      }
      if (kill.killedAt < log.date) log.date = kill.killedAt;
      const seenAt = log.seenBosses.get(kill.encounterId);
      if (seenAt === undefined) {
        log.seenBosses.set(kill.encounterId, kill.killedAt);
        log.bosses.push({ encounterId: kill.encounterId, name: { en: kill.name }, killedAt: kill.killedAt });
      } else if (kill.killedAt > seenAt) {
        log.seenBosses.set(kill.encounterId, kill.killedAt);
        const boss = log.bosses.find((b) => b.encounterId === kill.encounterId);
        if (boss) boss.killedAt = kill.killedAt;
      }
    }
  }

  return [...byReport.values()]
    .map(({ seenMembers: _m, seenBosses: _b, ...log }) => ({ ...log, bosses: log.bosses.sort((a, b) => a.killedAt.localeCompare(b.killedAt)) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Whether stored Warcraft Logs kills should be fetched again (missing, or older than the TTL). */
export function warcraftLogsStale(stored: { warcraftLogs?: WarcraftLogsProfile; missing?: Record<string, string> } | null, now = Date.now()) {
  if (stored?.warcraftLogs) return now - Date.parse(stored.warcraftLogs.fetchedAt) > WARCRAFT_LOGS_TTL_MS;
  return true;
}
