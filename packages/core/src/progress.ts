import type { CharacterProfile, InstanceProgress, MythicPlusProfile, Profession, Reputation } from "@wow/blizzard";
import {
  readProgressSettings,
  resolveSpec,
  selectProgressEvents,
  type GameProfile,
  type Localized,
  type ProgressEvent,
} from "@wow/config";
import { gameVersion, type CoreContext } from "./context";

export type { ProgressEvent } from "@wow/config";

/**
 * Character-progress announcements. On each sync the new state is compared to the previous one and every
 * transition becomes a raw event (level 58 → 61, a boss killed for the first time, Honored → Revered…). Each of a
 * roster's Discord webhooks then keeps the events its settings ask for (every 10 levels, keys from +10, chosen
 * professions and standings) and posts them. Only transitions are announced, never the state at first sight.
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
 * Which ladder a faction is on. The API has no type flag: the standard ladder (Hated → Exalted) is recognised by
 * tier plus English standing name from the version's profile; renown factions carry a renown level; anything else
 * with a tier is a friendship-style ladder (only where the version has them).
 */
export function reputationLadder(profile: Pick<GameProfile, "reputation">, rep: Reputation) {
  if (rep.renownLevel !== undefined) return profile.reputation.renown ? { kind: "renown" as const } : null;
  if (rep.tier === undefined) return null;
  const standard = profile.reputation.standings.find(
    (s) => s.tier === rep.tier && (s.name.en ?? "").toLowerCase() === (rep.standing?.en ?? "").toLowerCase(),
  );
  if (standard) return { kind: "standard" as const, standingKey: standard.key };
  return profile.reputation.friendship ? { kind: "friendship" as const } : null;
}

/**
 * The progress transitions between two snapshots. Returns nothing when `before` is null (first sync): only changes
 * are announced. Raid events are capped so one catch-up sync cannot post a wall of messages.
 */
export function detectProgressEvents(profile: GameProfile, before: ProgressSnapshot | null, after: ProgressSnapshot): ProgressEvent[] {
  if (!before) return [];
  const events: ProgressEvent[] = [];

  if (after.level > before.level) events.push({ type: "level_up", from: before.level, value: after.level });

  const beforeIl = floor(before.equippedItemLevel);
  const afterIl = floor(after.equippedItemLevel);
  if (afterIl !== undefined && beforeIl !== undefined && afterIl > beforeIl) events.push({ type: "item_level", from: beforeIl, value: afterIl });

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
  for (const instance of after.raids ?? []) {
    for (const mode of instance.modes) {
      const key = `${instance.id}:${mode.difficulty}`;
      if (now.cleared.has(key) && !past.cleared.has(key)) events.push({ type: "raid_cleared", title: instance.name });
    }
  }

  const beforeKey = bestKey(before.mythicPlus);
  const afterKey = bestKey(after.mythicPlus);
  if (afterKey > beforeKey) events.push({ type: "mythic_plus", from: beforeKey, value: afterKey });
  const beforeRating = Math.round(before.mythicPlus?.rating ?? 0);
  const afterRating = Math.round(after.mythicPlus?.rating ?? 0);
  if (afterRating > beforeRating && afterRating > 0) events.push({ type: "mythic_rating", from: beforeRating, value: afterRating });

  const beforeProf = new Map((before.professions ?? []).map((p) => [p.id, p]));
  for (const prof of after.professions ?? []) {
    const old = beforeProf.get(prof.id);
    const from = old ? headlineSkill(old) : 0;
    const value = headlineSkill(prof);
    if (value > from) events.push({ type: "profession", title: prof.name, professionId: prof.id, from, value, cap: professionCap(prof) || undefined });
  }

  const beforeRep = new Map((before.reputations ?? []).map((r) => [r.factionId, r]));
  for (const rep of after.reputations ?? []) {
    const old = beforeRep.get(rep.factionId);
    const ladder = reputationLadder(profile, rep);
    if (!ladder) continue;
    if (ladder.kind === "renown") {
      const from = old?.renownLevel ?? 0;
      if ((rep.renownLevel ?? 0) > from) {
        events.push({ type: "reputation", title: rep.name, subtitle: rep.standing, from, value: rep.renownLevel, reputation: ladder });
      }
    } else if ((old?.tier ?? -1) < rep.tier! && rep.standing) {
      events.push({ type: "reputation", title: rep.name, subtitle: rep.standing, from: old?.tier ?? 0, value: rep.tier, reputation: ladder });
    }
  }

  return events;
}

/** Professions entered by hand (Classic) as API-shaped professions, so the same detection applies to them. */
export function manualProfessionsAsProfessions(
  profile: Pick<GameProfile, "professions">,
  manual: { id: number; skill: number | null }[] | null | undefined,
): Profession[] {
  return (manual ?? []).flatMap((m) => {
    const known = profile.professions.find((p) => p.id === m.id);
    if (!known) return [];
    return [{ id: m.id, name: known.name, secondary: known.kind === "secondary", skill: m.skill ?? 0, maxSkill: known.maxSkill, tiers: [] }];
  });
}

const pick = (text: Localized | undefined, locale: string) => (text ? (text[locale] ?? text.en ?? Object.values(text)[0] ?? "") : "");

/** One announcement line per event, in the webhook's language. */
function line(profile: GameProfile, event: ProgressEvent, locale: string): string {
  const es = locale === "es";
  const title = pick(event.title, locale);
  const subtitle = pick(event.subtitle, locale);
  switch (event.type) {
    case "level_up":
      if ((event.value ?? 0) >= profile.maxLevel) return es ? `🎉 ¡Alcanzó el nivel máximo (${event.value})!` : `🎉 Hit max level (${event.value})!`;
      return es ? `⬆️ Subió a nivel ${event.value}` : `⬆️ Reached level ${event.value}`;
    case "item_level":
      return es ? `🛡️ Nivel de objeto ${event.value}` : `🛡️ Item level ${event.value}`;
    case "raid_boss":
      return es ? `⚔️ Derrotó a ${subtitle} en ${title}` : `⚔️ Killed ${subtitle} in ${title}`;
    case "raid_cleared":
      return es ? `🏆 Completó ${title}` : `🏆 Cleared ${title}`;
    case "mythic_plus":
      return es ? `🗝️ Nueva mejor llave: Mítica+${event.value}` : `🗝️ New best key: Mythic+${event.value}`;
    case "mythic_rating":
      return es ? `📈 Puntuación M+ ${event.value}` : `📈 M+ rating ${event.value}`;
    case "profession":
      if (event.from === 0) return es ? `🔨 Aprendió ${title} (${event.value})` : `🔨 Learned ${title} (${event.value})`;
      if (event.cap && (event.value ?? 0) >= event.cap) return es ? `🔨 ${title} al máximo (${event.value})` : `🔨 ${title} maxed (${event.value})`;
      return es ? `🔨 ${title} a ${event.value}` : `🔨 ${title} at ${event.value}`;
    case "reputation":
      if (event.reputation?.kind === "renown") return es ? `🤝 Renombre ${event.value} con ${title}` : `🤝 Renown ${event.value} with ${title}`;
      return es ? `🤝 ${subtitle} con ${title}` : `🤝 ${subtitle} with ${title}`;
    default:
      return "";
  }
}

const hexToInt = (hex: string | undefined) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  return m ? parseInt(m[1]!, 16) : 0x5865f2; // Discord blurple fallback
};

/** What an announcement shows about the character besides the events. */
export interface AnnouncedCharacter {
  name: string;
  classId: number | null;
  level: number;
  /** Spec key stored on the character (from the API's active spec), when known. */
  specName: string | null;
  avatarUrl: string | null;
  gameVersion: string;
  region: string;
  realm: string;
  profile?: Partial<CharacterProfile> | null;
}

/**
 * The spec to show: the stored one, else the talent tree with the most points in the active setup (Classic APIs
 * report trees, not a spec), else nothing.
 */
export function announcedSpec(profile: GameProfile, character: AnnouncedCharacter, locale: string): string | null {
  const gameClass = profile.classes.find((c) => c.id === character.classId);
  const known = gameClass?.specs.find((s) => s.key === character.specName);
  if (known) return pick(known.name, locale);
  const setups = character.profile?.talents ?? [];
  const setup = setups.find((s) => s.active) ?? setups[0];
  const tree = [...(setup?.trees ?? [])].filter((t) => (t.points ?? 0) > 0).sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0];
  if (!tree) return null;
  const spec = resolveSpec(profile, character.classId, { name: tree.name });
  return spec ? pick(spec.name, locale) : tree.name;
}

/** Builds the Discord webhook payload: one embed with the character's face, who plays it and its events. */
export function formatProgressMessage(
  profile: GameProfile,
  character: AnnouncedCharacter,
  events: ProgressEvent[],
  locale: string,
  extra: { playerName?: string | null; url?: string | null; rosterName?: string | null } = {},
) {
  const es = locale === "es";
  const gameClass = profile.classes.find((c) => c.id === character.classId);
  const className = gameClass ? pick(gameClass.name, locale) : null;
  const spec = announcedSpec(profile, character, locale);
  const face = character.profile?.media?.avatar ?? character.avatarUrl ?? character.profile?.media?.inset ?? null;
  const fields = [
    ...(extra.playerName ? [{ name: es ? "Jugador" : "Player", value: extra.playerName, inline: true }] : []),
    ...(className ? [{ name: es ? "Clase" : "Class", value: [spec, className].filter(Boolean).join(" · "), inline: true }] : []),
    { name: es ? "Nivel" : "Level", value: String(character.level), inline: true },
  ];
  return {
    embeds: [
      {
        title: character.name,
        ...(extra.url ? { url: extra.url } : {}),
        color: hexToInt(gameClass?.color),
        description: events.map((e) => line(profile, e, locale)).join("\n"),
        ...(face ? { thumbnail: { url: face } } : {}),
        fields,
        ...(extra.rosterName ? { footer: { text: extra.rosterName } } : {}),
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

/** Link to the character's page in the webhook's language, when the app's public URL is known. */
export function characterPageUrl(publicUrl: string | undefined, locale: string, c: { gameVersion: string; region: string; realm: string; name: string }) {
  if (!publicUrl) return null;
  return `${publicUrl.replace(/\/$/, "")}/${locale}/character/${c.gameVersion}/${c.region}/${encodeURIComponent(c.realm)}/${encodeURIComponent(c.name.toLowerCase())}`;
}

/**
 * Posts a character's progress events to every enabled webhook of every roster the character is in, filtered to the
 * events, thresholds and characters each webhook is configured for, in that webhook's language. Never throws: a
 * failed post is swallowed so it can never break a sync.
 */
export async function announceProgress(
  ctx: CoreContext,
  character: AnnouncedCharacter & { id: string; ownerId?: string | null },
  events: ProgressEvent[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (events.length === 0) return;
  try {
    const webhooks = await ctx.prisma.rosterWebhook.findMany({
      where: { enabled: true, guild: { roster: { some: { characterId: character.id, pending: false } } } },
      include: {
        guild: { select: { name: true, roster: { where: { characterId: character.id }, select: { playerName: true }, take: 1 } } },
      },
    });
    if (webhooks.length === 0) return;
    const profile = gameVersion(ctx, character.gameVersion);
    // Who plays it: the roster's own name for the player, else the owner's BattleTag without its number.
    const owner = character.ownerId
      ? await ctx.prisma.user.findUnique({ where: { id: character.ownerId }, select: { battletag: true } })
      : null;
    for (const webhook of webhooks) {
      if (!webhook.allCharacters && !webhook.characterIds.includes(character.id)) continue;
      const enabled = new Set(webhook.events);
      const selected = selectProgressEvents(
        profile,
        readProgressSettings(webhook.settings),
        events.filter((e) => enabled.has(e.type)),
      );
      if (selected.length === 0) continue;
      const playerName = webhook.guild.roster[0]?.playerName || owner?.battletag.split("#")[0] || null;
      const message = formatProgressMessage(profile, character, selected, webhook.locale, {
        playerName,
        url: characterPageUrl(ctx.publicUrl, webhook.locale, character),
        rosterName: webhook.guild.name,
      });
      await postDiscordWebhook(webhook.url, message, fetchImpl);
    }
  } catch {
    // Announcements are best effort and must never fail a sync.
  }
}
