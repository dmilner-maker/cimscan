/**
 * Output Purge Job — Delete Deliverables Older Than 90 Days
 *
 * Run via Railway cron or manually: npx ts-node src/jobs/purgeOutputs.ts
 *
 * Policy:
 *   - Outputs older than 90 days are deleted from the 'outputs' bucket
 *   - Output paths on the deal row are set to null
 *   - Deal status updated to 'outputs_purged'
 *   - Runs are idempotent — deals already purged are skipped
 *
 * Safety:
 *   - Only touches deals with status 'completed'
 *   - Logs every deletion for audit trail
 *   - Errors on individual deals don't stop the batch
 */

import { supabase } from "../lib/supabase.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RETENTION_DAYS = 90;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function purgeExpiredOutputs(): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
  const cutoffISO = cutoffDate.toISOString();

  console.log(`[purge] Starting output purge. Cutoff: ${cutoffISO} (${RETENTION_DAYS} days)`);

  // Find completed deals with outputs older than 90 days
  const { data: deals, error: queryError } = await supabase
    .from("deals")
    .select("id, deal_name, output_dataset_d_path, output_ic_insights_path, output_synopsis_path, created_at")
    .eq("status", "completed")
    .lt("created_at", cutoffISO)
    .not("output_dataset_d_path", "is", null);

  if (queryError) {
    console.error("[purge] Failed to query deals:", queryError);
    process.exit(1);
  }

  if (!deals || deals.length === 0) {
    console.log("[purge] No expired outputs found. Done.");
    return;
  }

  console.log(`[purge] Found ${deals.length} deal(s) with expired outputs.`);

  let purged = 0;
  let failed = 0;

  for (const deal of deals) {
    try {
      await purgeDealOutputs(deal);
      purged++;
    } catch (err) {
      console.error(`[purge] Failed to purge deal ${deal.id} (${deal.deal_name}):`, err);
      failed++;
    }
  }

  console.log(`[purge] Complete. Purged: ${purged}, Failed: ${failed}, Total: ${deals.length}`);
}

// ---------------------------------------------------------------------------
// Per-Deal Purge
// ---------------------------------------------------------------------------

interface DealRow {
  id: string;
  deal_name: string;
  output_dataset_d_path: string | null;
  output_ic_insights_path: string | null;
  output_synopsis_path: string | null;
  created_at: string;
}

async function purgeDealOutputs(deal: DealRow): Promise<void> {
  // Collect non-null paths to delete
  const paths: string[] = [
    deal.output_dataset_d_path,
    deal.output_ic_insights_path,
    deal.output_synopsis_path,
  ].filter((p): p is string => p !== null);

  if (paths.length === 0) {
    console.log(`[purge] Deal ${deal.id} — no output paths, skipping.`);
    return;
  }

  // Delete files from storage
  const { error: storageError } = await supabase.storage
    .from("outputs")
    .remove(paths);

  if (storageError) {
    throw new Error(`Storage deletion failed: ${storageError.message}`);
  }

  // Null out paths and update status
  const { error: updateError } = await supabase
    .from("deals")
    .update({
      output_dataset_d_path: null,
      output_ic_insights_path: null,
      output_synopsis_path: null,
      status: "outputs_purged",
    })
    .eq("id", deal.id);

  if (updateError) {
    throw new Error(`Deal update failed: ${updateError.message}`);
  }

  console.log(`[purge] Deal ${deal.id} (${deal.deal_name}) — ${paths.length} file(s) deleted.`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

purgeExpiredOutputs()
  .then(() => {
    console.log("[purge] Job finished.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[purge] Unhandled error:", err);
    process.exit(1);
  });
