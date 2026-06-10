-- ─────────────────────────────────────────────────────────────
--  Migration: 038 — Chatter-style internal feed + @mentions (Wave G3)
--
--  Adds two tables:
--
--    * `feed_posts` — one row per post on any entity's feed
--      (Client / Lead / Opportunity / Ticket). `entityType` +
--      `entityId` polymorphically pin the post to the record.
--      Threading is via a self-FK (`parentPostId`), so a reply to
--      a reply is just another row with the parent's id. We do NOT
--      enforce single-level threading at the DB layer — the API
--      can; preserving deeper trees costs us nothing and unlocks
--      future "quote-reply" UX without another migration.
--
--    * `feed_mentions` — junction row per (post, mentioned user).
--      Unique on `(post_id, mentioned_user_id)` so the same user
--      can't get duplicate notifications from one post even if
--      the API is buggy and submits the id twice.
--
--  Soft-delete: posts have `deletedAt TIMESTAMPTZ` rather than
--  being hard-deleted, so a deleted parent leaves its replies'
--  thread context intact. (The web layer renders deleted posts
--  as "[deleted]" placeholders to keep the thread reading
--  coherent.) Mentions cascade-delete with the post since their
--  only purpose is to notify; orphaned mention rows would just be
--  ghosts in the inbox.
--
--  Indexes:
--    * (org, entity, created_at desc) on `feed_posts` — the hot
--      query: "show me the feed for THIS record, newest first".
--    * (org, parent_post_id) on `feed_posts` — thread fan-out
--      when the API hydrates replies for a list of top-level posts.
--    * (org, mentioned_user_id, created_at desc) on
--      `feed_mentions` — "my recent mentions" inbox.
--
--  Tenancy:
--    * `organization_id` is denormalised onto BOTH tables (rather
--      than only on `feed_posts`) so the mention-inbox query can
--      filter on it directly without joining back to `feed_posts`.
--      The application layer is responsible for keeping the two
--      org_ids in sync — same pattern as existing audit + activity
--      tables.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. feed_posts ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "feed_posts" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  -- Polymorphic attach point. CHECK keeps tenants from
  -- inventing entity types that the API doesn't know how to
  -- guard cross-tenant access for. Extending this list requires
  -- a new migration AND a matching switch in FeedService.create().
  "entityType"     TEXT NOT NULL
    CHECK ("entityType" IN ('client', 'lead', 'opportunity', 'ticket')),
  "entityId"       TEXT NOT NULL,
  -- Author is nullable so a removed user doesn't blow away
  -- the thread; the UI shows "[former member]" instead.
  "authorId"       TEXT,
  "body"           TEXT NOT NULL,
  -- Self-FK for threaded replies. CASCADE so removing a parent
  -- post via hard-delete (admin tool only — soft-delete keeps
  -- the row) also cleans up its replies.
  "parentPostId"   TEXT,
  "deletedAt"      TIMESTAMPTZ,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "feed_posts_org_fk"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE,
  CONSTRAINT "feed_posts_author_fk"
    FOREIGN KEY ("authorId") REFERENCES "users"("id")
    ON DELETE SET NULL,
  CONSTRAINT "feed_posts_parent_fk"
    FOREIGN KEY ("parentPostId") REFERENCES "feed_posts"("id")
    ON DELETE CASCADE
);

-- Hot path: render an entity's feed (newest top-level posts first).
-- `parentPostId IS NULL` filter is applied in the query layer.
CREATE INDEX IF NOT EXISTS "feed_posts_org_entity_created_idx"
  ON "feed_posts" ("organizationId", "entityType", "entityId", "createdAt" DESC);

-- Thread fan-out: load replies for a list of top-level post ids.
CREATE INDEX IF NOT EXISTS "feed_posts_org_parent_idx"
  ON "feed_posts" ("organizationId", "parentPostId");

-- ─── 2. feed_mentions ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "feed_mentions" (
  "id"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId"   TEXT NOT NULL,
  "postId"           TEXT NOT NULL,
  "mentionedUserId"  TEXT NOT NULL,
  -- Stamped by the notification listener once the in-app
  -- notification (and best-effort web push) has been fired.
  -- Lets ops re-fire missed notifications by scanning rows
  -- where this is still NULL.
  "notifiedAt"       TIMESTAMPTZ,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "feed_mentions_org_fk"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE,
  CONSTRAINT "feed_mentions_post_fk"
    FOREIGN KEY ("postId") REFERENCES "feed_posts"("id")
    ON DELETE CASCADE,
  CONSTRAINT "feed_mentions_user_fk"
    FOREIGN KEY ("mentionedUserId") REFERENCES "users"("id")
    ON DELETE CASCADE,

  -- Belt-and-braces: even if the service double-submits, the DB
  -- guarantees one mention row per (post, user). The listener
  -- treats a UNIQUE-violation as "already notified, skip".
  CONSTRAINT "feed_mentions_post_user_uniq"
    UNIQUE ("postId", "mentionedUserId")
);

-- Hot path: "my recent mentions" inbox (newest first).
CREATE INDEX IF NOT EXISTS "feed_mentions_org_user_created_idx"
  ON "feed_mentions" ("organizationId", "mentionedUserId", "createdAt" DESC);

COMMIT;
