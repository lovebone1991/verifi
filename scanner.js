// ── Verifi Model Scanner — Web Worker ────────────────────────────────────
// Runs in a separate thread to avoid blocking the UI during heavy Excel scanning

importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

// Keywords that indicate a row contains important financial data
const FINANCIAL_KEYWORDS = [
  // Return metrics
  'irr','npv','xirr','xnpv','equity multiple','em','moic','coc','cash on cash',
  // Income metrics
  'noi','net operating income','gross income','effective income','revenue','rental income',
  'passing rent','market rent','face rent','gross rent',
  // Cost metrics
  'outgoings','opex','operating expense','statutory','land tax','rates','insurance',
  'capex','capital expenditure','tenant incentive','fitout','leasing commission','make good',
  // Development metrics
  'tpc','total project cost','gdv','gross development value','rlv','residual land',
  'development margin','dev margin','construction cost','soft cost','contingency',
  // Debt metrics
  'debt','loan','facility','drawdown','repayment','interest','icr','dscr','lvr','ltc','ltv',
  'covenant','senior','mezzanine','equity',
  // Valuation metrics
  'cap rate','capitalisation rate','yield','passing yield','reversionary yield',
  'equivalent yield','market yield','wale','walt','valuation','value',
  // Fund metrics
  'nav','gav','distribution','distributable','management fee','performance fee',
  'promote','waterfall','hurdle',
  // Check rows (critical — these are internal model checks)
  'check','error','balance','reconcil','variance','difference','sum check',
  // Summary words
  'total','net','gross','summary','subtotal','aggregate',
];

// High-value Excel functions — rows containing these are always captured
const HIGH_VALUE_FUNCTIONS = [
  'xirr(', 'xnpv(', 'irr(', 'npv(', 'sumproduct(', 'offset(', 
  'indirect(', 'mmult(', 'transpose(', 'frequency(',
];

function rowMatchesKeyword(rowLabel) {
  if (!rowLabel) return false;
  const lower = String(rowLabel).toLowerCase();
  return FINANCIAL_KEYWORDS.some(kw => lower.includes(kw));
}

function formulaIsHighValue(formula) {
  if (!formula) return false;
  const lower = formula.toLowerCase();
  return HIGH_VALUE_FUNCTIONS.some(fn => lower.includes(fn));
}

function processSheet(ws, sheetName) {
  if (!ws || !ws['!ref']) return null;

  const range = XLSX.utils.decode_range(ws['!ref']);
  const totalRows = range.e.r + 1;
  const totalCols = range.e.c + 1;

  const result = {
    name: sheetName,
    dimensions: { rows: totalRows, cols: totalCols },
    refErrors: [],
    hardcodes: [],
    keyRows: {},           // rows captured by keyword/formula matching
    namedRanges: [],
    checkRows: [],         // internal model check rows (value should be 0)
    hiddenRows: [],
    hiddenCols: [],
    formulaCount: 0,
    valueCount: 0,
    // Dependency tracking
    crossSheetRefs: [],    // references to other sheets
    // Time series sampling
    timeSeriesRows: {},    // sampled columns for time series rows
  };

  // ── Scan hidden rows/cols ──────────────────────────────────────────────
  if (ws['!rows']) {
    ws['!rows'].forEach((row, i) => {
      if (row && row.hidden) result.hiddenRows.push(i);
    });
  }
  if (ws['!cols']) {
    ws['!cols'].forEach((col, i) => {
      if (col && col.hidden) result.hiddenCols.push(i);
    });
  }

  // ── Identify time series columns (detect repeating monthly/quarterly pattern) ──
  // Look at row 0-5 for date/period headers to detect time series
  const periodCols = [];
  for (let c = 0; c <= Math.min(range.e.c, 300); c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })] || 
                 ws[XLSX.utils.encode_cell({ r: 1, c })] ||
                 ws[XLSX.utils.encode_cell({ r: 2, c })];
    if (cell && cell.t === 'n' && cell.v > 40000 && cell.v < 60000) {
      // Excel date serial — this is a date column
      periodCols.push(c);
    }
  }
  // Sample: first period, every 12th period (annual), last period
  const sampledCols = new Set();
  if (periodCols.length > 0) {
    sampledCols.add(periodCols[0]);
    for (let i = 11; i < periodCols.length; i += 12) sampledCols.add(periodCols[i]);
    sampledCols.add(periodCols[periodCols.length - 1]);
  }

  // ── Main cell scan ─────────────────────────────────────────────────────
  // Track row density for section boundary detection
  const rowDensity = new Array(totalRows).fill(0);
  const rowLabels = {}; // col A or B text for each row

  for (let r = 0; r <= range.e.r; r++) {
    // Grab row label from col A or B
    const labelCellA = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const labelCellB = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    const label = labelCellA?.v || labelCellB?.v || '';
    rowLabels[r] = label;

    for (let c = 0; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;

      rowDensity[r]++;

      if (cell.f) {
        result.formulaCount++;

        // Detect #REF! errors
        if (cell.f.includes('#REF!')) {
          result.refErrors.push({
            ref: `${sheetName}!${addr}`,
            formula: cell.f.substring(0, 100),
            iferrorWrapped: cell.f.toUpperCase().includes('IFERROR'),
            value: cell.v,
          });
        }

        // Detect cross-sheet references
        const crossSheetMatch = cell.f.match(/[A-Za-z0-9_\s]+!/g);
        if (crossSheetMatch) {
          crossSheetMatch.forEach(ref => {
            const refSheet = ref.replace('!', '').trim();
            if (refSheet !== sheetName && !result.crossSheetRefs.includes(refSheet)) {
              result.crossSheetRefs.push(refSheet);
            }
          });
        }

        // High-value formula rows — always capture
        if (formulaIsHighValue(cell.f)) {
          const rowKey = `row_${r}`;
          if (!result.keyRows[rowKey]) result.keyRows[rowKey] = { label, cells: {}, r };
          result.keyRows[rowKey].cells[addr] = {
            f: cell.f.substring(0, 150),
            v: typeof cell.v === 'number' ? Math.round(cell.v * 10000) / 10000 : cell.v,
            highValue: true,
          };
        }

      } else if (cell.v !== undefined && cell.v !== null && cell.v !== '') {
        result.valueCount++;

        // Hardcoded numbers > 1000 in non-input areas
        if (typeof cell.v === 'number' && Math.abs(cell.v) > 1000 && r > 10) {
          result.hardcodes.push({
            ref: `${sheetName}!${addr}`,
            value: Math.round(cell.v),
            row: r,
          });
        }
      }

      // Time series sampling — capture sampled columns for keyword rows
      if (sampledCols.has(c) && cell.v !== undefined) {
        const rowKey = `row_${r}`;
        if (result.keyRows[rowKey]) {
          result.keyRows[rowKey].cells[addr] = {
            v: typeof cell.v === 'number' ? Math.round(cell.v * 100) / 100 : cell.v,
            timeSeries: true,
          };
        }
      }
    }

    // After scanning row — check if label matches financial keywords
    if (rowMatchesKeyword(label)) {
      const rowKey = `row_${r}`;
      if (!result.keyRows[rowKey]) result.keyRows[rowKey] = { label, cells: {}, r };
      
      // Capture this entire row (or sampled cols for wide sheets)
      const colLimit = totalCols > 50 ? null : range.e.c; // full row if narrow, else sample
      const colsToCapture = colLimit !== null 
        ? Array.from({length: colLimit + 1}, (_, i) => i)
        : [...sampledCols, 0, 1, 2, range.e.c]; // label cols + sampled + last col

      for (const c of colsToCapture) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell && cell.v !== undefined) {
          result.keyRows[rowKey].cells[addr] = {
            v: typeof cell.v === 'number' ? Math.round(cell.v * 100) / 100 : cell.v,
            f: cell.f ? cell.f.substring(0, 80) : undefined,
          };
        }
      }

      // Detect internal check rows (label contains 'check'/'balance' and value ≈ 0)
      const lastCol = ws[XLSX.utils.encode_cell({ r, c: range.e.c })];
      const isCheckRow = String(label).toLowerCase().match(/check|balance|reconcil|error/);
      if (isCheckRow && lastCol && typeof lastCol.v === 'number' && Math.abs(lastCol.v) > 0.01) {
        result.checkRows.push({
          ref: `${sheetName}!row_${r}`,
          label,
          value: lastCol.v,
          note: 'Check row has non-zero value — possible model error',
        });
      }
    }
  }

  // ── Detect section boundaries via density analysis ─────────────────────
  // Find rows where density drops significantly (section breaks)
  const avgDensity = rowDensity.reduce((a, b) => a + b, 0) / totalRows;
  const sectionBoundaries = [];
  for (let r = 1; r < totalRows - 1; r++) {
    const prev = rowDensity[r - 1];
    const curr = rowDensity[r];
    if (prev > avgDensity * 1.5 && curr < avgDensity * 0.3) {
      sectionBoundaries.push(r); // density drop = section end
    }
  }

  // Capture rows just before section boundaries (usually subtotals/totals)
  for (const boundary of sectionBoundaries) {
    const r = boundary - 1;
    const label = rowLabels[r] || '';
    const rowKey = `row_${r}_boundary`;
    if (!result.keyRows[rowKey]) {
      result.keyRows[rowKey] = { label, cells: {}, r, isBoundary: true };
      // Capture last non-empty value in this row
      for (let c = range.e.c; c >= 0; c--) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell && cell.v !== undefined) {
          result.keyRows[rowKey].cells[addr] = {
            v: typeof cell.v === 'number' ? Math.round(cell.v * 100) / 100 : cell.v,
          };
          break;
        }
      }
    }
  }

  // ── Capture last row of sheet (often grand total) ──────────────────────
  for (let r = range.e.r; r >= Math.max(0, range.e.r - 5); r--) {
    let hasData = false;
    for (let c = 0; c <= range.e.c; c++) {
      if (ws[XLSX.utils.encode_cell({ r, c })]) { hasData = true; break; }
    }
    if (hasData) {
      const rowKey = `row_${r}_last`;
      if (!result.keyRows[rowKey]) {
        result.keyRows[rowKey] = { label: rowLabels[r] || 'Last row', cells: {}, r, isLastRow: true };
        for (let c = 0; c <= Math.min(range.e.c, 20); c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (cell && cell.v !== undefined) {
            result.keyRows[rowKey].cells[addr] = {
              v: typeof cell.v === 'number' ? Math.round(cell.v * 100) / 100 : cell.v,
            };
          }
        }
      }
      break;
    }
  }

  // Limit keyRows to prevent token explosion — keep top 80 most important
  const keyRowEntries = Object.entries(result.keyRows);
  if (keyRowEntries.length > 80) {
    // Prioritise: highValue > checkRow > boundary > keyword match
    keyRowEntries.sort((a, b) => {
      const aScore = (Object.values(a[1].cells).some(c => c.highValue) ? 3 : 0) +
                     (a[1].isBoundary ? 1 : 0) + (a[1].isLastRow ? 2 : 0);
      const bScore = (Object.values(b[1].cells).some(c => c.highValue) ? 3 : 0) +
                     (b[1].isBoundary ? 1 : 0) + (b[1].isLastRow ? 2 : 0);
      return bScore - aScore;
    });
    result.keyRows = Object.fromEntries(keyRowEntries.slice(0, 80));
  }

  // Limit refErrors and hardcodes to prevent token explosion
  result.refErrors = result.refErrors.slice(0, 50);
  result.hardcodes = result.hardcodes.slice(0, 30);

  return result;
}

// ── Main worker message handler ────────────────────────────────────────────
self.onmessage = function(e) {
  const { uint8, fileName } = e.data;

  try {
    self.postMessage({ type: 'progress', pct: 5, label: 'Loading workbook…' });

    const workbook = XLSX.read(uint8, {
      type: 'array',
      cellFormula: true,
      cellNF: false,
      cellStyles: true,   // needed for hidden detection
      sheetStubs: false,
    });

    // ── Named Ranges (global, across all sheets) ──────────────────────────
    const namedRanges = [];
    if (workbook.Workbook && workbook.Workbook.Names) {
      for (const name of workbook.Workbook.Names) {
        namedRanges.push({ name: name.Name, ref: name.Ref });
      }
    }

    // ── Build dependency graph from sheet names ────────────────────────────
    // (detailed cross-sheet refs built per-sheet below)
    const sheetDependencies = {};

    // ── Priority sheet ordering ────────────────────────────────────────────
    const priorityKeywords = [
      'summary','output','cashflow','cash flow','cf','irr','return',
      'input','assumption','debt','finance','financing','s&u','sources',
      'portfolio','venture','stage','dashboard','model','promote','waterfall',
      'valuation','noi','revenue','cost','development','hold',
    ];

    const allSheets = workbook.SheetNames;
    const prioritySheets = allSheets.filter(name =>
      priorityKeywords.some(k => name.toLowerCase().includes(k))
    );
    const otherSheets = allSheets.filter(name => !prioritySheets.includes(name));
    const orderedSheets = [...prioritySheets, ...otherSheets].slice(0, 50);

    const result = {
      sheetNames: allSheets,
      totalSheets: allSheets.length,
      namedRanges,
      sheetDependencies,
      globalStats: {
        totalRefErrors: 0,
        totalHardcodes: 0,
        totalCheckRowFailures: 0,
        sheetsWithErrors: [],
        hiddenSheets: [],
      },
      sheets: {},
    };

    // Detect hidden sheets
    if (workbook.Workbook && workbook.Workbook.Sheets) {
      workbook.Workbook.Sheets.forEach((s, i) => {
        if (s.Hidden) result.globalStats.hiddenSheets.push(allSheets[i]);
      });
    }

    // ── Process each sheet ────────────────────────────────────────────────
    for (let i = 0; i < orderedSheets.length; i++) {
      const sheetName = orderedSheets[i];
      const pct = 10 + Math.round((i / orderedSheets.length) * 80);
      self.postMessage({ type: 'progress', pct, label: `Scanning: ${sheetName}…` });

      const ws = workbook.Sheets[sheetName];
      const sheetResult = processSheet(ws, sheetName);

      if (sheetResult) {
        result.sheets[sheetName] = sheetResult;
        result.globalStats.totalRefErrors += sheetResult.refErrors.length;
        result.globalStats.totalHardcodes += sheetResult.hardcodes.length;
        result.globalStats.totalCheckRowFailures += sheetResult.checkRows.length;
        if (sheetResult.refErrors.length > 0) result.globalStats.sheetsWithErrors.push(sheetName);
        sheetDependencies[sheetName] = sheetResult.crossSheetRefs;
      }

      // Free memory after processing each sheet
      delete workbook.Sheets[sheetName];
    }

    self.postMessage({ type: 'progress', pct: 95, label: 'Preparing analysis…' });
    self.postMessage({ type: 'done', result });

  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
