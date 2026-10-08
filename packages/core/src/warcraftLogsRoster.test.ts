import type { WarcraftLogsProfile } from "@wow/blizzard";
import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import type { CoreContext } from "./context";
import { groupReportLinks, persistWarcraftLogsReports, type ReportLink } from "./warcraftLogs";

const era = resolveProfile("classic-era");

const link = (code: string, date: string, char: { id: string; name: string; classId: number }, over: Partial<ReportLink["report"]> = {}): ReportLink => ({
  report: { code, host: "vanilla.warcraftlogs.com", zoneName: { en: "Molten Core" }, type: "raid", date, ...over },
  character: { characterId: char.id, name: char.name, classId: char.classId },
});

describe("groupReportLinks", () => {
  it("groups links into one log per report, lists every member and sorts newest first", () => {
    const thrall = { id: "c1", name: "Thrall", classId: 7 };
    const garrosh = { id: "c2", name: "Garrosh", classId: 1 };
    const logs = groupReportLinks([
      link("ABC", "2026-10-01T20:00:00.000Z", thrall),
      link("ABC", "2026-10-01T20:00:00.000Z", garrosh),
      link("ZZZ", "2026-10-03T19:00:00.000Z", thrall, { type: "dungeon", zoneName: { en: "Deadmines" } }),
    ]);

    expect(logs.map((l) => l.report)).toEqual(["ZZZ", "ABC"]); // newest first
    const mc = logs.find((l) => l.report === "ABC")!;
    expect(mc).toMatchObject({ type: "raid", url: "https://vanilla.warcraftlogs.com/reports/ABC", zoneName: { en: "Molten Core" } });
    expect(mc.members.map((m) => m.characterId).sort()).toEqual(["c1", "c2"]);
    const dm = logs.find((l) => l.report === "ZZZ")!;
    expect(dm).toMatchObject({ type: "dungeon", zoneName: { en: "Deadmines" } });
    expect(dm.members.map((m) => m.name)).toEqual(["Thrall"]);
  });

  it("returns nothing with no links", () => {
    expect(groupReportLinks([])).toEqual([]);
  });
});

describe("persistWarcraftLogsReports", () => {
  function fakeCtx() {
    const reports: unknown[] = [];
    const links: unknown[] = [];
    const ctx = {
      prisma: {
        warcraftLogsReport: { upsert: async (args: { create: unknown }) => void reports.push(args.create) },
        warcraftLogsReportCharacter: { upsert: async (args: { create: unknown }) => void links.push(args.create) },
      },
    } as unknown as CoreContext;
    return { ctx, reports, links };
  }

  const wcl = (kills: WarcraftLogsProfile["kills"]): WarcraftLogsProfile => ({ url: "u", fetchedAt: new Date().toISOString(), kills });

  it("persists one report per code with its zone/type and the earliest date, and links the character", async () => {
    const { ctx, reports, links } = fakeCtx();
    await persistWarcraftLogsReports(ctx, { id: "c1" }, wcl([
      { report: "ABC", zoneId: 2000, zoneName: { en: "Molten Core" }, encounterId: 663, name: "Lucifron", killedAt: "2026-10-01T20:40:00.000Z" },
      { report: "ABC", zoneId: 2000, zoneName: { en: "Molten Core" }, encounterId: 664, name: "Magmadar", killedAt: "2026-10-01T20:10:00.000Z" },
      { report: "DEF", zoneId: 9999, zoneName: { en: "Deadmines" }, encounterId: 1, name: "VanCleef", killedAt: "2026-10-03T19:00:00.000Z" },
    ]), era);

    expect(reports).toHaveLength(2);
    const mc = reports.find((r) => (r as { code: string }).code === "ABC") as { type: string; zoneName: { en: string }; date: Date; host: string };
    expect(mc).toMatchObject({ type: "raid", host: "vanilla.warcraftlogs.com" });
    expect(mc.zoneName.en).toBe("Molten Core");
    expect(mc.date.toISOString()).toBe("2026-10-01T20:10:00.000Z"); // earliest kill
    const dm = reports.find((r) => (r as { code: string }).code === "DEF") as { type: string; zoneName: { en: string } };
    expect(dm).toMatchObject({ type: "dungeon" });
    expect(dm.zoneName.en).toBe("Deadmines");
    expect(links).toEqual([
      { reportCode: "ABC", characterId: "c1" },
      { reportCode: "DEF", characterId: "c1" },
    ]);
  });

  it("does nothing without a Warcraft Logs host or kills", async () => {
    const { ctx, reports } = fakeCtx();
    await persistWarcraftLogsReports(ctx, { id: "c1" }, wcl([]), era);
    await persistWarcraftLogsReports(ctx, { id: "c1" }, null, era);
    expect(reports).toHaveLength(0);
  });
});
