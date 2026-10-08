-- Warcraft Logs report history: persist each report seen during sync so the roster Logs view grows over time.
CREATE TABLE "WarcraftLogsReport" (
    "code" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "zoneId" INTEGER,
    "zoneName" JSONB NOT NULL,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WarcraftLogsReport_pkey" PRIMARY KEY ("code")
);

CREATE INDEX "WarcraftLogsReport_date_idx" ON "WarcraftLogsReport"("date");

CREATE TABLE "WarcraftLogsReportCharacter" (
    "reportCode" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WarcraftLogsReportCharacter_pkey" PRIMARY KEY ("reportCode","characterId")
);

CREATE INDEX "WarcraftLogsReportCharacter_characterId_idx" ON "WarcraftLogsReportCharacter"("characterId");

ALTER TABLE "WarcraftLogsReportCharacter" ADD CONSTRAINT "WarcraftLogsReportCharacter_reportCode_fkey" FOREIGN KEY ("reportCode") REFERENCES "WarcraftLogsReport"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarcraftLogsReportCharacter" ADD CONSTRAINT "WarcraftLogsReportCharacter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
