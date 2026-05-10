import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { del } from '@vercel/blob';

export const config = {
  api: {
    responseLimit: '50mb',
  },
};

const client = new Anthropic();

const SYSTEM_PROMPT = `You are Verifi, a financial model verification engine built by a CFA-qualified real estate investment professional with 15+ years experience reviewing residential development, commercial RE, industrial, BTR, PBSA, debt, and fund of funds models.

You are an expert property modeler who deeply understands:
- Three-way financial model logic (P&L → Balance Sheet → Cash Flow)
- Property valuation: Income Capitalisation, DCF, Residual Land Value
- Yield concepts: Passing/Initial Yield, Reversionary Yield, Equivalent Yield, Market Yield
- Gordon Growth Model: Unlev IRR ≈ Net Income Yield + g (when cap rate flat)
- Capital return drivers: rental growth (g) and cap rate movement (ΔCR)
- Development vs core hold vs BTR vs PBSA model structures
- Debt structures: construction loan, term facility, refi, capex facility
- Fund-level mechanics: waterfall, promote, management fees, tax

UNIVERSAL PROPERTY MODEL CHAIN (applies to all model types):
Gross Revenue → Net Operating Income (NOI) → AFFO/Distributable Income → Net Levered CF (gross) → Net Levered CF (post tax) → Net Levered CF (post fees) → Equity IRR

MODEL TYPES TO IDENTIFY:
- Core Hold: stable income, key metrics = passing/reversionary/equivalent yield, WALE, ICR, LVR
- Dev → Sell (Turnkey): sales revenue driven, key = $/sqm vs market, construction cost, presales coverage
- Dev → Hold → Sell: three phases, PC uplift = TPC to GDV jump, combined IRR has dev + stab components
- BTR: beds × room rate × occupancy, lease-up curve critical, operator fee structure
- PBSA: bed-based income, seasonal, YoC stabilised key benchmark
- Fund/Portfolio: asset-level CFs aggregated, add management fee + fund costs + tax + promote layers

KEY VERIFICATION RULES:

LAYER 1 - STRUCTURAL (FAIL if violated):
S-01: No merged cells in calculation areas
S-02: No formula errors (#REF!, #DIV/0!, #NAME?, #VALUE!) — especially dangerous when wrapped in IFERROR
S-03: No circular references
S-04: No hardcoded values in calculation cells
S-05: Inputs separated from calculations
S-06: Model has version/date metadata
S-07: Toggles centralised, not scattered
S-08: No orphaned inputs (inputs with no dependents)

LAYER 2 - ACCOUNTING (FAIL if violated):
A-01: Cash flow roll-forward closes each period: Opening + movements = Closing
A-02: Total debt drawdowns = total repayments at end of hold
A-03: Sources = Uses
A-04: Interest expense in cash flow (not just accrued)
A-05: Capitalised interest included in debt repayment
A-06: Levered CF = Unlevered CF + debt schedule each period
A-07: Fee leakages (mgmt fee, perf fee) as cash outflows
A-08: Actual → forecast transition: no unexplained jump at cutover
A-09: Distributions ≤ Distributable Income each period

LAYER 3 - ECONOMIC (WARN if outside range):
E-01: Revenue/salable area = implied $/sqm — check vs sector benchmark
E-02: Development margin within sector range (residential 15-25%, commercial 8-15%)
E-03: Positive leverage: cost of debt < unlev IRR → levered IRR higher
E-04: Leverage uplift ≈ (Unlev IRR - Kd) × D/E ratio
E-05: Yield on Cost vs Cap Rate spread (positive = development creates value)
E-06: Exit cap rate assumption vs entry cap rate — flag if compression > 50bps without justification
E-07: Unlev IRR ≈ Net Income Yield + rental growth (for stabilised hold assets, cap rate flat)
E-08: ICR > 1.5x throughout hold period
E-09: LVR within covenant levels (core ≤ 65%, development ≤ 75%)
E-10: E-IRR / Unlev IRR ratio < 2.5x (excessive leverage flag)
E-11: WALE vs cap rate consistency (short WALE should have higher cap rate)
E-12: Equivalent yield between passing yield and reversionary yield

IMPACT ON IRR — assess each finding:
HIGH: directly affects IRR or materially misstates costs/revenue
MEDIUM: affects supporting calculations or covenant checks
LOW: structural/presentation issue

Return ONLY valid JSON:
{
  "modelName": "string",
  "modelType": "Core Hold | Dev-Sell | Dev-Hold-Sell | BTR | PBSA | Fund | Mixed",
  "sector": "string",
  "verdict": "FAIL | WARN | PASS",
  "summary": { "fail": 0, "warn": 0, "pass": 0, "total": 0 },
  "findings": [
    {
      "id": "S-02",
      "layer": 1,
      "status": "FAIL | WARN | PASS",
      "title": "string",
      "impact": "HIGH | MEDIUM | LOW | NONE",
      "description": "string",
      "irrImpact": "string or null",
      "cells": [{ "ref": "Sheet!Cell", "note": "string", "value": "string" }],
      "fix": "string"
    }
  ],
  "priorities": [{ "rank": 1, "id": "S-02", "action": "string" }],
  "keyMetrics": {
    "unleveredIRR": "string or null",
    "leveredIRR": "string or null",
    "devMargin": "string or null",
    "yieldOnCost": "string or null",
    "capRate": "string or null",
    "ltc": "string or null",
    "holdPeriod": "string or null"
  },
  "scope": "This report checks structural and mathematical integrity. It does not validate whether assumptions reflect current market conditions. A clean Verifi report is necessary but not sufficient for a reliable model."
}`;

function extractModelData(buffer) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellFormula: true,
    cellNF: false,
    sheetStubs: false,
  });

  const result = {
    sheetNames: workbook.SheetNames,
    totalSheets: workbook.SheetNames.length,
    sheets: {},
    globalStats: {
      totalRefErrors: 0,
      totalHardcodes: 0,
      sheetsWithErrors: [],
    }
  };

  const priorityKeywords = [
    'summary', 'output', 'cashflow', 'cash flow', 'cf', 'irr', 'return',
    'input', 'assumption', 'debt', 'finance', 'financing', 's&u', 'sources',
    'portfolio', 'venture', 'stage', 'dashboard', 'model', 'promote'
  ];

  const sheetsToAnalyse = workbook.SheetNames.filter(name => {
    const lower = name.toLowerCase();
    return priorityKeywords.some(k => lower.includes(k));
  }).slice(0, 10);

  const finalSheets = sheetsToAnalyse.length > 0
    ? sheetsToAnalyse
    : workbook.SheetNames.slice(0, 8);

  for (const name of finalSheets) {
    const ws = workbook.Sheets[name];
    if (!ws || !ws['!ref']) continue;

    const data = {
      refErrors: [],
      hardcodes: [],
      keyRows: {},
      formulaCount: 0,
      valueCount: 0,
    };

    const range = XLSX.utils.decode_range(ws['!ref']);
    const maxRow = Math.min(range.e.r, 199);
    const maxCol = Math.min(range.e.c, 59);

    for (let r = 0; r <= maxRow; r++) {
      for (let c = 0; c <= maxCol; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) continue;

        if (cell.f) {
          data.formulaCount++;
          if (cell.f.includes('#REF!')) {
            data.refErrors.push({
              ref: `${name}!${addr}`,
              formula: cell.f.substring(0, 80),
              iferrorWrapped: cell.f.includes('IFERROR')
            });
          }
        } else if (cell.v !== undefined && cell.v !== null && cell.v !== '') {
          data.valueCount++;
          if (typeof cell.v === 'number' && Math.abs(cell.v) > 5000) {
            data.hardcodes.push({
              ref: `${name}!${addr}`,
              value: Math.round(cell.v)
            });
          }
        }

        if (r < 25 && c < 12) {
          if (cell.v !== undefined && cell.v !== null) {
            data.keyRows[addr] = typeof cell.v === 'number'
              ? Math.round(cell.v * 100) / 100
              : String(cell.v).substring(0, 50);
          }
        }
      }
    }

    result.sheets[name] = {
      refErrorCount: data.refErrors.length,
      refErrorSamples: data.refErrors.slice(0, 6),
      hardcodeSamples: data.hardcodes.slice(0, 8),
      formulaCount: data.formulaCount,
      valueCount: data.valueCount,
      keyRows: data.keyRows,
    };

    result.globalStats.totalRefErrors += data.refErrors.length;
    result.globalStats.totalHardcodes += data.hardcodes.length;
    if (data.refErrors.length > 0) {
      result.globalStats.sheetsWithErrors.push(name);
    }
  }

  return result;
}

function generateReportHtml(report) {
  const now = new Date().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const statusColor = { FAIL: '#b83224', WARN: '#7a5200', PASS: '#1a6b3c' };
  const statusBg = { FAIL: '#fdf0ee', WARN: '#fdf6e3', PASS: '#edf5f0' };

  const findingHtml = (f) => {
    const cellsHtml = f.cells && f.cells.length > 0
      ? `<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px">
          ${f.cells.slice(0, 5).map(c => `
          <div style="display:flex;gap:10px;padding:5px 10px;background:#f5f4ef;border-radius:6px;font-size:12px">
            <span style="font-family:monospace;color:#7a5200;min-width:80px;flex-shrink:0">${c.ref}</span>
            <span style="color:#5a5a56">${c.note}</span>
            ${c.value ? `<span style="font-family:monospace;font-size:11px;color:#9a9990;margin-left:auto">${c.value}</span>` : ''}
          </div>`).join('')}
        </div>` : '';

    const impactHtml = f.irrImpact && f.status !== 'PASS'
      ? `<div style="background:${statusBg[f.status]};border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:${statusColor[f.status]};line-height:1.6">
          <strong>IRR impact:</strong> ${f.irrImpact}
        </div>` : '';

    return `
    <div style="background:white;border:1px solid #dddcd4;border-radius:12px;overflow:hidden;margin-bottom:10px">
      <div style="background:${statusBg[f.status]};padding:10px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #dddcd4">
        <span style="font-family:monospace;font-size:10px;font-weight:500;color:${statusColor[f.status]}">${f.status}</span>
        <span style="font-size:13px;font-weight:500;flex:1">${f.id} · ${f.title}</span>
        ${f.impact !== 'NONE' ? `<span style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid #dddcd4;color:#5a5a56;background:white">${f.impact} impact</span>` : ''}
      </div>
      <div style="padding:14px 16px">
        <p style="font-size:13px;color:#5a5a56;line-height:1.7;margin-bottom:10px">${f.description}</p>
        ${impactHtml}
        ${cellsHtml}
        ${f.fix ? `<p style="font-size:12px;font-weight:500;color:#0e0e0c;margin-bottom:4px">How to fix</p>
        <p style="font-size:12px;color:#5a5a56;line-height:1.65">${f.fix}</p>` : ''}
      </div>
    </div>`;
  };

  const metricsHtml = report.keyMetrics
    ? Object.entries(report.keyMetrics)
        .filter(([, v]) => v && v !== 'null')
        .map(([k, v]) => {
          const labels = {
            unleveredIRR: 'Unlev IRR',
            leveredIRR: 'E-IRR',
            devMargin: 'Dev Margin',
            yieldOnCost: 'Yield on Cost',
            capRate: 'Cap Rate',
            ltc: 'LTC',
            holdPeriod: 'Hold Period'
          };
          return `<div style="background:#f5f4ef;border-radius:8px;padding:10px 12px;text-align:center">
            <div style="font-size:11px;color:#9a9990;margin-bottom:3px">${labels[k] || k}</div>
            <div style="font-size:15px;font-weight:500">${v}</div>
          </div>`;
        }).join('')
    : '';

  const prioritiesHtml = (report.priorities || []).map(p => {
    const f = (report.findings || []).find(x => x.id === p.id);
    const color = f?.status === 'FAIL' ? '#b83224' : '#7a5200';
    return `<div style="display:flex;gap:10px;align-items:flex-start;font-size:12px">
      <span style="font-family:monospace;font-weight:500;color:${color};min-width:16px">${p.rank}</span>
      <span style="color:#5a5a56;line-height:1.6">${p.action}</span>
    </div>`;
  }).join('');

  const verdictColor = statusColor[report.verdict] || '#0e0e0c';
  const failFindings = (report.findings || []).filter(f => f.status !== 'PASS');
  const passFindings = (report.findings || []).filter(f => f.status === 'PASS');

  return `
    <div style="margin-bottom:28px">
      <p style="font-size:12px;color:#9a9990;margin-bottom:4px">Verifi Audit Report · ${now}</p>
      <h1 style="font-size:20px;font-weight:400;margin-bottom:4px">${report.modelName || 'Financial Model'}</h1>
      <p style="font-size:13px;color:#5a5a56">${report.sector || ''} · ${report.modelType || ''} · Verdict: <strong style="color:${verdictColor}">${report.verdict}</strong></p>
    </div>

    ${metricsHtml ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin-bottom:24px">${metricsHtml}</div>` : ''}

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:24px">
      <div style="background:#f5f4ef;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#9a9990;margin-bottom:3px">checks run</div>
        <div style="font-size:20px;font-weight:500">${report.summary?.total || 0}</div>
      </div>
      <div style="background:#fdf0ee;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#b83224;margin-bottom:3px">failed</div>
        <div style="font-size:20px;font-weight:500;color:#b83224">${report.summary?.fail || 0}</div>
      </div>
      <div style="background:#fdf6e3;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#7a5200;margin-bottom:3px">warnings</div>
        <div style="font-size:20px;font-weight:500;color:#7a5200">${report.summary?.warn || 0}</div>
      </div>
      <div style="background:#edf5f0;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#1a6b3c;margin-bottom:3px">passed</div>
        <div style="font-size:20px;font-weight:500;color:#1a6b3c">${report.summary?.pass || 0}</div>
      </div>
    </div>

    ${prioritiesHtml ? `<div style="background:white;border:1px solid #dddcd4;border-radius:12px;padding:18px 20px;margin-bottom:20px">
      <p style="font-size:12px;font-weight:500;margin-bottom:12px">Priority action list</p>
      <div style="display:flex;flex-direction:column;gap:8px">${prioritiesHtml}</div>
    </div>` : ''}

    ${failFindings.map(findingHtml).join('')}
    ${passFindings.map(findingHtml).join('')}

    <div style="background:white;border:1px solid #dddcd4;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">
      <p style="font-size:13px;color:#5a5a56;margin-bottom:14px">Found something we missed? Your feedback improves Verifi.</p>
      <a href="mailto:hello@verifi.com.au?subject=Verifi Feedback" style="display:inline-block;padding:8px 20px;border:1px solid #dddcd4;border-radius:8px;font-size:13px;color:#0e0e0c;text-decoration:none">Send feedback</a>
    </div>

    <p style="font-size:11px;color:#9a9990;line-height:1.7;font-style:italic;border-top:1px solid #dddcd4;padding-top:16px">${report.scope}</p>
  `;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { blobUrl } = req.body || {};
  if (!blobUrl) {
    return res.status(400).json({ error: 'No blobUrl provided' });
  }

  try {
    const blobRes = await fetch(blobUrl);
    if (!blobRes.ok) throw new Error(`Blob fetch failed: ${blobRes.status}`);
    const buffer = Buffer.from(await blobRes.arrayBuffer());

    const modelData = extractModelData(buffer);

    const compactSummary = {
      sheetNames: modelData.sheetNames,
      totalSheets: modelData.totalSheets,
      globalStats: modelData.globalStats,
      sheets: {}
    };

    for (const [name, data] of Object.entries(modelData.sheets)) {
      compactSummary.sheets[name] = {
        refErrorCount: data.refErrorCount,
        refErrorSamples: data.refErrorSamples.slice(0, 4),
        hardcodeSamples: data.hardcodeSamples.slice(0, 5),
        formulaCount: data.formulaCount,
        keyRows: data.keyRows,
      };
    }

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Please audit this real estate financial model and return the JSON report.

Model structure extracted from Excel:
${JSON.stringify(compactSummary, null, 2)}`
      }]
    });

    // Delete blob immediately after extraction
    await del(blobUrl);

    const text = message.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');

    const report = JSON.parse(jsonMatch[0]);
    const reportHtml = generateReportHtml(report);

    res.status(200).json({ reportHtml });

  } catch (err) {
    try { await del(blobUrl); } catch {}
    console.error('Verifi analyze error:', err);
    res.status(500).json({ error: 'Analysis failed', detail: err.message });
  }
}
