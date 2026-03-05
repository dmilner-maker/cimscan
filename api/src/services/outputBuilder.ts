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
  Table,
  TableRow,
  TableCell,
  WidthType,
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
  var ic = result.icInsights || {};

  var sections: (Paragraph | Table)[] = [];

  // ---- Target ----
  sections.push(
    heading("Target: " + (ic.company_name || deal.deal_name), HeadingLevel.HEADING_1),
    para("")
  );

  // ---- Management Table ----
  sections.push(heading("Management", HeadingLevel.HEADING_1));
  sections.push(
    makeTable([
      ["CEO", String(ic.ceo || "Not disclosed in CIM")],
      ["CFO", String(ic.cfo || "Not disclosed in CIM")],
    ])
  );
  sections.push(para(""));

  // ---- Financial Stats Table ----
  sections.push(heading("Financial Stats for Current Year", HeadingLevel.HEADING_1));
  sections.push(
    makeTable([
      ["Revenue", String(ic.projected_revenue || "Not disclosed")],
      ["Gross Profit", String(ic.projected_gross_profit || "Not disclosed")],
      ["Operating Expense", String(ic.projected_op_ex || "Not disclosed")],
      ["Net Income", String(ic.projected_net_income || "Not disclosed")],
      ["Adjusted EBITDA", String(ic.adjusted_ebitda || "Not disclosed")],
    ])
  );
  sections.push(para(""));

  // ---- Operational Narrative ----
  sections.push(heading("OPERATIONAL NARRATIVE", HeadingLevel.HEADING_1));
  var opNarrative = String(ic.operational_narrative || "");
  if (opNarrative) {
    var opParagraphs = opNarrative.split("\n\n");
    for (var i = 0; i < opParagraphs.length; i++) {
      var text = opParagraphs[i].trim();
      if (text) {
        sections.push(para(text));
        sections.push(para(""));
      }
    }
  } else {
    sections.push(para("IC Insights narrative not generated for this run."));
  }

  // ---- What Breaks the Narrative ----
  sections.push(heading("WHAT BREAKS THE NARRATIVE", HeadingLevel.HEADING_1));
  var counterNarrative = String(ic.counter_narrative || "");
  if (counterNarrative) {
    var counterParagraphs = counterNarrative.split("\n\n");
    for (var i = 0; i < counterParagraphs.length; i++) {
      var text = counterParagraphs[i].trim();
      if (text) {
        sections.push(para(text));
        sections.push(para(""));
      }
    }
  } else {
    sections.push(para("Counter-narrative not generated for this run."));
  }

  // ---- Existential Threats ----
  sections.push(heading("EXISTENTIAL THREATS (From Operational Claims)", HeadingLevel.HEADING_1));
  var threats = String(ic.existential_threats || "");
  if (threats) {
    var threatParagraphs = threats.split("\n\n");
    for (var i = 0; i < threatParagraphs.length; i++) {
      var text = threatParagraphs[i].trim();
      if (text) {
        sections.push(para(text));
        sections.push(para(""));
      }
    }
  } else {
    sections.push(para("Existential threats analysis not generated for this run."));
  }

  // ---- Footer ----
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
// Table builder helper
// ---------------------------------------------------------------------------

function makeTable(rows: [string, string][]): Table {
  var tableRows: TableRow[] = [];
  for (var i = 0; i < rows.length; i++) {
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: rows[i][0], bold: true })] })],
            width: { size: 3000, type: WidthType.DXA },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun(rows[i][1])] })],
            width: { size: 6000, type: WidthType.DXA },
          }),
        ],
      })
    );
  }
  return new Table({ rows: tableRows });
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
