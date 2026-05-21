-- ============================================================
-- snapshots_unarchived_dates: missing RPC consumed by the
-- archive-prices-to-r2 edge function.
--
-- The drain function asks for the set of snapshot_date values
-- that still have archived_to_r2_at IS NULL rows (oldest first),
-- then walks each date until drained. Without this RPC the
-- function throws on every invocation with "function
-- snapshots_unarchived_dates() does not exist", which is how
-- the post-fix archive cron would still appear "successful" to
-- net.http_post while doing nothing.
--
-- Uses the existing partial index:
--   price_daily_snapshots_archive_queue_idx
--     ON (snapshot_date, archived_to_r2_at)
--     WHERE archived_to_r2_at IS NULL
-- so the GROUP BY is cheap even on the full backlog.
-- ============================================================

CREATE OR REPLACE FUNCTION public.snapshots_unarchived_dates()
RETURNS TABLE (snapshot_date date, remaining bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT snapshot_date, count(*)::bigint AS remaining
  FROM price_daily_snapshots
  WHERE archived_to_r2_at IS NULL
  GROUP BY snapshot_date
  ORDER BY snapshot_date;
$$;

GRANT EXECUTE ON FUNCTION public.snapshots_unarchived_dates()
  TO service_role;
