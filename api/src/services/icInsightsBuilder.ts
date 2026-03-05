/**
 * IC Insights Document Builder — v1.7.1
 * True Bearing LLC → IC Sentinel → CIMScan
 *
 * Renders the IC Insights JSON response (6th API call) into a styled .docx buffer.
 *
 * Usage:
 *   import { buildIcInsightsDoc, validateIcInsights } from './icInsightsBuilder';
 *
 *   const validation = validateIcInsights(data);
 *   if (!validation.ok) throw new Error(validation.error);
 *
 *   const buffer = await buildIcInsightsDoc(data);
 *   // upload buffer to Supabase Storage, write to disk, etc.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  PageNumber,
  TabStopType,
  TabStopPosition,
} from "docx";

// ─── Types ───────────────────────────────────────────────────────

export interface IcInsightsData {
  company_name: string;
  ceo: string;
  cfo: string;
  projected_revenue: string;
  projected_gross_profit: string;
  projected_op_ex: string;
  projected_net_income: string;
  adjusted_ebitda: string;
  operational_narrative: string;
  counter_narrative: string;
  existential_threats: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

// ─── Schema ──────────────────────────────────────────────────────

const REQUIRED_KEYS: (keyof IcInsightsData)[] = [
  "company_name",
  "ceo",
  "cfo",
  "projected_revenue",
  "projected_gross_profit",
  "projected_op_ex",
  "projected_net_income",
  "adjusted_ebitda",
  "operational_narrative",
  "counter_narrative",
  "existential_threats",
];

export function validateIcInsights(data: unknown): ValidationResult {
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "Input is not an object" };
  }

  const record = data as Record<string, unknown>;

  const missing = REQUIRED_KEYS.filter((k) => !(k in record));
  if (missing.length > 0) {
    return { ok: false, error: `Missing required keys: ${missing.join(", ")}` };
  }

  const nonString = REQUIRED_KEYS.filter((k) => typeof record[k] !== "string");
  if (nonString.length > 0) {
    return { ok: false, error: `Non-string values: ${nonString.join(", ")}` };
  }

  const empty = REQUIRED_KEYS.filter((k) => (record[k] as string).trim().length === 0);
  if (empty.length > 0) {
    return { ok: false, error: `Empty values: ${empty.join(", ")}` };
  }

  return { ok: true };
}

// ─── Color Palette ───────────────────────────────────────────────

const NAVY      = "1B2A4A";
const GOLD      = "C4933F";
const DARK_GRAY = "333333";
const MED_GRAY  = "666666";
const LIGHT_BG  = "F5F6F8";
const TABLE_HDR = "E8EAF0";
const WHITE     = "FFFFFF";
const RULE_LINE = "D0D3DA";

// ─── Layout ──────────────────────────────────────────────────────

const PAGE_W    = 12240;
const PAGE_H    = 15840;
const MARGIN    = 1440;
const CONTENT_W = PAGE_W - 2 * MARGIN;

// ─── Border helpers ──────────────────────────────────────────────

const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: RULE_LINE };
const thinBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const cellPad = { top: 80, bottom: 80, left: 120, right: 120 };

// ─── Reusable builders ──────────────────────────────────────────

function rule(color = RULE_LINE, size = 4, spaceBefore = 120, spaceAfter = 200): Paragraph {
  return new Paragraph({
    spacing: { before: spaceBefore, after: spaceAfter },
    border: { bottom: { style: BorderStyle.SINGLE, size, color, space: 1 } },
    children: [],
  });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 360, after: 160 },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        font: "Arial",
        size: 22,
        color: NAVY,
        characterSpacing: 60,
      }),
    ],
  });
}

function bodyPara(text: string, spacingAfter = 200): Paragraph {
  return new Paragraph({
    spacing: { after: spacingAfter, line: 276 },
    children: [
      new TextRun({
        text,
        font: "Arial",
        size: 20,
        color: DARK_GRAY,
      }),
    ],
  });
}

function infoTable(rows: [string, string][], col1Width = 3200): Table {
  const col2Width = CONTENT_W - col1Width;
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [col1Width, col2Width],
    rows: rows.map(([label, value], i) => {
      const isHeader = i === 0;
      const bg = isHeader ? TABLE_HDR : i % 2 === 0 ? LIGHT_BG : WHITE;
      return new TableRow({
        children: [
          new TableCell({
            width: { size: col1Width, type: WidthType.DXA },
            borders: thinBorders,
            shading: { fill: bg, type: ShadingType.CLEAR },
            margins: cellPad,
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: label,
                    bold: isHeader,
                    font: "Arial",
                    size: isHeader ? 18 : 20,
                    color: isHeader ? NAVY : MED_GRAY,
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: col2Width, type: WidthType.DXA },
            borders: thinBorders,
            shading: { fill: bg, type: ShadingType.CLEAR },
            margins: cellPad,
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: value,
                    bold: isHeader,
                    font: "Arial",
                    size: isHeader ? 18 : 20,
                    color: isHeader ? NAVY : DARK_GRAY,
                  }),
                ],
              }),
            ],
          }),
        ],
      });
    }),
  });
}

function parseExistentialThreats(raw: string): Paragraph[] {
  const sections = raw.split(/\n\n(?=\d\.)/).filter(Boolean);
  const elements: Paragraph[] = [];

  for (const section of sections) {
    const lines = section.trim().split("\n\n");
    const titleLine = lines[0];
    const bodyLines = lines.slice(1);

    const titleMatch = titleLine.match(/^(\d)\.\s+(.+?)(\s*\(Blast Radius:\s*\d+\))?$/);
    const num = titleMatch ? titleMatch[1] : "?";
    const title = titleMatch ? titleMatch[2].trim() : titleLine;
    const blastTag = titleMatch?.[3]?.trim() ?? "";

    elements.push(
      new Paragraph({
        spacing: { before: 280, after: 120 },
        children: [
          new TextRun({ text: `${num}.  `, font: "Arial", size: 22, bold: true, color: GOLD }),
          new TextRun({ text: title, font: "Arial", size: 22, bold: true, color: NAVY }),
          ...(blastTag
            ? [new TextRun({ text: `  ${blastTag}`, font: "Arial", size: 18, color: MED_GRAY, italics: true })]
            : []),
        ],
      })
    );

    for (const p of bodyLines) {
      elements.push(bodyPara(p));
    }
  }

  return elements;
}

// ─── Document builder ────────────────────────────────────────────

function buildDocument(data: IcInsightsData): Document {
  return new Document({
    styles: {
      default: {
        document: { run: { font: "Arial", size: 20, color: DARK_GRAY } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                spacing: { after: 0 },
                children: [
                  new TextRun({ text: "IC INSIGHTS", font: "Arial", size: 16, color: MED_GRAY, characterSpacing: 80 }),
                  new TextRun({ text: "\tCIMScan", font: "Arial", size: 16, color: MED_GRAY }),
                ],
                tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
                border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE_LINE, space: 4 } },
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                border: { top: { style: BorderStyle.SINGLE, size: 2, color: RULE_LINE, space: 4 } },
                children: [
                  new TextRun({ text: "Confidential \u2014 Not Investment Advice", font: "Arial", size: 14, color: MED_GRAY }),
                  new TextRun({ children: ["\tPage ", PageNumber.CURRENT], font: "Arial", size: 14, color: MED_GRAY }),
                ],
                tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              }),
            ],
          }),
        },
        children: [
          // Title block
          new Paragraph({ spacing: { before: 600, after: 0 }, children: [] }),
          rule(GOLD, 12, 0, 200),

          new Paragraph({
            spacing: { before: 240, after: 80 },
            children: [
              new TextRun({ text: data.company_name, font: "Arial", size: 52, bold: true, color: NAVY }),
            ],
          }),

          new Paragraph({
            spacing: { after: 360 },
            children: [
              new TextRun({ text: "IC Insights \u2014 Diligence Briefing", font: "Arial", size: 24, color: MED_GRAY, italics: true }),
            ],
          }),

          rule(RULE_LINE, 2, 0, 360),

          // Management
          sectionHeading("Management"),
          infoTable([
            ["Role", "Name"],
            ["Chief Executive Officer", data.ceo],
            ["Chief Financial Officer", data.cfo],
          ]),
          new Paragraph({ spacing: { after: 120 }, children: [] }),

          // Financial Stats
          sectionHeading("Financial Stats \u2014 Current Year (Projected)"),
          infoTable([
            ["Metric", "Value"],
            ["Revenue", data.projected_revenue],
            ["Gross Profit", data.projected_gross_profit],
            ["Operating Expense", data.projected_op_ex],
            ["Net Income", data.projected_net_income],
            ["Adjusted EBITDA", data.adjusted_ebitda],
          ]),
          new Paragraph({ spacing: { after: 120 }, children: [] }),

          // Operational Narrative
          rule(GOLD, 6, 360, 80),
          sectionHeading("Operational Narrative"),
          ...data.operational_narrative.split("\n\n").filter(Boolean).map((p) => bodyPara(p)),

          // What Breaks the Narrative
          rule(GOLD, 6, 360, 80),
          sectionHeading("What Breaks the Narrative"),
          ...data.counter_narrative.split("\n\n").filter(Boolean).map((p) => bodyPara(p)),

          // Existential Threats
          rule(GOLD, 6, 360, 80),
          sectionHeading("Existential Threats"),
          new Paragraph({
            spacing: { after: 160 },
            children: [
              new TextRun({
                text: "From Operational Claims \u2014 External Market Context Applied",
                font: "Arial", size: 18, italics: true, color: MED_GRAY,
              }),
            ],
          }),
          ...parseExistentialThreats(data.existential_threats),

          // Closing
          rule(NAVY, 4, 480, 120),
          new Paragraph({
            spacing: { after: 0 },
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "End of IC Insights", font: "Arial", size: 16, color: MED_GRAY, italics: true }),
            ],
          }),
        ],
      },
    ],
  });
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Builds a styled IC Insights .docx and returns the file as a Buffer.
 *
 * Validates the input first — throws if validation fails.
 *
 * @param data - The IC Insights JSON from the 6th API call.
 * @returns Buffer containing the .docx file bytes.
 */
export async function buildIcInsightsDoc(data: IcInsightsData): Promise<Buffer> {
  const v = validateIcInsights(data);
  if (!v.ok) {
    throw new Error(`IC Insights schema validation failed: ${v.error}`);
  }

  const doc = buildDocument(data);
  return await Packer.toBuffer(doc) as Buffer;
}

/**
 * Derives a safe filename from the company name.
 *
 * @param companyName - The company_name from IC Insights data.
 * @returns Filename string like "IC_Insights_Project_Nighthawk.docx"
 */
export function icInsightsFilename(companyName: string): string {
  const safe = companyName.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
  return `IC_Insights_${safe}.docx`;
}
