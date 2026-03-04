/**
 * Anthropic API Client for EC-CIM Pipeline
 *
 * Uses the FULL REFERENCE system prompt (~13K tokens) for maximum output
 * quality. Each stage uses the specific run command defined in the prompt
 * spec, matching how manual chat runs operate.
 *
 * Token budget per stage is tuned to allow full output:
 *   Pass 1 (CIM + Quality Gate + Claims): 16K
 *   Stage 2 (Underwriting Gates): 16K
 *   Stage 3 (Workstream Execution): 16K
 *   Stage 4 (Interdependency Analysis — largest output): 24K
 *   Stage 5 + Insights (Thesis Pillars + IC Insights): 16K
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
var ANTHROPIC_API_VERSION = "2023-06-01";
var PIPELINE_MODEL = "claude-sonnet-4-20250514";

// Per-stage token budgets
var PASS_1_MAX_TOKENS = 24000;
var STAGE_2_MAX_TOKENS = 16000;
var STAGE_3_MAX_TOKENS = 16000;
var STAGE_4_MAX_TOKENS = 32000;  // Largest output: matrix + hubs + cascades + coupling + kill hubs
var STAGE_5_MAX_TOKENS = 16000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | null;
  usage: { input_tokens: number; output_tokens: number };
}

interface ContentBlock {
  type: "text" | "tool_use";
  text?: string;
}

export interface PipelinePassResult {
  rawText: string;
  json: Record<string, unknown> | null;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// System prompt loader — uses FULL REFERENCE for maximum output quality
// ---------------------------------------------------------------------------

var cachedSystemPrompt: string | null = null;

var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = path.dirname(__filename2);

export function loadSystemPrompt(): string {
  if (cachedSystemPrompt) return cachedSystemPrompt;

  var promptPath =
    process.env.EC_CIM_SYSTEM_PROMPT_PATH ||
    path.resolve(__dirname2, "../../assets/ec-cim-system-prompt-v1.7.0.md");

  if (!fs.existsSync(promptPath)) {
    throw new Error(
      "EC-CIM system prompt not found at " + promptPath + ". " +
      "Set EC_CIM_SYSTEM_PROMPT_PATH or place the file in api/assets/."
    );
  }

  cachedSystemPrompt = fs.readFileSync(promptPath, "utf-8");
  return cachedSystemPrompt;
}

// ---------------------------------------------------------------------------
// API caller
// ---------------------------------------------------------------------------

async function callAnthropic(
  systemPrompt: string,
  userContent: unknown[],
  maxTokens: number
): Promise<AnthropicResponse> {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  var body = {
    model: PIPELINE_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  };

  var response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    var errorText = await response.text();
    throw new Error(
      "Anthropic API error " + response.status + ": " + errorText
    );
  }

  return (await response.json()) as AnthropicResponse;
}

// ---------------------------------------------------------------------------
// Pass 1: CIM PDF -> Quality Gate + Stage 1 (Claim Register)
// ---------------------------------------------------------------------------

export async function executePass1(
  pdfBuffer: Buffer,
  claimDepth: "CORE" | "FULL",
  sourceFilename: string
): Promise<PipelinePassResult> {
  var systemPrompt = loadSystemPrompt();
  var pdfBase64 = pdfBuffer.toString("base64");

  // Use the exact run command from the prompt spec
  var runCommand = "RUN: CIMScan — CLAIM_DEPTH: " + claimDepth + " — PACKAGING: JSON";

  var userContent = [
    {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdfBase64,
      },
    },
    {
      type: "text",
      text: "Source CIM: " + sourceFilename + "\n\n" +
        "IMPORTANT: Target the upper end of the CORE band (25-30 claims). " +
        "Extract every IC-material claim the CIM supports. Do not stop at the 20-claim floor — " +
        "push to 25+ claims by mining all underwriting surfaces thoroughly. " +
        "Ensure each surface has multiple claims covering different angles. " +
        "Include claim_text, source_excerpt, and all schema fields for every claim.\n\n" +
        runCommand,
    },
  ];

  var response = await callAnthropic(
    systemPrompt,
    userContent,
    PASS_1_MAX_TOKENS
  );

  return parseResponse(response);
}

// ---------------------------------------------------------------------------
// Stage 2: Underwriting Gates
// ---------------------------------------------------------------------------

export async function executeStage2(
  stage1Json: Record<string, unknown>,
  claimDepth: "CORE" | "FULL"
): Promise<PipelinePassResult> {
  var systemPrompt = loadSystemPrompt();

  // Use the exact Stage 2 run command from the prompt spec
  var runCommand = "RUN: Populate Underwriting Gates — CLAIM_SET: " + claimDepth + " — PACKAGING: JSON";

  var userContent = [
    {
      type: "text",
      text:
        "Stage 1 Output (Claim Register):\n\n" +
        "```json\n" + JSON.stringify(stage1Json, null, 2) + "\n```\n\n" +
        "Produce one underwriting gate per claim. Every claim in the register above must have a corresponding gate row. " +
        "Include claim_text and economic_driver in each gate row for traceability.\n\n" +
        runCommand,
    },
  ];

  var response = await callAnthropic(systemPrompt, userContent, STAGE_2_MAX_TOKENS);
  return parseResponse(response);
}

// ---------------------------------------------------------------------------
// Stage 3: Workstream Execution
// ---------------------------------------------------------------------------

export async function executeStage3(
  contextJson: Record<string, unknown>,
  claimDepth: "CORE" | "FULL"
): Promise<PipelinePassResult> {
  var systemPrompt = loadSystemPrompt();

  // Use the exact Stage 3 run command from the prompt spec
  var runCommand = "RUN: Expand Workstream Execution — CLAIM_SET: " + claimDepth + " — ARTIFACT_ROWS: ON — PACKAGING: JSON";

  var userContent = [
    {
      type: "text",
      text:
        "Previous Pipeline Output (Stages 1-2):\n\n" +
        "```json\n" + JSON.stringify(contextJson, null, 2) + "\n```\n\n" +
        "Produce comprehensive diligence tasks for ALL claims. Tier-1 claims (top 15 by priority score) " +
        "must have multiple task types with named interview targets and specific artifact names. " +
        "Every claim must have at least one task.\n\n" +
        runCommand,
    },
  ];

  var response = await callAnthropic(systemPrompt, userContent, STAGE_3_MAX_TOKENS);
  return parseResponse(response);
}

// ---------------------------------------------------------------------------
// Stage 4: Interdependency Analysis
// ---------------------------------------------------------------------------

export async function executeStage4(
  contextJson: Record<string, unknown>,
  claimDepth: "CORE" | "FULL"
): Promise<PipelinePassResult> {
  var systemPrompt = loadSystemPrompt();

  // Use the exact Stage 4 run command from the prompt spec
  var runCommand = "RUN: Interdependency Analysis — CLAIM_SET: " + claimDepth + " — MODE: IC GRADE — PACKAGING: JSON";

  var userContent = [
    {
      type: "text",
      text:
        "Previous Pipeline Output (Stages 1-3):\n\n" +
        "```json\n" + JSON.stringify(contextJson, null, 2) + "\n```\n\n" +
        "IMPORTANT — Produce comprehensive interdependency analysis:\n" +
        "- Evaluate ALL meaningful pairwise claim relationships. For CORE, produce minimum 40 pairs. For FULL, minimum 80 pairs. Include every pair with relationship_strength >= 0.40. Score each dimension (kpi_shared, driver_shared, semantic, evidence_chain) to 2 decimal places.\n" +
        "- Hub Risk Summary: include EVERY claim that has blast_radius >= 1 (not just >= 3). For each hub row include claim_id, claim_text, economic_driver, blast_radius, linked_claims, and hub_classification_tag. This should produce 15-25 rows for CORE.\n" +
        "- Cascade Scenarios: model propagation chains for EVERY hub with blast_radius >= 3. Include hub_claim_text.\n" +
        "- Negative Coupling Detection (STRICT mode): emit only confirmed contradictions.\n" +
        "- Top 5 IC Kill Hubs: rank by blast_radius + claim_priority_score. Include claim_text, linked_claims, economic_driver, and ic_gating_rationale.\n\n" +
        runCommand,
    },
  ];

  var response = await callAnthropic(systemPrompt, userContent, STAGE_4_MAX_TOKENS);
  return parseResponse(response);
}

// ---------------------------------------------------------------------------
// Stage 5 + IC Insights: Thesis Pillars + IC Insights
// ---------------------------------------------------------------------------

export async function executeStage5(
  contextJson: Record<string, unknown>,
  claimDepth: "CORE" | "FULL"
): Promise<PipelinePassResult> {
  var systemPrompt = loadSystemPrompt();

  // Use the exact Stage 5 run command from the prompt spec
  var runCommand = "RUN: Thesis Bundles — CLAIM_SET: " + claimDepth + " — PACKAGING: JSON";

  var userContent = [
    {
      type: "text",
      text:
        "Previous Pipeline Output (Stages 1-4):\n\n" +
        "```json\n" + JSON.stringify(contextJson, null, 2) + "\n```\n\n" +
        "Produce exactly 5 thesis pillars with complete STRICT coupling surface. " +
        "Include export_validation_gate with detailed check results.\n\n" +
        runCommand,
    },
  ];

  var response = await callAnthropic(systemPrompt, userContent, STAGE_5_MAX_TOKENS);
  return parseResponse(response);
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

function parseResponse(response: AnthropicResponse): PipelinePassResult {
  var rawText = response.content
    .filter(function(block) { return block.type === "text"; })
    .map(function(block) { return block.text || ""; })
    .join("\n");

  var truncated = response.stop_reason === "max_tokens";

  var json: Record<string, unknown> | null = null;
  try {
    json = extractJson(rawText);
  } catch (e) {
    // JSON extraction failed — caller will handle
  }

  return {
    rawText: rawText,
    json: json,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason,
    truncated: truncated,
  };
}

function extractJson(text: string): Record<string, unknown> {
  // Strategy 1: direct parse
  try {
    return JSON.parse(text.trim());
  } catch (e) {
    // continue
  }

  // Strategy 2: markdown JSON fence
  var fenceMatch = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (e) {
      // continue
    }
  }

  // Strategy 3: find outermost { } block
  var firstBrace = text.indexOf("{");
  var lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.substring(firstBrace, lastBrace + 1));
    } catch (e) {
      // continue
    }
  }

  throw new Error("No valid JSON found in response");
}
