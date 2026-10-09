import { describe, expect, it } from "vitest";
import { bisToGargulCsv } from "./bis";

describe("bisToGargulCsv", () => {
  it("writes one line per item with its players in order, deduped and sorted by item id", () => {
    const csv = bisToGargulCsv([
      { name: "Thrall", items: [{ itemId: 19019 }, { itemId: 17182 }] },
      { name: "Garrosh", items: [{ itemId: 19019 }] },
      { name: "Thrall", items: [{ itemId: 19019 }] }, // same player again: not duplicated
    ]);
    expect(csv).toBe(["17182,Thrall", "19019,Thrall,Garrosh"].join("\n"));
    // Gargul detects the format because the first line starts with digits and a comma.
    expect(csv.split("\n")[0]).toMatch(/^[0-9]+,/);
  });

  it("skips blank names and invalid item ids, and returns an empty string when there is nothing", () => {
    expect(bisToGargulCsv([{ name: "  ", items: [{ itemId: 5 }] }, { name: "Rexxar", items: [{ itemId: 0 }, { itemId: -1 }] }])).toBe("");
    expect(bisToGargulCsv([])).toBe("");
  });
});
