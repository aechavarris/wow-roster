-- Best-in-slot wishlists: on the Character for real characters, on the RosterEntry for planned ones.
ALTER TABLE "Character" ADD COLUMN "bis" JSONB;
ALTER TABLE "RosterEntry" ADD COLUMN "bis" JSONB;
