import type { EncounterProgress, InstanceProgress, WarcraftLogsProfile } from "@wow/blizzard";
import type { GameProfile } from "@wow/config";

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

/** Whether stored Warcraft Logs kills should be fetched again (missing, or older than the TTL). */
export function warcraftLogsStale(stored: { warcraftLogs?: WarcraftLogsProfile; missing?: Record<string, string> } | null, now = Date.now()) {
  if (stored?.warcraftLogs) return now - Date.parse(stored.warcraftLogs.fetchedAt) > WARCRAFT_LOGS_TTL_MS;
  return true;
}
