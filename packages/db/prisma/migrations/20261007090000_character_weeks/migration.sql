-- CreateTable
CREATE TABLE "CharacterWeek" (
    "characterId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "itemLevel" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterWeek_pkey" PRIMARY KEY ("characterId","weekStart")
);

-- CreateIndex
CREATE INDEX "CharacterWeek_weekStart_idx" ON "CharacterWeek"("weekStart");

-- AddForeignKey
ALTER TABLE "CharacterWeek" ADD CONSTRAINT "CharacterWeek_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
