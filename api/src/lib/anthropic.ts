/**
 * Anthropic API Client for EC-CIM Pipeline
 *
 * Handles multi-pass architecture:
 *   Pass 1: CIM PDF + system prompt -> Quality Gate + Stage 1 (claim register)
 *   Stage 2: Claim register -> Underwriting Gates
 *   Stage 3: Claim register + Gates -> Workstream Execution
 *   Stage 4: All previous -> Interdependency Analysis
 *   Stage 5 + Insights: All previous -> Thesis Pillars + IC Insights
 *
 * Uses the Messages API with document (PDF) support.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

var ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
var ANTHROPIC_API_VERSION = "2023-06-01";

// Model for pipeline execution
var PIPELINE_MODEL = "claude-sonnet-4-20250514";

// Max tokens per call
var PASS_1_MAX_TOKENS = 16000;
var STAGE_MAX_TOKENS = 16000;

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
// System prompt loader
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
// Pass 1: CIM PDF -> Quality Gate + Stage 1
// ---------------------------------------------------------------------------

export async function executePass1(
  pdfBuffer: Buffer,
  claimDepth: "CORE" | "FULL",
  sourceFilename: string
): Promise<PipelinePassResult> {
  var systemPrompt = loadSystemPrompt();
  var pdfBase64 = pdfBuffer.toString("base64");

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
      text: "Source CIM: " + sourceFilename + "\n\n" + runCommand,
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
// Sequential stage execution: one stage per API call
// ---------------------------------------------------------------------------

/**
 * Execute a single stage (or group of stages) of the EC-CIM pipeline.
 *
 * Sends accumulated context from previous stages plus a run command
 * for the specific stage(s) requested.
 *
 * @param contextJson - All previous pipeline output (Pass 1 + any completed stages)
 * @param stages - Stage string, e.g. "2" or "3" or "4" or "5,INSIGHTS"
 * @param claimDepth - "CORE" or "FULL"
 */
export async function executeStage(
  contextJson: Record<string, unknown>,
  stages: string,
  claimDepth: "CORE" | "FULL"
): Promise<PipelinePassResult> {
  var systemPrompt = loadSystemPrompt();

  var runCommand =
    "RUN: EC-CIM Pipeline — STAGES: " + stages + " — CLAIM_SET: " + claimDepth +
    " — MODE: IC GRADE — ARTIFACT_ROWS: ON — PACKAGING: JSON — ABORT_ON_FAIL: TRUE";

  var userContent = [
    {
      type: "text",
      text:
        "Previous Pipeline Output:\n\n" +
        "```json\n" + JSON.stringify(contextJson, null, 2) + "\n```\n\n" +
        runCommand,
    },
  ];

  var response = await callAnthropic(
    systemPrompt,
    userContent,
    STAGE_MAX_TOKENS
  );

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
