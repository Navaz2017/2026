-- Decision letters can be held and released together on one date.
ALTER TABLE "Application" ADD COLUMN "decisionPublishedAt" TIMESTAMP(3);
ALTER TABLE "Institution" ADD COLUMN "letterMode" TEXT NOT NULL DEFAULT 'IMMEDIATE', ADD COLUMN "lettersReleaseAt" TIMESTAMP(3);
-- Every decision made before this feature was already announced.
UPDATE "Application" SET "decisionPublishedAt" = "decidedAt" WHERE "decidedAt" IS NOT NULL;
