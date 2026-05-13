import Anthropic from '@anthropic-ai/sdk';

export const config = {
  maxDuration: 300,
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

const SYSTEM_PROMPT = `You are Verifi, a financial model verification engine built by a CFA-qualified real estate investment professional with 15+ years experience reviewing residential development, commercial RE, industrial, BTR, PBSA, debt, and fund of funds models.

CORE PHILOSOPHY:
Think like a seasoned fund manager reviewing this model. You have full access to the Excel file via code execution. Use Python iteratively — explore, discover, verify. Do not stop until you have thoroughly analysed the model.

ANALYSIS APPROACH:
1. Start by loading the file and listing all sheets with dimensions
2. Read the Inputs sheet fully — find geography, key assumptions, model date
3. Identify cashflow, IRR, and debt sheets by name
4. For each key sheet: find rows containing financial keywords, read those rows completely
5. Verify accounting identities: debt drawdown = repayment, sources = uses
6. Calculate WACD from the debt schedule
7. Check ICR every period
8. Count #REF! errors by sheet — use data_only=False to see formula errors
9. Identify hardcoded values that affect key outputs
10. Only stop when you have enough data to produce a thorough report

TECHNICAL NOTES:
- Use openpyxl with data_only=True to read calculated values
- Use openpyxl with data_only=False to see formulas and detect #REF! errors
- Use pandas for summing time series (drawdown totals, repayment totals, interest totals)
- The file is available in your sandbox — find it with: import os; os.listdir('.')
- Geography is in the Inputs sheet — scan for address/suburb/state/postcode keywords

You are an expert in:
- Universal cash flow chain: Gross Revenue → NOI → AFFO → Net Levered CF → Equity IRR
- WACD = Σ(Interest_t) / Σ(Average_Debt_t) — derive from debt schedule
- Leverage: E-IRR = Unlev IRR + (Unlev IRR - WACD) × D/E
- Model types: Core Hold, Dev-Sell, Dev-Hold-Sell, BTR, PBSA, Fund
- Four yield concepts: Passing, Reversionary, Equivalent, Market
- Debt structures: construction loan, term facility, refi, capex facility

When done, output ONLY valid JSON:
{
  "modelName": "string",
  "modelType": "Core Hold | Dev-Sell | Dev-Hold-Sell | BTR | PBSA | Fund | Mixed",
  "sector": "string",
  "geography": "string — from Inputs sheet, Unknown if not found",
  "verdict": "FAIL | WARN | PASS",
  "summary": { "fail": 0, "warn": 0, "pass": 0, "total": 0 },
  "findings": [{
    "id": "S-02",
    "layer": 1,
    "status": "FAIL | WARN | PASS",
    "title": "string",
    "impact": "HIGH | MEDIUM | LOW | NONE",
    "description": "string — specific, with actual numbers and cell references",
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
  "scope": "This report checks structural and mathematical integrity. A clean Verifi report is necessary but not sufficient for a reliable model."
}

METRICS FORMAT: clean numbers only e.g. "21.9%", "4.4%", "$187/sqm". No parenthetical text.
DYNAMIC METRICS: only populate metrics relevant to the model type. Null for all others.`;

function generateReportHtml(report) {
  const now = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const statusColor = { FAIL: '#b83224', WARN: '#7a5200', PASS: '#1a6b3c' };
  const statusBg = { FAIL: '#fdf0ee', WARN: '#fdf6e3', PASS: '#edf5f0' };

  const findingHtml = (f) => {
    const cellsHtml = f.cells && f.cells.length > 0
      ? `<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px">${f.cells.slice(0, 8).map(c => `
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
      parts.push({ name: nameMatch[1], filename: filenameMatch ? filenameMatch[1] : null, data: buffer.slice(dataStart, dataEnd) });
    }
    start = nextBoundary === -1 ? buffer.length : nextBoundary;
  }
  return parts;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const contentType = req.headers['content-type'] || '';
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) return res.status(400).json({ error: 'No boundary' });

    const parts = parseMultipart(buffer, boundary);
    const filePart = parts.find(p => p.name === 'file');
    const cellsScannedPart = parts.find(p => p.name === 'cellsScanned');
    if (!filePart) return res.status(400).json({ error: 'No file' });

    const fileBytes = filePart.data;
    const fileName = filePart.filename || 'model.xlsx';
    const cellsScanned = cellsScannedPart ? parseInt(cellsScannedPart.data.toString()) : null;

    // Upload file to Anthropic
    console.log('Uploading:', fileName, fileBytes.length, 'bytes');
    const fileBlob = new Blob([fileBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const uploadedFile = await client.beta.files.upload(
      { file: new File([fileBlob], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) },
      { betas: ['files-api-2025-04-14'] }
    );
    const fileId = uploadedFile.id;
    console.log('File ID:', fileId);

    let report = null;
    let containerId = null;

    try {
      // Agentic loop — Claude iterates freely until done
      const messages = [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Analyse this Excel financial model thoroughly. Use code execution to explore the file iteratively. Take as many steps as you need. When you have completed your analysis, output the JSON report.',
          },
          { type: 'container_upload', file_id: fileId },
        ],
      }];

      const MAX_ITERATIONS = 15;
      let iterations = 0;

      while (iterations < MAX_ITERATIONS) {
        iterations++;
        console.log(`Iteration ${iterations}...`);

        const requestBody = {
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          betas: ['files-api-2025-04-14'],
          system: [{
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          }],
          tools: [{ type: 'code_execution_20250825', name: 'code_execution' }],
          messages,
        };

        // Reuse container after first iteration
        if (containerId) requestBody.container = containerId;

        const response = await client.beta.messages.create(requestBody);

        // Save container ID for reuse
        if (response.container?.id && !containerId) {
          containerId = response.container.id;
          console.log('Container ID:', containerId);
        }

        console.log(`Iteration ${iterations} stop_reason:`, response.stop_reason);

        // Add assistant response to message history
        messages.push({ role: 'assistant', content: response.content });

        // Check if Claude is done
        if (response.stop_reason === 'end_turn') {
          // Extract JSON from final response
          const text = (response.content || [])
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('');

          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            report = JSON.parse(jsonMatch[0]);
            console.log('Report extracted after', iterations, 'iterations');
            break;
          }
          // Claude said end_turn but no JSON yet — ask for it
          messages.push({
            role: 'user',
            content: 'Please now output your complete findings as a single valid JSON object following the schema in your instructions.',
          });
        } else if (response.stop_reason === 'tool_use') {
          // Claude wants to run more code — continue loop
          // Tool results are already in response.content, add user turn to continue
          const toolResults = (response.content || [])
            .filter(b => b.type === 'tool_use')
            .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));

          if (toolResults.length > 0) {
            messages.push({ role: 'user', content: toolResults });
          }
        } else {
          // Unexpected stop reason
          console.log('Unexpected stop_reason:', response.stop_reason);
          break;
        }
      }

    } finally {
      await client.beta.files.delete(fileId, { betas: ['files-api-2025-04-14'] }).catch(() => {});
    }

    if (!report) throw new Error('No report generated after ' + MAX_ITERATIONS + ' iterations');

    report.cellsScanned = cellsScanned;
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

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Analysis failed', detail: err.message });
  }
}
