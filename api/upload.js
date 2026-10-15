'use strict';

const { handleUpload } = require('@vercel/blob/client');
const { MAX_FILE_BYTES, PATHNAME_PATTERN, passwordMatches } = require('../lib/config');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// The browser calls this to get a short-lived token, then uploads the file
// straight to Vercel Blob. The file itself never passes through this function.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!process.env.UPLOAD_PASSWORD) {
    return res.status(500).json({ error: 'UPLOAD_PASSWORD is not set on the server.' });
  }

  try {
    const result = await handleUpload({
      request: req,
      body: req.body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!passwordMatches(clientPayload)) throw new HttpError(401, 'Wrong upload password.');
        if (!PATHNAME_PATTERN.test(pathname)) throw new HttpError(400, 'Invalid file name.');
        return {
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
    });
    res.status(200).json(result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 400;
    if (!(err instanceof HttpError)) console.error(err);
    res.status(status).json({ error: err instanceof HttpError ? err.message : 'Upload could not be started.' });
  }
};
