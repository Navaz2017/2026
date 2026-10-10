# Enrolla School Hub - design and build plan

Day-to-day school life on top of Enrolla: roster, attendance, results, teacher feedback, announcements, chat.
**Decided by the owner (do not re-litigate):**

| Topic | Decision |
|---|---|
| Product shape | A **module inside Enrolla** (same backend, same login, same parent app), not a separate app. Keep it a clearly separated module (own tables, routes, menus). |
| First schools | **Secondary (JCE = Forms 1-2, MSCE = Forms 3-4) first, then Primary (STD1-8).** Colleges/universities: out of scope. |
| Who pays | **Schools do NOT pay** (smooth adoption). Revenue idea: parents pay a **monthly** fee for **paid tutoring courses** (private tutoring after school, focused on what the child missed). School communication stays free for parents. Teacher data bundles may be sponsored by Enrolla to incentivise use (tie to usage, monthly cap; check Africa's Talking airtime support for Malawi). NB: Airtel Money/Mpamba cannot auto-debit, so a "subscription" = manual 30-day payment by transaction ID, matched by the SMS reader (reuse `reconcile.ts`), with reminders. |
| Announcements | **In-app notification first** (live over WebSocket, always). **WhatsApp is secondary** (the school's own linked number via `WaOutbox`) in case whatsapp-web.js gets blocked. Per announcement `alsoWhatsApp` (default on when the school's WhatsApp is CONNECTED). |
| Quiet hours | **Off by default** (weather emergencies etc.). Optional per-school setting later; `urgent` announcements ignore quiet hours always. |
| Chat | **Class channels** for teacher <-> students (group). **No private teacher<->student chat.** A student receives **personalised feedback** on an assessment/assignment (it is attached to their grade, visible to the student and guardians). **Teacher <-> guardians: ONE thread per child per teacher, and ALL the child's guardians (who may message) see the same thread.** |
| Guardians | A child can have **several guardians**; a parent can have **children in different schools** (child switcher in the app). |
| Linking | Via the school roster: **phone number is the join key**, proven by the OTP login that already exists. Access to a child is granted only by a link the school confirmed (roster match or approved claim) - never by a parent's own say-so. |
| Migration of an existing school | School uploads a **template (CSV/XLSX)**: students, guardians, staff. Preview -> validate -> commit; duplicate detection; downloadable error report; idempotent re-import keyed on admission number; one-click rollback of an import batch. |

## Entities (Prisma, all school-owned rows carry `institutionId`)
- `Enrolment` {studentId, institutionId, academicYear, classId, admissionNo, status ACTIVE|LEFT|GRADUATED} - unique (institution, admissionNo) and (student, institution, year). **Everything school-side hangs off the enrolment**, not the student.
- `SchoolClass` {institutionId, academicYear, name ("Form 3A"), level (F1..F4 | STD1..STD8), classTeacherId?}.
- `Subject` {institutionId, name}.  `TeachingAssignment` {teacherUserId, classId, subjectId?(null = class teacher), academicYear}.
- `Guardianship` {studentId, guardianUserId? (null until claimed), phone (E.164, roster join key), fullName, relationship, canViewProgress, canMessage, receivesNotices, isPrimary, blocked (court order: no info), status ACTIVE|PENDING|REVOKED, source ROSTER|CLAIM|ADMISSIONS}. Backfilled from `Student.parentId`. `Student.parentId` still exists (admissions flow); keep both in sync (`POST /me/children` creates a Guardianship).
- `Assessment` {classId, subjectId, termNo, academicYear, title, type TEST|EXAM|ASSIGNMENT, maxScore, date, createdById} and `Grade` {assessmentId, enrolmentId, score?, feedback? (personalised, shown to student + guardians), publishedAt}. Results are visible to families only once published.
- `Attendance` {enrolmentId, date, status PRESENT|ABSENT|LATE|EXCUSED, note, markedById}, unique (enrolment, date). Absence -> notification to guardians at once.
- `Announcement` {institutionId, authorId, title, body, audience SCHOOL|CLASS, classIds[], urgent, alsoWhatsApp} + `AnnouncementRead`. Recipients = guardians (receivesNotices) + students with accounts of the targeted classes.
- `Channel` (class/subject group chat) + `ChannelMessage`; `Thread` {institutionId, studentId, teacherUserId} + `ThreadMessage` (participants: that teacher + every guardian with canMessage). **Phase 2.**
- `RosterImport` {institutionId, status PREVIEW|COMMITTED|ROLLED_BACK, rows JSON, errors JSON} + `rosterImportId` on created rows for rollback.
- Role `TEACHER` (users belong to an institution; invited by the school admin by phone; log in by OTP). Needs "several staff per institution" (today an institution has one admin) - model: `User.institutionId` + `Role` is enough; INSTITUTION_ADMIN may manage staff.

## Access rules (derive everything from the three link tables)
- Guardian: only children they have an ACTIVE, non-blocked Guardianship for; progress needs `canViewProgress`.
- Teacher: only classes they are assigned to (class teacher: whole class; subject teacher: that subject's assessments; attendance for the class teacher or any assigned teacher - decide); may message only guardians of those classes' children.
- School admin: whole institution. Student (own account): own enrolment only, own grades/feedback + class channels.
- When an enrolment ends the teacher loses access; guardians keep history.
- Every read of a child's grades/attendance by staff and every export is audited (`audit()`); `blocked` guardians get nothing.

## Build phases and acceptance
1. **Foundation + roster + linking + announcements + attendance + results (BUILT in this repo - see HANDOFF.md for the exact state).**
2. Teacher <-> guardian threads, class channels, homework/assignment submissions (file upload) with feedback, teacher mobile screens, quiet-hours setting, staff invitations UI, claim-code/QR flow for unmatched phones.
3. Paid tutoring courses (monthly, mobile-money + SMS matching), teacher data-bundle incentives, report-card PDFs, timetable/calendar, primary-school grading scales.

## Grading scales (configurable per school; defaults)
JCE/MSCE (MANEB): percentage -> grade 1-9 (1 = 80-100 ... 9 = below 40). Primary: percentage + position. Store raw `score`/`maxScore`; compute grades on read from a school-level scale (so scales can change).

## Risks / policy
Children's data: get the Malawi data-protection requirements reviewed by a lawyer before launch. Chat: retain messages, allow report/block, teacher phone numbers never shown, text-first (low data). Wrong phone numbers on rosters: first login asks the parent to confirm the child's admission number or name before showing grades; the school can unlink immediately.
