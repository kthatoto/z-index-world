import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const extensionPath = path.join(__dirname, '..', 'dist');
const contentScriptPath = path.join(extensionPath, 'content-script.js');

// Read the content script
const contentScriptCode = fs.readFileSync(contentScriptPath, 'utf-8');

async function injectContentScript(page: Page) {
  await page.evaluate((code) => {
    // Execute the content script code
    const fn = new Function(code);
    fn();
  }, contentScriptCode);
}

test.describe('z-index-world extension', () => {
  let context: BrowserContext;

  test.beforeAll(async () => {
    // Launch browser with extension loaded
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('extension loads and creates overlay when activated', async () => {
    const page = await context.newPage();

    // Go to a test page
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Check that overlay doesn't exist yet
    let overlayExists = await page.evaluate(() => {
      return !!document.getElementById('dom3d-game-root');
    });
    expect(overlayExists).toBe(false);

    // Inject content script
    await injectContentScript(page);

    // Wait a bit for initialization
    await page.waitForTimeout(500);

    // Check overlay exists
    overlayExists = await page.evaluate(() => {
      return !!document.getElementById('dom3d-game-root');
    });
    expect(overlayExists).toBe(true);

    // Check that player exists
    const playerExists = await page.evaluate(() => {
      return !!document.getElementById('dom3d-player');
    });
    expect(playerExists).toBe(true);

    // Check overlay styles
    const overlayStyles = await page.evaluate(() => {
      const el = document.getElementById('dom3d-game-root');
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        position: style.position,
        zIndex: style.zIndex,
        transformStyle: style.transformStyle,
        perspective: style.perspective,
      };
    });

    expect(overlayStyles?.position).toBe('fixed');
    expect(overlayStyles?.zIndex).toBe('2147483647');
    expect(overlayStyles?.transformStyle).toBe('preserve-3d');
    expect(overlayStyles?.perspective).toBe('1200px');

    // Check player has transform with translate3d
    const playerTransform = await page.evaluate(() => {
      const el = document.getElementById('dom3d-player');
      if (!el) return null;
      return el.style.transform;
    });
    expect(playerTransform).toContain('translate3d');

    console.log('Overlay test passed!');
  });

  test('player moves with vim keys', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    // Get initial position
    const getPlayerPos = async () => {
      return await page.evaluate(() => {
        const el = document.getElementById('dom3d-player');
        if (!el) return null;
        const transform = el.style.transform;
        const match = transform.match(/translate3d\(([^,]+)px,\s*([^,]+)px,\s*([^)]+)px\)/);
        if (!match) return null;
        return {
          x: parseFloat(match[1]),
          y: parseFloat(match[2]),
          z: parseFloat(match[3]),
        };
      });
    };

    const initialPos = await getPlayerPos();
    expect(initialPos).toBeTruthy();
    console.log('Initial position:', initialPos);

    // Move right with 'l'
    await page.keyboard.down('l');
    await page.waitForTimeout(200);
    await page.keyboard.up('l');

    const afterRight = await getPlayerPos();
    console.log('After right:', afterRight);
    expect(afterRight!.x).toBeGreaterThan(initialPos!.x);

    // Move left with 'h'
    await page.keyboard.down('h');
    await page.waitForTimeout(200);
    await page.keyboard.up('h');

    const afterLeft = await getPlayerPos();
    console.log('After left:', afterLeft);
    expect(afterLeft!.x).toBeLessThan(afterRight!.x);

    // Move down with 'j'
    await page.keyboard.down('j');
    await page.waitForTimeout(200);
    await page.keyboard.up('j');

    const afterDown = await getPlayerPos();
    console.log('After down:', afterDown);
    expect(afterDown!.y).toBeGreaterThan(afterLeft!.y);

    // Move up with 'k'
    await page.keyboard.down('k');
    await page.waitForTimeout(200);
    await page.keyboard.up('k');

    const afterUp = await getPlayerPos();
    console.log('After up:', afterUp);
    expect(afterUp!.y).toBeLessThan(afterDown!.y);

    console.log('Movement tests passed!');
  });

  test('jump with space key', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    const getPlayerZ = async () => {
      return await page.evaluate(() => {
        const el = document.getElementById('dom3d-player');
        if (!el) return null;
        const transform = el.style.transform;
        const match = transform.match(/translate3d\([^,]+px,\s*[^,]+px,\s*([^)]+)px\)/);
        if (!match) return null;
        return parseFloat(match[1]);
      });
    };

    // Wait for player to settle on ground (gravity pulls z down)
    await page.waitForTimeout(2000);

    const initialZ = await getPlayerZ();
    console.log('Initial Z (after settling):', initialZ);

    // Get multiple samples after jump to catch the peak
    await page.keyboard.press(' ');

    // Sample Z multiple times to catch the jump peak
    let maxZ = initialZ!;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(50);
      const z = await getPlayerZ();
      if (z !== null && z > maxZ) {
        maxZ = z;
      }
    }
    console.log('Max Z during jump:', maxZ);

    // Z should have increased at some point during the jump
    expect(maxZ).toBeGreaterThan(initialZ!);

    console.log('Jump test passed!');
  });

  test('debug walls are rendered', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    // Check debug walls container exists
    const debugWallsExist = await page.evaluate(() => {
      return !!document.getElementById('dom3d-debug-walls');
    });
    expect(debugWallsExist).toBe(true);

    // Check some debug walls are rendered
    const debugWallCount = await page.evaluate(() => {
      const container = document.getElementById('dom3d-debug-walls');
      if (!container) return 0;
      return container.querySelectorAll('.dom3d-debug-wall').length;
    });
    console.log('Debug wall count:', debugWallCount);
    expect(debugWallCount).toBeGreaterThan(0);

    console.log('Debug walls test passed!');
  });

  test('markers are created', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    // Check start marker exists
    const startMarkerExists = await page.evaluate(() => {
      const el = document.getElementById('dom3d-start-marker');
      return el !== null && el.textContent === 'S';
    });
    expect(startMarkerExists).toBe(true);

    // Check goal marker exists
    const goalMarkerExists = await page.evaluate(() => {
      const el = document.getElementById('dom3d-goal-marker');
      return el !== null && el.textContent === 'G';
    });
    expect(goalMarkerExists).toBe(true);

    console.log('Markers test passed!');
  });

  test('player transform uses translate3d for Layers visibility', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    // Check player transform
    const playerStyle = await page.evaluate(() => {
      const el = document.getElementById('dom3d-player');
      if (!el) return null;
      return {
        transform: el.style.transform,
        transformStyle: getComputedStyle(el).transformStyle,
      };
    });

    expect(playerStyle?.transform).toContain('translate3d');
    expect(playerStyle?.transform).toContain('scale');
    expect(playerStyle?.transformStyle).toBe('preserve-3d');

    // Check debug walls also use translate3d
    const wallTransforms = await page.evaluate(() => {
      const container = document.getElementById('dom3d-debug-walls');
      if (!container) return [];
      const walls = container.querySelectorAll('.dom3d-debug-wall');
      return Array.from(walls).slice(0, 5).map(w => (w as HTMLElement).style.transform);
    });

    for (const transform of wallTransforms) {
      expect(transform).toContain('translate3d');
    }

    console.log('Transform test passed!');
    console.log('Player transform:', playerStyle?.transform);
    console.log('Sample wall transforms:', wallTransforms);
  });
});
