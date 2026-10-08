import type { Buff, GameProfile } from "./schema";

/** One roster member as far as composition cares: what it is, not who it is. */
export interface CompositionMember {
  classId: number | null;
  specKey: string | null;
  role: string | null;
  /** Role of the member's off-spec when it differs from `role`: the member could cover it instead. */
  offRole?: string | null;
  planned: boolean;
}

export interface BuffCoverage {
  buff: Buff;
  /** Members able to bring it (real and planned). */
  providers: number;
  planned: number;
}

export interface Composition {
  total: number;
  planned: number;
  byRole: Record<string, number>;
  /** Members who play another role but could switch to this one with their off-spec. */
  flexByRole: Record<string, number>;
  byClass: Record<number, number>;
  buffs: BuffCoverage[];
}

/** Counts roles, classes and buff/debuff coverage for the given (raiding) members. */
export function computeComposition(
  profile: Pick<GameProfile, "classes" | "buffs">,
  members: CompositionMember[],
): Composition {
  const classKey = new Map(profile.classes.map((c) => [c.id, c.key]));
  const byRole: Record<string, number> = {};
  const flexByRole: Record<string, number> = {};
  const byClass: Record<number, number> = {};
  for (const m of members) {
    if (m.role) byRole[m.role] = (byRole[m.role] ?? 0) + 1;
    if (m.offRole && m.offRole !== m.role) flexByRole[m.offRole] = (flexByRole[m.offRole] ?? 0) + 1;
    if (m.classId != null) byClass[m.classId] = (byClass[m.classId] ?? 0) + 1;
  }

  // Older or hand-written profiles may not define buffs at all.
  const buffs = (profile.buffs ?? []).map((buff): BuffCoverage => {
    const able = members.filter((m) =>
      buff.providers.some(
        (p) =>
          m.classId != null &&
          classKey.get(m.classId) === p.classKey &&
          (!p.specs || (m.specKey !== null && p.specs.includes(m.specKey))),
      ),
    );
    return { buff, providers: able.length, planned: able.filter((m) => m.planned).length };
  });

  return { total: members.length, planned: members.filter((m) => m.planned).length, byRole, flexByRole, byClass, buffs };
}
