'use strict';

const path = require('node:path');

function number(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = {
  port: number('PORT', 3000),
  // Shared secret every device must send to connect (?token=...).
  accessToken: process.env.FRIEND_ACCESS_TOKEN || '',
  friendName: process.env.FRIEND_NAME || 'Mochi',
  ownerName: process.env.OWNER_NAME || '',

  realtimeModel: process.env.REALTIME_MODEL || 'gpt-realtime-2.1-mini',
  // Built-in voices include marin, cedar, coral, shimmer, sage, ballad, verse...
  voice: process.env.VOICE || 'marin',
  transcribeModel: process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
  searchModel: process.env.SEARCH_MODEL || 'gpt-5.4-mini',

  // Cost guards: hang up after this long without anyone speaking, and cap
  // any single conversation.
  idleSeconds: number('IDLE_SECONDS', 90),
  maxSessionMinutes: number('MAX_SESSION_MINUTES', 20),

  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  maxMemories: number('MAX_MEMORIES', 200),
};
