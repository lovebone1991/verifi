
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

const SYSTEM_PROMPT = `You are Verifi, a financial model verification engine built by a CFA-qualified real estate investment professional with 15+ years experience reviewing residential development, commercial RE, industrial, BTR, PBSA, debt, and fund of funds models.

CORE PHILOSOPHY:
Your primary role is to think like a seasoned fund manager or senior analyst reviewing this model with fresh eyes and deep domain expertise. You are NOT a mechanical rule-checker. You bring genuine judgment to every analysis.

- Lead with your own expert analysis. The ruleset below is a framework to guide your attention, not a constraint on your thinking.
- If your expert judgment identifies an issue not covered by the ruleset, report it. If the ruleset flags something that your judgment tells you is actually fine in context, say so and explain why.
- When your analysis conflicts with a ruleset rule, engage in deep thinking: consider the model type, the specific context, the materiality of the issue, and make a reasoned judgment call. Always explain your reasoning.
- Look for what experienced reviewers would catch: subtle inconsistencies, assumptions that don't hang together, structural choices that create hidden risk.

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

VERIFICATION FRAMEWORK (guidance for your analysis — apply judgment, not mechanical rules):

LAYER 1 - STRUCTURAL (typically FAIL if violated — but use judgment on materiality):
S-01: No merged cells in calculation areas
S-02: No formula errors (#REF!, #DIV/0!, #NAME?, #VALUE!) — especially dangerous when wrapped in IFERROR
S-03: No circular references
S-04: No hardcoded values in calculation cells
S-05: Inputs separated from calculations
S-06: Model has version/date metadata
S-07: Toggles centralised, not scattered
S-08: No orphaned inputs (inputs with no dependents)

LAYER 2 - ACCOUNTING (typically FAIL if violated — consider whether errors are material to returns):
A-01: Cash flow roll-forward closes each period: Opening + movements = Closing
A-02: Total debt drawdowns = total repayments at end of hold
A-03: Sources = Uses
A-04: Interest expense in cash flow (not just accrued)
A-05: Capitalised interest included in debt repayment
A-06: Levered CF = Unlevered CF + debt schedule each period
A-07: Fee leakages (mgmt fee, perf fee) as cash outflows
A-08: Actual → forecast transition: no unexplained jump at cutover
A-09: Distributions ≤ Distributable Income each period

LAYER 3 - ECONOMIC (use as reference ranges — your expert judgment on context matters more than the range):
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
    "devMargin": "string or null (Dev models only)",
    "yieldOnCost": "string or null (Dev/PBSA models only)",
    "capRate": "string or null",
    "ltc": "string or null (Dev models only)",
    "ltv": "string or null (Core Hold/Fund models only)",
    "icr": "string or null (Core Hold/Fund models only)",
    "wale": "string or null (Core Hold models only)",
    "passingYield": "string or null (Core Hold models only)",
    "occupancy": "string or null (BTR/PBSA models only)",
    "distributionYield": "string or null (Fund models only)",
    "navPerUnit": "string or null (Fund models only)",
    "holdPeriod": "string or null",
    "revenuePerSqm": "string or null (where relevant)"
  },

DYNAMIC METRICS RULE — only populate metrics relevant to the identified model type:
- Core Hold: unleveredIRR, leveredIRR, capRate, passingYield, wale, ltv, icr, holdPeriod
- Dev-Sell: devMargin, ltc, revenuePerSqm, holdPeriod
- Dev-Hold-Sell: unleveredIRR, leveredIRR, devMargin, yieldOnCost, capRate, ltc, holdPeriod
- BTR: unleveredIRR, leveredIRR, capRate, occupancy, yieldOnCost, holdPeriod
- PBSA: yieldOnCost, occupancy, capRate, holdPeriod
- Fund: leveredIRR, distributionYield, navPerUnit, ltv, holdPeriod
Set all non-relevant metrics to null.
  "scope": "This report checks structural and mathematical integrity. Where current market benchmarks were available, findings include live sourced data with citations. A clean Verifi report is necessary but not sufficient for a reliable model."
}

MARKET BENCHMARK INSTRUCTIONS:
          marketContext = '\n\nCURRENT MARKET BENCHMARKS (live web search, ' + new Date().toLocaleDateString('en-AU') + ' - cite sources in findings):\n' + snippets.join('\n---\n');
- When referencing market data, include the source URL and date in the finding description like: "(Source: [URL], [date])"
- If no live data is available for a specific metric, use your training knowledge but note it as "based on historical market data"
- Prioritise live sourced data over training knowledge for any economic benchmarking
- Keep citations concise — one line at the end of the description is enough`;

function generateReportHtml(report) {
  const now = new Date().toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
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
            unleveredIRR: 'Unlev IRR', leveredIRR: 'E-IRR', devMargin: 'Dev Margin',
            yieldOnCost: 'Yield on Cost', capRate: 'Cap Rate', ltc: 'LTC', ltv: 'LTV',
            icr: 'ICR', wale: 'WALE', passingYield: 'Passing Yield', occupancy: 'Occupancy',
            distributionYield: 'Distribution Yield', navPerUnit: 'NAV / Unit',
            holdPeriod: 'Hold Period', revenuePerSqm: 'Revenue / sqm',
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
        <div style="font-size:11px;color:#9a9990;margin-bottom:3px">cells scanned</div>
        <div style="font-size:20px;font-weight:500">${report.cellsScanned ? report.cellsScanned.toLocaleString() : '—'}</div>
      </div>
      <div style="background:#f5f4ef;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#9a9990;margin-bottom:3px">issues found</div>
        <div style="font-size:20px;font-weight:500">${(report.summary?.fail || 0) + (report.summary?.warn || 0)}</div>
      </div>
      <div style="background:#f5f4ef;border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#9a9990;margin-bottom:3px">severity</div>
        <div style="font-size:13px;font-weight:500;margin-top:4px">
          <span style="color:#b83224">${report.summary?.fail || 0} FAIL</span>
          <span style="color:#9a9990;margin:0 3px">·</span>
          <span style="color:#7a5200">${report.summary?.warn || 0} WARN</span>
        </div>
      </div>
      <div style="background:${report.verdict === 'FAIL' ? '#fdf0ee' : report.verdict === 'WARN' ? '#fdf6e3' : '#edf5f0'};border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:11px;color:#9a9990;margin-bottom:3px">verdict</div>
        <div style="font-size:20px;font-weight:500;color:${report.verdict === 'FAIL' ? '#b83224' : report.verdict === 'WARN' ? '#7a5200' : '#1a6b3c'}">${report.verdict}</div>
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

async function handleRequest(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Now receives pre-parsed JSON from frontend, not raw Excel file
  const compactSummary = await request.json();

  if (!compactSummary || !compactSummary.sheetNames) {
    return json({ error: 'Invalid model data' }, 400);
  }

  // ── Step 1: Identify model type + geography for targeted search ──────────
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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Based on this Excel model structure, return ONLY valid JSON with no other text: {"modelType":"Core Hold|Dev-Sell|Dev-Hold-Sell|BTR|PBSA|Fund","sector":"e.g. Industrial|Residential|Office|Retail|Mixed","geography":"e.g. Sydney|Melbourne|Australia|Unknown","searchQueries":["2-3 specific queries for current market benchmarks"]}

Sheet names: ${JSON.stringify(compactSummary.sheetNames)}
Global stats: ${JSON.stringify(compactSummary.globalStats)}`,
        }],
      }),
    });

    if (identifyRes.ok) {
      const identifyData = await identifyRes.json();
      const identifyText = identifyData.content[0].text;
      const identifyJson = JSON.parse(identifyText.match(/\{[\s\S]*\}/)[0]);
      const { searchQueries = [], modelType = '', geography = '', sector = '' } = identifyJson;

      // ── Step 2: Tavily web search for market benchmarks ──────────────────
      if (env.TAVILY_API_KEY && searchQueries.length > 0) {
        const tavilyResults = await Promise.allSettled(
          searchQueries.slice(0, 2).map(query =>
            fetch('https://api.tavily.com/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                api_key: env.TAVILY_API_KEY,
                query,
                search_depth: 'basic',
                max_results: 3,
                include_answer: true,
              }),
            }).then(r => r.json())
          )
        );

        const snippets = tavilyResults
          .filter(r => r.status === 'fulfilled' && r.value?.answer)
          .map(r => {
            const { answer, results = [] } = r.value;
            const sources = results.slice(0, 2).map(s => `${s.title} (${s.url})`).join(', ');
            return `${answer}
Sources: ${sources}`;
          })
          .filter(Boolean);

        if (snippets.length > 0) {
          marketContext = '\n\nCURRENT MARKET BENCHMARKS (live web search, ' + new Date().toLocaleDateString('en-AU') + ' - cite sources in findings):\n' + snippets.join('\n---\n');
        }
      }
    }
  } catch (e) {
    console.error('Market research error:', e.message);
    // Continue without market context
  }

  // ── Main analysis ──
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Please audit this real estate financial model and return the JSON report.\n\nModel structure extracted from Excel:\n${JSON.stringify(compactSummary, null, 2)}${marketContext}`,
      }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    throw new Error(`Anthropic API error ${anthropicRes.status}: ${errText}`);
  }

  const anthropicData = await anthropicRes.json();
  const text = anthropicData.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  const report = JSON.parse(jsonMatch[0]);

  // ── Calculate total cells scanned from model data ──
  let cellsScanned = 0;
  for (const sheetData of Object.values(compactSummary.sheets || {})) {
    if (sheetData.dimensions) {
      cellsScanned += (sheetData.dimensions.rows || 0) * (sheetData.dimensions.cols || 0);
    }
  }
  report.cellsScanned = cellsScanned;

  // ── Layer 1: Store rule frequency stats in KV (fire-and-forget) ──
  if (env.VERIFI_STATS) {
    const statsPromises = [];

    // Count total analyses
    statsPromises.push(incrementKV(env.VERIFI_STATS, 'stats:total_analyses'));

    // Count by model type
    if (report.modelType) {
      const typeKey = 'stats:modelType:' + report.modelType.replace(/[^a-zA-Z0-9]/g, '_');
      statsPromises.push(incrementKV(env.VERIFI_STATS, typeKey));
    }

    // Count each rule triggered (FAIL or WARN only)
    if (report.findings) {
      for (const finding of report.findings) {
        if (finding.status !== 'PASS') {
          statsPromises.push(incrementKV(env.VERIFI_STATS, 'stats:rule:' + finding.id));
          statsPromises.push(incrementKV(env.VERIFI_STATS, 'stats:rule:' + finding.id + ':' + finding.status));
        }
      }
    }

    // Count verdicts
    if (report.verdict) {
      statsPromises.push(incrementKV(env.VERIFI_STATS, 'stats:verdict:' + report.verdict));
    }

    // Don't await — let it run in background, don't slow down response
    Promise.all(statsPromises).catch(() => {});
  }

  // Build rich report metadata to send to frontend (for feedback enrichment)
  const reportMeta = {
    reportId: crypto.randomUUID(),
    modelType: report.modelType || null,
    sector: report.sector || null,
    verdict: report.verdict || null,
    summary: report.summary || {},
    keyMetrics: report.keyMetrics || {},
    findings: (report.findings || []).map(f => ({
      id: f.id,
      status: f.status,
      impact: f.impact,
      description: f.description || '',
      irrImpact: f.irrImpact || null,
      fix: f.fix || '',
    })),
    modelProfile: {
      totalSheets: compactSummary.totalSheets,
      sheetNames: compactSummary.sheetNames,
      totalRefErrors: compactSummary.globalStats?.totalRefErrors || 0,
      totalHardcodes: compactSummary.globalStats?.totalHardcodes || 0,
      sheetsWithErrors: compactSummary.globalStats?.sheetsWithErrors || [],
      formulaCounts: Object.fromEntries(
        Object.entries(compactSummary.sheets || {}).map(([k, v]) => [k, v.formulaCount || 0])
      ),
    },
  };

  return json({ reportHtml: generateReportHtml(report), ...reportMeta });
}

// Increment a KV counter atomically
async function incrementKV(kv, key) {
  const current = await kv.get(key);
  const val = current ? parseInt(current) + 1 : 1;
  await kv.put(key, String(val));
}

// Handle feedback submissions from report page
async function handleFeedback(request, env) {
  const payload = await request.json();
  const { type, ruleId, helpful, reason, freeText, sessionId, modelType, finding, modelProfile, reportSummary, keyMetrics, sector, verdict, fixed } = payload;

  if (!env.VERIFI_STATS) return json({ ok: true });

  const timestamp = new Date().toISOString();

  // ── Fix confirmation (separate event type) ──
  if (type === 'fix_confirmation') {
    const recordKey = 'fix:' + timestamp + ':' + (sessionId || 'anon');
    await Promise.all([
      incrementKV(env.VERIFI_STATS, 'fix:total'),
      incrementKV(env.VERIFI_STATS, fixed ? 'fix:yes' : 'fix:no'),
      env.VERIFI_STATS.put(recordKey, JSON.stringify({
        timestamp, type: 'fix_confirmation', fixed,
        sessionId: sessionId || null,
        modelType: modelType || null,
        sector: sector || null,
        verdict: verdict || null,
        reportSummary: reportSummary || null,
        keyMetrics: keyMetrics || null,
      }), { expirationTtl: 60 * 60 * 24 * 365 }),
    ]);
    return json({ ok: true });
  }

  // ── Finding feedback ──
  if (!ruleId || typeof helpful !== 'boolean') {
    return json({ error: 'Invalid feedback' }, 400);
  }

  const suffix = helpful ? 'helpful' : 'not_helpful';

  // 1. Aggregate counters
  const counters = [
    incrementKV(env.VERIFI_STATS, 'feedback:' + ruleId + ':' + suffix),
    incrementKV(env.VERIFI_STATS, 'feedback:total'),
  ];
  if (modelType) {
    counters.push(incrementKV(env.VERIFI_STATS, 'feedback:' + ruleId + ':' + modelType.replace(/[^a-zA-Z0-9]/g, '_') + ':' + suffix));
  }
  if (!helpful && reason) {
    counters.push(incrementKV(env.VERIFI_STATS, 'feedback:' + ruleId + ':reason:' + reason));
  }
  await Promise.all(counters);

  // 2. Rich record for pattern analysis
  const recordKey = 'record:' + timestamp + ':' + ruleId + ':' + (sessionId || 'anon');
  const record = {
    timestamp,
    type: 'finding_feedback',
    sessionId: sessionId || null,
    ruleId,
    helpful,
    reason: reason || null,          // false_positive | wrong_severity | unclear | other
    modelType: modelType || null,
    sector: sector || null,
    verdict: verdict || null,
    finding: finding || null,
    modelProfile: modelProfile || null,
    reportSummary: reportSummary || null,
    keyMetrics: keyMetrics || null,
  };
  await env.VERIFI_STATS.put(recordKey, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 365 });

  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: CORS });
    }

    try {
      const url = new URL(request.url);
      let response;
      if (url.pathname === '/feedback' && request.method === 'POST') {
        response = await handleFeedback(request, env);
      } else {
        response = await handleRequest(request, env);
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
