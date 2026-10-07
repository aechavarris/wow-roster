import type { CharacterProfile } from "@wow/blizzard";
import { resolveProfile } from "@wow/config";
import { describe, expect, it } from "vitest";
import { profileIncomplete } from "./sync";

const retail = resolveProfile("retail");
const era = resolveProfile("classic-era");

/** A stored profile with data for every endpoint the version declares. */
function complete(): Partial<CharacterProfile> {
  return {
    equipment: [],
    talents: [],
    media: {},
    statistics: {},
    professions: [],
    reputations: [],
    raids: [],
    dungeons: [],
    mythicPlus: { weeklyRuns: [], seasonRuns: [] },
    raiderIo: { weeklyRuns: [], recentRuns: [], bestRuns: [] },
    missing: {},
  } as unknown as Partial<CharacterProfile>;
}

describe("profileIncomplete", () => {
  it("accepts a profile with every endpoint of the version", () => {
    expect(profileIncomplete(retail, complete())).toBe(false);
  });

  it("refetches profiles stored before an endpoint was added", () => {
    const { mythicPlus: _m, ...old } = complete();
    expect(profileIncomplete(retail, old)).toBe(true);
    // Classic Era has no Mythic+, so the same profile is complete there.
    expect(profileIncomplete(era, old)).toBe(false);
  });

  it("keeps endpoints that answered 404 but retries other failures", () => {
    const { mythicPlus: _m, ...rest } = complete();
    expect(profileIncomplete(retail, { ...rest, missing: { mythicPlus: "404" } })).toBe(false);
    expect(profileIncomplete(retail, { ...rest, missing: { mythicPlus: "502" } })).toBe(true);
  });

  it("refetches Mythic+ profiles without the season's best runs", () => {
    expect(profileIncomplete(retail, { ...complete(), mythicPlus: { weeklyRuns: [] } })).toBe(true);
  });

  it("refetches retail profiles without Raider.IO data unless Raider.IO does not know the character", () => {
    const { raiderIo: _r, ...withoutRio } = complete();
    expect(profileIncomplete(retail, withoutRio)).toBe(true);
    expect(profileIncomplete(retail, { ...withoutRio, missing: { raiderIo: "404" } })).toBe(false);
    // Classic Era has no Raider.IO.
    expect(profileIncomplete(era, withoutRio)).toBe(false);
  });

  it("treats a missing profile as incomplete", () => {
    expect(profileIncomplete(retail, null)).toBe(true);
  });
});
