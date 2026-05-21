-- ============================================================
-- Support tables + RPCs for the archive-prices-to-r2 edge fn.
--
-- Why this exists: the previous function processed one ~50K shard
-- per invocation and stopped, and the calling cron used
-- net.http_post which reports "success" the instant the request is
-- queued. Net result: silent partial archiving, prune_old_snapshots
-- correctly refused to delete, and the table grew unbounded.
--
-- This migration backs the rewrite that drains all unarchived
-- shards per run, marks rows archived only after a confirmed R2
-- PutObject, and logs every invocation so failures stop being
-- silent.
--
--   archive_runs                      per-invocation log
--   snapshots_archive_fetch_page      paginated reader (bypasses
--                                     PostgREST 1000-row max-rows)
--   snapshots_archive_mark_ids        post-write archive stamp
--   snapshots_count_archived_for_date stable shard numbering
-- ============================================================

CREATE TABLE IF NOT EXISTS public.archive_runs (
  id              bigserial PRIMARY KEY,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  ok              boolean,
  partial         boolean NOT NULL DEFAULT false,
  shards_written  int NOT NULL DEFAULT 0,
  rows_archived   int NOT NULL DEFAULT 0,
  dates_processed text[],
  error           text,
  detail          jsonb
);

CREATE INDEX IF NOT EXISTS archive_runs_started_at_idx
  ON public.archive_runs (started_at DESC);

ALTER TABLE public.archive_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "archive_runs_admin_read" ON public.archive_runs;
CREATE POLICY "archive_runs_admin_read"
  ON public.archive_runs
  FOR SELECT
  USING (public.is_admin());

-- snapshots_archive_fetch_page: id-cursored page of unarchived rows
-- for a date. PostgREST max-rows still applies to the result, so
-- the caller pages with a small p_limit (≤ 1000) and accumulates.
CREATE OR REPLACE FUNCTION public.snapshots_archive_fetch_page(
  p_date     date,
  p_after_id bigint,
  p_limit    int
)
RETURNS SETOF public.price_daily_snapshots
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM price_daily_snapshots
  WHERE snapshot_date = p_date
    AND archived_to_r2_at IS NULL
    AND id > p_after_id
  ORDER BY id
  LIMIT GREATEST(p_limit, 0);
$$;

GRANT EXECUTE ON FUNCTION public.snapshots_archive_fetch_page(date, bigint, int)
  TO service_role;

-- snapshots_archive_mark_ids: stamp archived_to_r2_at on a batch
-- of ids. Caller invokes this only AFTER a confirmed R2 write.
-- Idempotent: rows already stamped are skipped, count reflects
-- only rows newly transitioned.
CREATE OR REPLACE FUNCTION public.snapshots_archive_mark_ids(p_ids bigint[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE price_daily_snapshots
  SET archived_to_r2_at = now()
  WHERE id = ANY(p_ids)
    AND archived_to_r2_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.snapshots_archive_mark_ids(bigint[])
  TO service_role;

-- snapshots_count_archived_for_date: drives stable partNN numbering
-- across re-runs. partIndex = floor(this / SHARD).
CREATE OR REPLACE FUNCTION public.snapshots_count_archived_for_date(p_date date)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::bigint
  FROM price_daily_snapshots
  WHERE snapshot_date = p_date
    AND archived_to_r2_at IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.snapshots_count_archived_for_date(date)
  TO service_role;
