-- AlterTable
ALTER TABLE "RosterWebhook" ADD COLUMN "settings" JSONB;

-- Existing webhooks keep announcing what they did before thresholds existed: every level, every item level point,
-- every rating gain, any new best key, learned and maxed professions, and every standard or friendship standing.
-- The cap is announced only where the old "max_level" event was enabled. New webhooks get the app defaults.
UPDATE "RosterWebhook"
SET "settings" = jsonb_build_object(
  -- A webhook with only "max_level" announced the cap alone, so it gets no "every" step.
  'level', jsonb_build_object(
    'every', CASE WHEN 'level_up' = ANY("events") THEN 1 END,
    'at', '[]'::jsonb,
    'atMax', 'max_level' = ANY("events")
  ),
  'itemLevel', '{"every": 1, "at": []}'::jsonb,
  'mythicRating', '{"every": 1, "at": []}'::jsonb,
  'mythicPlus', '{"minKey": 2}'::jsonb,
  'profession', '{"every": null, "at": [], "professions": null, "atMax": true, "onLearn": true}'::jsonb,
  'reputation', '{"standings": ["hated", "hostile", "unfriendly", "neutral", "friendly", "honored", "revered", "exalted"], "renown": {"every": null, "at": []}, "friendship": true}'::jsonb
);

-- "max_level" is now part of "level_up" (its "at the level cap" option, set above).
UPDATE "RosterWebhook"
SET "events" = ARRAY(
  SELECT DISTINCT CASE WHEN e = 'max_level' THEN 'level_up' ELSE e END FROM unnest("events") AS e
)
WHERE 'max_level' = ANY("events");
