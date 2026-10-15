'use strict';

const { list } = require('@vercel/blob');
const { MAX_FILE_BYTES } = require('../lib/config');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const files = [];
    let cursor;
    do {
      const page = await list({ prefix: 'files/', cursor, limit: 1000 });
      for (const blob of page.blobs) {
        files.push({
          name: blob.pathname.split('/').pop(),
          size: blob.size,
          uploadedAt: new Date(blob.uploadedAt).toISOString(),
          downloadUrl: blob.downloadUrl,
        });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    res.status(200).json({ maxFileBytes: MAX_FILE_BYTES, files });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not list files.' });
  }
};
