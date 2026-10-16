import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import {
  announcedSpec,
  characterPageUrl,
  detectProgressEvents,
  formatProgressMessage,
  manualProfessionsAsProfessions,
  postDiscordWebhook,
  reputationLadder,
  type AnnouncedCharacter,
  type ProgressSnapshot,
} from "./progress";

const retail = resolveProfile("retail");
const era = resolveProfile("classic-era");

const snap = (over: Partial<ProgressSnapshot> = {}): ProgressSnapshot => ({ level: 80, equippedItemLevel: 600, raids: [], mythicPlus: null, professions: [], reputations: [], ...over });

describe("detectProgressEvents", () => {
  it("returns nothing on the first sync (no previous state)", () => {
    expect(detectProgressEvents(retail, null, snap())).toEqual([]);
  });

  it("reports level and item level gains with the previous value, so thresholds can be applied", () => {
    expect(detectProgressEvents(era, snap({ level: 58 }), snap({ level: 61 }))).toEqual([{ type: "level_up", from: 58, value: 61 }]);
    expect(detectProgressEvents(retail, snap({ equippedItemLevel: 600.2 }), snap({ equippedItemLevel: 600.9 }))).toEqual([]);
    expect(detectProgressEvents(retail, snap({ equippedItemLevel: 600 }), snap({ equippedItemLevel: 603 }))).toEqual([{ type: "item_level", from: 600, value: 603 }]);
  });

  it("detects a boss killed for the first time and a full clear, but not re-kills", () => {
    const raid = (kills: number, completed: number) => [
      { id: 1, name: { en: "Molten Core" }, modes: [{ difficulty: "NORMAL", completed, total: 2, encounters: [{ id: 663, name: { en: "Lucifron" }, kills }, { id: 664, name: { en: "Magmadar" }, kills: completed > 1 ? 1 : 0 }] }] },
    ];
    const events = detectProgressEvents(era, snap({ raids: raid(0, 0) }), snap({ raids: raid(1, 2) }));
    expect(events).toContainEqual({ type: "raid_boss", title: { en: "Molten Core" }, subtitle: { en: "Lucifron" } });
    expect(events).toContainEqual({ type: "raid_boss", title: { en: "Molten Core" }, subtitle: { en: "Magmadar" } });
    expect(events).toContainEqual({ type: "raid_cleared", title: { en: "Molten Core" } });
    expect(detectProgressEvents(era, snap({ raids: raid(1, 2) }), snap({ raids: raid(2, 2) }))).toEqual([]);
  });

  it("detects a new Mythic+ best key and a higher rating", () => {
    const before = snap({ mythicPlus: { rating: 2000, weeklyRuns: [{ dungeon: { en: "x" }, level: 10, timed: true }], seasonRuns: [] } });
    const after = snap({ mythicPlus: { rating: 2100, weeklyRuns: [{ dungeon: { en: "x" }, level: 14, timed: true }], seasonRuns: [] } });
    expect(detectProgressEvents(retail, before, after)).toEqual([
      { type: "mythic_plus", from: 10, value: 14 },
      { type: "mythic_rating", from: 2000, value: 2100 },
    ]);
  });

  it("reports every profession skill gain with its cap", () => {
    const smith = (skill: number) => ({ id: 164, name: { en: "Blacksmithing" }, secondary: false, skill, maxSkill: 300, tiers: [] });
    expect(detectProgressEvents(era, snap({ professions: [] }), snap({ professions: [smith(75)] }))).toEqual([
      { type: "profession", title: { en: "Blacksmithing" }, professionId: 164, from: 0, value: 75, cap: 300 },
    ]);
    expect(detectProgressEvents(era, snap({ professions: [smith(75)] }), snap({ professions: [smith(80)] }))).toHaveLength(1);
    expect(detectProgressEvents(era, snap({ professions: [smith(80)] }), snap({ professions: [smith(80)] }))).toEqual([]);
  });

  it("tells reputation ladders apart: standard standings, renown and friendship", () => {
    // Shapes from a real retail /reputations response.
    const orgrimmar = (tier: number, en: string) => ({ factionId: 76, name: { en: "Orgrimmar" }, tier, standing: { en } });
    const wrathion = (tier: number, en: string) => ({ factionId: 2517, name: { en: "Wrathion" }, tier, standing: { en } });
    const centaur = (level: number) => ({ factionId: 2503, name: { en: "Maruuk Centaur" }, standing: { en: `Renown ${level}` }, renownLevel: level });
    const before = snap({ reputations: [orgrimmar(5, "Honored"), wrathion(4, "Friend"), centaur(9)] });
    const after = snap({ reputations: [orgrimmar(6, "Revered"), wrathion(5, "True Friend"), centaur(10)] });
    expect(detectProgressEvents(retail, before, after)).toEqual([
      { type: "reputation", title: { en: "Orgrimmar" }, subtitle: { en: "Revered" }, from: 5, value: 6, reputation: { kind: "standard", standingKey: "revered" } },
      { type: "reputation", title: { en: "Wrathion" }, subtitle: { en: "True Friend" }, from: 4, value: 5, reputation: { kind: "friendship" } },
      { type: "reputation", title: { en: "Maruuk Centaur" }, subtitle: { en: "Renown 10" }, from: 9, value: 10, reputation: { kind: "renown" } },
    ]);
  });

  it("ignores ladders the version does not have (no friendship or renown in Classic Era)", () => {
    expect(reputationLadder(era, { factionId: 1, name: {}, tier: 5, standing: { en: "True Friend" } })).toBeNull();
    expect(reputationLadder(era, { factionId: 1, name: {}, tier: 7, standing: { en: "Exalted" } })).toEqual({ kind: "standard", standingKey: "exalted" });
  });
});

describe("manualProfessionsAsProfessions", () => {
  it("turns hand-entered professions into API-shaped ones from the version's catalog", () => {
    const tailoring = era.professions.find((p) => p.key === "tailoring")!;
    expect(manualProfessionsAsProfessions(era, [{ id: tailoring.id, skill: 150 }, { id: 99999, skill: 1 }])).toEqual([
      { id: tailoring.id, name: tailoring.name, secondary: false, skill: 150, maxSkill: 300, tiers: [] },
    ]);
  });
});

const thrall: AnnouncedCharacter = {
  name: "Thrall",
  classId: 7,
  level: 60,
  specName: null,
  avatarUrl: "https://render/avatar.jpg",
  gameVersion: "classic-era",
  region: "eu",
  realm: "firemaw",
  profile: {
    talents: [
      {
        active: true,
        trees: [
          { name: "Elemental", points: 5, talents: [] },
          { name: "Enhancement", points: 31, talents: [] },
          { name: "Restoration", points: 15, talents: [] },
        ],
      },
    ],
  },
};

describe("announcedSpec", () => {
  it("uses the stored spec, else the talent tree with the most points", () => {
    expect(announcedSpec(era, thrall, "es")).toBe("Mejora");
    expect(announcedSpec(era, { ...thrall, specName: "restoration" }, "en")).toBe("Restoration");
    expect(announcedSpec(era, { ...thrall, profile: null }, "en")).toBeNull();
  });
});

describe("formatProgressMessage", () => {
  it("shows the face, a link, the player, spec, class and level in the webhook's language", () => {
    const url = characterPageUrl("https://roster.example/", "es", thrall);
    expect(url).toBe("https://roster.example/es/character/classic-era/eu/firemaw/thrall");
    const msg = formatProgressMessage(era, thrall, [{ type: "level_up", from: 59, value: 60 }], "es", { playerName: "Patxi", url, rosterName: "Horda" });
    const embed = msg.embeds[0]!;
    expect(embed).toMatchObject({ title: "Thrall", url, thumbnail: { url: "https://render/avatar.jpg" }, footer: { text: "Horda" } });
    expect(embed.description).toContain("nivel máximo");
    expect(embed.fields).toEqual([
      { name: "Jugador", value: "Patxi", inline: true },
      { name: "Clase", value: "Mejora · Chamán", inline: true },
      { name: "Nivel", value: "60", inline: true },
    ]);
    expect(typeof embed.color).toBe("number");
    const en = formatProgressMessage(era, thrall, [{ type: "level_up", from: 49, value: 50 }], "en");
    expect(en.embeds[0]!.description).toContain("Reached level 50");
    expect(en.embeds[0]!.fields[0]!.name).toBe("Class");
  });

  it("words renown and maxed professions", () => {
    const rep = formatProgressMessage(retail, { ...thrall, gameVersion: "retail" }, [{ type: "reputation", title: { es: "Centauros Maruuk" }, from: 9, value: 10, reputation: { kind: "renown" } }], "es");
    expect(rep.embeds[0]!.description).toBe("🤝 Renombre 10 con Centauros Maruuk");
    const prof = formatProgressMessage(era, thrall, [{ type: "profession", title: { en: "Tailoring" }, from: 290, value: 300, cap: 300 }], "en");
    expect(prof.embeds[0]!.description).toBe("🔨 Tailoring maxed (300)");
  });
});

describe("postDiscordWebhook", () => {
  it("posts JSON and reports success, swallowing errors", async () => {
    let seen: { url: string; body: string } | null = null;
    const ok = (async (url: string, init?: RequestInit) => {
      seen = { url: url.toString(), body: String(init?.body) };
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    expect(await postDiscordWebhook("https://discord.com/api/webhooks/1/tok", { content: "hi" }, ok)).toBe(true);
    expect(seen!.body).toContain("hi");

    const boom = (async () => {
      throw new Error("network");
    }) as typeof fetch;
    expect(await postDiscordWebhook("https://discord.com/api/webhooks/1/tok", {}, boom)).toBe(false);
  });
});
