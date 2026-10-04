// Renders public/icons/*.png from an inline SVG using the preinstalled Chromium (via Playwright).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const glyph = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#0f766e"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)">
    <path d="M96 330 L176 210 L246 290 L340 150 L416 234" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="416" cy="234" r="26" fill="#fcd34d"/>
    <rect x="96" y="372" width="320" height="28" rx="14" fill="#ffffff" opacity=".55"/>
  </g>
</svg>`;

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? (process.platform === 'linux' ? '/opt/pw-browsers/chromium' : undefined) });
const page = await browser.newPage();
async function render(file, size, pad) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${glyph(pad)}`);
  await page.screenshot({ path: `public/icons/${file}`, clip: { x: 0, y: 0, width: size, height: size } });
}
await render('icon-192.png', 192, 0.0);
await render('icon-512.png', 512, 0.0);
await render('maskable-512.png', 512, 0.22); // safe zone for maskable
await render('apple-touch-icon.png', 180, 0.0);
await browser.close();
console.log('icons written');
