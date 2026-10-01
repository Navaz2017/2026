-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SYSTEM_OWNER', 'INSTITUTION_ADMIN', 'PARENT', 'STUDENT');

-- CreateEnum
CREATE TYPE "InstitutionType" AS ENUM ('PRIMARY_SCHOOL', 'SECONDARY_SCHOOL', 'COLLEGE', 'UNIVERSITY');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ProgramStatus" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'UNDERPAID');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('AIRTEL_MONEY', 'MPAMBA');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('OPEN', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "fullName" TEXT NOT NULL,
    "mfaSecret" TEXT,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "institutionId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "InstitutionType" NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'MW',
    "district" TEXT,
    "address" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "payoutProvider" "Provider",
    "payoutPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionDocument" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "description" TEXT,
    "seats" INTEGER NOT NULL,
    "seatsTaken" INTEGER NOT NULL DEFAULT 0,
    "applicationFee" INTEGER NOT NULL,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "status" "ProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "caption" TEXT,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "occupation" TEXT NOT NULL,
    "employer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "parentId" TEXT,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" TEXT,
    "currentSchoolId" TEXT,
    "currentSchoolName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "statement" TEXT,
    "feeMinor" INTEGER NOT NULL,
    "studentServiceFeeMinor" INTEGER NOT NULL,
    "commissionMinor" INTEGER NOT NULL,
    "totalDueMinor" INTEGER NOT NULL,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "attachedCredentialIds" TEXT[],

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "reference" TEXT NOT NULL,
    "payerPhone" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "smsId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "settlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "reference" TEXT,
    "altReference" TEXT,
    "payerPhone" TEXT,
    "payerName" TEXT,
    "amountMinor" INTEGER,
    "rawBody" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "parsedOk" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeen" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceNonce" (
    "deviceId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceNonce_pkey" PRIMARY KEY ("deviceId","nonce")
);

-- CreateTable
CREATE TABLE "RevenueConfig" (
    "id" TEXT NOT NULL,
    "institutionCommissionBps" INTEGER NOT NULL,
    "studentServiceFeeBps" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "grossFeesMinor" INTEGER NOT NULL,
    "commissionMinor" INTEGER NOT NULL,
    "studentServiceFeesMinor" INTEGER NOT NULL,
    "netPayableMinor" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'OPEN',
    "payoutRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LetterTemplate" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "letterhead" TEXT,
    "signatory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LetterTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Letter" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "deliveredVia" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Letter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeRequest" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromSchoolId" TEXT NOT NULL,
    "toSchoolId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultCredentialId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_family_idx" ON "RefreshToken"("family");

-- CreateIndex
CREATE INDEX "Institution_status_type_idx" ON "Institution"("status", "type");

-- CreateIndex
CREATE INDEX "InstitutionDocument_institutionId_idx" ON "InstitutionDocument"("institutionId");

-- CreateIndex
CREATE INDEX "Program_institutionId_idx" ON "Program"("institutionId");

-- CreateIndex
CREATE INDEX "Program_status_updatedAt_idx" ON "Program"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Media_institutionId_idx" ON "Media"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "ParentProfile_userId_key" ON "ParentProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- CreateIndex
CREATE INDEX "Student_parentId_idx" ON "Student"("parentId");

-- CreateIndex
CREATE INDEX "Credential_studentId_idx" ON "Credential"("studentId");

-- CreateIndex
CREATE INDEX "Application_programId_status_idx" ON "Application"("programId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Application_studentId_programId_key" ON "Application"("studentId", "programId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_clientId_key" ON "Application"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_smsId_key" ON "Payment"("smsId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_settlementId_idx" ON "Payment"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_reference_key" ON "Payment"("provider", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_provider_reference_key" ON "SmsMessage"("provider", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_provider_altReference_key" ON "SmsMessage"("provider", "altReference");

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_deviceId_receivedAt_sender_key" ON "SmsMessage"("deviceId", "receivedAt", "sender");

-- CreateIndex
CREATE INDEX "RevenueConfig_effectiveFrom_idx" ON "RevenueConfig"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_institutionId_periodStart_periodEnd_key" ON "Settlement"("institutionId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "LetterTemplate_institutionId_kind_key" ON "LetterTemplate"("institutionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Letter_applicationId_key" ON "Letter"("applicationId");

-- CreateIndex
CREATE INDEX "GradeRequest_fromSchoolId_status_idx" ON "GradeRequest"("fromSchoolId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_updatedAt_idx" ON "Notification"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionDocument" ADD CONSTRAINT "InstitutionDocument_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentProfile" ADD CONSTRAINT "ParentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ParentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_smsId_fkey" FOREIGN KEY ("smsId") REFERENCES "SmsMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceNonce" ADD CONSTRAINT "DeviceNonce_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LetterTemplate" ADD CONSTRAINT "LetterTemplate_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeRequest" ADD CONSTRAINT "GradeRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeRequest" ADD CONSTRAINT "GradeRequest_fromSchoolId_fkey" FOREIGN KEY ("fromSchoolId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeRequest" ADD CONSTRAINT "GradeRequest_toSchoolId_fkey" FOREIGN KEY ("toSchoolId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
