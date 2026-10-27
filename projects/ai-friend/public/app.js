'use strict';

// Browser stand-in for the ESP32: streams the mic to the server as 24 kHz
// PCM16 and plays back the friend's voice. Speaks the same protocol the
// device firmware will.
(function () {
  const RATE = 24000;
  const faceEl = document.getElementById('face');
  const stateEl = document.getElementById('state');
  const nameEl = document.getElementById('name');
  const talkBtn = document.getElementById('talk');
  const tokenInput = document.getElementById('token');
  const settings = document.getElementById('settings');
  const logEl = document.getElementById('log');

  let ws = null;
  let ctx = null;
  let micStream = null;
  let micNode = null;
  let resampler = null;

  // Playback bookkeeping, for smooth queuing and honest interrupt reports.
  let playHead = 0;
  let sources = [];
  let currentItem = null;
  let itemStart = null;
  let itemQueuedSec = 0;

  let mood = 'neutral';
  let state = 'off';

  try {
    tokenInput.value = localStorage.getItem('friend-token') || '';
  } catch (e) { /* storage unavailable */ }
  if (!tokenInput.value) settings.open = true;

  const STATE_TEXT = {
    off: 'Tap Talk to wake me up',
    connecting: 'Waking up…',
    listening: "I'm listening…",
    thinking: 'Hmm…',
    speaking: '',
  };

  function render() {
    faceEl.className = 'face mood-' + mood + ' state-' + state;
    if (STATE_TEXT[state] !== undefined) stateEl.textContent = STATE_TEXT[state];
    talkBtn.textContent = state === 'off' ? 'Talk' : 'Hang up';
    talkBtn.classList.toggle('live', state !== 'off');
  }

  function addLog(role, text) {
    if (!text) return;
    const li = document.createElement('li');
    li.className = role;
    li.textContent = text;
    logEl.append(li);
    li.scrollIntoView({ block: 'nearest' });
  }

  // ---- Mic: native rate -> 24 kHz PCM16 --------------------------------------
  function makeResampler(inRate) {
    const step = inRate / RATE;
    let pos = 0;
    let prev = 0;
    return function (input) {
      const out = [];
      // Treat `prev` as sample index -1 so chunks join without clicks.
      while (pos < input.length) {
        const i = Math.floor(pos);
        const frac = pos - i;
        const a = i === 0 ? prev : input[i - 1];
        const b = input[i];
        out.push(a + (b - a) * frac);
        pos += step;
      }
      pos -= input.length;
      prev = input[input.length - 1];
      const pcm = new Int16Array(out.length);
      for (let k = 0; k < out.length; k++) {
        const s = Math.max(-1, Math.min(1, out[k]));
        pcm[k] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return pcm;
    };
  }

  // ---- Speaker: queue 24 kHz PCM16 chunks back to back -------------------------
  function playChunk(arrayBuffer) {
    const pcm = new Int16Array(arrayBuffer);
    if (!pcm.length) return;
    const buffer = ctx.createBuffer(1, pcm.length, RATE);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.04, playHead);
    src.start(startAt);
    if (itemStart === null) itemStart = startAt;
    itemQueuedSec += buffer.duration;
    playHead = startAt + buffer.duration;
    sources.push(src);
    src.onended = () => {
      sources = sources.filter((s) => s !== src);
    };
  }

  function stopPlayback() {
    for (const s of sources) {
      try { s.stop(); } catch (e) { /* already stopped */ }
    }
    sources = [];
    playHead = ctx ? ctx.currentTime : 0;
  }

  // ---- Server messages ----------------------------------------------------
  function onMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      playChunk(event.data);
      return;
    }
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    switch (msg.type) {
      case 'ready':
        nameEl.textContent = msg.name || 'AI Friend';
        document.title = msg.name || 'AI Friend';
        break;
      case 'state':
        state = msg.state;
        render();
        break;
      case 'audio_start':
        currentItem = msg.item_id;
        itemStart = null;
        itemQueuedSec = 0;
        break;
      case 'interrupt':
        if (msg.item_id && msg.item_id === currentItem && itemStart !== null) {
          const heardSec = Math.min(Math.max(0, ctx.currentTime - itemStart), itemQueuedSec);
          ws.send(JSON.stringify({ type: 'played', item_id: currentItem, ms: Math.round(heardSec * 1000) }));
        }
        stopPlayback();
        currentItem = null;
        break;
      case 'transcript':
        addLog(msg.role, msg.text);
        break;
      case 'mood':
        mood = msg.mood;
        render();
        break;
      case 'status':
        stateEl.textContent = msg.text;
        break;
      case 'error':
        addLog('note', 'Error: ' + msg.message);
        break;
      case 'bye':
        addLog('note', msg.reason === 'idle' ? 'Dozed off after a quiet spell. Tap Talk to wake me.' : 'Call ended (' + msg.reason + ').');
        break;
    }
  }

  // ---- Start / stop --------------------------------------------------------
  async function start() {
    const token = tokenInput.value.trim();
    if (!token) {
      settings.open = true;
      tokenInput.focus();
      stateEl.textContent = 'Enter the access token first.';
      return;
    }
    try { localStorage.setItem('friend-token', token); } catch (e) { /* ignore */ }

    state = 'connecting';
    mood = 'neutral';
    render();

    try {
      ctx = new AudioContext();
      await ctx.audioWorklet.addModule('capture-worklet.js');
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      addLog('note', 'Microphone unavailable: ' + err.message);
      stop();
      return;
    }

    resampler = makeResampler(ctx.sampleRate);
    const source = ctx.createMediaStreamSource(micStream);
    micNode = new AudioWorkletNode(ctx, 'capture-processor');
    micNode.port.onmessage = (e) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(resampler(e.data).buffer);
    };
    source.connect(micNode);
    playHead = ctx.currentTime;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/ws?device=browser&token=' + encodeURIComponent(token));
    ws.binaryType = 'arraybuffer';
    ws.onmessage = onMessage;
    ws.onclose = (e) => {
      if (e.code === 1006 && state === 'connecting') addLog('note', 'Could not connect. Check the access token.');
      stop();
    };
  }

  function stop() {
    if (ws) {
      ws.onclose = null;
      if (ws.readyState <= WebSocket.OPEN) ws.close();
      ws = null;
    }
    if (ctx) stopPlayback();
    if (micNode) micNode.port.onmessage = null;
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close();
    ctx = micStream = micNode = null;
    currentItem = null;
    state = 'off';
    mood = 'sleepy';
    render();
  }

  talkBtn.addEventListener('click', () => (state === 'off' ? start() : stop()));
  render();
})();
