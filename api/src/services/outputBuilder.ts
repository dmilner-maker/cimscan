/**
 * Output Builder — Converts EC-CIM Pipeline JSON into Deliverable Files
 *
 * Produces three files:
 *   1. Dataset D (.xlsx) — 12-sheet analytical workbook
 *   2. IC Insights (.docx) — 8-section Word document
 *   3. Workstream Synopsis (.md) — Markdown executive summary
 *
 * DESIGN PRINCIPLE: Dynamic column extraction. Instead of hardcoding column
 * names, we discover all keys from the first item in each array and use
 * those as headers. This ensures we never drop data the model produces.
 *
 * Dependencies: exceljs (xlsx), docx (docx generation)
 */

import ExcelJS from "exceljs";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from "docx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Deal {
  id: string;
  deal_name: string;
  claim_depth: "CORE" | "FULL";
  sender_email: string;
  firm_id: string;
}

interface PipelineResult {
  success: boolean;
  qualityGate?: Record<string, unknown>;
  stage1?: Record<string, unknown>;
  stage2?: Record<string, unknown>;
  stage3?: Record<string, unknown>;
  stage4?: Record<string, unknown>;
  stage5?: Record<string, unknown>;
  icInsights?: Record<string, unknown>;
  synopsis?: string;
  tokenUsage?: { totalInput: number; totalOutput: number };
}

export interface PipelineOutputs {
  datasetD: Buffer;
  icInsights: Buffer;
  synopsis: string;
  datasetDFilename: string;
  icInsightsFilename: string;
  synopsisFilename: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildOutputFiles(
  deal: Deal,
  result: PipelineResult
): Promise<PipelineOutputs> {
  var dealSlug = deal.deal_name.replace(/[^a-zA-Z0-9]/g, "_");
  var timestamp = new Date().toISOString().slice(0, 10);

  var datasetD = await buildDatasetD(deal, result);
  var icInsights = await buildIcInsights(deal, result);
  var synopsis = await buildSynopsis(deal, result);

  return {
    datasetD: datasetD,
    icInsights: icInsights,
    synopsis: synopsis,
    datasetDFilename: "Dataset_D_" + dealSlug + "_" + timestamp + ".xlsx",
    icInsightsFilename: "IC_Insights_" + dealSlug + "_" + timestamp + ".docx",
    synopsisFilename: "Synopsis_" + dealSlug + "_" + timestamp + ".md",
  };
}

// ===========================================================================
// Dataset D (.xlsx) — 12 sheets
// ===========================================================================

async function buildDatasetD(deal: Deal, result: PipelineResult): Promise<Buffer> {
  var wb = new ExcelJS.Workbook();

  // --- Sheet 1: README ---
  buildReadmeSheet(wb, deal, result);

  // --- Sheet 2: Claim Register (Stage 1) ---
  buildDynamicArraySheet(wb, "Claim Register", getArray(result.stage1, "claims"));

  // --- Sheet 3: Self-Audit ---
  buildSelfAuditSheet(wb, result.stage1);

  // --- Sheet 4: Underwriting Gates (Stage 2) ---
  buildDynamicArraySheet(wb, "Underwriting Gates", getArray(result.stage2, "gates"));

  // --- Sheet 5: Workstream Execution (Stage 3) ---
  var tasks = getArray(result.stage3, "tasks");
  var artifactRows = getArray(result.stage3, "artifact_rows");
  buildDynamicArraySheet(wb, "Workstream Execution", tasks.length > 0 ? tasks : artifactRows);

  // --- Sheet 6: Interdependency Matrix (Stage 4) ---
  buildDynamicArraySheet(wb, "Interdependency Matrix", getArray(result.stage4, "matrix_pairs"));

  // --- Sheet 7: Hub Risk Summary (Stage 4) ---
  buildDynamicArraySheet(wb, "Hub Risk Summary", getArray(result.stage4, "hub_risk"));

  // --- Sheet 8: Cascade Scenarios (Stage 4) ---
  buildDynamicArraySheet(wb, "Cascade Scenarios", getArray(result.stage4, "cascade_scenarios"));

  // --- Sheet 9: Negative Coupling (Stage 4) ---
  var couplings = getArray(result.stage4, "negative_couplings");
  buildNegativeCouplingSheet(wb, couplings, result.stage4);

  // --- Sheet 10: Top 5 IC Kill Hubs (Stage 4) ---
  buildDynamicArraySheet(wb, "Top 5 IC Kill Hubs", getArray(result.stage4, "top_5_kill_hubs"));

  // --- Sheet 11: Thesis Pillars (Stage 5) ---
  buildDynamicArraySheet(wb, "Thesis Pillars", getArray(result.stage5, "pillars"));

  // --- Sheet 12: Export Validation Gate (Stage 5) ---
  buildExportValidationSheet(wb, result.stage5);

  var arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Dynamic array sheet builder — extracts ALL keys from array items
// ---------------------------------------------------------------------------

function buildDynamicArraySheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
  items: Record<string, unknown>[]
): void {
  var ws = wb.addWorksheet(sheetName);

  if (items.length === 0) {
    ws.addRow(["No data returned for this stage"]);
    return;
  }

  // Discover all unique keys across all items (preserving order from first item)
  var keySet = new Set<string>();
  var orderedKeys: string[] = [];

  for (var i = 0; i < items.length; i++) {
    var itemKeys = Object.keys(items[i]);
    for (var j = 0; j < itemKeys.length; j++) {
      if (!keySet.has(itemKeys[j])) {
        keySet.add(itemKeys[j]);
        orderedKeys.push(itemKeys[j]);
      }
    }
  }

  // Add header row
  ws.addRow(orderedKeys);
  styleHeaderRow(ws);

  // Add data rows
  for (var i = 0; i < items.length; i++) {
    var row: (string | number)[] = [];
    for (var j = 0; j < orderedKeys.length; j++) {
      var val = items[i][orderedKeys[j]];
      if (val === null || val === undefined) {
        row.push("");
      } else if (Array.isArray(val)) {
        row.push(val.join(", "));
      } else if (typeof val === "object") {
        row.push(JSON.stringify(val));
      } else if (typeof val === "number") {
        row.push(val);
      } else {
        row.push(String(val));
      }
    }
    ws.addRow(row);
  }

  autoWidth(ws);
}

// ---------------------------------------------------------------------------
// Individual sheet builders for non-array data
// ---------------------------------------------------------------------------

function buildReadmeSheet(wb: ExcelJS.Workbook, deal: Deal, result: PipelineResult): void {
  var ws = wb.addWorksheet("README");
  var qg = result.qualityGate || {};

  var rows: [string, string][] = [
    ["EC-CIM VERSION", "v1.7.0"],
    ["DATASET", "Dataset D — Full Pipeline Output"],
    ["DEAL NAME", deal.deal_name],
    ["CLAIM_DEPTH", deal.claim_depth],
    ["RUN TIMESTAMP (UTC)", new Date().toISOString()],
    ["PACKAGING", "EXCEL (API Pipeline)"],
    ["", ""],
    ["CIM QUALITY GATE", ""],
    ["Gate Decision", String(qg.gate_decision || "N/A")],
    ["Quality Score", String(qg.quality_score || "N/A")],
    ["Financial Data Density", String(qg.financial_data_density || "N/A")],
    ["Customer & Concentration Data", String(qg.customer_concentration_data || "N/A")],
    ["Operational & Structural Detail", String(qg.operational_structural_detail || "N/A")],
    ["Growth & Pipeline Substantiation", String(qg.growth_pipeline_substantiation || "N/A")],
    ["Risk & Compliance Disclosure", String(qg.risk_compliance_disclosure || "N/A")],
  ];

  if (qg.quality_notes) {
    rows.push(["Quality Notes", String(qg.quality_notes)]);
  }

  if (Array.isArray(qg.data_gaps_identified)) {
    rows.push(["Data Gaps", (qg.data_gaps_identified as string[]).join("; ")]);
  }

  // Column definitions
  rows.push(["", ""]);
  rows.push(["COLUMN DEFINITIONS", ""]);
  rows.push(["claim_id", "Unique identifier for each extracted claim"]);
  rows.push(["claim_text", "Atomic, falsifiable assertion extracted from the CIM"]);
  rows.push(["claim_category", "Underwriting surface bucket"]);
  rows.push(["claim_priority_score", "IC priority ranking score (0-1)"]);
  rows.push(["mechanism_of_value", "Causal bridge from claim to economic outcome"]);
  rows.push(["economic_driver", "Primary value lever"]);
  rows.push(["kpi_to_validate", "Measurable KPI to test the claim"]);
  rows.push(["claim_type", "Standard Claim or Absence Claim"]);

  // Governing rules
  rows.push(["", ""]);
  rows.push(["GOVERNING RULES", ""]);
  rows.push(["No Placeholder Cells", "TBD, N/A, pending are prohibited"]);
  rows.push(["Anti-Fluff Rule", "Every claim must be falsifiable and economically linked"]);
  rows.push(["Atomic Enforcement", "One underwriting assertion per claim"]);
  rows.push(["CORE Band", "20-30 claims required for CORE depth"]);

  for (var i = 0; i < rows.length; i++) {
    ws.addRow(rows[i]);
  }

  styleHeaderColumn(ws, 1);
}

function buildSelfAuditSheet(wb: ExcelJS.Workbook, stage1?: Record<string, unknown>): void {
  var ws = wb.addWorksheet("Self-Audit");
  ws.addRow(["Check", "Result", "Detail"]);
  styleHeaderRow(ws);

  var audit = (stage1?.self_audit as Record<string, unknown>) || {};

  // If the self_audit is a rich object, enumerate all keys
  var auditKeys = Object.keys(audit);
  if (auditKeys.length > 0) {
    for (var i = 0; i < auditKeys.length; i++) {
      var key = auditKeys[i];
      var val = audit[key];
      var detail: string;

      if (typeof val === "object" && val !== null) {
        detail = JSON.stringify(val);
      } else {
        detail = String(val ?? "");
      }

      var passed = val !== false && val !== 0;
      ws.addRow([key, passed ? "PASS" : "FAIL", detail]);
    }
  }

  // Also add claim-level stats from stage1
  var claims = (stage1?.claims as Record<string, unknown>[]) || [];
  var absenceClaims = claims.filter(function(c) { return c.claim_type === "Absence Claim"; });
  var categories: Record<string, string[]> = {};
  for (var i = 0; i < claims.length; i++) {
    var cat = String(claims[i].claim_category || "Unknown");
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(String(claims[i].claim_id || ""));
  }

  ws.addRow(["", "", ""]);
  ws.addRow(["CLAIM STATISTICS", "", ""]);
  ws.addRow(["Total Claim Count", String(claims.length), claims.length >= 20 && claims.length <= 30 ? "PASS (CORE band)" : "CHECK"]);
  ws.addRow(["Standard Claims", String(claims.length - absenceClaims.length), ""]);
  ws.addRow(["Absence Claims", String(absenceClaims.length), ""]);

  ws.addRow(["", "", ""]);
  ws.addRow(["UNDERWRITING SURFACE COVERAGE", "", ""]);
  var catKeys = Object.keys(categories);
  for (var i = 0; i < catKeys.length; i++) {
    ws.addRow([catKeys[i], categories[catKeys[i]].length + " claims", categories[catKeys[i]].join(", ")]);
  }

  autoWidth(ws);
}

function buildNegativeCouplingSheet(
  wb: ExcelJS.Workbook,
  couplings: Record<string, unknown>[],
  stage4?: Record<string, unknown>
): void {
  if (couplings.length > 0) {
    buildDynamicArraySheet(wb, "Negative Coupling", couplings);
    return;
  }

  // Empty array is valid under STRICT mode
  var ws = wb.addWorksheet("Negative Coupling");
  var note = stage4?.negative_coupling_note as string;
  if (note) {
    ws.addRow(["Note", note]);
  } else {
    ws.addRow(["Status", "No negative couplings detected under STRICT mode"]);
  }
  ws.addRow(["", "This is a valid result — STRICT mode only flags confirmed contradictions"]);
  autoWidth(ws);
}

function buildExportValidationSheet(wb: ExcelJS.Workbook, stage5?: Record<string, unknown>): void {
  var ws = wb.addWorksheet("Export Validation Gate");
  ws.addRow(["Check", "Result", "Detail"]);
  styleHeaderRow(ws);

  var gate = (stage5?.export_validation_gate as Record<string, unknown>) || {};
  var gateKeys = Object.keys(gate);

  for (var i = 0; i < gateKeys.length; i++) {
    var key = gateKeys[i];
    var val = gate[key];

    if (key === "checks" && typeof val === "object" && val !== null) {
      // Nested checks object
      var checks = val as Record<string, unknown>;
      var checkKeys = Object.keys(checks);
      for (var j = 0; j < checkKeys.length; j++) {
        var checkVal = checks[checkKeys[j]];
        var checkStr = String(checkVal ?? "");
        // Determine pass/fail: check for boolean true, string "PASS", or strings starting with "PASS"
        var isPassing = checkVal === true || checkStr === "PASS" || checkStr.indexOf("PASS") === 0;
        ws.addRow([checkKeys[j], isPassing ? "PASS" : "FAIL", checkStr]);
      }
    } else if (typeof val === "object" && val !== null) {
      ws.addRow([key, "", JSON.stringify(val)]);
    } else {
      var valStr = String(val ?? "");
      var isPass = val === true || valStr === "PASS" || valStr === "true" || valStr.indexOf("PASS") === 0;
      ws.addRow([key, isPass ? "PASS" : String(val), valStr]);
    }
  }

  autoWidth(ws);
}

// ---------------------------------------------------------------------------
// Helper: extract array from stage data, trying multiple key patterns
// ---------------------------------------------------------------------------

function getArray(stageData: Record<string, unknown> | undefined, primaryKey: string): Record<string, unknown>[] {
  if (!stageData) return [];

  // Try primary key directly
  if (Array.isArray(stageData[primaryKey])) {
    return stageData[primaryKey] as Record<string, unknown>[];
  }

  // Try nested inside a stage wrapper (e.g., stage_2.gates)
  var stageKeys = Object.keys(stageData);
  for (var i = 0; i < stageKeys.length; i++) {
    var nested = stageData[stageKeys[i]];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      var inner = nested as Record<string, unknown>;
      if (Array.isArray(inner[primaryKey])) {
        return inner[primaryKey] as Record<string, unknown>[];
      }
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Excel styling helpers
// ---------------------------------------------------------------------------

function styleHeaderRow(ws: ExcelJS.Worksheet): void {
  var row = ws.getRow(1);
  row.font = { bold: true, size: 10 };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };
}

function styleHeaderColumn(ws: ExcelJS.Worksheet, colNum: number): void {
  ws.getColumn(colNum).font = { bold: true };
  ws.getColumn(colNum).width = 35;
  if (ws.getColumn(colNum + 1)) {
    ws.getColumn(colNum + 1).width = 60;
  }
}

function autoWidth(ws: ExcelJS.Worksheet): void {
  ws.columns.forEach(function(col) {
    var maxLen = 12;
    col.eachCell?.({ includeEmpty: false }, function(cell) {
      var len = String(cell.value ?? "").length;
      if (len > maxLen) maxLen = Math.min(len, 60);
    });
    col.width = maxLen + 2;
  });
}

// ===========================================================================
// IC Insights (.docx) — 8 sections
// ===========================================================================

async function buildIcInsights(deal: Deal, result: PipelineResult): Promise<Buffer> {
  var qg = result.qualityGate || {};
  var claims = (getArray(result.stage1, "claims"))
    .sort(function(a, b) { return Number(b.claim_priority_score ?? 0) - Number(a.claim_priority_score ?? 0); });
  var gates = getArray(result.stage2, "gates");
  var tasks = getArray(result.stage3, "tasks");
  if (tasks.length === 0) tasks = getArray(result.stage3, "artifact_rows");
  var killHubs = getArray(result.stage4, "top_5_kill_hubs");
  var pillars = getArray(result.stage5, "pillars");

  var sections: Paragraph[] = [];

  // ---- Section 1: Cover Page ----
  sections.push(
    heading("IC Insights", HeadingLevel.TITLE),
    para("Deal: " + deal.deal_name),
    para("EC-CIM Version: 1.7.0"),
    para("Claim Depth: " + deal.claim_depth),
    para("Run Timestamp: " + new Date().toISOString()),
    para("CIM Quality Gate: " + (qg.gate_decision || "N/A") + " (Score: " + (qg.quality_score || "N/A") + ")"),
    para("")
  );

  // ---- Section 2: Executive Summary ----
  sections.push(heading("Executive Summary", HeadingLevel.HEADING_1));
  sections.push(
    para(
      "The analysis surfaces " + claims.length + " claims across " +
      (deal.claim_depth === "CORE" ? "5" : "6+") + " underwriting surfaces. " +
      killHubs.length + " hub claims identified with potential cascade risk. " +
      pillars.length + " thesis pillars constructed with STRICT coupling surface."
    )
  );
  if (qg.gate_decision === "CONDITIONAL_PASS") {
    sections.push(
      para(
        "Note: CIM Quality Gate returned CONDITIONAL PASS (score: " + qg.quality_score + "). " +
        "Outputs may be constrained by source data limitations."
      )
    );
  }

  // ---- Section 3: Top 8 Claims ----
  sections.push(heading("Investment Thesis Claims — Top 8", HeadingLevel.HEADING_1));
  var top8 = claims.slice(0, 8);
  for (var i = 0; i < top8.length; i++) {
    var claim = top8[i];
    var isAbsence = claim.claim_type === "Absence Claim";
    sections.push(
      heading(
        String(claim.claim_id) + (isAbsence ? " [ABSENCE CLAIM]" : ""),
        HeadingLevel.HEADING_2
      ),
      para(String(claim.claim_text || "")),
      para("Category: " + (claim.claim_category || "N/A")),
      para("Mechanism: " + (claim.mechanism_of_value || "N/A")),
      para("Economic Driver: " + (claim.economic_driver || "N/A")),
      para("KPI: " + (claim.kpi_to_validate || "N/A")),
      para("Priority Score: " + (claim.claim_priority_score || "N/A")),
      para("")
    );
  }

  // ---- Section 4: Underwriting Gates ----
  sections.push(heading("Underwriting Gates & Kill Thresholds", HeadingLevel.HEADING_1));
  for (var i = 0; i < Math.min(gates.length, 15); i++) {
    var gate = gates[i];
    sections.push(
      para(
        String(gate.claim_id) + ": " + String(gate.underwriting_gate || "") + " — " +
        "Kill: " + String(gate.kill_threshold || "N/A") + " — " +
        "Downside: " + String(gate.downside_case_if_false || "N/A")
      )
    );
  }

  // ---- Section 5: Top 5 IC Kill Risks ----
  sections.push(heading("Top 5 IC Kill Risks", HeadingLevel.HEADING_1));
  for (var i = 0; i < killHubs.length; i++) {
    var hub = killHubs[i];
    sections.push(
      heading("#" + (hub.rank || (i + 1)) + " — " + hub.claim_id + " (" + (hub.hub_tag || "") + ")", HeadingLevel.HEADING_2),
      para("Blast Radius: " + (hub.blast_radius || "N/A")),
      para("IC Gating Rationale: " + (hub.ic_gating_rationale || "N/A")),
      para("")
    );
  }

  // ---- Section 6: Diligence Workplan ----
  sections.push(heading("Diligence Workplan", HeadingLevel.HEADING_1));
  var taskCounts: Record<string, number> = {};
  for (var i = 0; i < tasks.length; i++) {
    var taskType = String(tasks[i].diligence_task_type || tasks[i].task_type || "Other");
    taskCounts[taskType] = (taskCounts[taskType] || 0) + 1;
  }
  sections.push(
    para("Total tasks: " + tasks.length),
    para("Distribution: " + Object.entries(taskCounts).map(function(e) { return e[0] + " (" + e[1] + ")"; }).join(", ")),
    para("")
  );

  // ---- Section 7: Thesis Pillars ----
  sections.push(heading("Thesis Pillars with STRICT Coupling Surface", HeadingLevel.HEADING_1));
  for (var i = 0; i < pillars.length; i++) {
    var p = pillars[i];
    sections.push(
      heading(String(p.pillar_id || "") + ": " + String(p.pillar_name || ""), HeadingLevel.HEADING_2),
      para("Thesis: " + (p.pillar_thesis || "N/A")),
      para("Supporting Claims: " + formatArrayOrString(p.supporting_claim_ids)),
      para("Key KPIs: " + formatArrayOrString(p.key_kpis)),
      para("Kill Threshold: " + (p.kill_threshold || "N/A")),
      para("Negative Coupling Trigger: " + (p.negative_coupling_trigger || "N/A")),
      para("Collapse Path: " + (p.pillar_collapse_path_if_breached || "N/A")),
      para("IC RED Condition: " + (p.ic_red_threshold_condition || "N/A")),
      para("")
    );
  }

  // ---- Section 8: Appendix ----
  sections.push(heading("Appendix: Full Claim Register", HeadingLevel.HEADING_1));
  for (var i = 0; i < claims.length; i++) {
    var c = claims[i];
    sections.push(
      para(
        String(c.claim_id) + (c.claim_type === "Absence Claim" ? " [ABSENCE]" : "") + " | " +
        String(c.claim_category || "") + " | Score: " + String(c.claim_priority_score || "") + " | " +
        String(c.economic_driver || "") + " | " + String(c.claim_text || "")
      )
    );
  }

  sections.push(
    para(""),
    para("IC Insights v1.7.0 — True Bearing LLC / IC Sentinel / CIMScan"),
    para("This document presents structured diligence findings. It does not constitute investment advice.")
  );

  var doc = new Document({
    sections: [{ children: sections }],
  });

  return await Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// Docx helpers
// ---------------------------------------------------------------------------

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ text: text, heading: level });
}

function para(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun(text)] });
}

function formatArrayOrString(val: unknown): string {
  if (Array.isArray(val)) return val.join(", ");
  if (val) return String(val);
  return "N/A";
}

// ===========================================================================
// Workstream Synopsis (.md)
// ===========================================================================

async function buildSynopsis(deal: Deal, result: PipelineResult): Promise<string> {
  // If any stage returned a synopsis, use it
  if (result.synopsis && result.synopsis.length > 100) {
    return result.synopsis;
  }

  var qg = result.qualityGate || {};
  var claims = getArray(result.stage1, "claims");
  var killHubs = getArray(result.stage4, "top_5_kill_hubs");
  var pillars = getArray(result.stage5, "pillars");
  var absenceClaims = claims.filter(function(c) { return c.claim_type === "Absence Claim"; });

  var lines: string[] = [
    "# Workstream Synopsis: " + deal.deal_name,
    "",
    "**EC-CIM v1.7.0 | " + deal.claim_depth + " | " + new Date().toISOString() + "**",
    "",
    "---",
    "",
    "## CIM Quality Gate",
    "",
    "**Decision:** " + (qg.gate_decision || "N/A") + " | **Score:** " + (qg.quality_score || "N/A"),
    "",
    "---",
    "",
    "## Stage 1: CIMScan (Claim Extraction)",
    "",
    "**Claims:** " + claims.length + " | **Absence Claims:** " + absenceClaims.length,
    "",
    "Top 3 claims by priority:",
  ];

  var sorted = claims.slice().sort(function(a, b) {
    return Number(b.claim_priority_score ?? 0) - Number(a.claim_priority_score ?? 0);
  });
  for (var i = 0; i < Math.min(3, sorted.length); i++) {
    lines.push("- **" + sorted[i].claim_id + "** (" + sorted[i].claim_priority_score + "): " + sorted[i].claim_text);
  }

  lines.push("", "---", "", "## Stage 4: Interdependency Analysis", "", "**Top IC Kill Hubs:**");
  for (var i = 0; i < Math.min(3, killHubs.length); i++) {
    lines.push("- **" + killHubs[i].claim_id + "** — " + killHubs[i].hub_tag + " (blast radius: " + killHubs[i].blast_radius + ")");
  }

  lines.push("", "---", "", "## Stage 5: Thesis Pillars", "");
  for (var i = 0; i < pillars.length; i++) {
    lines.push("- **" + pillars[i].pillar_id + " " + pillars[i].pillar_name + ":** " + (pillars[i].pillar_thesis || "N/A"));
  }

  lines.push(
    "", "---", "",
    "## Pipeline Completion", "",
    "- CIM Quality Gate: " + (qg.gate_decision || "N/A"),
    "- Total Claims: " + claims.length,
    "- Absence Claims: " + absenceClaims.length,
    "- Kill Hubs: " + killHubs.length,
    "- Pillars: " + pillars.length,
    "",
    "---",
    "*Workstream Synopsis — EC-CIM v1.7.0 — True Bearing LLC / IC Sentinel / CIMScan*"
  );

  return lines.join("\n");
}
