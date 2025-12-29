# osu!dash

Local-first osu! dashboard built with Nuxt 3/4 (Nitro) that visualizes profile + score history and (optionally) computes deep timing stats.

This project is designed to run on your own machine. It’s not intended to be a public multi-tenant service.

## Features

- Nuxt + Tailwind UI dashboard
- Score history persistence in `data/` (local JSON)
- Optional deep stats pipeline (UR / hit error distribution)
- Mod badges + checksum-based dedupe (latest replay replaces old for same map)
- Production hardening: wipe/token endpoints disabled
- Clear request logs (`VISIT` and `API`) via server middleware

## Quick start

```bash
npm install
npm run dev
```

App runs on `http://localhost:3000`.

## Environment

Create a `.env` (see `.env.example`). Common vars:

- `NUXT_OSU_CLIENT_ID`
- `NUXT_OSU_CLIENT_SECRET`
- `NUXT_OSU_TARGET_USER`

Optional:

- `NUXT_PUBLIC_OSU_API_BASE` (defaults to `https://osu.ppy.sh/api/v2`)
- `OSU_REPLAY_PATH` / `NUXT_OSU_REPLAY_PATH` (where lazer exports `.osr`)
- `NUXT_OSU_FILES_PATH` (local beatmap files folder)

## Production

Build + run the Nitro server:

```bash
npm run prod
```

Notes:

- In production (`NODE_ENV=production`), these endpoints return `404`:
	- `/api/deep-wipe`
	- `/api/osu-token`
- The UI shows an orange banner indicating the app is still in development.

## PM2 (recommended for “always-on” local prod)

1) Build once:

```bash
npm run build
```

2) Start with PM2:

```bash
npm run pm2:start
npm run pm2:logs
```

By default it binds to `127.0.0.1:3000`. Override:

```bash
NITRO_HOST=0.0.0.0 NITRO_PORT=3000 npm run pm2:start
```

## Security & privacy defaults

- Replay parsing/watching is disabled by default.
	- Enable explicitly with: `NUXT_ENABLE_REPLAY_WATCHER=true`
- Local JSON caches/history in `data/` are intended to remain local and are gitignored.
- Server logs include IP/UA/referrer for requests. If you don’t want that, remove `server/middleware/visit-logger.ts`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branching, and PR guidelines.

## Issues

Please use the issue templates (bug/feature). Include repro steps and environment info.
