import { put } from '@vercel/blob';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({
      error: 'Blob store not configured — add BLOB_READ_WRITE_TOKEN to your environment.',
    });
  }

  const form = formidable({ maxFileSize: 50 * 1024 * 1024 });
  let filePath = null;

  try {
    const [, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    filePath = file.filepath;

    const blob = await put(
      file.originalFilename || 'model.xlsx',
      fs.createReadStream(filePath),
      {
        access: 'public',
        contentType: file.mimetype || 'application/octet-stream',
      }
    );

    return res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error('blob-upload error:', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    if (filePath) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
}
