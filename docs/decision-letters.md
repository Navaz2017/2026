# Decision letters: send now, or hold and release together

The registrar chooses, for the whole institution **and** for each decision:

| Choice | What happens |
|---|---|
| **Send the letter now** (default) | The decision is announced at once: the applicant's status changes, they get the in-app notice, and the letter goes out by email / WhatsApp (the school's own linked number). |
| **Hold the letter** | The decision is saved and the seat is used, but the applicant (and their parent) is told **nothing**: their application still reads "Being reviewed", no note, no letter, no notification, nothing in the mobile sync. |

*Institution default:* **Letters → Sending decision letters** (needs the security code). Each decision on the applicant's page starts from that default and can be changed with its **Letter** choice.

## Releasing held letters
- **Send all N letters now** (Letters page): every held decision of this institution (acceptances and rejections) is announced in one go.
- **Automatic date:** set *Send them automatically on (date and time)*. When it arrives, everything held is released by itself (a check runs every minute inside the API). The date is then used up.
- **One at a time:** *Send this letter now* on a held applicant's page.
- Releasing twice does nothing the second time (atomic claim; no duplicate notices or letters, even with several API processes).

## Notes
- Held decisions are private to the school; the registrar's list shows a **Letter on hold** badge.
- There is no "undo decision" yet: once decided (held or not) a decision cannot be changed. Decide carefully, or add that feature.
- Decisions made before this feature existed count as already announced.
- Everything is per institution: one school's release never touches another's.
- Tests: `backend/test/integration/letters.int.test.ts` (hidden everywhere while held, release one/all, idempotency, MFA, schedule, isolation).
