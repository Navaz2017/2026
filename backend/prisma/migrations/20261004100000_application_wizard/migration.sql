-- DropIndex
DROP INDEX "Application_studentId_programId_key";

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "academicYear" TEXT NOT NULL DEFAULT '2026/2027',
ADD COLUMN     "form" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "institutionId" TEXT,
ADD COLUMN     "offeredProgramId" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "campuses" TEXT[],
ADD COLUMN     "description" TEXT,
ADD COLUMN     "highestLevel" TEXT,
ADD COLUMN     "otherFees" JSONB,
ADD COLUMN     "syllabi" TEXT[],
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "classLevel" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "duration" TEXT,
ADD COLUMN     "entryRequirements" TEXT,
ADD COLUMN     "modes" TEXT[],
ADD COLUMN     "syllabus" TEXT,
ADD COLUMN     "tuitionFeeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tuitionPeriod" TEXT NOT NULL DEFAULT 'SEMESTER';

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "profile" JSONB;


-- Backfill existing rows (safe on databases that already hold applications):
UPDATE "Application" a SET "institutionId" = p."institutionId" FROM "Program" p WHERE p."id" = a."programId";
-- A student could previously apply to several programmes of one institution; keep the first, tag the rest so the new
-- one-application-per-institution-per-year unique index can be created without losing data.
UPDATE "Application" a SET "academicYear" = a."academicYear" || ' (extra ' || d.rn || ')'
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "studentId", "institutionId" ORDER BY "createdAt") AS rn FROM "Application") d
WHERE d."id" = a."id" AND d.rn > 1;
ALTER TABLE "Application" ALTER COLUMN "institutionId" SET NOT NULL;

-- CreateTable
CREATE TABLE "ApplicationChoice" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "ApplicationChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationChoice_applicationId_rank_key" ON "ApplicationChoice"("applicationId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationChoice_applicationId_programId_key" ON "ApplicationChoice"("applicationId", "programId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_studentId_institutionId_academicYear_key" ON "Application"("studentId", "institutionId", "academicYear");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationChoice" ADD CONSTRAINT "ApplicationChoice_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationChoice" ADD CONSTRAINT "ApplicationChoice_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing applications become rank-1 choices.
INSERT INTO "ApplicationChoice" ("id", "applicationId", "programId", "rank")
SELECT gen_random_uuid()::text, "id", "programId", 1 FROM "Application";
