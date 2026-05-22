// archive-prices-to-r2: drains unarchived price_daily_snapshots
// rows to Cloudflare R2 as gzipped JSONL shards (≤ 50K rows each),
// then stamps archived_to_r2_at AFTER each shard's PutObject
// returns success.
//
// Per-invocation contract:
//   - Iterate every snapshot_date with unarchived rows, oldest first.
//   - For each date, continue numbering shards from where prior
//     runs left off (partIndex = floor(already_archived / 50000)).
//   - Loop until no unarchived rows remain, OR until the time
//     budget is hit (then return { partial: true } and let the
//     next invocation resume — the filter `archived_to_r2_at
//     IS NULL` makes the function safely re-runnable).
//   - Log every run to archive_runs so cron failures stop being
//     silent.
//
// Path convention: vault/prices/YYYY/MM/DD.partNN.jsonl.gz
//
// Auth: x-cron-secret (matches Vault cron_secret) OR
//       Authorization: Bearer <SERVICE_ROLE_KEY>.
//
// R2 credentials are read from Supabase Vault:
//   r2_account_id, r2_access_key_id, r2_secret_access_key, r2_bucket_name
//
// Output rows are projected to canonical "Schema B" JSONL — the
// same on-disk shape the prior implementation wrote — so DuckDB
// queries over vault/prices/**/*.jsonl.gz keep working and the
// May 19 part00 already on R2 stays consistent with new shards.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const SHARD = 50_000;
const PAGE = 1_000;
const TIME_BUDGET_MS = 5 * 60_000;
const MARK_CHUNK = 5_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-cron-secret, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

type SnapshotRow = {
  id: number;
  card_listing_id: string;
  card_canonical_key: string;
  source: string;
  currency: string;
  variant_label: string | null;
  condition: string | null;
  is_foil: boolean;
  price_low: number | null;
  price_market: number | null;
  price_high: number | null;
  cm_avg30: number | null;
  snapshot_date: string;
  captured_at: string;
  archive_version: number;
  archived_to_r2_at: string | null;
  source_payload: unknown;
  created_at: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Auth: cron secret OR service-role bearer
  const cronHeader = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerMatches = authHeader.toLowerCase().startsWith("bearer ")
    && authHeader.slice(7).trim() === SERVICE_KEY;

  let authorized = bearerMatches;
  if (!authorized && cronHeader) {
    const { data: vaultSecret } = await admin.rpc("get_vault_secret", {
      p_name: "cron_secret",
    });
    if (typeof vaultSecret === "string" && vaultSecret === cronHeader) {
      authorized = true;
    }
  }
  if (!authorized) return json({ ok: false, error: "unauthorized" }, 401);

  const [accountId, accessKeyId, secretAccessKey, bucket] = await Promise.all([
    getSecret(admin, "r2_account_id"),
    getSecret(admin, "r2_access_key_id"),
    getSecret(admin, "r2_secret_access_key"),
    getSecret(admin, "r2_bucket_name"),
  ]);
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return json({ ok: false, error: "missing_r2_credentials" }, 500);
  }

  const r2 = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const r2Endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;

  // Open the run log row up front so a hard crash still leaves a
  // breadcrumb (finished_at NULL = died mid-run).
  const { data: runRow, error: runErr } = await admin
    .from("archive_runs")
    .insert({})
    .select("id")
    .single();
  if (runErr) {
    return json({ ok: false, error: `run_log_insert: ${runErr.message}` }, 500);
  }
  const runId = (runRow as { id: number }).id;

  const startedAt = Date.now();
  const deadline = startedAt + TIME_BUDGET_MS;
  const datesProcessed: string[] = [];
  let totalRows = 0;
  let totalShards = 0;
  let partial = false;
  let runError: string | null = null;

  try {
    const { data: dates, error: dErr } = await admin.rpc("snapshots_unarchived_dates");
    if (dErr) throw new Error(`unarchived_dates: ${dErr.message}`);

    const sorted = ((dates ?? []) as { snapshot_date: string }[])
      .map((r) => r.snapshot_date)
      .sort();

    for (const snapshotDate of sorted) {
      if (Date.now() >= deadline) { partial = true; break; }

      const { rows, shards } = await drainDate({
        admin, r2, r2Endpoint, snapshotDate, deadline,
      });

      totalRows += rows;
      totalShards += shards;
      datesProcessed.push(snapshotDate);

      if (Date.now() >= deadline) {
        partial = await dateStillHasUnarchived(admin, snapshotDate);
        break;
      }
    }
  } catch (e) {
    runError = (e as Error)?.message ?? String(e);
  }

  await admin
    .from("archive_runs")
    .update({
      finished_at: new Date().toISOString(),
      ok: !runError,
      partial,
      shards_written: totalShards,
      rows_archived: totalRows,
      dates_processed: datesProcessed,
      error: runError,
      detail: { duration_ms: Date.now() - startedAt },
    })
    .eq("id", runId);

  if (runError) {
    return json({
      ok: false,
      error: runError,
      partial,
      rows_archived: totalRows,
      shards_written: totalShards,
      dates_processed: datesProcessed,
    }, 500);
  }

  return json({
    ok: true,
    partial,
    rows_archived: totalRows,
    shards_written: totalShards,
    dates_processed: datesProcessed,
  });
});

async function drainDate(args: {
  admin: SupabaseClient;
  r2: AwsClient;
  r2Endpoint: string;
  snapshotDate: string;
  deadline: number;
}): Promise<{ rows: number; shards: number }> {
  const { admin, r2, r2Endpoint, snapshotDate, deadline } = args;

  const { data: alreadyData, error: cErr } = await admin.rpc(
    "snapshots_count_archived_for_date",
    { p_date: snapshotDate },
  );
  if (cErr) throw new Error(`count_archived(${snapshotDate}): ${cErr.message}`);
  const already = Number(alreadyData ?? 0);
  let partIndex = Math.floor(already / SHARD);

  let rows = 0;
  let shards = 0;

  while (Date.now() < deadline) {
    const shardRows = await fetchShard(admin, snapshotDate);
    if (shardRows.length === 0) break;

    const key = r2KeyFor(snapshotDate, partIndex);
    const body = await gzipJsonl(shardRows);

    const put = await r2.fetch(`${r2Endpoint}/${key}`, {
      method: "PUT",
      body,
      headers: { "Content-Type": "application/gzip" },
    });
    if (!put.ok) {
      const text = await put.text().catch(() => "");
      throw new Error(`r2_put ${put.status} ${key}: ${text.slice(0, 300)}`);
    }

    const ids = shardRows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += MARK_CHUNK) {
      const chunk = ids.slice(i, i + MARK_CHUNK);
      const { error: mErr } = await admin.rpc("snapshots_archive_mark_ids", {
        p_ids: chunk,
      });
      if (mErr) throw new Error(`mark_ids: ${mErr.message}`);
    }

    rows += shardRows.length;
    shards++;
    partIndex++;
  }

  return { rows, shards };
}

async function fetchShard(
  admin: SupabaseClient,
  snapshotDate: string,
): Promise<SnapshotRow[]> {
  const out: SnapshotRow[] = [];
  let afterId = 0;
  while (out.length < SHARD) {
    const limit = Math.min(PAGE, SHARD - out.length);
    const { data, error } = await admin.rpc("snapshots_archive_fetch_page", {
      p_date: snapshotDate,
      p_after_id: afterId,
      p_limit: limit,
    });
    if (error) throw new Error(`fetch_page: ${error.message}`);
    const page = (data ?? []) as SnapshotRow[];
    if (page.length === 0) break;
    out.push(...page);
    afterId = page[page.length - 1].id;
    if (page.length < limit) break;
  }
  return out;
}

async function gzipJsonl(rows: SnapshotRow[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  const readable = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= rows.length) { controller.close(); return; }
      const end = Math.min(i + 500, rows.length);
      let chunk = "";
      for (; i < end; i++) chunk += projectToCanonical(rows[i]) + "\n";
      controller.enqueue(encoder.encode(chunk));
    },
  });
  const compressed = readable.pipeThrough(new CompressionStream("gzip"));
  const ab = await new Response(compressed).arrayBuffer();
  return new Uint8Array(ab);
}

// Canonical "Schema B" projection — kept byte-compatible with the
// prior archive function so DuckDB queries over the existing R2
// prefix don't see a schema seam at the cutover. snapshot_date is
// taken from the row itself since every shard contains rows from
// exactly one date.
function projectToCanonical(s: SnapshotRow): string {
  let canonicalSource: string;
  if (s.source === "tcgplayer_market" || s.source === "tcgplayer_low") {
    canonicalSource = "tcgplayer";
  } else if (s.source === "cardmarket_csv") {
    canonicalSource = "cardmarket";
  } else {
    canonicalSource = s.source;
  }

  const payload: Record<string, unknown> = { original_source: s.source };
  if (s.cm_avg30 != null) payload.cm_avg30 = s.cm_avg30;

  return JSON.stringify({
    archive_version: s.archive_version ?? 1,
    snapshot_date: s.snapshot_date,
    card_canonical_key: s.card_canonical_key,
    source: canonicalSource,
    source_table: "thevault.price_daily_snapshots",
    currency: s.currency,
    variant_label: s.variant_label,
    condition: s.condition,
    is_foil: s.is_foil,
    price_low: s.price_low,
    price_market: s.price_market,
    price_high: s.price_high,
    captured_at: s.captured_at,
    source_payload: payload,
  });
}

function r2KeyFor(snapshotDate: string, partIndex: number): string {
  const [yyyy, mm, dd] = snapshotDate.split("-");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `vault/prices/${yyyy}/${mm}/${dd}.part${pad(partIndex)}.jsonl.gz`;
}

async function dateStillHasUnarchived(
  admin: SupabaseClient,
  snapshotDate: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("snapshots_archive_fetch_page", {
    p_date: snapshotDate,
    p_after_id: 0,
    p_limit: 1,
  });
  if (error) return true;
  return Array.isArray(data) && data.length > 0;
}

async function getSecret(
  admin: SupabaseClient,
  name: string,
): Promise<string | null> {
  const { data } = await admin.rpc("get_vault_secret", { p_name: name });
  return typeof data === "string" && data.length > 0 ? data : null;
}
