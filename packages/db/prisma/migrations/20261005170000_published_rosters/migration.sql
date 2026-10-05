-- Published rosters: listed for every signed-in user, who can propose characters that stay
-- pending until the owner accepts them.

-- AlterTable
ALTER TABLE "Guild" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RosterEntry" ADD COLUMN "pending" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Guild_published_idx" ON "Guild"("published");

-- CreateIndex
CREATE INDEX "RosterEntry_guildId_pending_idx" ON "RosterEntry"("guildId", "pending");
