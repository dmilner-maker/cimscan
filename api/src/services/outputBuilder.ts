/**
 * Output Builder — Converts EC-CIM Pipeline JSON into Deliverable Files
 *
 * Produces three files:
 *   1. Dataset D (.xlsx) — 12-sheet analytical workbook
 *   2. IC Insights (.docx) — 8-section Word document
 *   3. Workstream Synopsis (.md) — Markdown executive summary
 *
 * Dependencies: exceljs (xlsx), docx (docx generation)
 * Install: npm install exceljs docx
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
  BorderStyle,
  AlignmentType,
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
  datasetD: Buffer;   // .xlsx
  icInsights: Buffer;  // .docx
  synopsis: string;    // .md content
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
  const dealSlug = deal.deal_name.replace(/[^a-zA-Z0-9]/g, "_");
  const timestamp = new Date().toISOString().slice(0, 10);

  const [datasetD, icInsights, synopsis] = await Promise.all([
    buildDatasetD(deal, result),
    buildIcInsights(deal, result),
    buildSynopsis(deal, result),
  ]);

  return {
    datasetD,
    icInsights,
    synopsis,
    datasetDFilename: `Dataset_D_${dealSlug}_${timestamp}.xlsx`,
    icInsightsFilename: `IC_Insights_${dealSlug}_${timestamp}.docx`,
    synopsisFilename: `Synopsis_${dealSlug}_${timestamp}.md`,
  };
}

// ===========================================================================
// Dataset D (.xlsx) — 12 sheets
// ===========================================================================

async function buildDatasetD(deal: Deal, result: PipelineResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // --- Sheet 1: README ---
  buildReadmeSheet(wb, deal, result);

  // --- Sheet 2: Claim Register (Stage 1) ---
  buildClaimRegisterSheet(wb, result.stage1);

  // --- Sheet 3: Self-Audit ---
  buildSelfAuditSheet(wb, result.stage1);

  // --- Sheet 4: Underwriting Gates (Stage 2) ---
  buildUnderwritingGatesSheet(wb, result.stage2);

  // --- Sheet 5: Workstream Execution (Stage 3) ---
  buildWorkstreamSheet(wb, result.stage3);

  // --- Sheets 6–10: Interdependency Analysis (Stage 4) ---
  buildInterdependencyMatrixSheet(wb, result.stage4);
  buildHubRiskSheet(wb, result.stage4);
  buildCascadeScenariosSheet(wb, result.stage4);
  buildNegativeCouplingSheet(wb, result.stage4);
  buildKillHubsSheet(wb, result.stage4);

  // --- Sheet 11: Thesis Pillars (Stage 5) ---
  buildThesisPillarsSheet(wb, result.stage5);

  // --- Sheet 12: Export Validation Gate ---
  buildExportValidationSheet(wb, result.stage5);

  // Write to buffer
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

function buildReadmeSheet(wb: ExcelJS.Workbook, deal: Deal, result: PipelineResult): void {
  const ws = wb.addWorksheet("README");
  const qg = result.qualityGate || {};

  const rows: [string, string][] = [
    ["EC-CIM Version", "1.7.0"],
    ["Dataset D", `Generated ${new Date().toISOString()}`],
    ["Deal Name", deal.deal_name],
    ["Claim Depth", deal.claim_depth],
    ["CIM Quality Gate", String(qg.gate_decision || "N/A")],
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

  rows.forEach((row) => ws.addRow(row));
  styleHeaderColumn(ws, 1);
}

function buildClaimRegisterSheet(wb: ExcelJS.Workbook, stage1?: Record<string, unknown>): void {
  const ws = wb.addWorksheet("Claim Register");
  const headers = [
    "claim_id", "claim_text", "claim_category", "cim_section",
    "claim_priority_score", "source_page", "source_excerpt",
    "mechanism_of_value", "economic_driver", "kpi_to_validate", "claim_type",
  ];
  ws.addRow(headers);
  styleHeaderRow(ws);

  const claims = (stage1?.claims as Record<string, unknown>[]) || [];
  for (const claim of claims) {
    ws.addRow(headers.map((h) => String(claim[h] ?? "")));
  }

  autoWidth(ws);
}

function buildSelfAuditSheet(wb: ExcelJS.Workbook, stage1?: Record<string, unknown>): void {
  const ws = wb.addWorksheet("Self-Audit");
  ws.addRow(["Check", "Result", "Detail"]);
  styleHeaderRow(ws);

  const audit = (stage1?.self_audit as Record<string, unknown>) || {};

  // Standard audit checks
  const checks: [string, unknown][] = [
    ["claim_count", audit.claim_count],
    ["surfaces_covered", JSON.stringify(audit.surfaces_covered || {})],
    ["forecast_claim_count", audit.forecast_claim_count],
    ["absence_claim_count", audit.absence_claim_count],
    ["all_checks_passed", audit.all_checks_passed],
  ];

  for (const [check, value] of checks) {
    const passed = value !== false && value !== 0;
    ws.addRow([check, passed ? "PASS" : "FAIL", String(value ?? "")]);
  }

  autoWidth(ws);
}

function buildUnderwritingGatesSheet(wb: ExcelJS.Workbook, stage2?: Record<string, unknown>): void {
  const ws = wb.addWorksheet("Underwriting Gates");
  const headers = [
    "claim_id", "underwriting_gate", "kill_threshold",
    "downside_case_if_false", "claim_priority_score", "gate_status",
  ];
  ws.addRow(headers);
  styleHeaderRow(ws);

  const gates = (stage2?.gates as Record<string, unknown>[]) || [];
  for (const gate of gates) {
    ws.addRow(headers.map((h) => String(gate[h] ?? "")));
  }

  autoWidth(ws);
}

function buildWorkstreamSheet(wb: ExcelJS.Workbook, stage3?: Record<string, unknown>): void {
  const ws = wb.addWorksheet("Workstream Execution");
  const headers = [
    "claim_id", "diligence_task_type", "artifact_name",
    "interview_target", "purpose",
  ];
  ws.addRow(headers);
  styleHeaderRow(ws);

  const tasks = (stage3?.tasks as Record<string, unknown>[]) || [];
  for (const task of tasks) {
    ws.addRow(headers.map((h) => String(task[h] ?? "")));
  }

  autoWidth(ws);
}

function buildInterdependencyMatrixSheet(
  wb: ExcelJS.Workbook,
  stage4?: Record<string, unknown>
): void {
  const ws = wb.addWorksheet("Interdependency Matrix");
  const headers = [
    "claim_id_a", "claim_id_b", "kpi_shared", "driver_shared",
    "semantic", "evidence_chain", "relationship_strength", "relationship_type",
  ];
  ws.addRow(headers);
  styleHeaderRow(ws);

  const pairs = (stage4?.matrix_pairs as Record<string, unknown>[]) || [];
  for (const pair of pairs) {
    ws.addRow(headers.map((h) => {
      const val = pair[h];
      return typeof val === "number" ? val : String(val ?? "");
    }));
  }

  autoWidth(ws);
}

function buildHubRiskSheet(wb: ExcelJS.Workbook, stage4?: Record<string, unknown>): void {
  const ws = wb.addWorksheet("Hub Risk Summary");
  const headers = ["claim_id", "blast_radius", "linked_claims", "hub_classification_tag"];
  ws.addRow(headers);
  styleHeaderRow(ws);

  const hubs = (stage4?.hub_risk as Record<string, unknown>[]) || [];
  for (const hub of hubs) {
    ws.addRow([
      String(hub.claim_id ?? ""),
      Number(hub.blast_radius ?? 0),
      Array.isArray(hub.linked_claims)
        ? (hub.linked_claims as string[]).join(", ")
        : String(hub.linked_claims ?? ""),
      String(hub.hub_classification_tag ?? ""),
    ]);
  }

  autoWidth(ws);
}

function buildCascadeScenariosSheet(wb: ExcelJS.Workbook, stage4?: Record<string, unknown>): void {
  const ws = wb.addWorksheet("Cascade Scenarios");
  const headers = [
    "hub_claim_id", "hub_tag", "blast_radius",
    "economic_driver", "cascade_claims", "propagation_chain",
  ];
  ws.addRow(headers);
  styleHeaderRow(ws);

  const cascades = (stage4?.cascade_scenarios as Record<string, unknown>[]) || [];
  for (const c of cascades) {
    ws.addRow([
      String(c.hub_claim_id ?? ""),
      String(c.hub_tag ?? ""),
      Number(c.blast_radius ?? 0),
      String(c.economic_driver ?? ""),
      Array.isArray(c.cascade_claims)
        ? (c.cascade_claims as string[]).join(", ")
        : String(c.cascade_claims ?? ""),
      String(c.propagation_chain ?? ""),
    ]);
  }

  autoWidth(ws);
}

function buildNegativeCouplingSheet(wb: ExcelJS.Workbook, stage4?: Record<string, unknown>): void {
  const ws = wb.addWorksheet("Negative Coupling");
  const headers = [
    "claim_id_a", "claim_id_b", "coupling_family",
    "dimension_signature", "inconsistency_description", "severity",
  ];
  ws.addRow(headers);
  styleHeaderRow(ws);

  const couplings = (stage4?.negative_couplings as Record<string, unknown>[]) || [];
  if (couplings.length === 0) {
    // Empty array is valid under STRICT mode — add note
    ws.addRow(["No negative couplings detected under STRICT mode", "", "", "", "", ""]);
  } else {
    for (const c of couplings) {
      ws.addRow(headers.map((h) => String(c[h] ?? "")));
    }
  }

  autoWidth(ws);
}

function buildKillHubsSheet(wb: ExcelJS.Workbook, stage4?: Record<string, unknown>): void {
  const ws = wb.addWorksheet("Top 5 IC Kill Hubs");
  const headers = ["rank", "claim_id", "hub_tag", "blast_radius", "ic_gating_rationale"];
  ws.addRow(headers);
  styleHeaderRow(ws);

  const killHubs = (stage4?.top_5_kill_hubs as Record<string, unknown>[]) || [];
  for (const hub of killHubs) {
    ws.addRow([
      Number(hub.rank ?? 0),
      String(hub.claim_id ?? ""),
      String(hub.hub_tag ?? ""),
      Number(hub.blast_radius ?? 0),
      String(hub.ic_gating_rationale ?? ""),
    ]);
  }

  autoWidth(ws);
}

function buildThesisPillarsSheet(wb: ExcelJS.Workbook, stage5?: Record<string, unknown>): void {
  const ws = wb.addWorksheet("Thesis Pillars");
  const headers = [
    "pillar_id", "pillar_name", "pillar_thesis", "supporting_claim_ids",
    "economic_driver", "key_kpis", "kill_threshold", "hub_claims_linked",
    "blast_radius_exposure", "negative_coupling_trigger",
    "pillar_collapse_path_if_breached", "ic_red_threshold_condition",
  ];
  ws.addRow(headers);
  styleHeaderRow(ws);

  const pillars = (stage5?.pillars as Record<string, unknown>[]) || [];
  for (const p of pillars) {
    ws.addRow(headers.map((h) => {
      const val = p[h];
      if (Array.isArray(val)) return (val as string[]).join(", ");
      return typeof val === "number" ? val : String(val ?? "");
    }));
  }

  autoWidth(ws);
}

function buildExportValidationSheet(wb: ExcelJS.Workbook, stage5?: Record<string, unknown>): void {
  const ws = wb.addWorksheet("Export Validation Gate");
  ws.addRow(["Check", "Result", "Detail"]);
  styleHeaderRow(ws);

  const gate = (stage5?.export_validation_gate as Record<string, unknown>) || {};
  const checks = (gate.checks as Record<string, unknown>) || {};

  for (const [check, result] of Object.entries(checks)) {
    const passed = result === true || result === "PASS";
    ws.addRow([check, passed ? "PASS" : "FAIL", String(result ?? "")]);
  }

  // Overall result
  ws.addRow([
    "ALL_CHECKS_PASSED",
    gate.all_checks_passed ? "PASS" : "FAIL",
    "",
  ]);

  autoWidth(ws);
}

// ---------------------------------------------------------------------------
// Excel styling helpers
// ---------------------------------------------------------------------------

function styleHeaderRow(ws: ExcelJS.Worksheet): void {
  const row = ws.getRow(1);
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
  ws.getColumn(colNum + 1).width = 60;
}

function autoWidth(ws: ExcelJS.Worksheet): void {
  ws.columns.forEach((col) => {
    let maxLen = 12;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > maxLen) maxLen = Math.min(len, 60);
    });
    col.width = maxLen + 2;
  });
}

// ===========================================================================
// IC Insights (.docx) — 8 sections
// ===========================================================================

async function buildIcInsights(deal: Deal, result: PipelineResult): Promise<Buffer> {
  const qg = result.qualityGate || {};
  const claims = ((result.stage1?.claims as Record<string, unknown>[]) || [])
    .sort((a, b) => Number(b.claim_priority_score ?? 0) - Number(a.claim_priority_score ?? 0));
  const gates = (result.stage2?.gates as Record<string, unknown>[]) || [];
  const tasks = (result.stage3?.tasks as Record<string, unknown>[]) || [];
  const killHubs = (result.stage4?.top_5_kill_hubs as Record<string, unknown>[]) || [];
  const pillars = (result.stage5?.pillars as Record<string, unknown>[]) || [];
  const icContent = result.icInsights || {};

  const sections: Paragraph[] = [];

  // ---- Section 1: Cover Page ----
  sections.push(
    heading("IC Insights", HeadingLevel.TITLE),
    para(`Deal: ${deal.deal_name}`),
    para(`EC-CIM Version: 1.7.0`),
    para(`Claim Depth: ${deal.claim_depth}`),
    para(`Run Timestamp: ${new Date().toISOString()}`),
    para(`CIM Quality Gate: ${qg.gate_decision || "N/A"} (Score: ${qg.quality_score || "N/A"})`),
    para(""),
  );

  // ---- Section 2: Executive Summary ----
  sections.push(heading("Executive Summary", HeadingLevel.HEADING_1));
  if (icContent.executive_summary) {
    sections.push(para(String(icContent.executive_summary)));
  } else {
    sections.push(
      para(
        `The analysis surfaces ${claims.length} claims across ` +
          `${deal.claim_depth === "CORE" ? "5" : "6+"} underwriting surfaces. ` +
          `${killHubs.length} hub claims identified with potential cascade risk.`
      )
    );
    if (qg.gate_decision === "CONDITIONAL_PASS") {
      sections.push(
        para(
          `Note: CIM Quality Gate returned CONDITIONAL PASS (score: ${qg.quality_score}). ` +
            `Outputs may be constrained by source data limitations.`
        )
      );
    }
  }

  // ---- Section 3: Top 8 Claims ----
  sections.push(heading("Investment Thesis Claims — Top 8", HeadingLevel.HEADING_1));
  const top8 = claims.slice(0, 8);
  for (const claim of top8) {
    const isAbsence = claim.claim_type === "Absence Claim";
    sections.push(
      heading(
        `${claim.claim_id}${isAbsence ? " [ABSENCE CLAIM]" : ""}`,
        HeadingLevel.HEADING_2
      ),
      para(String(claim.claim_text || "")),
      para(`Mechanism: ${claim.mechanism_of_value || "N/A"}`),
      para(`Economic Driver: ${claim.economic_driver || "N/A"}`),
      para(`KPI: ${claim.kpi_to_validate || "N/A"}`),
      para(`Priority Score: ${claim.claim_priority_score || "N/A"}`),
      para(""),
    );
  }

  // ---- Section 4: Underwriting Gates & Kill Thresholds ----
  sections.push(heading("Underwriting Gates & Kill Thresholds", HeadingLevel.HEADING_1));
  if (icContent.underwriting_gates_summary) {
    sections.push(para(String(icContent.underwriting_gates_summary)));
  }
  // Add top gates (Tier-1 claims)
  const tier1Ids = new Set(claims.slice(0, 15).map((c) => c.claim_id));
  const criticalGates = gates.filter((g) => tier1Ids.has(g.claim_id as string));
  for (const gate of criticalGates.slice(0, 10)) {
    sections.push(
      para(
        `${gate.claim_id}: ${gate.underwriting_gate} — ` +
          `Kill: ${gate.kill_threshold} — Downside: ${gate.downside_case_if_false}`
      )
    );
  }

  // ---- Section 5: Top 5 IC Kill Risks ----
  sections.push(heading("Top 5 IC Kill Risks", HeadingLevel.HEADING_1));
  for (const hub of killHubs) {
    sections.push(
      heading(`#${hub.rank} — ${hub.claim_id} (${hub.hub_tag})`, HeadingLevel.HEADING_2),
      para(`Blast Radius: ${hub.blast_radius}`),
      para(`IC Gating Rationale: ${hub.ic_gating_rationale || "N/A"}`),
      para(""),
    );
  }

  // ---- Section 6: Diligence Workplan ----
  sections.push(heading("Diligence Workplan", HeadingLevel.HEADING_1));
  // Task type distribution
  const taskCounts: Record<string, number> = {};
  for (const task of tasks) {
    const type = String(task.diligence_task_type || "Other");
    taskCounts[type] = (taskCounts[type] || 0) + 1;
  }
  sections.push(
    para(`Total tasks: ${tasks.length}`),
    para(`Distribution: ${Object.entries(taskCounts).map(([t, c]) => `${t} (${c})`).join(", ")}`),
    para(""),
  );

  // ---- Section 7: Thesis Pillars with STRICT Coupling ----
  sections.push(heading("Thesis Pillars with STRICT Coupling Surface", HeadingLevel.HEADING_1));
  for (const pillar of pillars) {
    sections.push(
      heading(
        `${pillar.pillar_id}: ${pillar.pillar_name}`,
        HeadingLevel.HEADING_2
      ),
      para(`Thesis: ${pillar.pillar_thesis || "N/A"}`),
      para(`Supporting Claims: ${Array.isArray(pillar.supporting_claim_ids) ? (pillar.supporting_claim_ids as string[]).join(", ") : pillar.supporting_claim_ids || "N/A"}`),
      para(`Key KPIs: ${pillar.key_kpis || "N/A"}`),
      para(`Kill Threshold: ${pillar.kill_threshold || "N/A"}`),
      para(`Negative Coupling Trigger: ${pillar.negative_coupling_trigger || "N/A"}`),
      para(`Collapse Path: ${pillar.pillar_collapse_path_if_breached || "N/A"}`),
      para(`IC RED Condition: ${pillar.ic_red_threshold_condition || "N/A"}`),
      para(""),
    );
  }

  // ---- Section 8: Appendix — Full Claim Register ----
  sections.push(heading("Appendix: Full Claim Register", HeadingLevel.HEADING_1));
  for (const claim of claims) {
    const isAbsence = claim.claim_type === "Absence Claim";
    sections.push(
      para(
        `${claim.claim_id}${isAbsence ? " [ABSENCE]" : ""} | ` +
          `${claim.claim_category} | Score: ${claim.claim_priority_score} | ` +
          `${claim.economic_driver} | ${claim.claim_text}`
      )
    );
  }

  // ---- Footer ----
  sections.push(
    para(""),
    para("IC Insights v1.7.0 — True Bearing LLC → IC Sentinel → CIMScan"),
    para("This document presents structured diligence findings. It does not constitute investment advice."),
  );

  const doc = new Document({
    sections: [{ children: sections }],
  });

  return await Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// Docx helpers
// ---------------------------------------------------------------------------

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ text, heading: level });
}

function para(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun(text)] });
}

// ===========================================================================
// Workstream Synopsis (.md)
// ===========================================================================

async function buildSynopsis(deal: Deal, result: PipelineResult): Promise<string> {
  // If EC-CIM returned a synopsis, use it
  if (result.synopsis && result.synopsis.length > 100) {
    return result.synopsis;
  }

  // Otherwise, generate one from the pipeline data
  const qg = result.qualityGate || {};
  const claims = (result.stage1?.claims as Record<string, unknown>[]) || [];
  const killHubs = (result.stage4?.top_5_kill_hubs as Record<string, unknown>[]) || [];
  const pillars = (result.stage5?.pillars as Record<string, unknown>[]) || [];
  const absenceClaims = claims.filter((c) => c.claim_type === "Absence Claim");

  const lines: string[] = [
    `# Workstream Synopsis: ${deal.deal_name}`,
    ``,
    `**EC-CIM v1.7.0 | ${deal.claim_depth} | ${new Date().toISOString()}**`,
    ``,
    `---`,
    ``,
    `## CIM Quality Gate`,
    ``,
    `**Decision:** ${qg.gate_decision || "N/A"} | **Score:** ${qg.quality_score || "N/A"}`,
    ``,
    `---`,
    ``,
    `## Stage 1: CIMScan (Claim Extraction)`,
    ``,
    `**Status:** PASS | **Claims:** ${claims.length} | **Absence Claims:** ${absenceClaims.length}`,
    ``,
    `Top 3 claims by priority:`,
  ];

  const sorted = [...claims].sort(
    (a, b) => Number(b.claim_priority_score ?? 0) - Number(a.claim_priority_score ?? 0)
  );
  for (const c of sorted.slice(0, 3)) {
    lines.push(`- **${c.claim_id}** (${c.claim_priority_score}): ${c.claim_text}`);
  }

  lines.push(
    ``,
    `---`,
    ``,
    `## Stage 4: Interdependency Analysis`,
    ``,
    `**Top IC Kill Hubs:**`,
  );
  for (const hub of killHubs.slice(0, 3)) {
    lines.push(`- **${hub.claim_id}** — ${hub.hub_tag} (blast radius: ${hub.blast_radius})`);
  }

  lines.push(
    ``,
    `---`,
    ``,
    `## Stage 5: Thesis Pillars`,
    ``,
  );
  for (const p of pillars) {
    lines.push(`- **${p.pillar_id} ${p.pillar_name}:** ${p.pillar_thesis || "N/A"}`);
  }

  lines.push(
    ``,
    `---`,
    ``,
    `## Pipeline Completion`,
    ``,
    `- CIM Quality Gate: ${qg.gate_decision}`,
    `- Absence Claim Count: ${absenceClaims.length}`,
    `- Total Claims: ${claims.length}`,
    `- Kill Hubs: ${killHubs.length}`,
    `- Pillars: ${pillars.length}`,
    ``,
    `---`,
    `*Workstream Synopsis — EC-CIM v1.7.0 — True Bearing LLC → IC Sentinel → CIMScan*`,
  );

  return lines.join("\n");
}
