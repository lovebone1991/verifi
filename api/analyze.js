import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export const config = {
  maxDuration: 300,
  api: { bodyParser: false, responseLimit: false },
};

// ── RE Knowledge Base ─────────────────────────────────────────────────────────
const RE_KNOWLEDGE = {
  universal: `UNIVERSAL CASH FLOW CHAIN:
Gross Revenue → -Vacancy → Gross Effective Income → -Outgoings → NOI
→ -CapEx -Leasing → AFFO → ±Investment CFs → Unlevered IRR
→ +Debt CFs → Net Levered CF → -Tax → -Fund Fees → Net IRR to Investor

SENSE CHECK MATRIX:
NOI Margin 75-90% (red <70%), ICR >1.5x (red <1.2x), LVR 40-60% (red >65%)
LTC Dev 55-70% (red >75%), E-IRR/Unlev ratio 1.3-2.0x (red >2.5x)
TER <1.5% (red >2%), Distribution Yield 3-6% (red <2% or >8%)
WACD = Σ(Interest_t)/Σ(Avg_Debt_t) — always derive from debt schedule
Unlev IRR ≈ Entry Yield + g (cap rate flat, long hold)`,

  core_hold: `CORE HOLD: 4 yields: Passing/Reversionary/Equivalent/Market
Under-rented: Passing < Reversionary. Over-rented: Passing > Reversionary
Equivalent always between Passing and Reversionary
Multi-tranche debt: each of Acquisition/Refi/Capex must independently close (drawdown=repayment)`,

  development: `DEVELOPMENT: GDV = Stabilised NOI/Exit Cap Rate or Area×$/sqm
RLV = GDV - TDC - Dev Profit. YoC = NOI/TPC (must > Cap Rate)
PC moment: Value jumps TPC→GDV. Dev Margin residential 15-25%, commercial 8-15%`,

  btr: `BTR: Day 1 100% occupancy = red flag. Ramp: Y1~75%, Y2~85%, Y3~92%
Income: Total Potential → -Vacancy → -Lease-Up → +Retained → +Relet = Actual`,

  pbsa: `PBSA: Income = Beds × Room Rate × Occupancy (NOT sqm-based)
YoC stabilised vs acquisition cap rate = key spread. Operator fee = % of revenue`,

  fund: `FUND: Distributions ≤ Distributable Income each period (critical)
TER = (Mgmt Fee + Fund Costs)/NAV target <1.5%
Performance fee hurdle must match waterfall definition exactly`,

  jv_waterfall: `JV WATERFALL: XIRR #NUM! during construction = normal (all-negative CFs)
2.98e-9 ≈ 0 (XIRR floating point precision, not error)
Co-invest % must be identical across ALL scenario sheets
Third tier never triggering: verify hurdle is achievable given returns`,
};

// ── Tools ─────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "search_errors",
    description: "Search for formula errors (#REF!, #DIV/0!, #N/A, #VALUE!, #NAME?, #NUM!) in the model",
    input_schema: {
      type: "object",
      properties: {
        error_type: { type: "string", description: "Error type or ALL" },
        sheet_name: { type: "string", description: "Optional: specific sheet" }
      },
      required: ["error_type"]
    }
  },
  {
    name: "get_section",
    description: "Get content from a specific sheet around a keyword",
    input_schema: {
      type: "object",
      properties: {
        sheet_name: { type: "string" },
        keyword: { type: "string" },
        context_lines: { type: "number" }
      },
      required: ["sheet_name", "keyword"]
    }
  },
  {
    name: "scan_sheet",
    description: "Scan a sheet for a pattern, or list all content if no pattern given",
    input_schema: {
      type: "object",
      properties: {
        sheet_name: { type: "string" },
        pattern: { type: "string" }
      },
      required: ["sheet_name"]
    }
  },
  {
    name: "check_metric",
    description: "Check a metric value against RE benchmarks",
    input_schema: {
      type: "object",
      properties: {
        metric_name: { type: "string", description: "NOI_Margin|ICR|LVR|LTC|Dev_Margin_Residential|Dev_Margin_Commercial|TER|Distribution_Yield|IRR_Leverage_Ratio" },
        value: { type: "number" },
        context: { type: "string" }
      },
      required: ["metric_name", "value"]
    }
  },
  {
    name: "finish_analysis",
    description: "Output the final structured audit report. Call when analysis is complete.",
    input_schema: {
      type: "object",
      properties: {
        report: {
          type: "object",
          properties: {
            modelName: { type: "string" },
            modelType: { type: "string" },
            sector: { type: "string" },
            geography: { type: "string" },
            verdict: { type: "string" },
            summary: { type: "object" },
            findings: { type: "array" },
            priorities: { type: "array" },
            keyMetrics: { type: "object" },
            scope: { type: "string" }
          },
          required: ["modelName", "modelType", "verdict", "findings", "keyMetrics"]
        }
      },
      required: ["report"]
    }
  }
];

// ── Tool Executor ─────────────────────────────────────────────────────────────
function executeTool(name, input, modelText) {
  const lines = modelText.split('\n');

  if (name === 'search_errors') {
    const { error_type, sheet_name } = input;
    const errors = error_type === 'ALL'
      ? ['#REF!', '#DIV/0!', '#N/A', '#VALUE!', '#NAME?', '#NUM!']
      : [error_type];

    let currentSheet = '';
    const results = [];

    for (const line of lines) {
      if (line.startsWith('## Sheet:')) { currentSheet = line.replace('## Sheet:', '').trim(); continue; }
      if (sheet_name && currentSheet !== sheet_name) continue;
      for (const err of errors) {
        if (line.includes(err)) {
          const count = (line.match(new RegExp(err.replace(/[!/?]/g, '\\$&'), 'g')) || []).length;
          results.push(`[${currentSheet}] ${line.trim().slice(0, 120)} (${count}× ${err})`);
          break;
        }
      }
    }

    if (!results.length) return `No ${error_type} errors found${sheet_name ? ` in ${sheet_name}` : ''}.`;
    return `${results.length} lines with errors:\n${results.slice(0, 25).join('\n')}${results.length > 25 ? `\n...+${results.length - 25} more` : ''}`;
  }

  if (name === 'get_section') {
    const { sheet_name, keyword, context_lines = 10 } = input;
    let inSheet = false;
    const sheetLines = [];

    for (const line of lines) {
      if (line.startsWith('## Sheet:')) { inSheet = line.includes(sheet_name); continue; }
      if (inSheet) sheetLines.push(line);
    }

    if (!sheetLines.length) {
      const available = [...modelText.matchAll(/## Sheet: (.+)/g)].map(m => m[1]).join(', ');
      return `Sheet '${sheet_name}' not found. Available: ${available}`;
    }

    const idx = sheetLines.findIndex(l => l.toLowerCase().includes(keyword.toLowerCase()));
    if (idx === -1) return `'${keyword}' not found in ${sheet_name}. Sample:\n${sheetLines.slice(0, 15).join('\n')}`;

    const start = Math.max(0, idx - 3);
    return `'${keyword}' in ${sheet_name} (line ${idx}):\n${sheetLines.slice(start, idx + context_lines).join('\n')}`;
  }

  if (name === 'scan_sheet') {
    const { sheet_name, pattern } = input;
    let inSheet = false;
    const results = [];

    for (const line of lines) {
      if (line.startsWith('## Sheet:')) { inSheet = line.includes(sheet_name); continue; }
      if (!inSheet) continue;
      if (!pattern || line.toLowerCase().includes(pattern.toLowerCase())) {
        if (line.trim()) results.push(line.trim().slice(0, 150));
      }
    }

    if (!results.length) return `Nothing found in '${sheet_name}'${pattern ? ` matching '${pattern}'` : ''}.`;
    return `${sheet_name}${pattern ? ` ('${pattern}')` : ''}: ${results.length} lines\n${results.slice(0, 35).join('\n')}`;
  }

  if (name === 'check_metric') {
    const { metric_name, value, context = '' } = input;
    const benchmarks = {
      NOI_Margin:               { normal: [0.75, 0.90], redBelow: 0.70, unit: '%', x100: true },
      ICR:                      { normal: [1.5, null],  redBelow: 1.2,  unit: 'x' },
      LVR:                      { normal: [0.40, 0.60], redAbove: 0.65, unit: '%', x100: true },
      LTC:                      { normal: [0.55, 0.70], redAbove: 0.75, unit: '%', x100: true },
      Dev_Margin_Residential:   { normal: [0.15, 0.25], redBelow: 0.10, unit: '%', x100: true },
      Dev_Margin_Commercial:    { normal: [0.08, 0.15], redBelow: 0.05, unit: '%', x100: true },
      TER:                      { normal: [null, 0.015],redAbove: 0.02, unit: '%', x100: true },
      Distribution_Yield:       { normal: [0.03, 0.06], redBelow: 0.02, redAbove: 0.08, unit: '%', x100: true },
      IRR_Leverage_Ratio:       { normal: [1.3, 2.0],  redAbove: 2.5,  unit: 'x' },
    };

    const b = benchmarks[metric_name];
    if (!b) return `No benchmark for '${metric_name}'. Value: ${value}`;

    const fmt = v => b.x100 ? (v * 100).toFixed(1) + b.unit : v.toFixed(2) + b.unit;
    let flag = '';
    if (b.redBelow !== undefined && value < b.redBelow) flag = `RED FLAG: below ${fmt(b.redBelow)}`;
    if (b.redAbove !== undefined && value > b.redAbove) flag = `RED FLAG: above ${fmt(b.redAbove)}`;

    const range = b.normal.filter(Boolean).map(fmt).join('–');
    return `${metric_name}: ${fmt(value)} — ${flag || 'NORMAL'}. Benchmark: ${range}${context ? '. ' + context : ''}`;
  }

  return `Unknown tool: ${name}`;
}

// ── Agentic Loop ──────────────────────────────────────────────────────────────
async function runAgenticLoop(client, modelText, modelType) {
  const messages = [];
  const toolsUsed = [];
  const toolCallCount = {};
  let inputTokens = 0, outputTokens = 0, cachedTokens = 0;
  let rounds = 0;

  const knowledgeKey = {
    'Core Hold': 'core_hold', 'Dev-Sell': 'development',
    'Dev-Hold-Sell': 'development', 'BTR': 'btr', 'PBSA': 'pbsa',
    'Fund': 'fund', 'JV-Waterfall': 'jv_waterfall',
  }[modelType] || '';

  const knowledge = RE_KNOWLEDGE.universal + (knowledgeKey ? '\n\n' + RE_KNOWLEDGE[knowledgeKey] : '');

  messages.push({
    role: "user",
    content: [{
      type: "text",
      text: `Audit this real estate financial model. Use tools systematically, then call finish_analysis.\n\nRE KNOWLEDGE:\n${knowledge}\n\nMODEL CONTENT:\n${modelText.slice(0, 160000)}`,
      cache_control: { type: "ephemeral" }
    }]
  });

  const systemPrompt = [{
    type: "text",
    text: `You are Verifi, an automated RE financial model audit engine built by a CFA-qualified analyst with 15+ years institutional experience.

Analyse like a senior fund manager. Use tools to:
1. search_errors — find structural issues first
2. get_section / scan_sheet — investigate specific areas
3. check_metric — benchmark values
4. finish_analysis — when you have complete findings (typically 6-12 tool calls)

In finish_analysis findings, include: specific cell references, actual numbers, IRR impact, concrete fix.
Flag: IFERROR-wrapped errors (silent failures), hardcoded values affecting IRR/NOI, exit cap rate assumptions, debt drawdown≠repayment.`,
    cache_control: { type: "ephemeral" }
  }];

  while (rounds < 15) {
    rounds++;

    const res = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    const usage = res.usage || {};
    inputTokens += usage.input_tokens || 0;
    outputTokens += usage.output_tokens || 0;
    cachedTokens += usage.cache_read_input_tokens || 0;

    messages.push({ role: "assistant", content: res.content });

    if (res.stop_reason === 'end_turn') break;

    if (res.stop_reason === 'tool_use') {
      const toolResults = [];

      for (const block of res.content) {
        if (block.type !== 'tool_use') continue;

        toolsUsed.push(block.name);
        toolCallCount[block.name] = (toolCallCount[block.name] || 0) + 1;

        if (block.name === 'finish_analysis') {
          const report = block.input.report;
          report.metrics = {
            rounds,
            inputTokens,
            outputTokens,
            cachedTokens,
            cacheHitRate: cachedTokens > 0 ? `${((cachedTokens / (inputTokens + cachedTokens)) * 100).toFixed(0)}%` : '0%',
            toolCallCount,
            toolsUsed,
            estimatedCostUSD: ((inputTokens * 3 + outputTokens * 15 + cachedTokens * 0.3) / 1_000_000).toFixed(4)
          };
          return report;
        }

        const result = executeTool(block.name, block.input, modelText);
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
      }

      if (toolResults.length) messages.push({ role: "user", content: toolResults });
    }
  }

  // Fallback
  return {
    modelName: "Unknown", modelType, sector: "Unknown", geography: "Unknown",
    verdict: "WARN",
    summary: { fail: 0, warn: 1, pass: 0, total: 1 },
    findings: [{ id: "SYS-01", layer: 0, status: "WARN", title: "Analysis incomplete",
      impact: "MEDIUM", description: `Reached ${rounds} rounds without completing.`,
      irrImpact: null, cells: [], fix: "Review manually" }],
    priorities: [], keyMetrics: {},
    metrics: { rounds, inputTokens, outputTokens, cachedTokens, toolCallCount, toolsUsed,
      estimatedCostUSD: ((inputTokens * 3 + outputTokens * 15) / 1_000_000).toFixed(4) }
  };
}

// ── Result Cache (in-memory) ──────────────────────────────────────────────────
const resultCache = new Map();

// ── Main Handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const startTime = Date.now();

  try {
    // Read raw body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    // Parse multipart
    const boundary = req.headers['content-type']?.match(/boundary=(.+)/)?.[1];
    if (!boundary) return res.status(400).json({ error: 'Invalid multipart request' });

    // Extract filename
    const headerStr = buffer.slice(0, 500).toString();
    const filename = headerStr.match(/filename="(.+?)"/)?.[1] || 'model.xlsx';

    // Find file bytes in multipart - robust version
    const boundaryBuf = Buffer.from(`--${boundary}`);
    const positions = [];
    for (let i = 0; i <= buffer.length - boundaryBuf.length; i++) {
      if (buffer.slice(i, i + boundaryBuf.length).equals(boundaryBuf)) {
        positions.push(i);
        i += boundaryBuf.length - 1;
      }
    }

    if (positions.length < 2) {
      return res.status(400).json({ error: `Multipart parse failed: found ${positions.length} boundaries` });
    }

    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), positions[0]);
    if (headerEnd === -1) {
      return res.status(400).json({ error: 'Could not find multipart header end' });
    }

    const fileStart = headerEnd + 4;
    const fileEnd = positions[1] - 2;

    if (fileEnd <= fileStart) {
      return res.status(400).json({ error: 'Empty file in multipart' });
    }

    const fileBuffer = buffer.slice(fileStart, fileEnd);

    // Hash for caching
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16);

    // Check cache
    if (resultCache.has(fileHash)) {
      return res.status(200).json({
        ...resultCache.get(fileHash),
        cached: true,
        analysisTime: `${((Date.now() - startTime) / 1000).toFixed(1)}s (cached)`
      });
    }

    // Write to temp file
    const ext = filename.split('.').pop().toLowerCase();
    const tmpPath = join(tmpdir(), `verifi_${fileHash}.${ext}`);
    writeFileSync(tmpPath, fileBuffer);

    // Extract text
    const format = ['xlsm', 'xls', 'xlsb'].includes(ext) ? 'xlsx' : ext;
    const extracted = spawnSync('extract-text', ['--format', format, tmpPath], {
      timeout: 60000, maxBuffer: 50 * 1024 * 1024
    });

    try { unlinkSync(tmpPath); } catch {}

    const modelText = extracted.stdout?.toString() || '';
    if (modelText.length < 100) {
      return res.status(400).json({ error: 'Could not extract content from file. Ensure it is a valid Excel file.' });
    }

    // Detect model type
    const sheets = [...modelText.matchAll(/## Sheet: (.+)/g)].map(m => m[1].toLowerCase());
    const text = modelText.toLowerCase();
    let modelType = 'Mixed';
    if (text.includes('build-to-rent') || text.includes(' btr') || sheets.some(s => s.includes('btr'))) modelType = 'BTR';
    else if (text.includes('beds') && (text.includes('pbsa') || text.includes('student'))) modelType = 'PBSA';
    else if (sheets.some(s => s.includes('promote') || s.includes('waterfall'))) modelType = 'JV-Waterfall';
    else if (sheets.some(s => s.includes('fund') || s.includes('portfolio'))) modelType = 'Fund';
    else if (text.includes('construction cost') || text.includes('development cost')) modelType = 'Dev-Hold-Sell';
    else if (sheets.some(s => s.includes('tenant') || s.includes('lease'))) modelType = 'Core Hold';

    // Run analysis
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const report = await runAgenticLoop(client, modelText, modelType);

    // Cache result
    if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value);
    resultCache.set(fileHash, report);

    res.status(200).json({
      ...report,
      cached: false,
      analysisTime: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      fileInfo: { name: filename, hash: fileHash, textLength: modelText.length, sheets: sheets.length }
    });

  } catch (err) {
    console.error('Verifi error:', err);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
}
