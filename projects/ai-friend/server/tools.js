'use strict';

const OpenAI = require('openai');
const config = require('./config');
const memory = require('./memory');

const MOODS = ['happy', 'excited', 'curious', 'thinking', 'sad', 'surprised', 'sleepy', 'love', 'neutral'];

// Function tools offered to the Realtime model. `followUp` means the model
// needs the result to finish its answer, so a new response is requested
// after the tool runs.
const definitions = [
  {
    type: 'function',
    name: 'web_search',
    description:
      'Search the web for current or factual information: news, weather, sports, prices, dates, facts you are unsure of. ' +
      'Say a quick "let me check" before calling it.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What to search for.' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'remember',
    description: 'Save one short fact about your human to long-term memory.',
    parameters: {
      type: 'object',
      properties: { fact: { type: 'string', description: 'The fact, e.g. "Loves masala chai".' } },
      required: ['fact'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'forget',
    description: 'Delete a memory, by its id or by a word or phrase in it.',
    parameters: {
      type: 'object',
      properties: { memory: { type: 'string', description: 'Memory id or text to match.' } },
      required: ['memory'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'set_mood',
    description: 'Change the expression on your face screen.',
    parameters: {
      type: 'object',
      properties: { mood: { type: 'string', enum: MOODS } },
      required: ['mood'],
      additionalProperties: false,
    },
  },
];

const FOLLOW_UP = new Set(['web_search']);

let openai;
function client() {
  openai ??= new OpenAI();
  return openai;
}

async function webSearch(query) {
  const response = await client().responses.create({
    model: config.searchModel,
    tools: [{ type: 'web_search' }],
    input:
      `Search the web and answer briefly (2-4 sentences, plain text, no links or markdown) ` +
      `so it can be read aloud: ${query}`,
  });
  return response.output_text || 'No results found.';
}

// Runs one tool call. `notify` sends a JSON message to the device.
async function run(name, args, notify) {
  switch (name) {
    case 'web_search':
      notify({ type: 'status', text: `Searching: ${args.query}` });
      return { answer: await webSearch(String(args.query || '')) };
    case 'remember':
      return memory.remember(args.fact);
    case 'forget':
      return memory.forget(args.memory);
    case 'set_mood': {
      const mood = MOODS.includes(args.mood) ? args.mood : 'neutral';
      notify({ type: 'mood', mood });
      return { ok: true };
    }
    default:
      return { ok: false, error: `Unknown tool ${name}` };
  }
}

module.exports = { definitions, run, FOLLOW_UP, MOODS };
