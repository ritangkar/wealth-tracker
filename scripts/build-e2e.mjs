// Builds two distinct deploys (different build ids) so e2e can test cache invalidation / update flow.
import { execSync } from 'node:child_process';
execSync('npx tsc --noEmit', { stdio: 'inherit' });
execSync('npx vite build --outDir dist', { stdio: 'inherit', env: { ...process.env, BUILD_ID: 'e2e-a' } });
execSync('npx vite build --outDir dist-v2', { stdio: 'inherit', env: { ...process.env, BUILD_ID: 'e2e-b' } });
