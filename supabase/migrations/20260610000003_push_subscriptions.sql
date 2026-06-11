-- Web push (VAPID) subscriptions — one row per browser/device a realtor has
-- granted notification permission on. The browser hands us an endpoint URL plus
-- the p256dh/auth keys needed to encrypt a payload for that subscriber; we store
-- them verbatim and replay them server-side via the `web-push` library when a
-- new lead / tour / deal / follow-up fires.
--
-- endpoint is unique: re-subscribing the same browser upserts rather than
-- duplicating. Dead subscriptions (404/410 from the push service) are pruned by
-- lib/push.ts at send time. RLS is enabled with no policies — every read/write
-- goes through the server with the service-role key, same posture as the other
-- realtor-owned tables.

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "spaceId"    TEXT        NOT NULL,
  "userId"     TEXT,
  "endpoint"   TEXT        NOT NULL,
  "p256dh"     TEXT        NOT NULL,
  "auth"       TEXT        NOT NULL,
  "userAgent"  TEXT,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushSubscription_endpoint_key" UNIQUE ("endpoint"),
  CONSTRAINT "PushSubscription_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE
);

-- Dispatch loads every subscription for a space, so index on spaceId.
CREATE INDEX IF NOT EXISTS "PushSubscription_spaceId_idx"
  ON "PushSubscription" ("spaceId");

ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;

-- Master gate for push, alongside the existing per-event toggles on SpaceSetting.
-- Defaults true so a realtor who subscribes a device starts receiving push
-- immediately; flipping this off mutes push across all their devices without
-- having to unsubscribe each one.
ALTER TABLE "SpaceSetting" ADD COLUMN IF NOT EXISTS "notifyPush" BOOLEAN NOT NULL DEFAULT true;
