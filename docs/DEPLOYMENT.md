# Deployment (GitHub Pages)

1. Repo → Settings → Pages → Source: **GitHub Actions**.
2. Push to `main`. `.github/workflows/pages.yml` runs typecheck, unit tests, Playwright e2e (PWA/offline/subpath), then builds (`BUILD_ID=<sha>`) and deploys `dist/`.
3. The site is served at `https://<user>.github.io/<repo>/`. Nothing in the app depends on the path: assets are relative (`base: './'`), routes are hash-based, the manifest `scope`/`start_url` are `./`, and the service worker is registered as `./sw.js`.

## Local checks
- `npm run build && npm run pages:serve` → http://localhost:4173/wealth-tracker/ (mimics Pages: subpath, 404 for unknown paths, 10-minute cache headers).
- `npm run test:e2e` builds two deploys with different build ids and verifies install/offline/update/stale-cache behaviour.

## Releasing an update
Every deploy changes `BUILD_ID`, so `sw.js` bytes change → browsers fetch the new worker (checked on launch/foreground/hourly) → it installs a new precache → users see "A new version is ready" → **Update now** → old caches are deleted. Pages may serve a stale `sw.js` for ~10 minutes (cache-control); that only delays the prompt.
Bump `version` in `package.json` for human-readable versions; schema changes also need `SCHEMA_VERSION` + a migration.

## Install
iPhone: Safari → Share → Add to Home Screen. Android/desktop Chrome/Edge: Install app. Data is per-origin per-browser; use backups to move devices.
