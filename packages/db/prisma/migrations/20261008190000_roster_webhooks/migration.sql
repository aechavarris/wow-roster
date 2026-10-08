-- Discord webhooks a roster posts character-progress announcements to.
CREATE TABLE "RosterWebhook" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "locale" TEXT NOT NULL DEFAULT 'es',
    "allCharacters" BOOLEAN NOT NULL DEFAULT true,
    "characterIds" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RosterWebhook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RosterWebhook_guildId_idx" ON "RosterWebhook"("guildId");

ALTER TABLE "RosterWebhook" ADD CONSTRAINT "RosterWebhook_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
