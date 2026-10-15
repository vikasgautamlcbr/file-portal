'use strict';

const { passwordMatches } = require('../lib/config');

// Lets the page tell the visitor about a wrong password, or a server setup
// problem, before uploading.
module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  // Catch a missing store connection here, before the visitor starts uploading.
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({
      error: 'Uploads are not set up yet: no Blob store is connected to this project (BLOB_STORE_ID is missing).',
    });
  }
  if (!process.env.UPLOAD_PASSWORD) {
    return res.status(500).json({ error: 'Uploads are not set up yet: UPLOAD_PASSWORD is missing on the server.' });
  }
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  res.status(passwordMatches(password) ? 204 : 401).end();
};
