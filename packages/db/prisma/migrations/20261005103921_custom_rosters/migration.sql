-- AlterTable
ALTER TABLE "Guild" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'guild',
ALTER COLUMN "realm" DROP NOT NULL,
ALTER COLUMN "slug" DROP NOT NULL;

-- CreateTable
CREATE TABLE "RosterInvite" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "role" "GuildRole" NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RosterInvite_guildId_idx" ON "RosterInvite"("guildId");

-- AddForeignKey
ALTER TABLE "RosterInvite" ADD CONSTRAINT "RosterInvite_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
