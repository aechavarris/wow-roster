-- AlterTable
ALTER TABLE "RosterEntry" ADD COLUMN     "plannedClassId" INTEGER,
ADD COLUMN     "plannedName" TEXT,
ADD COLUMN     "plannedSpec" TEXT,
ADD COLUMN     "playerName" TEXT,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "characterId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
