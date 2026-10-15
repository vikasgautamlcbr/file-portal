'use strict';

const crypto = require('node:crypto');

const MAX_FILE_MB = 20;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

// Every upload lives at files/<timestamp>-<random>/<original name>.
// The folder keeps names unique; the last segment keeps the original name.
const PATHNAME_PATTERN = /^files\/\d{13}-[a-z0-9]{8}\/[^/\\]{1,200}$/;

function passwordMatches(given) {
  const expected = process.env.UPLOAD_PASSWORD || '';
  if (!expected || typeof given !== 'string' || given === '') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { MAX_FILE_MB, MAX_FILE_BYTES, PATHNAME_PATTERN, passwordMatches };
