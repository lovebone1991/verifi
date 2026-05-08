import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: { bodyParser: false },
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let tempPath = null;

  try {
    const form = formidable({ maxFileSize: 20 * 1024 * 1024, keepExtensions: true });
    const [, files] = await form.parse(req);

    const fileField = files.file;
    const file = Array.isArray(fileField) ? fileField[0] : fileField;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    tempPath = file.filepath;
    const originalName = file.originalFilename || 'model.xlsx';

    const workbook = XLSX.readFile(tempPath, { cellFormula: true, cellNF: true, cellStyles: false });

    const sheetNames = workbook.SheetNames;
    const sheetData = [];

    for (const name of sheetNames.slice(0, 12)) {
      const ws = workbook.Sheets[name];
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
      const rows = range.e.r - range.s.r + 1;
      const cols = range.e.c - range.s.c + 1;

      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      const csvLines = csv.split('\n').filter(l => l.trim() && l.replace(/,/g, '').trim());

      const formulaSamples = [];
      for (const addr in ws) {
        if (addr.startsWith('!')) continue;
        const cell = ws[addr];
        if (cell && cell.f) {
          formulaSamples.push(`${addr}: =${cell.f}`);
          if (formulaSamples.length >= 30) break;
        }
      }

      sheetData.push({
        name,
        dimensions: `${rows} rows × ${cols} cols`,
        preview: csvLines.slice(0, 60).join('\n'),
        formulas: formulaSamples,
      });
    }

    const modelContext = sheetData.map(s => [
      `=== Sheet: "${s.name}" (${s.dimensions}) ===`,
      s.preview,
      s.formulas.length > 0 ? `\n--- Sample Formulas ---\n${s.formulas.join('\n')}` : '',
    ].join('\n')).join('\n\n');

    const prompt = `You are a senior real estate financial model auditor. Analyze the following Excel financial model data extracted from "${originalName}".

Your job is to:
1. Identify assumptions that appear aggressive, conservative, or unusual compared to typical CRE underwriting standards
2. Flag potential formula errors, hardcoded values that should be dynamic, or structural issues
3. Check for internal consistency (e.g., NOI = Revenue - Expenses, Debt service coverage, cap rate implied by exit price)
4. Note any missing critical tabs or inputs (rent roll, operating expenses, debt schedule, sensitivity analysis)
5. Rate each finding by severity: Critical, High, Medium, Low, or Info

Return ONLY a valid JSON object with this exact shape (no markdown, no code fences):
{
  "summary": "2-4 sentence executive summary of the model quality and key concerns",
  "findings": [
    {
      "severity": "Critical|High|Medium|Low|Info",
      "title": "Short finding title",
      "detail": "Detailed explanation of what was found and why it matters",
      "recommendation": "Specific action to fix or investigate",
      "location": "Sheet name and cell/range if known, else null"
    }
  ]
}

Provide between 3 and 15 findings. Be specific — cite sheet names and cell references where visible.

=== MODEL DATA ===
${modelContext}`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = message.content[0]?.text || '{}';

    let parsed;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      parsed = { summary: rawText, findings: [] };
    }

    return res.status(200).json({
      fileName: originalName,
      sheetCount: sheetNames.length,
      summary: parsed.summary || null,
      findings: parsed.findings || [],
      rawAnalysis: parsed.findings?.length === 0 ? rawText : undefined,
    });
  } catch (err) {
    console.error('Analyze error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }
}
