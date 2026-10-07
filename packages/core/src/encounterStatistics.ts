import type { EncounterProgress, EncounterStatistic, InstanceMode, InstanceProgress, LocalizedText } from "@wow/blizzard";
import type { GameProfile } from "@wow/config";

/** "Garrosh Hellscream kills (Siege of Orgrimmar 25 player Heroic)" → the counter text and the instance label. */
const LABELLED = /^(.*?)\s*\(([^()]*)\)\s*$/;
/** Difficulty words at the start or end of a dungeon label: English puts them first, Spanish last. */
const DUNGEON_DIFFICULTY = /^(heroic|normal|mythic)\s+|\s+(heroic|normal|mythic|heroic[oa]|mític[oa])$/i;

function split(text: string | undefined): { counter: string; label: string } | undefined {
  const match = text ? LABELLED.exec(text) : null;
  return match ? { counter: match[1]!.trim(), label: match[2]!.trim() } : undefined;
}

/** Each locale of a name, split into counter text and instance label. */
function splitLocales(name: LocalizedText) {
  const parts: Record<string, { counter: string; label: string }> = {};
  for (const [locale, text] of Object.entries(name)) {
    const part = split(text);
    if (part) parts[locale] = part;
  }
  return parts;
}

/** Blizzard-style difficulty type from an English label, for ranking difficulties like the encounters API does. */
function difficultyType(text: string): string {
  if (/mythic/i.test(text)) return "MYTHIC";
  if (/heroic/i.test(text)) return "HEROIC";
  if (/raid finder|looking for raid/i.test(text)) return "LFR";
  return "NORMAL";
}

/** Small stable number for an instance name, so characters' instances match by id like the encounters API's. */
function nameId(text: string): number {
  let hash = 0;
  for (const char of text.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

interface Group {
  instance: InstanceProgress;
  modes: Map<string, InstanceMode>;
}

function addKill(group: Group, modeKey: string, makeMode: () => InstanceMode, encounter: EncounterProgress) {
  let mode = group.modes.get(modeKey);
  if (!mode) {
    mode = makeMode();
    group.modes.set(modeKey, mode);
  }
  mode.encounters.push(encounter);
}

function finish(groups: Map<string, Group>, bossCount: (key: string) => number | undefined): InstanceProgress[] {
  return [...groups.entries()].map(([key, group]) => ({
    ...group.instance,
    modes: [...group.modes.values()].map((mode) => {
      const completed = mode.encounters.filter((e) => e.kills > 0).length;
      // The statistics only list bosses killed at least once, so the total comes from the profile when it has it.
      return { ...mode, completed, total: Math.max(bossCount(key) ?? 0, completed) };
    }),
  }));
}

/**
 * Raid and dungeon progress built from the boss kill statistics, in the shape the encounters API gives (MoP Classic
 * has statistics but no /encounters). Raids are the version's configured raids found in the label; dungeons are
 * labels that come with a difficulty word (heroic…) at least once, which leaves out world bosses. Each counter's
 * last update is its last kill, so the weekly audit works as with the encounters API.
 */
export function instancesFromStatistics(profile: Pick<GameProfile, "raids">, statistics: EncounterStatistic[]) {
  const raids = new Map<string, Group>();
  const dungeons = new Map<string, Group>();
  const dungeonPending: { base: string; tokened: boolean; add: () => void }[] = [];

  for (const stat of statistics) {
    const parts = splitLocales(stat.name);
    const en = parts.en ?? Object.values(parts)[0];
    if (!en) continue;
    const encounter: EncounterProgress = {
      id: stat.id,
      name: Object.fromEntries(Object.entries(parts).map(([locale, p]) => [locale, p.counter])),
      kills: stat.quantity,
      lastKillAt: stat.lastUpdated,
    };
    const instanceBase = { expansionId: stat.expansionOrder, expansion: stat.expansion };

    const raid = profile.raids.find((r) => r.name.en && en.label.toLowerCase().includes(r.name.en.toLowerCase()));
    if (raid) {
      const rest = (locale: string) => {
        const label = parts[locale]?.label;
        const raidName = raid.name[locale];
        if (!label) return undefined;
        const without = raidName ? label.replace(new RegExp(raidName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "") : label;
        return without.replace(/\s+/g, " ").trim();
      };
      const difficultyText = rest("en") ?? "";
      const difficultyName = Object.fromEntries(Object.keys(parts).map((l) => [l, rest(l) || "Normal"]));
      let group = raids.get(raid.key);
      if (!group) {
        group = { instance: { id: nameId(raid.key), name: raid.name, ...instanceBase, modes: [] }, modes: new Map() };
        raids.set(raid.key, group);
      }
      addKill(group, difficultyText.toLowerCase(), () => ({ difficulty: difficultyType(difficultyText), difficultyName, completed: 0, total: 0, encounters: [] }), encounter);
      continue;
    }

    const token = DUNGEON_DIFFICULTY.exec(en.label);
    const base = en.label.replace(DUNGEON_DIFFICULTY, "").trim();
    const difficultyText = token ? (token[1] ?? token[2] ?? "") : "";
    dungeonPending.push({
      base,
      tokened: Boolean(token),
      add: () => {
        const names = Object.fromEntries(Object.entries(parts).map(([l, p]) => [l, p.label.replace(DUNGEON_DIFFICULTY, "").trim()]));
        const difficultyNames = Object.fromEntries(
          Object.entries(parts).map(([l, p]) => {
            const m = DUNGEON_DIFFICULTY.exec(p.label);
            return [l, m ? (m[1] ?? m[2] ?? "").replace(/^./, (c) => c.toUpperCase()) : "Normal"];
          }),
        );
        let group = dungeons.get(base);
        if (!group) {
          group = { instance: { id: nameId(base), name: names, ...instanceBase, modes: [] }, modes: new Map() };
          dungeons.set(base, group);
        }
        addKill(group, difficultyText.toLowerCase(), () => ({ difficulty: difficultyType(difficultyText), difficultyName: difficultyNames, completed: 0, total: 0, encounters: [] }), encounter);
      },
    });
  }

  const dungeonBases = new Set(dungeonPending.filter((d) => d.tokened).map((d) => d.base));
  for (const pending of dungeonPending) if (dungeonBases.has(pending.base)) pending.add();

  return {
    raids: finish(raids, (key) => profile.raids.find((r) => r.key === key)?.bossCount),
    dungeons: finish(dungeons, () => undefined),
  };
}
