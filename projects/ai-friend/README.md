# AI Friend *(working name: Mochi)*

A cute voice buddy you talk to like a person. It hears you while it's speaking, so you can interrupt it. It remembers things about you between conversations and looks things up on the web. Later it will live in a little ESP32 robot with a screen face. For now you can talk to it from a browser.

```
[ESP32 bot or browser]  ⇄  WebSocket, raw audio both ways  ⇄  [this server]  ⇄  [OpenAI Realtime API]
                                                                  ├─ memory (data/memory.json)
                                                                  └─ web search (OpenAI Responses API)
```

## Run it on your computer

You need Node.js 20+ and an OpenAI API key.

```bash
cd projects/ai-friend
npm install
OPENAI_API_KEY=sk-... FRIEND_ACCESS_TOKEN=pick-a-long-secret npm start
```

Open http://localhost:3000, paste the access token under *Settings*, press **Talk**, and say hi. Use headphones, or it may hear itself through your speakers and interrupt itself.

## Deploy to a cloud host

The server needs to stay running, so it doesn't fit Vercel. Any host that runs a Docker container works, for example Fly.io, Railway or Render. Check their current pricing.

1. Create a service from this folder. It has a `Dockerfile`, and the app listens on port 3000.
2. Set `OPENAI_API_KEY` and `FRIEND_ACCESS_TOKEN` as secrets.
3. Attach a **persistent volume at `/data`**. Without one, memories are lost on every redeploy.
4. Open the service's https URL. The page connects over `wss://` automatically.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `OPENAI_API_KEY` | *(required)* | Your OpenAI key. Keep it on the server only. |
| `FRIEND_ACCESS_TOKEN` | *(required)* | Shared secret devices send to connect (12+ characters). |
| `FRIEND_NAME` | `Mochi` | What it calls itself. |
| `OWNER_NAME` | — | Your name, so it knows who it's talking to. |
| `VOICE` | `marin` | OpenAI voice: `marin`, `cedar`, `coral`, `shimmer`, `sage`, `ballad`, `verse`, `alloy`, `ash`, `echo`. |
| `REALTIME_MODEL` | `gpt-realtime-2.1-mini` | The voice model. `gpt-realtime-2.1` is smarter but roughly 3× the price. |
| `SEARCH_MODEL` | `gpt-5.4-mini` | Model used for web searches. |
| `TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` | Writes down what you said, for the on-screen transcript. |
| `IDLE_SECONDS` | `90` | Hangs up after this long with nobody talking (saves money). |
| `MAX_SESSION_MINUTES` | `20` | Hard cap on one conversation. |

Its personality lives in `server/persona.js`. Edit that to change how it talks.

## Costs

You pay OpenAI per audio token, mostly for the friend's speech. Third-party estimates put `gpt-realtime-2.1-mini` at roughly $0.02–0.05 per conversation minute, but measure your own usage on the OpenAI dashboard. Short replies, the idle hang-up and the session cap all keep costs down.

## Device protocol (for the ESP32 firmware)

Connect to `wss://<host>/ws?token=<FRIEND_ACCESS_TOKEN>&device=<name>`.

| Direction | Frame | Content |
|---|---|---|
| device → server | binary | Mic audio: PCM 16-bit little-endian, **24 kHz, mono**. Send continuously in roughly 20–100 ms chunks. |
| device → server | text | `{"type":"played","item_id":"…","ms":1234}`. Send after an `interrupt`: how much of that reply was actually played. |
| server → device | binary | The friend's voice, in the same format. Queue it and play back to back. |
| server → device | text | `ready` · `state` (`listening` / `thinking` / `speaking`) · `audio_start` / `audio_end` (`item_id`) · `interrupt` (stop playback now, then reply with `played`) · `mood` (`happy`, `excited`, `curious`, `thinking`, `sad`, `surprised`, `sleepy`, `love`, `neutral`) · `transcript` · `status` · `error` · `bye` (`reason`: `idle`, `max_session`, …) |

You can see what it remembers at `GET /api/memory` with the header `Authorization: Bearer <FRIEND_ACCESS_TOKEN>`.

## Status

- [x] Server: realtime voice, interruptions, memory, web search, mood
- [x] Browser test page
- [ ] Pick a host and deploy
- [ ] Hardware parts list
- [ ] ESP32 firmware
