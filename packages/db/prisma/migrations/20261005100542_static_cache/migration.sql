-- CreateTable
CREATE TABLE "StaticCache" (
    "key" TEXT NOT NULL,
    "data" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaticCache_pkey" PRIMARY KEY ("key")
);
