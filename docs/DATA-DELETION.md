# Account deletion — data map, plan, and what needs owner sign-off

GDPR right to erasure / CCPA right to delete, as promised in the Privacy Policy
(`app/legal/privacy`, §11.1: Access, Deletion, Portability; §11.2: "through your
account settings"; §9.3: 30-day post-cancellation retention).

This document is the single source of truth for what an account deletion
touches. The destructive code lives in `lib/account-deletion.ts` and is called
from `app/api/account/delete/route.ts`. Read this before changing either.

---

## tl;dr for the reviewer

- **Export is fully implemented and on.** `GET /api/account/export` returns the
  caller's whole workspace as JSON, scoped server-side to their one `spaceId`.
- **Deletion is scaffolded.** The request flow, type-to-confirm, Clerk user
  deletion, and the documented DB sweep all exist. The **destructive DB sweep
  is gated behind a feature flag** (`ACCOUNT_DELETION_HARD_DELETE`) and is
  **off by default**. With it off, deletion removes the Clerk login and audits
  the request; the workspace rows wait for a reviewed run.
- **No schema migration is required for the hard delete itself** — the cascade
  graph already exists. The optional improvements in the last section
  (soft-delete / retention columns) DO need a migration and owner approval.

---

## how the cascade works (load-bearing)

The schema was built for this. Two facts make a full purge possible with a
single `DELETE` and no hand-written ordering:

1. `Space.ownerId REFERENCES "User"(id) ON DELETE CASCADE`
   — delete the User row and its Space row goes with it.
2. Almost every space-scoped table is `... REFERENCES "Space"(id) ON DELETE
   CASCADE` — delete the Space row and all of them go with it.

So `DELETE FROM "User" WHERE id = ?` cascades: User → Space → Contact, Deal,
Property, Conversation, Message, Note, Tour, DealStage, Pipeline, etc. Postgres
enforces the order via the FK graph. We do not replicate that order in code.

---

## table-by-table plan

### A. Hard-deleted automatically via `ON DELETE CASCADE` from Space

These need no explicit handling — deleting the Space (via deleting the User)
removes them. Verified against `supabase/schema.sql` and `supabase/migrations/*`:

| Table | FK |
|---|---|
| `SpaceSetting` | `spaceId → Space ON DELETE CASCADE` |
| `Contact` | `spaceId → Space ON DELETE CASCADE` |
| `ContactActivity` | `spaceId → Space ON DELETE CASCADE` |
| `ContactDocument` | `spaceId → Space ON DELETE CASCADE` |
| `DealStage` | `spaceId → Space ON DELETE CASCADE` |
| `Pipeline` | `spaceId → Space ON DELETE CASCADE` |
| `Deal` | `spaceId → Space ON DELETE CASCADE` |
| `DealActivity` | `spaceId → Space ON DELETE CASCADE` |
| `DealChecklistItem` | `spaceId → Space ON DELETE CASCADE` |
| `DealDocument` | `spaceId → Space ON DELETE CASCADE` |
| `DealContact` | `dealId → Deal ON DELETE CASCADE` (reached via Deal) |
| `Property` | `spaceId → Space ON DELETE CASCADE` |
| `PropertyPacket` | `spaceId → Space ON DELETE CASCADE` |
| `Conversation` | `spaceId → Space ON DELETE CASCADE` |
| `Message` | `spaceId → Space ON DELETE CASCADE` |
| `Note` | `spaceId → Space ON DELETE CASCADE` |
| `Tour` | `spaceId → Space ON DELETE CASCADE` |
| `TourFeedback` | `spaceId → Space ON DELETE CASCADE` |
| `TourWaitlist` | `spaceId → Space ON DELETE CASCADE` |
| `TourPropertyProfile` | `spaceId → Space ON DELETE CASCADE` |
| `TourAvailabilityOverride` | `spaceId → Space ON DELETE CASCADE` |
| `CalendarEvent` | `spaceId → Space ON DELETE CASCADE` |
| `GoogleCalendarToken` | `spaceId → Space ON DELETE CASCADE` |
| `MessageTemplate` | `spaceId → Space ON DELETE CASCADE` |
| `FormDraft` | `spaceId → Space ON DELETE CASCADE` |
| `FormAnalyticsEvent` | `spaceId → Space ON DELETE CASCADE` |
| `ApplicationMessage` | `spaceId → Space ON DELETE CASCADE` |
| `ApplicationStatusUpdate` | `spaceId → Space ON DELETE CASCADE` |
| `CommissionSplit` | `spaceId → Space ON DELETE CASCADE` |
| `DocumentEmbedding` | `spaceId → Space ON DELETE CASCADE` |
| `AuditLog` | `spaceId → Space ON DELETE CASCADE` |
| `AgentSettings` | `spaceId → Space ON DELETE CASCADE` |
| `AgentActivityLog` | `spaceId → Space ON DELETE CASCADE` |
| `AgentDraft` | `spaceId → Space ON DELETE CASCADE` |
| `AgentMemory` | `spaceId → Space ON DELETE CASCADE` |
| `AgentGoal` | `spaceId → Space ON DELETE CASCADE` |
| `AgentQuestion` | `spaceId → Space ON DELETE CASCADE` |
| `AgentTask` | `spaceId → Space ON DELETE CASCADE` |
| `McpApiKey` | `spaceId → Space ON DELETE CASCADE` |
| `McpAuthCode` | `spaceId → Space ON DELETE CASCADE` |
| `CmaReport` | `spaceId → Space ON DELETE CASCADE` |
| `StudioPost` | `spaceId → Space ON DELETE CASCADE` |
| `File` | `spaceId → Space ON DELETE CASCADE` |
| `DisabledSpace` | `spaceId → Space ON DELETE CASCADE` |

> Note: `AuditLog` cascades away with the Space. That is acceptable for the
> tenant's own operational log, but see the open question below about whether
> deletion-event audit records should outlive the Space (they currently do
> not — the pre-delete `audit()` call writes to the same table that's about to
> be deleted). **Open question for owner.**

### B. Hard-deleted EXPLICITLY (no FK cascade — handled in code)

These carry `spaceId` but have **no foreign key** to `Space`, so they are NOT
cascaded. `lib/account-deletion.ts` deletes them by `spaceId` BEFORE deleting
the User row:

| Table | Why it doesn't cascade |
|---|---|
| `Attachment` | `spaceId` column, no `REFERENCES "Space"` (schema.sql) |
| `TelemetryEvent` | nullable `spaceId`, no FK (schema.sql) |

### C. Anonymized / retained (NOT deleted) — by design or by law

| Table / record | Behavior | Reason |
|---|---|---|
| Stripe customer, invoices, charges | retained at Stripe | financial-records retention; we don't control Stripe's store. The `stripeCustomerId`/`stripeSubscriptionId` on the Space row are deleted with the Space, but the Stripe-side objects persist per their retention. |
| `CommissionLedger` | retained | `brokerageId`/`agentUserId`/`dealId`-scoped financial record owned by the **brokerage**, not the space. Erasing one agent's account should not destroy the brokerage's commission books. `agentUserId → User ON DELETE CASCADE` would normally remove rows, so deleting a User that has ledger rows needs a decision — see open questions. |
| `SupportTicket` | `spaceId` set to NULL (`ON DELETE SET NULL`) | support history is retained for dispute resolution; the link to the space is severed. |
| `Property.assignedSpaceId` (brokerage pool) | set to NULL (`ON DELETE SET NULL`) | a brokerage-pool property returns to the pool rather than being destroyed. |
| `Brokerage` (`ownerId → User ON DELETE RESTRICT`) | **blocks deletion** | a broker who owns a brokerage cannot delete their User row until the brokerage is transferred or removed. The route detects this (`checkDeletionBlockers`) and returns a clear 409 rather than letting Postgres throw. |

---

## what's hard-deleted vs anonymized — summary

- **Hard-deleted:** the entire space-scoped CRM footprint (people, deals,
  properties, conversations, documents-metadata, agent memory, settings) plus
  the Clerk identity, plus the two non-cascading tables (`Attachment`,
  `TelemetryEvent`).
- **Anonymized / link-severed:** `SupportTicket`, brokerage-pool `Property`.
- **Retained:** Stripe-side financial records, `CommissionLedger` (brokerage
  financial books), as legally appropriate.

> Document **binary contents** (files in object storage referenced by
> `DealDocument`/`ContactDocument`/`File`/`Attachment` rows) are NOT swept by
> the DB delete — only the metadata rows are. **Open question: storage purge.**

---

## the feature flag

`ACCOUNT_DELETION_HARD_DELETE`

- **off (default):** `POST /api/account/delete` validates type-to-confirm,
  audits, and **deletes the Clerk user** (locks the person out), then returns
  `{ pendingDataDeletion: true }`. No DB rows are touched. This is the shipped
  default — we do not run an untested cascade in production automatically.
- **on:** after the Clerk delete, `hardDeleteSpaceAndUser()` runs the sweep
  in section B then deletes the User row (cascade in section A).

Flip it to `true` only after this document is signed off and the cascade has
been exercised against a staging copy.

---

## OPEN QUESTIONS — need owner approval

1. **Turn on the hard delete?** The cascade is correct per the schema but has
   not been run end-to-end in production. Approve a staging dry-run, then flip
   `ACCOUNT_DELETION_HARD_DELETE=true`.
2. **Object-storage purge.** Deleting `DealDocument`/`File`/`Attachment` rows
   leaves the underlying blobs in storage. Do we add a storage-sweep step
   (enumerate `storageKey`/`publicUrl` and delete from the bucket) to fully
   honor erasure? Recommended yes; needs the storage-client wiring.
3. **`CommissionLedger` on agent deletion.** `agentUserId → User ON DELETE
   CASCADE` means deleting the User row WILL delete that agent's ledger rows,
   which conflicts with the "retain brokerage financial books" intent above.
   Decide: (a) reassign/anonymize `agentUserId` before delete, or (b) accept
   loss. Option (a) needs a migration to `ON DELETE SET NULL` + an
   `agentUserId` nullable column — **schema change, needs approval.**
4. **Deletion-event audit trail.** The pre-delete `audit()` row lands in
   `AuditLog`, which cascades away with the Space. If we need a durable record
   that "user X deleted their account on date Y," it must live in a table that
   is NOT space-scoped (e.g. a platform-level deletion log). **Possible schema
   addition, needs approval.**
5. **Soft-delete / 30-day grace (Privacy Policy §9.3).** The policy promises a
   30-day post-cancellation window before permanent deletion. To honor that
   precisely we'd add a `deletedAt`/`scheduledPurgeAt` column to `Space` (or a
   `PendingDeletion` table) and a cron purge. **Schema change, needs approval.**
   Until then the in-product delete is immediate-on-flag; the 30-day window is
   handled operationally via the gated/manual path.

None of these block the export (done) or the request+confirm+Clerk-delete flow
(done). They gate flipping the destructive sweep fully on.
