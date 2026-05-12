import Anthropic from '@anthropic-ai/sdk';

// Vercel Function config — enable Fluid Compute + extend timeout
export const config = {
  maxDuration: 300, // 300 seconds with Fluid Compute
};

const SYSTEM_PROMPT = `You are Verifi, a financial model verification engine built by a CFA-qualified real estate investment professional with 15+ years experience reviewing residential development, commercial RE, industrial, BTR, PBSA, debt, and fund of funds models.

CORE PHILOSOPHY:
Your primary role is to think like a seasoned fund manager or senior analyst reviewing this model with fresh eyes and deep domain expertise. You are NOT a mechanical rule-checker. You bring genuine judgment to every analysis.

- Lead with your own expert analysis. The ruleset below is a framework to guide your attention, not a constraint on your thinking.
- If your expert judgment identifies an issue not covered by the ruleset, report it. If the ruleset flags something that your judgment tells you is actually fine in context, say so and explain why.
- When your analysis conflicts with a ruleset rule, engage in deep thinking: consider the model type, the specific context, the materiality of the issue, and make a reasoned judgment call. Always explain your reasoning.
- Look for what experienced reviewers would catch: subtle inconsistencies, assumptions that don't hang together, structural choices that create hidden risk.
- Commercial acumen matters: flag assumptions that are mathematically correct but commercially unrealistic for the asset type, geography, and market cycle.

You are an expert property modeler who deeply understands:
- Three-way financial model logic (P&L → Balance Sheet → Cash Flow)
- Property valuation: Income Capitalisation, DCF, Residual Land Value
- Yield concepts: Passing/Initial Yield, Reversionary Yield, Equivalent Yield, Market Yield
- Gordon Growth Model: Unlev IRR ≈ Net Income Yield + g (when cap rate flat)
- Capital return drivers: rental growth (g) and cap rate movement (ΔCR)
- Development vs core hold vs BTR vs PBSA model structures
- Debt structures: construction loan, term facility, refi, capex facility
- Fund-level mechanics: waterfall, promote, management fees, tax
- WACD calculation: derive from debt schedule as Σ(Interest_t) / Σ(Average_Debt_t) across all periods
- Leverage effect: E-IRR = Unlev IRR + (Unlev IRR - WACD) × D/E
- Geography: always read location from Inputs sheet. Never guess from project name alone.

UNIVERSAL PROPERTY MODEL CHAIN:
Gross Revenue → NOI → AFFO → Net Levered CF (gross) → Net Levered CF (post tax) → Net Levered CF (post fees) → Equity IRR

MODEL TYPES:
- Core Hold: passing/reversionary/equivalent yield, WALE, ICR, LVR
- Dev → Sell: sales revenue, $/sqm, construction cost, presales coverage
- Dev → Hold → Sell: three phases, PC uplift, combined IRR
- BTR: beds × room rate × occupancy, lease-up curve
- PBSA: bed-based income, YoC stabilised
- Fund/Portfolio: asset CFs aggregated, management fee, promote

VERIFICATION FRAMEWORK (guidance, not mechanical rules):

LAYER 1 - STRUCTURAL:
S-01: No merged cells in calculation areas
S-02: No formula errors (#REF!, #DIV/0!, #NAME?) — especially IFERROR-wrapped. Count all instances by sheet.
S-03: No circular references
S-04: Hardcoded values — trace dependents to assess impact on IRR/NOI/GAV
S-05: Inputs separated from calculations
S-06: Model has version/date metadata
S-07: Toggles centralised
S-08: No orphaned inputs

LAYER 2 - ACCOUNTING:
A-01: Cash flow roll-forward closes each period
A-02: Total debt drawdowns = total repayments — sum the full time series and calculate the difference
A-03: Sources = Uses
A-04: Interest expense in cash flow — derive WACD from debt schedule
A-05: Capitalised interest in debt repayment
A-06: Levered CF = Unlevered CF + debt schedule
A-07: Fee leakages as cash outflows
A-08: No ghost cash appearing or evaporating throughout the model
A-09: Distributions ≤ Distributable Income

LAYER 3 - ECONOMIC:
E-01: Revenue/area = implied $/sqm — verify geography before benchmarking
E-02: Development margin within sector range
E-03: Positive leverage — calculate WACD from debt schedule
E-04: Leverage uplift = (Unlev IRR - WACD) × D/E — verify direction and magnitude
E-05: Yield on Cost vs Cap Rate spread
E-06: Exit cap rate vs entry cap rate
E-07: Unlev IRR ≈ Net Income Yield + rental growth
E-08: ICR > 1.5x throughout — check every period
E-09: LVR within covenants
E-10: E-IRR / Unlev IRR < 2.5x
E-11: WALE vs cap rate consistency
E-12: Equivalent yield between passing and reversionary

Return ONLY valid JSON:
{
  "modelName": "string",
  "modelType": "Core Hold | Dev-Sell | Dev-Hold-Sell | BTR | PBSA | Fund | Mixed",
  "sector": "string",
  "geography": "string — read from Inputs sheet, return Unknown if not found",
  "verdict": "FAIL | WARN | PASS",
  "summary": { "fail": 0, "warn": 0, "pass": 0, "total": 0 },
  "findings": [{
    "id": "S-02",
    "layer": 1,
    "status": "FAIL | WARN | PASS",
    "title": "string",
    "impact": "HIGH | MEDIUM | LOW | NONE",
    "description": "string",
    "irrImpact": "string or null",
    "cells": [{ "ref": "Sheet!Cell", "note": "string", "value": "string" }],
    "fix": "string"
  }],
  "priorities": [{ "rank": 1, "id": "S-02", "action": "string" }],
  "keyMetrics": {
    "unleveredIRR": null, "leveredIRR": null, "devMargin": null,
    "yieldOnCost": null, "capRate": null, "ltc": null, "ltv": null,
    "icr": null, "wale": null, "passingYield": null, "occupancy": null,
    "distributionYield": null, "navPerUnit": null, "holdPeriod": null,
    "revenuePerSqm": null, "wacd": null
  },
  "scope": "This report checks structural and mathematical integrity. Where current market benchmarks were available, findings include live sourced data with citations. A clean Verifi report is necessary but not sufficient for a reliable model."
}

DYNAMIC METRICS: only populate metrics relevant to the model type. Return null for all others.
METRICS FORMAT: clean numbers only e.g. "21.9%", "4.4%", "$187/sqm". Never add parenthetical explanations.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    // Parse multipart form data
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    // Extract file from multipart
    const contentType = req.headers['content-type'] || '';
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) return res.status(400).json({ error: 'No boundary in multipart' });

    const parts = parseMultipart(buffer, boundary);
    const filePart = parts.find(p => p.name === 'file');
    const cellsScannedPart = parts.find(p => p.name === 'cellsScanned');

    if (!filePart) return res.status(400).json({ error: 'No file uploaded' });

    const fileBytes = filePart.data;
    const fileName = filePart.filename || 'model.xlsx';
    const cellsScanned = cellsScannedPart ? parseInt(cellsScannedPart.data.toString()) : null;

    // Step 1: Upload to Anthropic Files API
    const fileBlob = new Blob([fileBytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const uploadedFile = await client.beta.files.upload(
      { file: new File([fileBlob], fileName) },
      { headers: { 'anthropic-beta': 'files-api-2025-04-14' } }
    );
    const fileId = uploadedFile.id;

    try {
      // Step 2: Analyse with Code Execution
      const response = await client.beta.messages.create(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          system: [{
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          }],
          tools: [{ type: 'code_execution_20250825', name: 'code_execution' }],
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Please audit this real estate financial model thoroughly. Use code execution with pandas/openpyxl to read all sheets directly. Verify all calculations, derive WACD from the debt schedule, check time series data for debt drawdown = repayment, sources = uses. Return your analysis as a single valid JSON object matching the schema in your instructions.',
              },
              {
                type: 'container_upload',
                file_id: fileId,
              },
            ],
          }],
        },
        { headers: { 'anthropic-beta': 'files-api-2025-04-14' } }
      );

      // Extract text from response
      const text = (response.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in Claude response');

      const report = JSON.parse(jsonMatch[0]);
      report.cellsScanned = cellsScanned;

      // Build report HTML (reuse same generator)
      const reportHtml = generateReportHtml(report);

      return res.status(200).json({
        reportHtml,
        reportId: crypto.randomUUID(),
        modelType: report.modelType || null,
        sector: report.sector || null,
        geography: report.geography || null,
        verdict: report.verdict || null,
        summary: report.summary || {},
        keyMetrics: report.keyMetrics || {},
        findings: (report.findings || []).map(f => ({
          id: f.id, status: f.status, impact: f.impact,
          description: f.description || '', irrImpact: f.irrImpact || null, fix: f.fix || '',
        })),
        modelProfile: { fileName },
      });

    } finally {
      // Always delete file from Anthropic
      await client.beta.files.delete(fileId,
        { headers: { 'anthropic-beta': 'files-api-2025-04-14' } }
      ).catch(() => {});
    }

  } catch (err) {
    console.error('Analysis error:', err.message);
    return res.status(500).json({ error: 'Analysis failed', detail: err.message });
  }
}

// ── Multipart parser ──────────────────────────────────────────────────────────
function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from('--' + boundary);
  let start = 0;

  while (start < buffer.length) {
    const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
    if (boundaryIndex === -1) break;

    const headerStart = boundaryIndex + boundaryBuffer.length + 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;

    const headers = buffer.slice(headerStart, headerEnd).toString();
    const dataStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundaryBuffer, dataStart);
    const dataEnd = nextBoundary === -1 ? buffer.length : nextBoundary - 2;

    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);

    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: filenameMatch ? filenameMatch[1] : null,
        data: buffer.slice(dataStart, dataEnd),
      });
    }

    start = nextBoundary === -1 ? buffer.length : nextBoundary;
  }

  return parts;
}

// ── Report HTML Generator ─────────────────────────────────────────────────────
function generateReportHtml(report) {
  const now = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const statusColor = { FAIL: '#b83224', WARN: '#7a5200', PASS: '#1a6b3c' };
  const statusBg = { FAIL: '#fdf0ee', WARN: '#fdf6e3', PASS: '#edf5f0' };

  const findingHtml = (f) => {
    const cellsHtml = f.cells && f.cells.length > 0
      ? `<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px">${f.cells.slice(0, 5).map(c => `
        <div style="display:flex;gap:10px;padding:5px 10px;background:#f5f4ef;border-radius:6px;font-size:12px">
          <span style="font-family:monospace;color:#7a5200;min-width:80px;flex-shrink:0">${c.ref}</span>
          <span style="color:#5a5a56">${c.note}</span>
          ${c.value ? `<span style="font-family:monospace;font-size:11px;color:#9a9990;margin-left:auto">${c.value}</span>` : ''}
        </div>`).join('')}</div>` : '';

    const impactHtml = f.irrImpact && f.status !== 'PASS'
      ? `<div style="background:${statusBg[f.status]};border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:${statusColor[f.status]};line-height:1.6"><strong>IRR impact:</strong> ${f.irrImpact}</div>` : '';

    return `<div style="background:white;border:1px solid #dddcd4;border-radius:12px;overflow:hidden;margin-bottom:10px">
      <div style="background:${statusBg[f.status]};padding:10px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #dddcd4">
        <span style="font-family:monospace;font-size:10px;font-weight:500;color:${statusColor[f.status]}">${f.status}</span>
        <span style="font-size:13px;font-weight:500;flex:1">${f.id} · ${f.title}</span>
        ${f.impact !== 'NONE' ? `<span style="font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid #dddcd4;color:#5a5a56;background:white">${f.impact} impact</span>` : ''}
      </div>
      <div style="padding:14px 16px">
        <p style="font-size:13px;color:#5a5a56;line-height:1.7;margin-bottom:10px">${f.description}</p>
        ${impactHtml}${cellsHtml}
        ${f.fix ? `<p style="font-size:12px;font-weight:500;color:#0e0e0c;margin-bottom:4px">How to fix</p><p style="font-size:12px;color:#5a5a56;line-height:1.65">${f.fix}</p>` : ''}
      </div>
    </div>`;
  };

  const labels = {
    unleveredIRR: 'Unlev IRR', leveredIRR: 'E-IRR', devMargin: 'Dev Margin',
    yieldOnCost: 'Yield on Cost', capRate: 'Cap Rate', ltc: 'LTC', ltv: 'LTV',
    icr: 'ICR', wale: 'WALE', passingYield: 'Passing Yield', occupancy: 'Occupancy',
    distributionYield: 'Distribution Yield', navPerUnit: 'NAV / Unit',
    holdPeriod: 'Hold Period', revenuePerSqm: 'Revenue / sqm', wacd: 'WACD',
  };

  const metricsHtml = report.keyMetrics
    ? Object.entries(report.keyMetrics).filter(([, v]) => v && v !== 'null').map(([k, v]) =>
        `<div style="background:#f5f4ef;border-radius:8px;padding:10px 12px;text-align:center">
          <div style="font-size:11px;color:#9a9990;margin-bottom:3px">${labels[k] || k}</div>
          <div style="font-size:15px;font-weight:500">${v}</div>
        </div>`).join('') : '';

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
      <p style="font-size:13px;color:#5a5a56">${report.sector || ''} · ${report.geography || ''} · ${report.modelType || ''} · Verdict: <strong style="color:${verdictColor}">${report.verdict}</strong></p>
    </div>
    ${metricsHtml ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin-bottom:24px">${metricsHtml}</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:24px">
      <div style="background:#f5f4ef;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#9a9990;margin-bottom:3px">cells scanned</div>
        <div style="font-size:18px;font-weight:500">${report.cellsScanned ? report.cellsScanned.toLocaleString() : '—'}</div>
      </div>
      <div style="background:#f5f4ef;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#9a9990;margin-bottom:3px">issues found</div>
        <div style="font-size:18px;font-weight:500">${(report.summary?.fail || 0) + (report.summary?.warn || 0)}</div>
      </div>
      <div style="background:#fdf0ee;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#b83224;margin-bottom:3px">FAIL</div>
        <div style="font-size:18px;font-weight:500;color:#b83224">${report.summary?.fail || 0}</div>
      </div>
      <div style="background:#fdf6e3;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#7a5200;margin-bottom:3px">WARN</div>
        <div style="font-size:18px;font-weight:500;color:#7a5200">${report.summary?.warn || 0}</div>
      </div>
    </div>
    ${prioritiesHtml ? `<div style="background:white;border:1px solid #dddcd4;border-radius:12px;padding:18px 20px;margin-bottom:20px">
      <p style="font-size:12px;font-weight:500;margin-bottom:12px">Priority action list</p>
      <div style="display:flex;flex-direction:column;gap:8px">${prioritiesHtml}</div>
    </div>` : ''}
    ${failFindings.map(findingHtml).join('')}
    ${passFindings.map(findingHtml).join('')}
    <p style="font-size:11px;color:#9a9990;line-height:1.7;font-style:italic;border-top:1px solid #dddcd4;padding-top:16px;margin-bottom:20px">${report.scope}</p>
    <div style="background:white;border:1px solid #dddcd4;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px">
      <p style="font-size:13px;color:#5a5a56;margin-bottom:14px">Found something we missed? Your feedback improves Verifi.</p>
      <a href="mailto:hello@verifi.com.au?subject=Verifi Feedback" style="display:inline-block;padding:8px 20px;border:1px solid #dddcd4;border-radius:8px;font-size:13px;color:#0e0e0c;text-decoration:none">Send feedback</a>
    </div>`;
}
