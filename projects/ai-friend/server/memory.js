'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

// Long-term memory: a short list of facts the friend chose to remember,
// kept in one JSON file. Small on purpose: every fact is read back into the
// model's instructions at the start of each conversation.
const FILE = path.join(config.dataDir, 'memory.json');

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(data.facts) ? data.facts : [];
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Could not read ${FILE}: ${err.message}`);
    return [];
  }
}

function save(facts) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ facts }, null, 2));
  fs.renameSync(tmp, FILE);
}

function list() {
  return load();
}

function remember(text) {
  const fact = String(text || '').trim().slice(0, 300);
  if (!fact) return { ok: false, error: 'Nothing to remember.' };
  const facts = load();
  if (facts.some((f) => f.text.toLowerCase() === fact.toLowerCase())) {
    return { ok: true, note: 'Already remembered.' };
  }
  facts.push({ id: crypto.randomBytes(4).toString('hex'), text: fact, at: new Date().toISOString() });
  // Oldest facts drop off first when the list is full.
  save(facts.slice(-config.maxMemories));
  return { ok: true };
}

function forget(idOrText) {
  const needle = String(idOrText || '').trim().toLowerCase();
  if (!needle) return { ok: false, error: 'Say which memory to forget.' };
  const facts = load();
  const kept = facts.filter((f) => f.id !== needle && !f.text.toLowerCase().includes(needle));
  if (kept.length === facts.length) return { ok: false, error: 'No matching memory found.' };
  save(kept);
  return { ok: true, forgotten: facts.length - kept.length };
}

module.exports = { list, remember, forget, FILE };
