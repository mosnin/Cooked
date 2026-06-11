# BACKUP & RESTORE — Supabase Point-in-Time Recovery

How to verify our database backups are real, and how to actually restore from
them. The database is the company's memory — if PITR isn't on, a bad migration
or an accidental `DELETE` is unrecoverable past the last daily snapshot.

> **This is a MANUAL action.** Enabling and verifying PITR is done in the
> Supabase dashboard, not in this repo. No code in this codebase can turn it on,
> and there is no env var for it. Someone with project-admin access has to do it
> and confirm it. Treat the steps below as a checklist a human runs.

> **Requires a paid Supabase plan.** PITR is a paid add-on (Pro plan and above,
> billed per backup-retention tier). On the free plan you get only periodic
> logical backups with a short retention and **no** point-in-time recovery. If
> we're on free, the answer to "can we restore to 10 minutes ago?" is **no** —
> escalate to get the plan upgraded before treating prod data as safe.

---

## 1. Verify PITR is enabled (do this now, then quarterly)

1. Supabase dashboard → the **production** project.
2. **Project Settings → Database → Backups** (also surfaced under
   **Database → Backups / Point-in-Time Recovery**).
3. Confirm:
   - The project is on a **paid plan** (Pro or higher). PITR controls are
     greyed out on free.
   - **Point-in-Time Recovery is toggled ON.**
   - A **retention window** is shown (e.g. 7 days). Write down what it is — that
     window is the maximum age we can restore to.
   - The **"Physical backups / WAL"** status shows recent, healthy activity
     (a recent restore-point timestamp, not a stale one).
4. If PITR is off or the project is on free: **stop and escalate.** Upgrade the
   plan and enable PITR before relying on the data. Note the date you verified.

There is no programmatic health check for this in the app. The only source of
truth is the dashboard. Put a recurring calendar reminder on it.

---

## 2. Know your two recovery primitives

- **Daily backups** — Supabase takes scheduled logical/physical backups. These
  let you restore to a *backup boundary* (e.g. "last night").
- **Point-in-Time Recovery (PITR)** — replays write-ahead log on top of a base
  backup so you can restore to *any second* inside the retention window (e.g.
  "2026-06-03 14:32:10 UTC, right before the bad migration"). This is the one
  that saves you from a mid-day mistake.

---

## 3. Restore procedure (the real thing)

> A restore is destructive to the project's current state. Supabase performs an
> **in-place** restore on the same project — the data is rewound, and writes
> after the chosen timestamp are gone. Do not run this casually.

1. **Declare the incident.** Stop the bleeding first: if a runaway process is
   still writing/deleting, pause it (e.g. disable the offending cron via its
   kill switch — see `docs/RUNBOOK.md` — or take the app into maintenance).
2. **Pin the target timestamp.** Identify the exact UTC time *just before* the
   data loss. PITR is only as good as the timestamp you give it. Confirm it's
   inside the retention window from §1.
3. Supabase dashboard → project → **Database → Backups → Point-in-Time
   Recovery**.
4. Choose **Restore** and enter the target timestamp (UTC). Read the warning:
   this rewinds the project.
5. Confirm and wait. The project goes unavailable during the restore; duration
   scales with database size.
6. **Re-verify the app:**
   - `/status` database row is operational.
   - Spot-check the rows that were lost are back and the bad rows are gone.
   - Confirm app connectivity (Vercel env still points at the same project, so
     no env change should be needed for an in-place restore).
7. **Resume** anything you paused in step 1. Re-enable disabled crons.
8. **Write it up:** what was lost, the restore timestamp, what we couldn't
   recover (writes after the timestamp), and the root cause.

---

## 4. Restore DRILL (practice before you need it)

You do not want the first time you run a restore to be during a real incident.
Run a drill at least once after enabling PITR, and after any major plan change.

1. **Don't drill on production in-place.** Use Supabase's **"Restore to a new
   project"** / **clone** option if available on the plan, or run the drill
   against a **staging** project that has PITR enabled.
2. Note the current time, then make a small, identifiable write to the drill
   database (e.g. insert a sentinel row you can recognize).
3. Wait a couple of minutes, then make a second, "bad" change (delete the
   sentinel, or drop a throwaway table).
4. Perform a PITR restore to a timestamp **between** step 2 and step 3.
5. Confirm the sentinel row is back and the "bad" change is undone.
6. Record: how long the restore took, the exact dashboard clicks, and any
   surprises. Fold corrections back into this doc.

A drill that you've actually run end-to-end turns a 2-hour panic into a 15-
minute procedure.
