import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import * as XLSX from 'xlsx';

export const config = {
  maxDuration: 300,
  api: { bodyParser: false, responseLimit: false },
};

// ── Excel Extractor ───────────────────────────────────────────────────────────
function extractExcelText(fileBuffer) {
  try {
    const workbook = XLSX.read(fileBuffer, {
      type: 'buffer',
      cellFormula: true,   // extract formulas — needed to detect IFERROR wrapping
      cellHTML: false,
      cellText: true,
      sheetStubs: true,
      WTF: false,
    });

    const errMap = {
      0: '#NULL!', 7: '#DIV/0!', 15: '#VALUE!',
      23: '#REF!', 29: '#NAME?', 36: '#NUM!', 42: '#N/A!'
    };

    function readSheet(sheet, maxRows, maxCols) {
      maxRows = maxRows || 2000;
      maxCols = maxCols || 50;
      const range = sheet['!ref'];
      if (!range) return [];
      const decoded = XLSX.utils.decode_range(range);
      const rows = [];
      const rMax = Math.min(decoded.e.r, maxRows);
      const cMax = Math.min(decoded.e.c, maxCols);

      for (let R = decoded.s.r; R <= rMax; R++) {
        const rowVals = [];
        for (let C = decoded.s.c; C <= cMax; C++) {
          const cell = sheet[XLSX.utils.encode_cell({ r: R, c: C })];
          if (!cell) { rowVals.push(''); continue; }

          if (cell.t === 'e') {
            const errStr = errMap[cell.v] || '#ERR!';
            // Show formula if error — key for IFERROR detection
            const formula = cell.f ? (' [=' + cell.f + ']') : '';
            rowVals.push(errStr + formula);
          } else {
            const val = String(cell.w != null ? cell.w : (cell.v != null ? cell.v : ''));
            // Flag IFERROR-wrapped cells explicitly
            const iferrorFlag = (cell.f && cell.f.toUpperCase().startsWith('IFERROR'))
              ? (' [IFERROR:=' + cell.f.slice(0, 80) + ']') : '';
            rowVals.push(val + iferrorFlag);
          }
        }
        const rowStr = rowVals.join('\t').trim();
        if (rowStr) rows.push(rowStr);
      }
      return rows;
    }

    const lines = [];

    // ── SHEET OVERVIEW — Claude sees ALL sheets upfront ──────────────────────
    lines.push('## SHEET OVERVIEW');
    lines.push('Total sheets: ' + workbook.SheetNames.length);
    lines.push('Sheet names: ' + workbook.SheetNames.join(' | '));
    lines.push('');

    for (let i = 0; i < workbook.SheetNames.length; i++) {
      const sheetName = workbook.SheetNames[i];
      const sheet = workbook.Sheets[sheetName];
      if (!sheet || !sheet['!ref']) {
        lines.push('  * [' + sheetName + ']: empty');
        continue;
      }
      const decoded = XLSX.utils.decode_range(sheet['!ref']);
      const rows = decoded.e.r - decoded.s.r + 1;
      const cols = decoded.e.c - decoded.s.c + 1;
      const preview = readSheet(sheet, 2, 8);
      const previewStr = preview.length > 0 ? preview[0].replace(/\t+/g, ' | ').slice(0, 100) : '';
      lines.push('  * [' + sheetName + ']: ' + rows + 'r x ' + cols + 'c | ' + previewStr);
    }
    lines.push('');

    // ── FULL SHEET CONTENT ────────────────────────────────────────────────────
    for (let i = 0; i < workbook.SheetNames.length; i++) {
      const sheetName = workbook.SheetNames[i];
      lines.push('## Sheet: ' + sheetName);
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) { lines.push('(empty)'); lines.push(''); continue; }
      const rows = readSheet(sheet);
      for (let j = 0; j < rows.length; j++) lines.push(rows[j]);
      lines.push('');
    }

    return lines.join('\n');
  } catch (err) {
    throw new Error('Excel parse failed: ' + err.message);
  }
}

// ── RE Knowledge Base ─────────────────────────────────────────────────────────
const RE_KNOWLEDGE = {
  universal: `UNIVERSAL CASH FLOW CHAIN:
Gross Revenue -> -Vacancy -> Gross Effective Income -> -Outgoings -> NOI
-> -CapEx -Leasing -> AFFO -> +/-Investment CFs -> Unlevered IRR
-> +Debt CFs -> Net Levered CF -> -Tax -> -Fund Fees -> Net IRR to Investor

SENSE CHECK MATRIX:
NOI Margin 75-90% (red <70%), ICR >1.5x (red <1.2x), LVR 40-60% (red >65%)
LTC Dev 55-70% (red >75%), E-IRR/Unlev ratio 1.3-2.0x (red >2.5x)
TER <1.5% (red >2%), Distribution Yield 3-6% (red <2% or >8%)
WACD = Sum(Interest_t)/Sum(Avg_Debt_t) -- always derive from debt schedule
Unlev IRR approx= Entry Yield + g (cap rate flat, long hold)`,

  core_hold: `CORE HOLD: 4 yields: Passing/Reversionary/Equivalent/Market
Under-rented: Passing < Reversionary. Over-rented: Passing > Reversionary
Equivalent always between Passing and Reversionary
Multi-tranche debt: each of Acquisition/Refi/Capex must independently close (drawdown=repayment)`,

  development: `DEVELOPMENT: GDV = Stabilised NOI/Exit Cap Rate or Area x $/sqm
RLV = GDV - TDC - Dev Profit. YoC = NOI/TPC (must > Cap Rate)
PC moment: Value jumps TPC->GDV. Dev Margin residential 15-25%, commercial 8-15%`,

  btr: `BTR: Day 1 100% occupancy = red flag. Ramp: Y1~75%, Y2~85%, Y3~92%
Income: Total Potential -> -Vacancy -> -Lease-Up -> +Retained -> +Relet = Actual`,

  pbsa: `PBSA: Income = Beds x Room Rate x Occupancy (NOT sqm-based)
YoC stabilised vs acquisition cap rate = key spread. Operator fee = % of revenue`,

  fund: `FUND: Distributions <= Distributable Income each period (critical)
TER = (Mgmt Fee + Fund Costs)/NAV target <1.5%
Performance fee hurdle must match waterfall definition exactly
Returns Calculator: verify IRR/EM/DPI calculations are mathematically consistent`,

  jv_waterfall: `JV WATERFALL: XIRR #NUM! during construction = normal (all-negative CFs)
2.98e-9 approx= 0 (XIRR floating point precision, not error)
Co-invest % must be identical across ALL scenario sheets
Third tier never triggering: verify hurdle is achievable given returns`,
};

// ── Tools ─────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'search_errors',
    description: 'Search for formula errors (#REF!, #DIV/0!, #N/A, #VALUE!, #NAME?, #NUM!, IFERROR) in the model',
    input_schema: {
      type: 'object',
      properties: {
        error_type: { type: 'string', description: 'Error type: ALL, #REF!, #DIV/0!, #N/A, #VALUE!, #NAME?, #NUM!, IFERROR' },
        sheet_name: { type: 'string', description: 'Optional: specific sheet name' }
      },
      required: ['error_type']
    }
  },
  {
    name: 'get_section',
    description: 'Get content from a specific sheet around a keyword',
    input_schema: {
      type: 'object',
      properties: {
        sheet_name: { type: 'string' },
        keyword: { type: 'string' },
        context_lines: { type: 'number' }
      },
      required: ['sheet_name', 'keyword']
    }
  },
  {
    name: 'scan_sheet',
    description: 'Scan a sheet for a pattern, or list all content if no pattern given',
    input_schema: {
      type: 'object',
      properties: {
        sheet_name: { type: 'string' },
        pattern: { type: 'string' }
      },
      required: ['sheet_name']
    }
  },
  {
    name: 'check_metric',
    description: 'Check a metric value against RE benchmarks',
    input_schema: {
      type: 'object',
      properties: {
        metric_name: { type: 'string', description: 'NOI_Margin|ICR|LVR|LTC|Dev_Margin_Residential|Dev_Margin_Commercial|TER|Distribution_Yield|IRR_Leverage_Ratio' },
        value: { type: 'number' },
        context: { type: 'string' }
      },
      required: ['metric_name', 'value']
    }
  },
  {
    name: 'finish_analysis',
    description: 'Output the final structured audit report. Call when analysis is complete.',
    input_schema: {
      type: 'object',
      properties: {
        report: {
          type: 'object',
          properties: {
            modelName: { type: 'string' },
            modelType: { type: 'string' },
            sector: { type: 'string' },
            geography: { type: 'string' },
            verdict: { type: 'string' },
            summary: { type: 'object' },
            findings: { type: 'array' },
            priorities: { type: 'array' },
            keyMetrics: { type: 'object' },
            scope: { type: 'string' }
          },
          required: ['modelName', 'modelType', 'verdict', 'findings', 'keyMetrics']
        }
      },
      required: ['report']
    }
  }
];

// ── Tool Executor ─────────────────────────────────────────────────────────────
function executeTool(name, input, modelText, sheetsVisited) {
  const lines = modelText.split('\n');

  if (name === 'search_errors') {
    const errorType = input.error_type;
    const sheetName = input.sheet_name;

    // Special case: search for IFERROR-wrapped cells
    if (errorType === 'IFERROR') {
      let currentSheet = '';
      const results = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('## Sheet:')) { currentSheet = line.replace('## Sheet:', '').trim(); continue; }
        if (sheetName && currentSheet !== sheetName) continue;
        if (line.includes('[IFERROR:=')) {
          results.push('[' + currentSheet + '] ' + line.trim().slice(0, 120));
        }
      }
      if (!results.length) return 'No IFERROR-wrapped cells found' + (sheetName ? ' in ' + sheetName : '') + '.';
      return results.length + ' IFERROR-wrapped cells:\n' + results.slice(0, 25).join('\n') + (results.length > 25 ? '\n...+' + (results.length - 25) + ' more' : '');
    }

    const errors = errorType === 'ALL'
      ? ['#REF!', '#DIV/0!', '#N/A', '#VALUE!', '#NAME?', '#NUM!', '[IFERROR:=']
      : [errorType];

    let currentSheet = '';
    const results = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('## Sheet:')) { currentSheet = line.replace('## Sheet:', '').trim(); continue; }
      if (sheetName && currentSheet !== sheetName) continue;
      for (let e = 0; e < errors.length; e++) {
        const err = errors[e];
        if (line.includes(err)) {
          const safe = err.replace(/[!/?[\]]/g, '\\$&');
          const count = (line.match(new RegExp(safe, 'g')) || []).length;
          results.push('[' + currentSheet + '] ' + line.trim().slice(0, 120) + ' (' + count + 'x ' + err + ')');
          break;
        }
      }
    }

    if (!results.length) return 'No ' + errorType + ' errors found' + (sheetName ? ' in ' + sheetName : '') + '.';
    return results.length + ' lines with errors:\n' + results.slice(0, 25).join('\n') + (results.length > 25 ? '\n...+' + (results.length - 25) + ' more' : '');
  }

  if (name === 'get_section') {
    const sheetName = input.sheet_name;
    const keyword = input.keyword;
    const contextLines = input.context_lines || 10;
    let inSheet = false;
    const sheetLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('## Sheet:')) { inSheet = line.includes(sheetName); continue; }
      if (inSheet) sheetLines.push(line);
    }

    if (!sheetLines.length) {
      const available = [];
      for (const m of modelText.matchAll(/## Sheet: (.+)/g)) available.push(m[1]);
      return "Sheet '" + sheetName + "' not found. Available: " + available.join(', ');
    }

    sheetsVisited.add(sheetName);

    let idx = -1;
    for (let i = 0; i < sheetLines.length; i++) {
      if (sheetLines[i].toLowerCase().includes(keyword.toLowerCase())) { idx = i; break; }
    }
    if (idx === -1) return "'" + keyword + "' not found in " + sheetName + ". Sample:\n" + sheetLines.slice(0, 15).join('\n');

    const start = Math.max(0, idx - 3);
    return "'" + keyword + "' in " + sheetName + " (line " + idx + "):\n" + sheetLines.slice(start, idx + contextLines).join('\n');
  }

  if (name === 'scan_sheet') {
    const sheetName = input.sheet_name;
    const pattern = input.pattern;
    let inSheet = false;
    const results = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('## Sheet:')) { inSheet = line.includes(sheetName); continue; }
      if (!inSheet) continue;
      if (!pattern || line.toLowerCase().includes(pattern.toLowerCase())) {
        if (line.trim()) results.push(line.trim().slice(0, 150));
      }
    }

    if (!results.length) return 'Nothing found in \'' + sheetName + '\'' + (pattern ? " matching '" + pattern + "'" : '') + '.';

    sheetsVisited.add(sheetName);

    return sheetName + (pattern ? " ('" + pattern + "')" : '') + ': ' + results.length + ' lines\n' + results.slice(0, 35).join('\n');
  }

  if (name === 'check_metric') {
    const metricName = input.metric_name;
    const value = input.value;
    const context = input.context || '';

    const benchmarks = {
      NOI_Margin:             { normal: [0.75, 0.90], redBelow: 0.70, unit: '%', x100: true },
      ICR:                    { normal: [1.5, null],  redBelow: 1.2,  unit: 'x' },
      LVR:                    { normal: [0.40, 0.60], redAbove: 0.65, unit: '%', x100: true },
      LTC:                    { normal: [0.55, 0.70], redAbove: 0.75, unit: '%', x100: true },
      Dev_Margin_Residential: { normal: [0.15, 0.25], redBelow: 0.10, unit: '%', x100: true },
      Dev_Margin_Commercial:  { normal: [0.08, 0.15], redBelow: 0.05, unit: '%', x100: true },
      TER:                    { normal: [null, 0.015], redAbove: 0.02, unit: '%', x100: true },
      Distribution_Yield:     { normal: [0.03, 0.06], redBelow: 0.02, redAbove: 0.08, unit: '%', x100: true },
      IRR_Leverage_Ratio:     { normal: [1.3, 2.0],  redAbove: 2.5,  unit: 'x' },
    };

    const b = benchmarks[metricName];
    if (!b) return 'No benchmark for \'' + metricName + '\'. Value: ' + value;

    const fmt = function(v) { return b.x100 ? (v * 100).toFixed(1) + b.unit : v.toFixed(2) + b.unit; };
    let flag = '';
    if (b.redBelow !== undefined && value < b.redBelow) flag = 'RED FLAG: below ' + fmt(b.redBelow);
    if (b.redAbove !== undefined && value > b.redAbove) flag = 'RED FLAG: above ' + fmt(b.redAbove);

    const range = b.normal.filter(Boolean).map(fmt).join('-');
    return metricName + ': ' + fmt(value) + ' -- ' + (flag || 'NORMAL') + '. Benchmark: ' + range + (context ? '. ' + context : '');
  }

  return 'Unknown tool: ' + name;
}

// ── Agentic Loop ──────────────────────────────────────────────────────────────
async function runAgenticLoop(client, modelText, modelType, totalSheets) {
  const messages = [];
  const toolsUsed = [];
  const toolCallCount = {};
  const sheetsVisited = new Set();
  let inputTokens = 0, outputTokens = 0, cachedTokens = 0;
  let rounds = 0;

  const knowledgeKey = {
    'Core Hold': 'core_hold', 'Dev-Sell': 'development',
    'Dev-Hold-Sell': 'development', 'BTR': 'btr', 'PBSA': 'pbsa',
    'Fund': 'fund', 'JV-Waterfall': 'jv_waterfall',
  }[modelType] || '';

  const knowledge = RE_KNOWLEDGE.universal + (knowledgeKey ? '\n\n' + RE_KNOWLEDGE[knowledgeKey] : '');

  messages.push({
    role: 'user',
    content: [{
      type: 'text',
      text: 'Audit this real estate financial model. Follow the STRICT WORKFLOW below.\n\nRE KNOWLEDGE:\n' + knowledge + '\n\nMODEL CONTENT (includes Sheet Overview at top -- read it first):\n' + modelText.slice(0, 160000),
      cache_control: { type: 'ephemeral' }
    }]
  });

  const systemPrompt = [{
    type: 'text',
    text: `You are Verifi, an automated RE financial model audit engine built by a CFA-qualified analyst with 15+ years institutional experience.

The model content starts with a SHEET OVERVIEW listing all sheets with dimensions and first-row previews. Use this to understand model structure without calling scan_sheet unnecessarily.

STRICT WORKFLOW -- follow exactly:
Step 1 (round 1): search_errors with error_type="ALL" -- finds all errors including IFERROR-wrapped cells
Step 2 (rounds 2-4): get_section on the most important sheets identified from the overview -- investigate specific issues from Step 1
Step 3 (rounds 5-7): check_metric for key values found, and get_section to trace root causes
Step 4 (round 8 HARD LIMIT): call finish_analysis with all findings -- no exceptions

HARD LIMIT: You MUST call finish_analysis by round 8. Do not keep investigating. An incomplete-but-delivered report is better than no report.

In finish_analysis findings, include: specific cell references, actual numbers, IRR impact, concrete fix.
Flag: IFERROR-wrapped errors (silent failures), hardcoded values affecting IRR/NOI, exit cap rate assumptions, debt drawdown not equal to repayment.`,
    cache_control: { type: 'ephemeral' }
  }];

  while (rounds < 12) {
    rounds++;

    // Force finish at round 9
    if (rounds === 9) {
      messages.push({
        role: 'user',
        content: 'FINAL ROUND: You must call finish_analysis NOW with all findings gathered so far. Do not call any other tool.'
      });
    }

    const res = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    const usage = res.usage || {};
    inputTokens += usage.input_tokens || 0;
    outputTokens += usage.output_tokens || 0;
    cachedTokens += usage.cache_read_input_tokens || 0;

    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason === 'end_turn') break;

    if (res.stop_reason === 'tool_use') {
      const toolResults = [];

      for (let i = 0; i < res.content.length; i++) {
        const block = res.content[i];
        if (block.type !== 'tool_use') continue;

        toolsUsed.push(block.name);
        toolCallCount[block.name] = (toolCallCount[block.name] || 0) + 1;

        if (block.name === 'finish_analysis') {
          const report = block.input.report;

          const coverageRate = totalSheets > 0
            ? Math.round((sheetsVisited.size / totalSheets) * 100) : 0;

          const estCostUSD = (
            (inputTokens * 3) +
            (outputTokens * 15) +
            (cachedTokens * 0.3)
          ) / 1_000_000;

          report.metrics = {
            rounds,
            inputTokens,
            outputTokens,
            cachedTokens,
            cacheHitRate: (inputTokens + cachedTokens) > 0
              ? Math.round((cachedTokens / (inputTokens + cachedTokens)) * 100) + '%'
              : '0%',
            coverageRate: coverageRate + '% (' + sheetsVisited.size + '/' + totalSheets + ' sheets)',
            sheetsVisited: Array.from(sheetsVisited),
            toolCallCount,
            toolsUsed,
            estimatedCostUSD: estCostUSD.toFixed(4)
          };
          return report;
        }

        const result = executeTool(block.name, block.input, modelText, sheetsVisited);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      }

      if (toolResults.length) messages.push({ role: 'user', content: toolResults });
    }
  }

  // Fallback
  const coverageRate = totalSheets > 0
    ? Math.round((sheetsVisited.size / totalSheets) * 100) : 0;

  return {
    modelName: 'Unknown', modelType, sector: 'Unknown', geography: 'Unknown',
    verdict: 'WARN',
    summary: { fail: 0, warn: 1, pass: 0, total: 1 },
    findings: [{ id: 'SYS-01', layer: 0, status: 'WARN', title: 'Analysis incomplete',
      impact: 'MEDIUM', description: 'Reached ' + rounds + ' rounds without completing.',
      irrImpact: null, cells: [], fix: 'Review manually' }],
    priorities: [], keyMetrics: {},
    metrics: {
      rounds, inputTokens, outputTokens, cachedTokens, toolCallCount, toolsUsed,
      coverageRate: coverageRate + '% (' + sheetsVisited.size + '/' + totalSheets + ' sheets)',
      sheetsVisited: Array.from(sheetsVisited),
      estimatedCostUSD: ((inputTokens * 3 + outputTokens * 15) / 1_000_000).toFixed(4)
    }
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
    const boundary = (req.headers['content-type'] || '').match(/boundary=(.+)/);
    if (!boundary) return res.status(400).json({ error: 'Invalid multipart request' });

    const headerStr = buffer.slice(0, 500).toString();
    const filenameMatch = headerStr.match(/filename="(.+?)"/);
    const filename = filenameMatch ? filenameMatch[1] : 'model.xlsx';

    const boundaryBuf = Buffer.from('--' + boundary[1]);
    const positions = [];
    for (let i = 0; i <= buffer.length - boundaryBuf.length; i++) {
      if (buffer.slice(i, i + boundaryBuf.length).equals(boundaryBuf)) {
        positions.push(i);
        i += boundaryBuf.length - 1;
      }
    }

    if (positions.length < 2) {
      return res.status(400).json({ error: 'Multipart parse failed: found ' + positions.length + ' boundaries' });
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

    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 16);

    if (resultCache.has(fileHash)) {
      return res.status(200).json({
        ...resultCache.get(fileHash),
        cached: true,
        analysisTime: ((Date.now() - startTime) / 1000).toFixed(1) + 's (cached)'
      });
    }

    let modelText;
    try {
      modelText = extractExcelText(fileBuffer);
    } catch (parseErr) {
      return res.status(400).json({ error: 'Could not parse Excel file: ' + parseErr.message });
    }

    if (!modelText || modelText.length < 100) {
      return res.status(400).json({ error: 'Could not extract content from file. Ensure it is a valid Excel file.' });
    }

    // Count total sheets
    const totalSheets = (modelText.match(/^## Sheet: /mg) || []).length;

    // Detect model type
    const sheets = [];
    for (const m of modelText.matchAll(/## Sheet: (.+)/g)) sheets.push(m[1].toLowerCase());
    const text = modelText.toLowerCase();
    let modelType = 'Mixed';

    if (text.includes('build-to-rent') || text.includes(' btr') || sheets.some(function(s) { return s.includes('btr'); })) {
      modelType = 'BTR';
    } else if (sheets.some(function(s) { return s.includes('promote') || s.includes('waterfall'); })) {
      modelType = 'JV-Waterfall';
    } else if (
      sheets.some(function(s) { return s.includes('fund') || s.includes('portfolio') || s.includes('returns') || s.includes('calculator'); }) ||
      text.includes('net asset value') || text.includes('management fee') ||
      text.includes('unit price') || text.includes('distribution per unit')
    ) {
      modelType = 'Fund';
    } else if (text.includes('beds') && (text.includes('pbsa') || text.includes('student'))) {
      modelType = 'PBSA';
    } else if (text.includes('construction cost') || text.includes('development cost') || text.includes('total project cost')) {
      modelType = 'Dev-Hold-Sell';
    } else if (sheets.some(function(s) { return s.includes('tenant') || s.includes('lease'); })) {
      modelType = 'Core Hold';
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const report = await runAgenticLoop(client, modelText, modelType, totalSheets);

    if (resultCache.size >= 50) resultCache.delete(resultCache.keys().next().value);
    resultCache.set(fileHash, report);

    res.status(200).json({
      ...report,
      cached: false,
      analysisTime: ((Date.now() - startTime) / 1000).toFixed(1) + 's',
      fileInfo: { name: filename, hash: fileHash, textLength: modelText.length, sheets: totalSheets }
    });

  } catch (err) {
    console.error('Verifi error:', err);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
}
