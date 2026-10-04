-- Puts the e2e database back to the seeded state so the browser test can be re-run.
TRUNCATE "Device","DeviceNonce" CASCADE;
DELETE FROM "GradeRequest" WHERE "studentId" IN (SELECT s.id FROM "Student" s JOIN "ParentProfile" p ON p.id = s."parentId" JOIN "User" u ON u.id = p."userId" WHERE u.email = 'mayi@example.mw');
DELETE FROM "Application" WHERE "studentId" IN (SELECT s.id FROM "Student" s JOIN "ParentProfile" p ON p.id = s."parentId" JOIN "User" u ON u.id = p."userId" WHERE u.email = 'mayi@example.mw');
DELETE FROM "Student" WHERE "parentId" IN (SELECT p.id FROM "ParentProfile" p JOIN "User" u ON u.id = p."userId" WHERE u.email = 'mayi@example.mw');
DELETE FROM "User" WHERE email = 'mayi@example.mw';
UPDATE "Application" SET status = 'SUBMITTED', "decidedAt" = NULL, "offeredProgramId" = NULL;
UPDATE "Program" SET "seatsTaken" = 0;
DELETE FROM "WhatsAppSession";
DELETE FROM "Notification";
