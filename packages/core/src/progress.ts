import type { InstanceProgress, MythicPlusProfile, Profession, Reputation } from "@wow/blizzard";
import type { GameProfile, Localized, ProgressEventKey } from "@wow/config";
import { gameVersion, type CoreContext } from "./context";

/**
 * Character-progress announcements. On each sync the new state is compared to the previous one and the differences
 * become events (a boss killed for the first time, a level or item-level gain, a new Mythic+ best, a profession or
 * reputation milestone). A roster's Discord webhooks then post the events they are configured for, so a guild sees
 * its members' progress in a channel. Only transitions are announced, never the state at first sight.
 */

/** The slice of a character used to detect progress. Built from the stored Character row and its profile JSON. */
export interface ProgressSnapshot {
  level: number;
  equippedItemLevel: number | null;
  raids?: InstanceProgress[] | null;
  mythicPlus?: MythicPlusProfile | null;
  professions?: Profession[] | null;
  reputations?: Reputation[] | null;
}

export interface ProgressEvent {
  type: ProgressEventKey;
  /** Main subject (zone, faction, profession, dungeon). */
  title?: Localized;
  /** Secondary subject (boss within a raid). */
  subtitle?: Localized;
  /** Number the message shows (level, item level, key level, rating, skill). */
  value?: number;
}

const floor = (v: number | null | undefined) => (typeof v === "number" ? Math.floor(v) : undefined);
const bestKey = (mp: MythicPlusProfile | null | undefined) =>
  Math.max(0, ...[...(mp?.seasonRuns ?? []), ...(mp?.weeklyRuns ?? [])].map((r) => r.level ?? 0));
const headlineSkill = (p: Profession) => Math.max(p.skill ?? 0, ...p.tiers.map((t) => t.skill ?? 0));
const professionCap = (p: Profession) => Math.max(p.maxSkill ?? 0, ...p.tiers.map((t) => t.maxSkill ?? 0));

/** Every (instance, difficulty, encounter) a character has a kill for, keyed for cheap "was it killed before?" checks. */
function killedBosses(raids: InstanceProgress[] | null | undefined) {
  const set = new Set<string>();
  const cleared = new Set<string>();
  for (const instance of raids ?? []) {
    for (const mode of instance.modes) {
      if (mode.total > 0 && mode.completed >= mode.total) cleared.add(`${instance.id}:${mode.difficulty}`);
      for (const boss of mode.encounters) {
        if (boss.kills > 0 || boss.lastKillAt) set.add(`${instance.id}:${mode.difficulty}:${boss.id}`);
      }
    }
  }
  return { set, cleared };
}

/**
 * The progress events between two snapshots. Returns nothing when `before` is null (first sync): only changes are
 * announced. Raid events are capped so one catch-up sync cannot post a wall of messages.
 */
export function detectProgressEvents(profile: GameProfile, before: ProgressSnapshot | null, after: ProgressSnapshot): ProgressEvent[] {
  if (!before) return [];
  const events: ProgressEvent[] = [];

  if (after.level > before.level) {
    if (after.level >= profile.maxLevel && before.level < profile.maxLevel) events.push({ type: "max_level", value: after.level });
    else events.push({ type: "level_up", value: after.level });
  }

  const beforeIl = floor(before.equippedItemLevel);
  const afterIl = floor(after.equippedItemLevel);
  if (afterIl !== undefined && beforeIl !== undefined && afterIl > beforeIl) events.push({ type: "item_level", value: afterIl });

  const past = killedBosses(before.raids);
  const now = killedBosses(after.raids);
  const newBosses: ProgressEvent[] = [];
  for (const instance of after.raids ?? []) {
    for (const mode of instance.modes) {
      for (const boss of mode.encounters) {
        const key = `${instance.id}:${mode.difficulty}:${boss.id}`;
        if ((boss.kills > 0 || boss.lastKillAt) && !past.set.has(key)) {
          newBosses.push({ type: "raid_boss", title: instance.name, subtitle: boss.name });
        }
      }
    }
  }
  // Cap the per-sync raid flood (e.g. a character first joined to Warcraft Logs gains many kills at once).
  events.push(...newBosses.slice(0, 10));
  for (const key of now.cleared) {
    if (!past.cleared.has(key)) {
      const instance = (after.raids ?? []).find((i) => `${i.id}:${i.modes.find((m) => `${i.id}:${m.difficulty}` === key)?.difficulty}` === key);
      events.push({ type: "raid_cleared", title: instance?.name });
    }
  }

  const beforeKey = bestKey(before.mythicPlus);
  const afterKey = bestKey(after.mythicPlus);
  if (afterKey > beforeKey) events.push({ type: "mythic_plus", value: afterKey });
  const beforeRating = Math.round(before.mythicPlus?.rating ?? 0);
  const afterRating = Math.round(after.mythicPlus?.rating ?? 0);
  if (afterRating > beforeRating && afterRating > 0) events.push({ type: "mythic_rating", value: afterRating });

  const beforeProf = new Map((before.professions ?? []).map((p) => [p.id, p]));
  for (const prof of after.professions ?? []) {
    const old = beforeProf.get(prof.id);
    const skill = headlineSkill(prof);
    const cap = professionCap(prof);
    if (!old && skill > 0) events.push({ type: "profession", title: prof.name, value: skill });
    else if (old && cap > 0 && skill >= cap && headlineSkill(old) < cap) events.push({ type: "profession", title: prof.name, value: skill });
  }

  const beforeRep = new Map((before.reputations ?? []).map((r) => [r.factionId, r]));
  for (const rep of after.reputations ?? []) {
    const old = beforeRep.get(rep.factionId);
    if (rep.tier !== undefined && (old?.tier ?? -1) < rep.tier && rep.standing) {
      events.push({ type: "reputation", title: rep.name, subtitle: rep.standing });
    }
  }

  return events;
}

const pick = (text: Localized | undefined, locale: string) => (text ? (text[locale] ?? text.en ?? Object.values(text)[0] ?? "") : "");

/** One announcement line per event, in the webhook's language. */
function line(event: ProgressEvent, locale: string): string {
  const es = locale === "es";
  const title = pick(event.title, locale);
  const subtitle = pick(event.subtitle, locale);
  switch (event.type) {
    case "level_up":
      return es ? `⬆️ Subió a nivel ${event.value}` : `⬆️ Reached level ${event.value}`;
    case "max_level":
      return es ? `🎉 ¡Alcanzó el nivel máximo (${event.value})!` : `🎉 Hit max level (${event.value})!`;
    case "item_level":
      return es ? `🛡️ Mejoró su nivel de objeto a ${event.value}` : `🛡️ Improved item level to ${event.value}`;
    case "raid_boss":
      return es ? `⚔️ Derrotó a ${subtitle} en ${title}` : `⚔️ Killed ${subtitle} in ${title}`;
    case "raid_cleared":
      return es ? `🏆 Completó ${title}` : `🏆 Cleared ${title}`;
    case "mythic_plus":
      return es ? `🗝️ Logró una Mítica+${event.value}` : `🗝️ Completed a Mythic+${event.value}`;
    case "mythic_rating":
      return es ? `📈 Subió su puntuación M+ a ${event.value}` : `📈 Raised M+ rating to ${event.value}`;
    case "profession":
      return es ? `🔨 ${title} a ${event.value}` : `🔨 ${title} at ${event.value}`;
    case "reputation":
      return es ? `🤝 Alcanzó ${subtitle} con ${title}` : `🤝 Reached ${subtitle} with ${title}`;
    default:
      return "";
  }
}

const hexToInt = (hex: string | undefined) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  return m ? parseInt(m[1]!, 16) : 0x5865f2; // Discord blurple fallback
};

/** Builds the Discord webhook payload (an embed) for a character's events in the webhook's language. */
export function formatProgressMessage(
  profile: GameProfile,
  character: { name: string; classId: number | null },
  events: ProgressEvent[],
  locale: string,
): { embeds: { title: string; color: number; description: string; timestamp: string }[] } {
  const color = hexToInt(profile.classes.find((c) => c.id === character.classId)?.color);
  return {
    embeds: [
      {
        title: character.name,
        color,
        description: events.map((e) => line(e, locale)).join("\n"),
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/** Posts one payload to a Discord webhook. Best effort: returns false on any error instead of throwing. */
export async function postDiscordWebhook(url: string, payload: unknown, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

/**
 * Posts a character's progress events to every enabled webhook of every roster the character is in, filtered to the
 * events and characters each webhook is configured for, in that webhook's language. Never throws: a failed post is
 * swallowed so it can never break a sync.
 */
export async function announceProgress(
  ctx: CoreContext,
  character: { id: string; name: string; classId: number | null; gameVersion: string },
  events: ProgressEvent[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (events.length === 0) return;
  try {
    const webhooks = await ctx.prisma.rosterWebhook.findMany({
      where: { enabled: true, guild: { roster: { some: { characterId: character.id, pending: false } } } },
    });
    if (webhooks.length === 0) return;
    const profile = gameVersion(ctx, character.gameVersion);
    for (const webhook of webhooks) {
      if (!webhook.allCharacters && !webhook.characterIds.includes(character.id)) continue;
      const enabled = new Set(webhook.events);
      const selected = events.filter((e) => enabled.has(e.type));
      if (selected.length === 0) continue;
      await postDiscordWebhook(webhook.url, formatProgressMessage(profile, character, selected, webhook.locale), fetchImpl);
    }
  } catch {
    // Announcements are best effort and must never fail a sync.
  }
}
