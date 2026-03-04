/**
 * Anthropic API Client for EC-CIM Pipeline
 *
 * Handles two-pass architecture:
 *   Pass 1: CIM PDF + system prompt → Quality Gate + Stage 1 (claim register)
 *   Pass 2: Stage 1 JSON + system prompt → Stages 2–5 + IC Insights
 *
 * Uses the Messages API with document (PDF) support.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

// Model for pipeline execution — Sonnet for cost/speed balance on structured output
const PIPELINE_MODEL = "claude-sonnet-4-20250514";

// Max tokens — pipeline JSON outputs can be large (especially FULL depth Stage 4)
const PASS_1_MAX_TOKENS = 16_000; // Quality Gate + up to 60 claims
const PASS_2_MAX_TOKENS = 32_000; // Stages 2–5 + IC Insights content

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

let cachedSystemPrompt: string | null = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load the EC-CIM API Payload system prompt.
 * Path is configurable via EC_CIM_SYSTEM_PROMPT_PATH env var.
 * Falls back to a bundled copy in the API's assets directory.
 */
export function loadSystemPrompt(): string {
  if (cachedSystemPrompt) return cachedSystemPrompt;

  const promptPath =
    process.env.EC_CIM_SYSTEM_PROMPT_PATH ||
    path.resolve(__dirname, "../../assets/ec-cim-system-prompt-v1.7.0.md");

  if (!fs.existsSync(promptPath)) {
    throw new Error(
      `EC-CIM system prompt not found at ${promptPath}. ` +
        `Set EC_CIM_SYSTEM_PROMPT_PATH or place the file in api/assets/.`
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const body = {
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

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Anthropic API error ${response.status}: ${errorText}`
    );
  }

  return (await response.json()) as AnthropicResponse;
}

// ---------------------------------------------------------------------------
// Pass 1: CIM PDF → Quality Gate + Stage 1
// ---------------------------------------------------------------------------

/**
 * Execute Pass 1 of the EC-CIM pipeline.
 *
 * Sends the CIM PDF (base64) with the system prompt and a Stage 1 run command.
 * Returns the Quality Gate report + claim register as JSON.
 *
 * @param pdfBuffer - Raw PDF file contents
 * @param claimDepth - "CORE" or "FULL"
 * @param sourceFilename - Original CIM filename (for the run command)
 */
export async function executePass1(
  pdfBuffer: Buffer,
  claimDepth: "CORE" | "FULL",
  sourceFilename: string
): Promise<PipelinePassResult> {
  const systemPrompt = loadSystemPrompt();
  const pdfBase64 = pdfBuffer.toString("base64");

  const runCommand = `RUN: CIMScan — CLAIM_DEPTH: ${claimDepth} — PACKAGING: JSON`;

  const userContent = [
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
      text: `Source CIM: ${sourceFilename}\n\n${runCommand}`,
    },
  ];

  const response = await callAnthropic(
    systemPrompt,
    userContent,
    PASS_1_MAX_TOKENS
  );

  return parseResponse(response);
}

// ---------------------------------------------------------------------------
// Pass 2: Stage 1 JSON → Stages 2–5 + IC Insights
// ---------------------------------------------------------------------------

/**
 * Execute Pass 2 of the EC-CIM pipeline.
 *
 * Sends the Stage 1 claim register JSON (no CIM PDF needed) with the system
 * prompt and a pipeline run command for Stages 2–5 + IC Insights.
 *
 * @param stage1Json - The full Stage 1 JSON output from Pass 1
 * @param claimDepth - "CORE" or "FULL" (must match Pass 1)
 */
export async function executePass2(
  stage1Json: Record<string, unknown>,
  claimDepth: "CORE" | "FULL"
): Promise<PipelinePassResult> {
  const systemPrompt = loadSystemPrompt();

  const runCommand =
    `RUN: EC-CIM Pipeline — STAGES: 2,3,4,5,INSIGHTS — CLAIM_SET: ${claimDepth}` +
    ` — MODE: IC GRADE — ARTIFACT_ROWS: ON — PACKAGING: JSON — ABORT_ON_FAIL: TRUE`;

  const userContent = [
    {
      type: "text",
      text:
        `Stage 1 Output (Claim Register):\n\n` +
        `\`\`\`json\n${JSON.stringify(stage1Json, null, 2)}\n\`\`\`\n\n` +
        runCommand,
    },
  ];

  const response = await callAnthropic(
    systemPrompt,
    userContent,
    PASS_2_MAX_TOKENS
  );

  return parseResponse(response);
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

function parseResponse(response: AnthropicResponse): PipelinePassResult {
  // Concatenate all text blocks
  const rawText = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text || "")
    .join("\n");

  const truncated = response.stop_reason === "max_tokens";

  // Attempt to extract JSON from the response
  let json: Record<string, unknown> | null = null;
  try {
    json = extractJson(rawText);
  } catch {
    // JSON extraction failed — caller will handle based on context
  }

  return {
    rawText,
    json,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    stopReason: response.stop_reason,
    truncated,
  };
}

/**
 * Extract JSON from a response that may contain markdown fences or preamble text.
 * Tries multiple strategies:
 *   1. Direct JSON.parse on the full text
 *   2. Extract from ```json ... ``` fences
 *   3. Find the first { ... } block
 */
function extractJson(text: string): Record<string, unknown> {
  // Strategy 1: direct parse
  try {
    return JSON.parse(text.trim());
  } catch {
    // continue
  }

  // Strategy 2: markdown JSON fence
  const fenceMatch = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }

  // Strategy 3: find outermost { } block
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.substring(firstBrace, lastBrace + 1));
    } catch {
      // continue
    }
  }

  throw new Error("No valid JSON found in response");
}
