import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('blob-upload: BLOB_READ_WRITE_TOKEN is not set');
    return res.status(500).json({
      error: 'Blob store not configured — add BLOB_READ_WRITE_TOKEN to your environment variables.',
    });
  }

  try {
    const body = req.body;

    // After upload the client POSTs blob.upload-completed — acknowledge and return
    if (body?.type !== 'blob.generate-client-token') {
      return res.status(200).json({ type: body?.type, response: 'ok' });
    }

    const { pathname } = body.payload ?? {};
    if (!pathname) {
      return res.status(400).json({ error: 'Missing pathname in payload' });
    }

    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      maximumSizeInBytes: 50 * 1024 * 1024,
      allowedContentTypes: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/vnd.ms-excel.sheet.macroEnabled.12',
      ],
      addRandomSuffix: true,
      validUntil: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    return res.status(200).json({ type: 'blob.generate-client-token', clientToken });
  } catch (err) {
    console.error('blob-upload error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
