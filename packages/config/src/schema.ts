import { z } from "zod";

/** Text translated per UI locale, e.g. { en: "Warrior", es: "Guerrero" }. */
export const localizedSchema = z.record(z.string(), z.string());
export type Localized = z.infer<typeof localizedSchema>;

export const roleSchema = z.object({
  key: z.string(),
  name: localizedSchema,
  color: z.string(),
});

export const specSchema = z.object({
  key: z.string(),
  name: localizedSchema,
  /** Roles this spec can fill; the first one is the default. */
  roles: z.array(z.string()).min(1),
  /** Specialization ids as returned by the Blizzard API for this game version. */
  blizzardIds: z.array(z.number()).default([]),
  /** Fallback match on the English spec/talent-tree name when ids are unknown (e.g. Classic APIs). */
  apiNames: z.array(z.string()).default([]),
});

export const classSchema = z.object({
  id: z.number(),
  key: z.string(),
  name: localizedSchema,
  color: z.string(),
  specs: z.array(specSchema),
});

export const raidSizeSchema = z.object({
  size: z.number().int().positive(),
  groupSize: z.number().int().positive().default(5),
  enabled: z.boolean().default(true),
  note: z.string().optional(),
});

export const raidSchema = z.object({
  key: z.string(),
  name: localizedSchema,
  size: z.number().int().positive(),
  enabled: z.boolean().default(true),
  bosses: z.array(z.object({ key: z.string(), name: localizedSchema })).default([]),
  note: z.string().optional(),
});

export const rosterStatusSchema = z.object({
  key: z.string(),
  name: localizedSchema,
  color: z.string(),
  /** Whether characters in this status are part of the active raiding roster. */
  raiding: z.boolean(),
  /** Hidden from the default roster view. */
  hidden: z.boolean().default(false),
});

export const apiSchema = z.object({
  /** Namespace templates; `{region}` is replaced at runtime. */
  profileNamespace: z.string(),
  staticNamespace: z.string(),
  dynamicNamespace: z.string(),
  /** Whether characters and guilds are addressed by realm (retail/classic) or not (Forever rulesets). */
  hasRealms: z.boolean(),
  /** Profile endpoints this game version supports; others are skipped instead of 404ing. */
  characterEndpoints: z.array(
    z.enum(["equipment", "specializations", "media", "statistics", "professions", "reputations"]),
  ),
});

export const gameProfileSchema = z.object({
  id: z.string(),
  label: z.string(),
  maxLevel: z.number().int().positive(),
  api: apiSchema,
  /** Wowhead tooltip domain prefix: "" for retail, "classic", "forever"... */
  wowheadDomain: z.string(),
  roles: z.array(roleSchema),
  classes: z.array(classSchema),
  raidSizes: z.array(raidSizeSchema),
  raids: z.array(raidSchema),
  rosterStatuses: z.array(rosterStatusSchema),
  sync: z.object({
    defaultIntervalMinutes: z.number().int().positive(),
    minIntervalMinutes: z.number().int().positive(),
    defaultMinLevel: z.number().int().nonnegative(),
  }),
});

export type GameProfile = z.infer<typeof gameProfileSchema>;
export type GameClass = z.infer<typeof classSchema>;
export type GameSpec = z.infer<typeof specSchema>;
export type GameRole = z.infer<typeof roleSchema>;
export type RosterStatus = z.infer<typeof rosterStatusSchema>;
export type RaidSize = z.infer<typeof raidSizeSchema>;

/** A profile file may extend another one and override any top-level key. */
export const profileFileSchema = gameProfileSchema.partial().extend({
  id: z.string(),
  extends: z.string().optional(),
});
export type ProfileFile = z.infer<typeof profileFileSchema>;
