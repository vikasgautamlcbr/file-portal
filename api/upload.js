'use strict';

const { handleUploadPresigned } = require('@vercel/blob/client');
const { issueSignedToken } = require('@vercel/blob');
const { MAX_FILE_BYTES, PATHNAME_PATTERN, passwordMatches } = require('../lib/config');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The browser calls this to get a short-lived presigned URL, then uploads the
// file straight to Vercel Blob. The file itself never passes through here.
// Works with stores connected through OIDC (BLOB_STORE_ID) or with a
// BLOB_READ_WRITE_TOKEN.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!process.env.UPLOAD_PASSWORD) {
    return res.status(500).json({ error: 'UPLOAD_PASSWORD is not set on the server.' });
  }
  // This app never asks for upload-completed callbacks, so only accept URL requests.
  if (!req.body || req.body.type !== 'blob.generate-presigned-url') {
    return res.status(400).json({ error: 'Unsupported request.' });
  }

  try {
    const result = await handleUploadPresigned({
      request: req,
      body: req.body,
      // Only used to verify upload-completed callbacks, which are rejected above.
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY || 'unused',
      getSignedToken: async (pathname, clientPayload) => {
        if (!passwordMatches(clientPayload)) throw new HttpError(401, 'Wrong upload password.');
        if (!PATHNAME_PATTERN.test(pathname)) throw new HttpError(400, 'Invalid file name.');
        const validUntil = Date.now() + 60 * 60 * 1000;
        const token = await issueSignedToken({
          pathname,
          operations: ['put'],
          maximumSizeInBytes: MAX_FILE_BYTES,
          validUntil,
        });
        return {
          token,
          urlOptions: {
            maximumSizeInBytes: MAX_FILE_BYTES,
            addRandomSuffix: false,
            allowOverwrite: false,
            validUntil,
          },
        };
      },
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('Upload URL could not be created:', err);
    res.status(500).json({ error: 'Upload could not be started.' });
  }
};
