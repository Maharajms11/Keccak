# Keccak Model (Standalone)

Interactive Keccak teaching web app with:
- Step-by-step sponge + permutation visualization
- Redis-backed usage telemetry
- Render Blueprint (`web + keyvalue`) deployment

## Local Run

```bash
cd "/Users/manojmaharaj/Desktop/Apps/keccak-model"
npm install
npm run dev
```

Open:
- http://localhost:3000/
- http://localhost:3000/keccak

## Environment

Copy `.env.example` to `.env` and set values as needed.

- `HOST`: bind host (default `0.0.0.0`)
- `PORT`: server port (default `3000`)
- `REDIS_URL`: Redis/Valkey connection string
- `ADMIN_TOKEN`: token for `/api/stats`

## API

- `GET /api/health`
  - App + Redis health status
- `POST /api/events`
  - Stores telemetry counters in Redis
  - Body: `{ "event": "build_trace", "sessionId": "..." }`
- `GET /api/stats?days=7&token=<ADMIN_TOKEN>`
  - Returns event totals and unique sessions per day

## GitHub -> Render Workflow

1. Push repo to GitHub (`main` branch).
2. In Render: `New +` -> `Blueprint` -> select this repo.
3. Render reads `render.yaml` and provisions:
   - `keccak-model-web` (Node web service)
   - `keccak-model-cache` (Key Value service)
4. After first deploy, open the web URL and test:
   - `/api/health`
   - `/keccak`
5. Share the Render URL with students.

## Notes

- Telemetry is anonymous: only event counters + optional session ids.
- If Redis is unavailable, the app still serves normally.
