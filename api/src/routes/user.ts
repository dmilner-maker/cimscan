/**
 * User Account Routes — Data Deletion & Account Deletion
 *
 * Endpoints:
 *   DELETE /api/user/data    — Delete all deals, outputs, and CIMs for the authenticated user
 *   DELETE /api/user/account — Delete all user data + the user account itself
 *
 * Auth: Requires valid Supabase Auth JWT in Authorization header.
 *
 * Policy:
 *   - /data keeps the account alive but removes all deal artifacts
 *   - /account is permanent — removes everything including Auth user
 *   - Both are idempotent — safe to call multiple times
 *   - Storage deletions are best-effort (logged, not thrown)
 */

import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase.js";
import { createClient } from "@supabase/supabase-js";

const router = Router();

// ---------------------------------------------------------------------------
// Middleware — extract user from JWT
// ---------------------------------------------------------------------------

async function requireAuth(req: Request, res: Response, next: Function): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  (req as any).userId = data.user.id;
  (req as any).userEmail = data.user.email;
  next();
}

// ---------------------------------------------------------------------------
// DELETE /api/user/data — Delete all deals and artifacts, keep account
// ---------------------------------------------------------------------------

router.delete("/data", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId;
  const userEmail = (req as any).userEmail;

  try {
    console.log(`[user] Data deletion requested by ${userEmail} (${userId})`);

    const stats = await deleteUserDeals(userId);

    console.log(`[user] Data deletion complete for ${userEmail}: ${stats.dealsProcessed} deals, ${stats.filesDeleted} files deleted`);

    res.json({
      success: true,
      message: "All deal data has been deleted.",
      details: stats,
    });
  } catch (err: any) {
    console.error(`[user] Data deletion failed for ${userId}:`, err);
    res.status(500).json({ error: "Data deletion failed. Please try again or contact support." });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/user/account — Delete all data + the account itself
// ---------------------------------------------------------------------------

router.delete("/account", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId;
  const userEmail = (req as any).userEmail;

  try {
    console.log(`[user] Account deletion requested by ${userEmail} (${userId})`);

    // 1. Delete all deal data
    const stats = await deleteUserDeals(userId);

    // 2. Delete inbound_emails records
    const { error: emailsError } = await supabase
      .from("inbound_emails")
      .delete()
      .eq("user_id", userId);

    if (emailsError) {
      console.error(`[user] Failed to delete inbound_emails for ${userId}:`, emailsError);
    }

    // 3. Delete the users table row
    const { error: userRowError } = await supabase
      .from("users")
      .delete()
      .eq("id", userId);

    if (userRowError) {
      console.error(`[user] Failed to delete users row for ${userId}:`, userRowError);
      throw new Error("Failed to delete user record");
    }

    // 4. Delete the Supabase Auth user
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);

    if (authError) {
      console.error(`[user] Failed to delete Auth user for ${userId}:`, authError);
      throw new Error("Failed to delete auth account");
    }

    console.log(`[user] Account deletion complete for ${userEmail}: ${stats.dealsProcessed} deals, ${stats.filesDeleted} files, account removed`);

    res.json({
      success: true,
      message: "Your account and all associated data have been permanently deleted.",
      details: stats,
    });
  } catch (err: any) {
    console.error(`[user] Account deletion failed for ${userId}:`, err);
    res.status(500).json({ error: "Account deletion failed. Please try again or contact support." });
  }
});

// ---------------------------------------------------------------------------
// Shared — Delete All Deals & Artifacts for a User
// ---------------------------------------------------------------------------

interface DeletionStats {
  dealsProcessed: number;
  filesDeleted: number;
  errors: number;
}

async function deleteUserDeals(userId: string): Promise<DeletionStats> {
  const stats: DeletionStats = { dealsProcessed: 0, filesDeleted: 0, errors: 0 };

  // Fetch all deals for this user
  const { data: deals, error: queryError } = await supabase
    .from("deals")
    .select("id, cim_storage_path, output_dataset_d_path, output_ic_insights_path, output_synopsis_path")
    .eq("user_id", userId);

  if (queryError) {
    throw new Error(`Failed to query deals: ${queryError.message}`);
  }

  if (!deals || deals.length === 0) {
    console.log(`[user] No deals found for user ${userId}`);
    return stats;
  }

  for (const deal of deals) {
    try {
      // Delete CIM from storage
      if (deal.cim_storage_path) {
        const { error } = await supabase.storage.from("cims").remove([deal.cim_storage_path]);
        if (error) {
          console.error(`[user] Failed to delete CIM for deal ${deal.id}:`, error);
          stats.errors++;
        } else {
          stats.filesDeleted++;
        }
      }

      // Delete outputs from storage
      const outputPaths = [
        deal.output_dataset_d_path,
        deal.output_ic_insights_path,
        deal.output_synopsis_path,
      ].filter((p): p is string => p !== null);

      if (outputPaths.length > 0) {
        const { error } = await supabase.storage.from("outputs").remove(outputPaths);
        if (error) {
          console.error(`[user] Failed to delete outputs for deal ${deal.id}:`, error);
          stats.errors++;
        } else {
          stats.filesDeleted += outputPaths.length;
        }
      }

      // Delete the deal row
      const { error: dealDeleteError } = await supabase
        .from("deals")
        .delete()
        .eq("id", deal.id);

      if (dealDeleteError) {
        console.error(`[user] Failed to delete deal row ${deal.id}:`, dealDeleteError);
        stats.errors++;
      }

      stats.dealsProcessed++;
    } catch (err) {
      console.error(`[user] Error processing deal ${deal.id}:`, err);
      stats.errors++;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export default router;
