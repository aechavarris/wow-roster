import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import { detectProgressEvents, formatProgressMessage, postDiscordWebhook, type ProgressSnapshot } from "./progress";

const retail = resolveProfile("retail");
const era = resolveProfile("classic-era");

const snap = (over: Partial<ProgressSnapshot> = {}): ProgressSnapshot => ({ level: 80, equippedItemLevel: 600, raids: [], mythicPlus: null, professions: [], reputations: [], ...over });

describe("detectProgressEvents", () => {
  it("returns nothing on the first sync (no previous state)", () => {
    expect(detectProgressEvents(retail, null, snap())).toEqual([]);
  });

  it("detects level ups and reaching max level", () => {
    expect(detectProgressEvents(retail, snap({ level: 71 }), snap({ level: 72 }))).toEqual([{ type: "level_up", value: 72 }]);
    expect(detectProgressEvents(era, snap({ level: 59 }), snap({ level: 60 }))).toEqual([{ type: "max_level", value: 60 }]);
  });

  it("detects an item-level gain only when the integer value rises", () => {
    expect(detectProgressEvents(retail, snap({ equippedItemLevel: 600.2 }), snap({ equippedItemLevel: 600.9 }))).toEqual([]);
    expect(detectProgressEvents(retail, snap({ equippedItemLevel: 600 }), snap({ equippedItemLevel: 603 }))).toEqual([{ type: "item_level", value: 603 }]);
  });

  it("detects a boss killed for the first time and a full clear, but not re-kills", () => {
    const raid = (kills: number, completed: number) => [
      { id: 1, name: { en: "Molten Core" }, modes: [{ difficulty: "NORMAL", completed, total: 2, encounters: [{ id: 663, name: { en: "Lucifron" }, kills }, { id: 664, name: { en: "Magmadar" }, kills: completed > 1 ? 1 : 0 }] }] },
    ];
    const events = detectProgressEvents(era, snap({ raids: raid(0, 0) }), snap({ raids: raid(1, 2) }));
    expect(events).toContainEqual({ type: "raid_boss", title: { en: "Molten Core" }, subtitle: { en: "Lucifron" } });
    expect(events).toContainEqual({ type: "raid_boss", title: { en: "Molten Core" }, subtitle: { en: "Magmadar" } });
    expect(events).toContainEqual({ type: "raid_cleared", title: { en: "Molten Core" } });
    // Already killed: nothing new.
    expect(detectProgressEvents(era, snap({ raids: raid(1, 2) }), snap({ raids: raid(2, 2) }))).toEqual([]);
  });

  it("detects a new Mythic+ best key and a higher rating", () => {
    const before = snap({ mythicPlus: { rating: 2000, weeklyRuns: [{ dungeon: { en: "x" }, level: 10, timed: true }], seasonRuns: [] } });
    const after = snap({ mythicPlus: { rating: 2100, weeklyRuns: [{ dungeon: { en: "x" }, level: 14, timed: true }], seasonRuns: [] } });
    expect(detectProgressEvents(retail, before, after)).toEqual([
      { type: "mythic_plus", value: 14 },
      { type: "mythic_rating", value: 2100 },
    ]);
  });

  it("detects a learned profession and a reputation tier gain", () => {
    const before = snap({ professions: [], reputations: [{ factionId: 5, name: { en: "Thorium Brotherhood" }, tier: 1, standing: { en: "Friendly" } }] });
    const after = snap({
      professions: [{ id: 164, name: { en: "Blacksmithing" }, secondary: false, skill: 75, tiers: [] }],
      reputations: [{ factionId: 5, name: { en: "Thorium Brotherhood" }, tier: 2, standing: { en: "Honored" } }],
    });
    expect(detectProgressEvents(era, before, after)).toEqual([
      { type: "profession", title: { en: "Blacksmithing" }, value: 75 },
      { type: "reputation", title: { en: "Thorium Brotherhood" }, subtitle: { en: "Honored" } },
    ]);
  });
});

describe("formatProgressMessage", () => {
  it("builds a Discord embed in the webhook's language with the class colour", () => {
    const msg = formatProgressMessage(era, { name: "Thrall", classId: 7 }, [{ type: "max_level", value: 60 }], "es");
    expect(msg.embeds[0]!.title).toBe("Thrall");
    expect(msg.embeds[0]!.description).toContain("nivel máximo");
    expect(typeof msg.embeds[0]!.color).toBe("number");
    const en = formatProgressMessage(era, { name: "Thrall", classId: 7 }, [{ type: "max_level", value: 60 }], "en");
    expect(en.embeds[0]!.description).toContain("max level");
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
