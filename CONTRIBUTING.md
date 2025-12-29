# Contributing to osu!dash

Thanks for helping improve osu!dash.

This project is intentionally **local-first** and **privacy-conscious**.

## Ground rules

- Do not propose features that require collecting, uploading, or sharing user replay files by default.
- Do not add telemetry/analytics without an explicit opt-in.
- Keep secrets out of code and screenshots (client id/secret, tokens, local paths).

## Development setup

```bash
npm install
npm run dev
```

## Project structure

- `app/` – Nuxt app
- `server/api/` – Nitro API routes
- `server/plugins/` – Nitro plugins (watchers, etc.)
- `server/middleware/` – request middleware (logging, auth guards, etc.)
- `data/` – local JSON stores (gitignored)

## Feature flags / safety

Replay watching/parsing is **disabled by default**.

Enable only when you need it:

```bash
NUXT_ENABLE_REPLAY_WATCHER=true npm run dev
```

## Making changes

1) Create a branch

```bash
git checkout -b feat/<short-name>
```

2) Keep PRs small and focused

- One feature/fix per PR
- Avoid drive-by formatting

3) Verify before opening a PR

```bash
npm run build
```

## Commit style

Use clear, descriptive commits. Examples:

- `fix: disable deep-wipe in production`
- `feat: add request visit logger`

## Reporting security issues

If you find a security/privacy issue (token exposure, filesystem access, replay parsing risk), please open a **private** report if possible, or file a public issue with minimal detail and mark it as security-related.

## Code of conduct

Be respectful and constructive. If you’re unsure about scope/security, ask first in an issue.
