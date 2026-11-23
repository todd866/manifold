#!/usr/bin/env node
/**
 * Headless, muted Instrument-UX visual & single-viewport audit for Manifold.
 * Verifies `scrollHeight <= innerHeight` at both 390x844 (phone) and 1440x900 (desktop)
 * in dark and light themes, and saves screenshots for visual inspection.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'https://manifold-chi.vercel.app';
const outDir = process.argv[3] || path.resolve(import.meta.dirname, '..', 'shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--mute-audio'],
});

try {
  for (const vp of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Dark mode check across tabs
    for (const tabLabel of ['Map', 'Lenses', 'Trust', 'MCP']) {
      await page.getByRole('tab', { name: new RegExp(`^${tabLabel}`) }).click();
      const metrics = await page.evaluate(() => ({
        scrollH: document.documentElement.scrollHeight,
        innerH: window.innerHeight,
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
      }));
      assert.ok(
        metrics.scrollH <= metrics.innerH,
        `${vp.name} dark ${tabLabel}: scrollHeight ${metrics.scrollH} > innerHeight ${metrics.innerH}`,
      );
      assert.ok(
        metrics.scrollW <= metrics.innerW,
        `${vp.name} dark ${tabLabel}: horizontal overflow ${metrics.scrollW} > ${metrics.innerW}`,
      );
      if (tabLabel === 'Map' || tabLabel === 'Lenses') {
        await page.screenshot({
          path: path.join(outDir, `manifold-${vp.name}-dark-${tabLabel.toLowerCase()}.png`),
        });
      }
    }

    // Switch to Light theme and capture Map
    await page.getByRole('tab', { name: /^Map/ }).click();
    await page.getByRole('button', { name: /Switch to light theme/i }).click();
    const lightMetrics = await page.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
    }));
    assert.ok(lightMetrics.scrollH <= lightMetrics.innerH);
    await page.screenshot({
      path: path.join(outDir, `manifold-${vp.name}-light-map.png`),
    });

    await context.close();
  }
  console.log(`Visual & viewport audit passed for ${targetUrl} -> ${outDir}`);
} finally {
  await browser.close();
}
