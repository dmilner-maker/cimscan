import { Router } from "express";
import { supabase } from "../lib/supabase.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  const timestamp = new Date().toISOString();

  let supabaseOk = false;
  try {
    const { error } = await supabase
      .from("firms")
      .select("*", { count: "exact", head: true });
    supabaseOk = !error;
  } catch {
    supabaseOk = false;
  }

  const anthropicOk = Boolean(
    process.env.ANTHROPIC_API_KEY &&
      process.env.ANTHROPIC_API_KEY.trim().length > 0
  );

  if (supabaseOk && anthropicOk) {
    res.json({
      status: "ok",
      supabase: true,
      anthropic: true,
      timestamp,
    });
    return;
  }

  const errors: string[] = [];
  if (!supabaseOk) errors.push("Supabase connection failed");
  if (!anthropicOk) errors.push("ANTHROPIC_API_KEY missing or empty");

  res.status(500).json({
    status: "error",
    supabase: supabaseOk,
    anthropic: anthropicOk,
    error: errors.join("; "),
  });
});
