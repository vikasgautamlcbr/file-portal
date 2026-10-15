'use strict';

const { passwordMatches } = require('../lib/config');

// Lets the page tell the visitor about a wrong password before uploading.
module.exports = (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
  res.status(passwordMatches(password) ? 204 : 401).end();
};
