'use strict';

const OpenAI = require('openai');
const { OpenAIRealtimeWS } = require('openai/realtime/ws');
const config = require('./config');
const persona = require('./persona');
const tools = require('./tools');

// 24 kHz, 16-bit mono PCM: 48 bytes per millisecond.
const BYTES_PER_MS = 48;

/**
 * Bridges one device WebSocket (browser or ESP32) to one OpenAI Realtime
 * session.
 *
 * Device -> server:  binary frames = mic audio (PCM16 LE, 24 kHz, mono)
 *                    {"type":"played","item_id","ms"} after an interrupt
 * Server -> device:  binary frames = friend's voice (same format)
 *                    JSON: ready, state, audio_start, audio_end, interrupt,
 *                          transcript, mood, status, error, bye
 */
class FriendSession {
  constructor(device, label) {
    this.device = device;
    this.label = label;
    this.rt = null;
    this.ready = false;
    this.closed = false;
    this.currentItem = null;
    this.sentMs = new Map();
    // Replies the user talked over; late audio for them is dropped.
    this.interrupted = new Set();
    this.pendingTools = [];
    this.needsFollowUp = false;
    this.responseHadAudio = false;
  }

  async start() {
    this.rt = await OpenAIRealtimeWS.create(new OpenAI(), { model: config.realtimeModel });
    this.rt.on('error', (err) => this.onRealtimeError(err));
    this.rt.socket.on('open', () => this.configure());
    this.rt.socket.on('close', (code, reason) => {
      this.log(`OpenAI socket closed (${code} ${reason})`);
      this.end('upstream_closed');
    });
    this.rt.on('event', (event) => this.onEvent(event).catch((err) => this.fail(err)));

    this.device.on('message', (data, isBinary) => this.onDeviceMessage(data, isBinary));
    this.device.on('close', () => this.end('device_closed'));
    this.device.on('error', (err) => this.log(`device socket error: ${err.message}`));

    this.maxTimer = setTimeout(() => this.end('max_session'), config.maxSessionMinutes * 60_000);
    this.resetIdle();
  }

  configure() {
    this.rt.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: persona.instructions(),
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            noise_reduction: { type: 'near_field' },
            transcription: { model: config.transcribeModel },
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'high',
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
            voice: config.voice,
          },
        },
        tools: tools.definitions,
        tool_choice: 'auto',
      },
    });
  }

  // ---- Device -> OpenAI -----------------------------------------------------
  onDeviceMessage(data, isBinary) {
    if (isBinary) {
      if (!this.ready || this.closed) return;
      this.rt.send({ type: 'input_audio_buffer.append', audio: Buffer.from(data).toString('base64') });
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === 'played' && typeof msg.item_id === 'string') {
      // The device stopped playback after an interrupt; drop the unheard part
      // of the reply from the conversation so the model knows what was said.
      const sent = this.sentMs.get(msg.item_id) || 0;
      const heard = Math.max(0, Math.floor(Number(msg.ms) || 0));
      if (heard < sent) {
        this.rt.send({ type: 'conversation.item.truncate', item_id: msg.item_id, content_index: 0, audio_end_ms: heard });
      }
    }
  }

  // ---- OpenAI -> device -----------------------------------------------------
  async onEvent(event) {
    switch (event.type) {
      case 'session.updated':
        if (!this.ready) {
          this.ready = true;
          this.toDevice({ type: 'ready', name: config.friendName });
          this.toDevice({ type: 'state', state: 'listening' });
          this.log('session ready');
        }
        break;

      case 'input_audio_buffer.speech_started':
        this.resetIdle();
        if (this.currentItem) {
          this.interrupted.add(this.currentItem);
          this.toDevice({ type: 'interrupt', item_id: this.currentItem });
        }
        this.currentItem = null;
        this.toDevice({ type: 'state', state: 'listening' });
        break;

      case 'input_audio_buffer.speech_stopped':
        this.toDevice({ type: 'state', state: 'thinking' });
        break;

      case 'response.created':
        this.responseHadAudio = false;
        this.needsFollowUp = false;
        this.pendingTools = [];
        break;

      case 'response.output_audio.delta': {
        // Chunks already in flight when the user cut in must not restart playback.
        if (this.interrupted.has(event.item_id)) break;
        this.resetIdle();
        this.responseHadAudio = true;
        if (event.item_id !== this.currentItem) {
          this.currentItem = event.item_id;
          this.sentMs.set(event.item_id, 0);
          this.toDevice({ type: 'audio_start', item_id: event.item_id });
          this.toDevice({ type: 'state', state: 'speaking' });
        }
        const pcm = Buffer.from(event.delta, 'base64');
        this.sentMs.set(event.item_id, this.sentMs.get(event.item_id) + pcm.length / BYTES_PER_MS);
        if (this.device.readyState === this.device.OPEN) this.device.send(pcm, { binary: true });
        break;
      }

      case 'response.output_audio.done':
        if (this.interrupted.has(event.item_id)) break;
        this.toDevice({ type: 'audio_end', item_id: event.item_id });
        break;

      case 'response.output_audio_transcript.done':
        this.toDevice({ type: 'transcript', role: 'friend', text: event.transcript });
        break;

      case 'conversation.item.input_audio_transcription.completed':
        this.toDevice({ type: 'transcript', role: 'you', text: event.transcript });
        break;

      case 'response.function_call_arguments.done':
        this.pendingTools.push(this.runTool(event));
        if (tools.FOLLOW_UP.has(event.name)) this.needsFollowUp = true;
        break;

      case 'response.done':
        await this.finishResponse();
        break;

      default:
        break;
    }
  }

  async runTool(event) {
    let args = {};
    try {
      args = JSON.parse(event.arguments || '{}');
    } catch {
      /* leave empty */
    }
    this.log(`tool ${event.name}(${JSON.stringify(args)})`);
    let result;
    try {
      result = await tools.run(event.name, args, (msg) => this.toDevice(msg));
    } catch (err) {
      this.log(`tool ${event.name} failed: ${err.message}`);
      result = { ok: false, error: 'That did not work. Tell your human you could not do it right now.' };
    }
    return { call_id: event.call_id, output: JSON.stringify(result) };
  }

  async finishResponse() {
    const calls = this.pendingTools;
    const followUp = this.needsFollowUp || (calls.length > 0 && !this.responseHadAudio);
    this.pendingTools = [];
    if (calls.length) {
      if (followUp) this.toDevice({ type: 'state', state: 'thinking' });
      const outputs = await Promise.all(calls);
      if (this.closed) return;
      for (const out of outputs) {
        this.rt.send({ type: 'conversation.item.create', item: { type: 'function_call_output', ...out } });
      }
      // Only ask for another reply when the model still owes an answer;
      // otherwise a mood change would make it speak twice.
      if (followUp) {
        this.rt.send({ type: 'response.create' });
        return;
      }
    }
    if (!this.responseHadAudio) this.toDevice({ type: 'state', state: 'listening' });
  }

  // ---- Lifecycle ------------------------------------------------------------
  resetIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.end('idle'), config.idleSeconds * 1000);
  }

  onRealtimeError(err) {
    const detail = err.error?.message || err.message;
    this.log(`OpenAI error: ${detail}`);
    // Truncating audio that already finished is harmless; don't alarm the device.
    if (err.error?.type === 'invalid_request_error' && /truncat/i.test(detail || '')) return;
    this.toDevice({ type: 'error', message: detail });
  }

  fail(err) {
    this.log(`session error: ${err.stack || err.message}`);
    this.toDevice({ type: 'error', message: 'Something went wrong on the server.' });
    this.end('error');
  }

  end(reason) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    this.log(`ending: ${reason}`);
    this.toDevice({ type: 'bye', reason });
    try {
      this.rt?.close();
    } catch {
      /* already closed */
    }
    if (this.device.readyState === this.device.OPEN) this.device.close(1000, reason);
    this.onEnd?.();
  }

  toDevice(msg) {
    if (this.device.readyState === this.device.OPEN) this.device.send(JSON.stringify(msg));
  }

  log(text) {
    console.log(`[${this.label}] ${text}`);
  }
}

module.exports = { FriendSession };
