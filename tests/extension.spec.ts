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

    // Check debug display exists
    const debugExists = await page.evaluate(() => {
      return !!document.getElementById('dom3d-debug');
    });
    expect(debugExists).toBe(true);

    // Check overlay styles
    const overlayStyles = await page.evaluate(() => {
      const el = document.getElementById('dom3d-game-root');
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        position: style.position,
        zIndex: style.zIndex,
      };
    });

    expect(overlayStyles?.position).toBe('fixed');
    expect(overlayStyles?.zIndex).toBe('2147483647');

    console.log('Overlay test passed!');
  });

  test('player moves with vim keys', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    // Get initial position (using left/top style)
    const getPlayerPos = async () => {
      return await page.evaluate(() => {
        const el = document.getElementById('dom3d-player');
        if (!el) return null;
        return {
          x: parseFloat(el.style.left) || 0,
          y: parseFloat(el.style.top) || 0,
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

  test('jump with space key changes scale (z visual)', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    // Get player scale (indicates Z height)
    const getPlayerScale = async () => {
      return await page.evaluate(() => {
        const el = document.getElementById('dom3d-player');
        if (!el) return null;
        const transform = el.style.transform;
        const match = transform.match(/scale\(([^)]+)\)/);
        if (!match) return 1;
        return parseFloat(match[1]);
      });
    };

    // Wait for player to settle
    await page.waitForTimeout(500);

    const initialScale = await getPlayerScale();
    console.log('Initial scale:', initialScale);

    // Jump
    await page.keyboard.press(' ');

    // Sample scale multiple times to catch the jump peak
    let maxScale = initialScale ?? 1;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(30);
      const scale = await getPlayerScale();
      if (scale !== null && scale > maxScale) {
        maxScale = scale;
      }
    }
    console.log('Max scale during jump:', maxScale);

    // Scale should increase during jump (Z goes up)
    expect(maxScale).toBeGreaterThan(initialScale ?? 1);

    console.log('Jump test passed!');
  });

  test('start and goal markers exist', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    // Check start marker exists
    const startMarkerExists = await page.evaluate(() => {
      return !!document.getElementById('dom3d-start-marker');
    });
    expect(startMarkerExists).toBe(true);

    // Check goal marker exists
    const goalMarkerExists = await page.evaluate(() => {
      return !!document.getElementById('dom3d-goal-marker');
    });
    expect(goalMarkerExists).toBe(true);

    // Check marker content
    const markers = await page.evaluate(() => {
      const start = document.getElementById('dom3d-start-marker');
      const goal = document.getElementById('dom3d-goal-marker');
      return {
        startText: start?.textContent,
        goalText: goal?.textContent,
      };
    });

    expect(markers.startText).toBe('S');
    expect(markers.goalText).toBe('G');

    console.log('Markers test passed!');
  });

  test('player is 2D div with proper styling', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    // Check player style
    const playerStyle = await page.evaluate(() => {
      const player = document.getElementById('dom3d-player');
      if (!player) return null;
      const style = getComputedStyle(player);
      return {
        position: style.position,
        width: style.width,
        height: style.height,
        borderRadius: style.borderRadius,
      };
    });

    expect(playerStyle?.position).toBe('absolute');
    expect(playerStyle?.width).toBe('20px');
    expect(playerStyle?.height).toBe('20px');

    console.log('Player style test passed!');
  });
});
