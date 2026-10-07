import type { EncounterStatistic } from "@wow/blizzard";
import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import { instancesFromStatistics } from "./encounterStatistics";

const mop = resolveProfile("progression");
let nextId = 1;
const stat = (en: string, es: string, quantity: number, lastUpdated?: string): EncounterStatistic => ({
  id: nextId++,
  name: { en, es },
  quantity,
  lastUpdated,
  expansion: { en: "Mists of Pandaria", es: "Mists of Pandaria" },
  expansionOrder: 5,
});

describe("instancesFromStatistics", () => {
  const stats = [
    stat("Garrosh Hellscream kills (25-player Heroic Siege of Orgrimmar)", "Muertes de Garrosh Grito Infernal (Asedio de Orgrimmar 25 j. heroico)", 2, "2026-10-08T21:00:00Z"),
    stat("Immerseus kills (25-player Heroic Siege of Orgrimmar)", "Muertes de Inmerseus (Asedio de Orgrimmar 25 j. heroico)", 5, "2026-10-01T21:00:00Z"),
    stat("Immerseus kills (25-player Normal Siege of Orgrimmar)", "Muertes de Inmerseus (Asedio de Orgrimmar 25 j.)", 9),
    // English names as a real MoP Classic character returns them; the Spanish raid ones are a guess.
    stat("Sha of Doubt kills (Heroic Temple of the Jade Serpent)", "Muertes del Sha de la duda (Templo del Dragón de Jade heroica)", 4, "2025-12-13T10:16:00Z"),
    stat("Sha of Doubt kills (Temple of the Jade Serpent)", "Muertes del Sha de la duda (Templo del Dragón de Jade)", 2),
    stat("Sha of Anger kills (Kun-Lai Summit)", "Muertes del Sha de la ira (Cima Kun-Lai)", 1),
  ];
  const { raids, dungeons } = instancesFromStatistics(mop, stats);

  it("groups raid bosses by difficulty with the profile's boss count", () => {
    expect(raids).toHaveLength(1);
    const soo = raids[0]!;
    expect(soo.name).toEqual({ en: "Siege of Orgrimmar", es: "Asedio de Orgrimmar" });
    const heroic = soo.modes.find((m) => m.difficulty === "HEROIC")!;
    expect(heroic).toMatchObject({ completed: 2, total: 14, difficultyName: { en: "25-player Heroic", es: "25 j. heroico" } });
    expect(heroic.encounters.map((e) => [e.name.es, e.kills, e.lastKillAt])).toEqual([
      ["Muertes de Garrosh Grito Infernal", 2, "2026-10-08T21:00:00Z"],
      ["Muertes de Inmerseus", 5, "2026-10-01T21:00:00Z"],
    ]);
    expect(soo.modes.find((m) => m.difficulty === "NORMAL")).toMatchObject({ completed: 1, total: 14 });
  });

  it("keeps dungeons that have a difficulty and leaves world bosses out", () => {
    expect(dungeons.map((d) => d.name)).toEqual([{ en: "Temple of the Jade Serpent", es: "Templo del Dragón de Jade" }]);
    expect(dungeons[0]!.modes.map((m) => [m.difficulty, m.difficultyName?.es, m.completed])).toEqual([
      ["HEROIC", "Heroica", 1],
      ["NORMAL", "Normal", 1],
    ]);
  });

  it("gives the same instance the same id for every character", () => {
    const again = instancesFromStatistics(mop, stats.slice(0, 1));
    expect(again.raids[0]!.id).toBe(raids[0]!.id);
  });
});
