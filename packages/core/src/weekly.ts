import type { CharacterProfile, InstanceProgress, LocalizedText } from "@wow/blizzard";
import type { WeeklyRules } from "@wow/config";
import type { Prisma } from "@wow/db";
import { gameVersion, type CoreContext } from "./context";

const DAY_MS = 86_400_000;

/**
 * Start of the game week containing `now`: the last weekly reset of the region (EU Wednesday, US
 * Tuesday…), as configured in the version's profile. Without rules, weeks start on Monday 00:00 UTC.
 */
export function weekStart(rules: WeeklyRules | undefined, region: string, now = new Date()): Date {
  const reset = rules?.reset[region.toLowerCase()] ?? rules?.reset.eu ?? { day: 1, hourUtc: 0 };
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), reset.hourUtc));
  const back = (candidate.getUTCDay() - reset.day + 7) % 7;
  let start = candidate.getTime() - back * DAY_MS;
  if (start > now.getTime()) start -= 7 * DAY_MS;
  return new Date(start);
}

export interface WeekInstance {
  instanceId?: number;
  name: LocalizedText;
  difficulty: string;
  difficultyName?: LocalizedText;
  bosses: { id?: number; name: LocalizedText }[];
}

export interface WeekRun {
  dungeon: LocalizedText;
  level: number;
  timed: boolean;
  completedAt?: string;
}

/** What a character did in one game week. */
export interface WeekActivity {
  raids: WeekInstance[];
  dungeons: WeekInstance[];
  mythicPlus: WeekRun[];
}

/** Bosses whose last kill falls in the week, per instance and difficulty. */
function killedSince(instances: InstanceProgress[] | undefined, from: number, to: number): WeekInstance[] {
  const result: WeekInstance[] = [];
  for (const instance of instances ?? []) {
    for (const mode of instance.modes) {
      const bosses = mode.encounters
        .filter((e) => e.lastKillAt && Date.parse(e.lastKillAt) >= from && Date.parse(e.lastKillAt) < to)
        .map((e) => ({ id: e.id, name: e.name }));
      if (bosses.length > 0) {
        result.push({ instanceId: instance.id, name: instance.name, difficulty: mode.difficulty, difficultyName: mode.difficultyName, bosses });
      }
    }
  }
  return result;
}

/**
 * The week's content from a synced profile. Blizzard gives each boss's last kill time and each
 * Mythic+ run's completion time, so a stale profile (no login since) still yields the right week:
 * nothing counts that happened before the reset.
 */
export function weekActivity(profile: Partial<CharacterProfile> | null, start: Date): WeekActivity {
  const from = start.getTime();
  const to = from + 7 * DAY_MS;
  return {
    raids: killedSince(profile?.raids, from, to),
    dungeons: killedSince(profile?.dungeons, from, to),
    mythicPlus: (profile?.mythicPlus?.weeklyRuns ?? [])
      .filter((run) => run.completedAt && Date.parse(run.completedAt) >= from && Date.parse(run.completedAt) < to)
      .map((run) => ({ dungeon: run.dungeon, level: run.level, timed: run.timed, completedAt: run.completedAt })),
  };
}

/** Great Vault slots unlocked, where the version has a vault: raid bosses and dungeon runs. */
export function vaultSlots(rules: WeeklyRules | undefined, week: WeekActivity) {
  if (!rules?.vault) return null;
  const bosses = new Set(week.raids.flatMap((r) => r.bosses.map((b) => `${r.instanceId}:${b.id ?? JSON.stringify(b.name)}`))).size;
  const runs = week.mythicPlus.length;
  return {
    raid: rules.vault.raid.filter((n) => bosses >= n).length,
    dungeons: rules.vault.dungeons.filter((n) => runs >= n).length,
    bosses,
    runs,
  };
}

/** Stores (or refreshes) the character's row for the current game week. */
export async function recordWeek(
  ctx: CoreContext,
  character: { id: string; gameVersion: string; region: string; equippedItemLevel: number | null },
  profile: Partial<CharacterProfile> | null,
  now = new Date(),
): Promise<void> {
  const start = weekStart(gameVersion(ctx, character.gameVersion).weekly, character.region, now);
  const data = JSON.parse(JSON.stringify(weekActivity(profile, start))) as Prisma.InputJsonValue;
  await ctx.prisma.characterWeek.upsert({
    where: { characterId_weekStart: { characterId: character.id, weekStart: start } },
    create: { characterId: character.id, weekStart: start, data, itemLevel: character.equippedItemLevel },
    update: { data, itemLevel: character.equippedItemLevel },
  });
}
