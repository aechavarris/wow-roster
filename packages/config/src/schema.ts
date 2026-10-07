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
  /** False while Blizzard has no public API for the version (Forever): rosters can only hold planned characters. */
  available: z.boolean().default(true),
  /** Namespace templates; `{region}` is replaced at runtime. */
  profileNamespace: z.string(),
  staticNamespace: z.string(),
  dynamicNamespace: z.string(),
  /** Whether characters and guilds are addressed by realm (retail/classic) or not (Forever rulesets). */
  hasRealms: z.boolean(),
  /** Profile endpoints this game version supports; others are skipped instead of 404ing. */
  characterEndpoints: z.array(
    z.enum(["equipment", "specializations", "media", "statistics", "professions", "reputations", "raids", "dungeons", "mythicPlus"]),
  ),
});

/**
 * One row of the character stats panel. `stats` lists API statistic keys; the highest one is
 * shown (e.g. crit = max of melee/ranged/spell), and `labels` can name each candidate (primary stat).
 */
export const statEntrySchema = z.object({
  key: z.string(),
  label: localizedSchema,
  stats: z.array(z.string()).min(1),
  labels: z.record(z.string(), localizedSchema).optional(),
  format: z.enum(["number", "percent"]).default("number"),
  /** API key holding the rating behind a percentage, when it is not part of the stat itself. */
  ratingStat: z.string().optional(),
  hideIfZero: z.boolean().default(false),
});

/** Sections of the stats panel, in the order the game shows them. Rows whose stats the API lacks are skipped. */
export const statSectionSchema = z.object({
  key: z.string(),
  name: localizedSchema,
  entries: z.array(statEntrySchema),
});

/**
 * A raid buff, debuff or utility and who can bring it. Providers name a class and, when the
 * effect needs a specialization (talent), the specs that bring it.
 */
export const buffSchema = z.object({
  key: z.string(),
  name: localizedSchema,
  category: z.enum(["buff", "debuff", "utility"]),
  providers: z.array(z.object({ classKey: z.string(), specs: z.array(z.string()).optional() })).min(1),
  note: z.string().optional(),
});

export type Buff = z.infer<typeof buffSchema>;
export type StatEntry = z.infer<typeof statEntrySchema>;
export type StatSection = z.infer<typeof statSectionSchema>;

/**
 * A profession of the game version. `id` is Blizzard's profession (skill line) id, the same the
 * profession API returns; `maxSkill` is the cap at this version's level cap (absent where the API
 * reports it per expansion tier, as in retail).
 */
export const professionSchema = z.object({
  id: z.number().int().positive(),
  key: z.string(),
  name: localizedSchema,
  kind: z.enum(["primary", "secondary"]),
  maxSkill: z.number().int().positive().optional(),
});

export const gameProfileSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Short name shown when picking a game version for a roster. */
  name: localizedSchema,
  maxLevel: z.number().int().positive(),
  api: apiSchema,
  /** Wowhead tooltip domain prefix: "" for retail, "classic", "forever"... */
  wowheadDomain: z.string(),
  roles: z.array(roleSchema),
  classes: z.array(classSchema),
  raidSizes: z.array(raidSizeSchema),
  raids: z.array(raidSchema),
  rosterStatuses: z.array(rosterStatusSchema),
  statPanel: z.array(statSectionSchema).default([]),
  /** Raid composition coverage; replaced as a whole when a profile extends another. */
  buffs: z.array(buffSchema).default([]),
  /** Professions that exist in this version; validates manually entered ones where the API has none. */
  professions: z.array(professionSchema).default([]),
  /** How many primary professions a character can learn. */
  maxPrimaryProfessions: z.number().int().positive().default(2),
  sync: z.object({
    defaultIntervalMinutes: z.number().int().positive(),
    minIntervalMinutes: z.number().int().positive(),
    defaultMinLevel: z.number().int().nonnegative(),
  }),
});

export type GameProfile = z.infer<typeof gameProfileSchema>;
export type ApiConfig = z.infer<typeof apiSchema>;
export type GameClass = z.infer<typeof classSchema>;
export type GameSpec = z.infer<typeof specSchema>;
export type GameRole = z.infer<typeof roleSchema>;
export type RosterStatus = z.infer<typeof rosterStatusSchema>;
export type RaidSize = z.infer<typeof raidSizeSchema>;
export type GameProfession = z.infer<typeof professionSchema>;

/** A profile file may extend another one and override any top-level key. */
export const profileFileSchema = gameProfileSchema.partial().extend({
  id: z.string(),
  extends: z.string().optional(),
});
export type ProfileFile = z.infer<typeof profileFileSchema>;
