-- Every roster and character belongs to a game version (config profile id). Existing data was
-- read from the retail API, so it is backfilled as "retail"; new rows must always say their version.

-- AlterTable
ALTER TABLE "Guild" ADD COLUMN "gameVersion" TEXT NOT NULL DEFAULT 'retail';
ALTER TABLE "Guild" ALTER COLUMN "gameVersion" DROP DEFAULT;

ALTER TABLE "Character" ADD COLUMN "gameVersion" TEXT NOT NULL DEFAULT 'retail';
ALTER TABLE "Character" ALTER COLUMN "gameVersion" DROP DEFAULT;

-- The same name can exist in several game versions.
DROP INDEX "Guild_region_realm_slug_key";
CREATE UNIQUE INDEX "Guild_gameVersion_region_realm_slug_key" ON "Guild"("gameVersion", "region", "realm", "slug");

DROP INDEX "Character_region_realm_nameKey_key";
CREATE UNIQUE INDEX "Character_gameVersion_region_realm_nameKey_key" ON "Character"("gameVersion", "region", "realm", "nameKey");
