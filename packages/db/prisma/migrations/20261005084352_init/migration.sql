-- CreateEnum
CREATE TYPE "GuildRole" AS ENUM ('OWNER', 'OFFICER', 'MEMBER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "bnetId" INTEGER NOT NULL,
    "battletag" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guild" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "faction" TEXT,
    "blizzardId" INTEGER,
    "public" BOOLEAN NOT NULL DEFAULT true,
    "syncIntervalMinutes" INTEGER NOT NULL,
    "minLevel" INTEGER NOT NULL,
    "officerMaxRank" INTEGER NOT NULL DEFAULT 1,
    "lastSyncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildRank" (
    "guildId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL,

    CONSTRAINT "GuildRank_pkey" PRIMARY KEY ("guildId","rank")
);

-- CreateTable
CREATE TABLE "GuildMembership" (
    "userId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "role" "GuildRole" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "GuildMembership_pkey" PRIMARY KEY ("userId","guildId")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "blizzardId" INTEGER,
    "level" INTEGER NOT NULL DEFAULT 0,
    "classId" INTEGER,
    "raceId" INTEGER,
    "gender" TEXT,
    "faction" TEXT,
    "specId" INTEGER,
    "specName" TEXT,
    "averageItemLevel" DOUBLE PRECISION,
    "equippedItemLevel" DOUBLE PRECISION,
    "lastLoginAt" TIMESTAMP(3),
    "guildId" TEXT,
    "guildRank" INTEGER,
    "ownerId" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "profile" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT,
    "role" TEXT,
    "note" TEXT,
    "mainEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_bnetId_key" ON "User"("bnetId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Guild_region_realm_slug_key" ON "Guild"("region", "realm", "slug");

-- CreateIndex
CREATE INDEX "Character_guildId_idx" ON "Character"("guildId");

-- CreateIndex
CREATE INDEX "Character_ownerId_idx" ON "Character"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_region_realm_nameKey_key" ON "Character"("region", "realm", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "RosterEntry_guildId_characterId_key" ON "RosterEntry"("guildId", "characterId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildRank" ADD CONSTRAINT "GuildRank_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildMembership" ADD CONSTRAINT "GuildMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuildMembership" ADD CONSTRAINT "GuildMembership_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_mainEntryId_fkey" FOREIGN KEY ("mainEntryId") REFERENCES "RosterEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
