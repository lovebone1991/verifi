const CORS = {
  'Access-Control-Allow-Origin': 'https://verifi-seven.vercel.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── System Prompt (cached for cost efficiency) ────────────────────────────────
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
- WACD calculation: derive from debt schedule as Σ(Interest_t) / Σ(Average_Debt_t) across all periods — never assume it is directly stated
- Leverage effect: E-IRR = Unlev IRR + (Unlev IRR - WACD) × D/E. Sensitivity: per 1pp spread change, E-IRR moves by D/E multiple. Per 1pp LVR change, effect = spread × 1/(1-LVR)². Dev models include development profit in apparent uplift — strip this out before assessing leverage effect.
- Geography: always read location from Inputs sheet (address, suburb, state, postcode). Never guess geography from project name alone.

UNIVERSAL PROPERTY MODEL CHAIN (applies to all model types):
Gross Revenue → Net Operating Income (NOI) → AFFO/Distributable Income → Net Levered CF (gross) → Net Levered CF (post tax) → Net Levered CF (post fees) → Equity IRR

MODEL TYPES TO IDENTIFY:
- Core Hold: stable income, key metrics = passing/reversionary/equivalent yield, WALE, ICR, LVR
- Dev → Sell (Turnkey): sales revenue driven, key = $/sqm vs market, construction cost, presales coverage
- Dev → Hold → Sell: three phases, PC uplift = TPC to GDV jump, combined IRR has dev + stab components
- BTR: beds × room rate × occupancy, lease-up curve critical, operator fee structure
- PBSA: bed-based income, seasonal, YoC stabilised key benchmark
- Fund/Portfolio: asset-level CFs aggregated, add management fee + fund costs + tax + promote layers

VERIFICATION FRAMEWORK (guidance for your analysis — apply judgment, not mechanical rules):

LAYER 1 - STRUCTURAL (typically FAIL if violated — but use judgment on materiality):
S-01: No merged cells in calculation areas
S-02: No formula errors (#REF!, #DIV/0!, #NAME?, #VALUE!) — especially dangerous when wrapped in IFERROR. Count all instances, identify which sheets and which calculation areas they affect.
S-03: No circular references
S-04: No hardcoded values in calculation cells — for each hardcode found, trace its dependents to assess whether it affects key outputs (IRR, NOI, GAV). Only flag hardcodes that influence key outputs.
S-05: Inputs separated from calculations
S-06: Model has version/date metadata
S-07: Toggles centralised, not scattered
S-08: No orphaned inputs (inputs with no dependents)

LAYER 2 - ACCOUNTING (typically FAIL if violated — consider whether errors are material to returns):
A-01: Cash flow roll-forward closes each period: Opening + movements = Closing
A-02: Total debt drawdowns = total repayments. Verify by summing all drawdown rows and all repayment rows across the full time series. Calculate the difference — if non-zero, flag the amount.
A-03: Sources = Uses — sum both sides and verify they balance
A-04: Interest expense in cash flow (not just accrued). Derive WACD from debt schedule.
A-05: Capitalised interest included in debt repayment
A-06: Levered CF = Unlevered CF + debt schedule each period
A-07: Fee leakages (mgmt fee, perf fee) as cash outflows
A-08: Actual → forecast transition: no ghost cash appearing or evaporating
A-09: Distributions ≤ Distributable Income each period

LAYER 3 - ECONOMIC (use as reference ranges — your expert judgment on context matters more than the range):
E-01: Revenue/salable area = implied $/sqm — verify geography from Inputs sheet before benchmarking
E-02: Development margin within sector range (residential 15-25%, commercial 8-15%)
E-03: Positive leverage: WACD < Unlev IRR → levered IRR higher. Calculate WACD from debt schedule.
E-04: Leverage uplift — use formula E-IRR = Unlev IRR + (Unlev IRR - WACD) × D/E. For Dev models, note that apparent uplift includes dev profit component. Verify direction (positive/negative) and reasonableness of magnitude given LVR and WACD.
E-05: Yield on Cost vs Cap Rate spread (positive = development creates value)
E-06: Exit cap rate assumption vs entry cap rate — flag if compression > 50bps without justification
E-07: Unlev IRR ≈ Net Income Yield + rental growth (for stabilised hold assets, cap rate flat)
E-08: ICR > 1.5x throughout hold period — check every period, not just average
E-09: LVR within covenant levels (core ≤ 65%, development ≤ 75%)
E-10: E-IRR / Unlev IRR ratio < 2.5x (excessive leverage flag)
E-11: WALE vs cap rate consistency (short WALE should have higher cap rate)
E-12: Equivalent yield between passing yield and reversionary yield

IMPACT ON IRR — assess each finding:
HIGH: directly affects IRR or materially misstates costs/revenue
MEDIUM: affects supporting calculations or covenant checks
LOW: structural/presentation issue

Return ONLY valid JSON — no markdown, no backticks, no preamble:
{
  "modelName": "string",
  "modelType": "Core Hold | Dev-Sell | Dev-Hold-Sell | BTR | PBSA | Fund | Mixed",
  "sector": "string",
  "geography": "string — read from Inputs sheet. If not found, return Unknown",
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
    "ltv": "string or null",
    "icr": "string or null",
    "wale": "string or null",
    "passingYield": "string or null",
    "occupancy": "string or null",
    "distributionYield": "string or null",
    "navPerUnit": "string or null",
    "holdPeriod": "string or null",
    "revenuePerSqm": "string or null",
    "wacd": "string or null"
  },
  "scope": "This report checks structural and mathematical integrity. Where current market benchmarks were available, findings include live sourced data with citations. A clean Verifi report is necessary but not sufficient for a reliable model."
}

DYNAMIC METRICS RULE — only populate metrics relevant to the identified model type:
- Core Hold: unleveredIRR, leveredIRR, capRate, passingYield, wale, ltv, icr, wacd, holdPeriod
- Dev-Sell: devMargin, ltc, revenuePerSqm, holdPeriod
- Dev-Hold-Sell: unleveredIRR, leveredIRR, devMargin, yieldOnCost, capRate, ltc, wacd, holdPeriod
- BTR: unleveredIRR, leveredIRR, capRate, occupancy, yieldOnCost, wacd, holdPeriod
- PBSA: yieldOnCost, occupancy, capRate, holdPeriod
- Fund: leveredIRR, distributionYield, navPerUnit, ltv, holdPeriod
Set all non-relevant metrics to null.

CRITICAL METRICS FORMAT RULE:
- Return ONLY clean numbers or percentages. Examples: "21.9%", "4.4%", "65%", "$187/sqm", "3 years"
- NEVER add explanations, qualifications, or parenthetical text in metric values
- If a metric cannot be precisely determined, return null — do not return approximations with text`;

// ── HTML Report Generator ─────────────────────────────────────────────────────
function generateReportHtml(report) {
  const now = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
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
            unleveredIRR: 'Unlev IRR', leveredIRR: 'E-IRR', devMargin: 'Dev Margin',
            yieldOnCost: 'Yield on Cost', capRate: 'Cap Rate', ltc: 'LTC', ltv: 'LTV',
            icr: 'ICR', wale: 'WALE', passingYield: 'Passing Yield', occupancy: 'Occupancy',
            distributionYield: 'Distribution Yield', navPerUnit: 'NAV / Unit',
            holdPeriod: 'Hold Period', revenuePerSqm: 'Revenue / sqm', wacd: 'WACD',
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
    </div>
  `;
}

// ── Files API: Upload Excel to Anthropic ──────────────────────────────────────
async function uploadFileToAnthropic(fileBytes, fileName, apiKey) {
  const formData = new FormData();
  const blob = new Blob([fileBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  formData.append('file', blob, fileName);

  const res = await fetch('https://api.anthropic.com/v1/files', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'files-api-2025-04-14',
    },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Files API upload failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.id;
}

// ── Files API: Delete file from Anthropic ────────────────────────────────────
async function deleteFileFromAnthropic(fileId, apiKey) {
  await fetch(`https://api.anthropic.com/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'files-api-2025-04-14',
    },
  });
}

// ── Main Analysis Handler ─────────────────────────────────────────────────────
async function handleRequest(request, env, ctx) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const contentType = request.headers.get('Content-Type') || '';

  // ── New path: Excel file upload via Files API + xlsx Skill ──────────────
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return json({ error: 'No file uploaded' }, 400);
    }

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const fileName = file.name || 'model.xlsx';
    const cellsScanned = null; // Scanner stats come from frontend separately

    let fileId = null;
    try {
      // Step 1: Upload to Anthropic Files API
      console.log('Step 1: Uploading file to Anthropic...', fileName, fileBytes.length, 'bytes');
      fileId = await uploadFileToAnthropic(fileBytes, fileName, env.ANTHROPIC_API_KEY);
      console.log('Step 1 done. File ID:', fileId);

      // Step 2: Analyse with Code Execution — Claude reads Excel directly with pandas/openpyxl
      console.log('Step 2: Starting Code Execution analysis...');
      const analysisRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'files-api-2025-04-14',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            }
          ],
          tools: [{ type: 'code_execution_20250825', name: 'code_execution' }],
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Please audit this real estate financial model thoroughly. Use code execution with pandas/openpyxl to read all sheets directly from the uploaded Excel file. Verify all calculations, derive WACD from the debt schedule by summing interest expense over average outstanding debt balance each period, check time series data for debt drawdown = repayment, sources = uses, and all other checks in your framework. Return your analysis as a single valid JSON object matching the schema in your instructions.',
              },
              {
                type: 'container_upload',
                file_id: fileId,
              },
            ],
          }],
        }),
      });

      if (!analysisRes.ok) {
        const err = await analysisRes.text();
        throw new Error(`Anthropic API error ${analysisRes.status}: ${err}`);
      }

      const analysisData = await analysisRes.json();

      // Extract text from response (may include code execution results)
      const text = (analysisData.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in Claude response');

      const report = JSON.parse(jsonMatch[0]);
      report.cellsScanned = formData.get('cellsScanned') ? parseInt(formData.get('cellsScanned')) : null;

      // Step 3: KV stats (fire and forget with waitUntil)
      if (env.VERIFI_STATS) {
        const statsPromises = [
          incrementKV(env.VERIFI_STATS, 'stats:total_analyses'),
          report.modelType ? incrementKV(env.VERIFI_STATS, 'stats:modelType:' + report.modelType.replace(/[^a-zA-Z0-9]/g, '_')) : Promise.resolve(),
          report.verdict ? incrementKV(env.VERIFI_STATS, 'stats:verdict:' + report.verdict) : Promise.resolve(),
        ];
        if (report.findings) {
          for (const f of report.findings) {
            if (f.status !== 'PASS') {
              statsPromises.push(incrementKV(env.VERIFI_STATS, 'stats:rule:' + f.id));
            }
          }
        }
        ctx.waitUntil(Promise.all(statsPromises).catch(e => console.error('KV error:', e)));
      }

      // Build rich report metadata for feedback
      const reportMeta = {
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
      };

      return json({ reportHtml: generateReportHtml(report), ...reportMeta });

    } finally {
      // Step 4: Always delete file from Anthropic (privacy)
      if (fileId) {
        ctx.waitUntil(deleteFileFromAnthropic(fileId, env.ANTHROPIC_API_KEY));
      }
    }
  }

  // ── Legacy path: JSON summary from scanner (kept as fallback) ────────────
  const compactSummary = await request.json();
  if (!compactSummary || !compactSummary.sheetNames) {
    return json({ error: 'Invalid model data' }, 400);
  }

  // Tavily market research
  let marketContext = '';
  try {
    const identifyRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: 'Based on this Excel model structure, return ONLY valid JSON: {"modelType":"string","sector":"string","geography":"string","searchQueries":["2-3 specific queries for current market benchmarks"]}\n\nSheet names: ' + JSON.stringify(compactSummary.sheetNames),
        }],
      }),
    });

    if (identifyRes.ok) {
      const identifyData = await identifyRes.json();
      const identifyText = identifyData.content[0].text;
      const identifyJson = JSON.parse(identifyText.match(/\{[\s\S]*\}/)[0]);
      const { searchQueries = [] } = identifyJson;

      if (env.TAVILY_API_KEY && searchQueries.length > 0) {
        const tavilyRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: env.TAVILY_API_KEY,
            query: searchQueries.slice(0, 2).join(' AND '),
            search_depth: 'basic',
            max_results: 3,
            include_answer: true,
          }),
        }).then(r => r.json());

        if (tavilyRes?.answer) {
          const sources = (tavilyRes.results || []).slice(0, 2).map(s => s.url).join(', ');
          marketContext = '\n\nCURRENT MARKET BENCHMARKS (live web search, ' + new Date().toLocaleDateString('en-AU') + ' - cite sources in findings):\n' + tavilyRes.answer + '\nSources: ' + sources;
        }
      }
    }
  } catch (e) {
    console.error('Market research error:', e.message);
  }

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        }
      ],
      messages: [{
        role: 'user',
        content: 'Please audit this real estate financial model and return the JSON report.\n\nModel structure extracted from Excel:\n' + JSON.stringify(compactSummary, null, 2) + marketContext,
      }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    throw new Error('Anthropic API error ' + anthropicRes.status + ': ' + errText);
  }

  const anthropicData = await anthropicRes.json();
  const text = anthropicData.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  const report = JSON.parse(jsonMatch[0]);

  let cellsScanned = 0;
  for (const sheetData of Object.values(compactSummary.sheets || {})) {
    if (sheetData.dimensions) {
      cellsScanned += (sheetData.dimensions.rows || 0) * (sheetData.dimensions.cols || 0);
    }
  }
  report.cellsScanned = cellsScanned;

  if (env.VERIFI_STATS) {
    const statsPromises = [
      incrementKV(env.VERIFI_STATS, 'stats:total_analyses'),
      report.modelType ? incrementKV(env.VERIFI_STATS, 'stats:modelType:' + report.modelType.replace(/[^a-zA-Z0-9]/g, '_')) : Promise.resolve(),
      report.verdict ? incrementKV(env.VERIFI_STATS, 'stats:verdict:' + report.verdict) : Promise.resolve(),
    ];
    if (report.findings) {
      for (const f of report.findings) {
        if (f.status !== 'PASS') {
          statsPromises.push(incrementKV(env.VERIFI_STATS, 'stats:rule:' + f.id));
        }
      }
    }
    ctx.waitUntil(Promise.all(statsPromises).catch(e => console.error('KV error:', e)));
  }

  const reportMeta = {
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
    modelProfile: {
      totalSheets: compactSummary.totalSheets,
      sheetNames: compactSummary.sheetNames,
      totalRefErrors: compactSummary.globalStats?.totalRefErrors || 0,
      totalHardcodes: compactSummary.globalStats?.totalHardcodes || 0,
    },
  };

  return json({ reportHtml: generateReportHtml(report), ...reportMeta });
}

// ── KV increment helper ───────────────────────────────────────────────────────
async function incrementKV(kv, key) {
  const current = await kv.get(key);
  const val = current ? parseInt(current) + 1 : 1;
  await kv.put(key, String(val));
}

// ── Feedback Handler ──────────────────────────────────────────────────────────
async function handleFeedback(request, env, ctx) {
  const payload = await request.json();
  const { type, ruleId, helpful, reason, freeText, sessionId, modelType, finding, modelProfile, reportSummary, keyMetrics, sector, geography, verdict, fixed } = payload;

  if (!env.VERIFI_STATS) return json({ ok: true });

  const timestamp = new Date().toISOString();

  if (type === 'fix_confirmation') {
    const recordKey = 'fix:' + timestamp + ':' + (sessionId || 'anon');
    ctx.waitUntil(Promise.all([
      incrementKV(env.VERIFI_STATS, 'fix:total'),
      incrementKV(env.VERIFI_STATS, fixed ? 'fix:yes' : 'fix:no'),
      env.VERIFI_STATS.put(recordKey, JSON.stringify({
        timestamp, type: 'fix_confirmation', fixed,
        sessionId: sessionId || null, modelType: modelType || null,
        sector: sector || null, geography: geography || null,
        verdict: verdict || null, reportSummary: reportSummary || null, keyMetrics: keyMetrics || null,
      }), { expirationTtl: 60 * 60 * 24 * 365 }),
    ]).catch(e => console.error('KV fix error:', e)));
    return json({ ok: true });
  }

  if (!ruleId || typeof helpful !== 'boolean') {
    return json({ error: 'Invalid feedback' }, 400);
  }

  const suffix = helpful ? 'helpful' : 'not_helpful';
  const recordKey = 'record:' + timestamp + ':' + ruleId + ':' + (sessionId || 'anon');

  ctx.waitUntil(Promise.all([
    incrementKV(env.VERIFI_STATS, 'feedback:' + ruleId + ':' + suffix),
    incrementKV(env.VERIFI_STATS, 'feedback:total'),
    modelType ? incrementKV(env.VERIFI_STATS, 'feedback:' + ruleId + ':' + modelType.replace(/[^a-zA-Z0-9]/g, '_') + ':' + suffix) : Promise.resolve(),
    !helpful && reason ? incrementKV(env.VERIFI_STATS, 'feedback:' + ruleId + ':reason:' + reason) : Promise.resolve(),
    env.VERIFI_STATS.put(recordKey, JSON.stringify({
      timestamp, type: 'finding_feedback', sessionId: sessionId || null,
      ruleId, helpful, reason: reason || null, freeText: freeText || null,
      modelType: modelType || null, sector: sector || null, geography: geography || null,
      verdict: verdict || null, finding: finding || null,
      modelProfile: modelProfile || null, reportSummary: reportSummary || null, keyMetrics: keyMetrics || null,
    }), { expirationTtl: 60 * 60 * 24 * 365 }),
  ]).catch(e => console.error('KV feedback error:', e)));

  return json({ ok: true });
}

// ── Fetch Handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: CORS });
    }

    try {
      const url = new URL(request.url);
      let response;
      if (url.pathname === '/feedback' && request.method === 'POST') {
        response = await handleFeedback(request, env, ctx);
      } else {
        response = await handleRequest(request, env, ctx);
      }
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      return new Response(response.body, { status: response.status, headers });
    } catch (err) {
      console.error('Worker error:', err.message);
      return new Response(JSON.stringify({ error: 'Analysis failed', detail: err.message }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  },
};
