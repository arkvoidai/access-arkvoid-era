# Arkvoid — Persistent World Preview (`app.arkvoid.com`)

Early preview, in development by **Arkvoid Inc.**  
Founder: Manish Talukdar · X: [@ArkvoidAI](https://x.com/ArkvoidAI) · Email: `heyarkvoid@gmail.com` · Site: [arkvoid.com](https://arkvoid.com)

## What this is

Arkvoid is a persistent world where characters have routines, goals, and relationships, and read their memories exclusively from an append-only ledger. A deterministic rules engine (`R1`–`R8`) validates every character proposal before committing events, and background simulation (`Tier 0`) advances the world without language model calls while you are away.

## Running locally

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

Run unit tests:

```bash
npm test
```

## Environment variables

Every environment variable is optional. If `MISTRAL_API_KEY` is omitted or empty, the application starts and runs in deterministic **Offline voice** mode with zero errors.

| Variable | Default | Description |
| :--- | :--- | :--- |
| `MISTRAL_API_KEY` | `""` | Server-only API key for Mistral AI (`https://api.mistral.ai/v1/chat/completions`). Never exposed to the client. |
| `MISTRAL_MODEL` | `mistral-small-latest` | Mistral model identifier used for live character turns. |
| `LIVE_AI_ENABLED` | `"true"` | Set to `"false"` to force offline scripted voice even when a key is present. |
| `ACCESS_CODES` | `""` | Optional comma-separated list of access codes required for live model calls. |
| `SESSION_SECRET` | random per-boot | Secret used to sign HMAC session tokens issued by `/api/session`. |
| `DAILY_CALL_CAP` | `150` | Maximum live model calls across all sessions per UTC day. |
| `SESSION_CALL_CAP` | `20` | Maximum live model calls per session token. |
| `INDEXABLE` | `"false"` | Controls indexing headers when deployed. |
| `UPSTASH_REDIS_REST_URL` | `""` | Optional Upstash Redis REST URL for shared rate limits across serverless instances. |
| `UPSTASH_REDIS_REST_TOKEN` | `""` | Optional Upstash Redis REST token. If omitted, rate limits use an in-memory map (best effort per server instance). |
