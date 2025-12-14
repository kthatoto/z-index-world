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

    // Check overlay styles (preserve-3d for 3D transforms)
    const overlayStyles = await page.evaluate(() => {
      const el = document.getElementById('dom3d-game-root');
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        position: style.position,
        zIndex: style.zIndex,
        transformStyle: style.transformStyle,
      };
    });

    expect(overlayStyles?.position).toBe('fixed');
    expect(overlayStyles?.zIndex).toBe('2147483647');
    expect(overlayStyles?.transformStyle).toBe('preserve-3d');

    console.log('Overlay test passed!');
  });

  test('player uses translate3d with Z component', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    // Check player transform uses translate3d
    const playerTransform = await page.evaluate(() => {
      const el = document.getElementById('dom3d-player');
      if (!el) return null;
      return el.style.transform;
    });

    expect(playerTransform).toBeTruthy();
    expect(playerTransform).toContain('translate3d');

    // Parse the transform to verify Z component exists
    const match = playerTransform?.match(/translate3d\(([^,]+)px,\s*([^,]+)px,\s*([^)]+)px\)/);
    expect(match).toBeTruthy();
    if (match) {
      const z = parseFloat(match[3]);
      expect(typeof z).toBe('number');
      expect(isNaN(z)).toBe(false);
      console.log('Player transform:', playerTransform);
      console.log('Z value:', z);
    }

    console.log('translate3d test passed!');
  });

  test('player moves with vim keys', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    // Get position from translate3d transform
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

  test('jump changes Z value in translate3d', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    // Get Z from translate3d transform
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

    // Wait for player to settle
    await page.waitForTimeout(500);

    const initialZ = await getPlayerZ();
    console.log('Initial Z:', initialZ);

    // Jump
    await page.keyboard.press(' ');

    // Sample Z multiple times to catch the jump peak
    let maxZ = initialZ ?? 0;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(30);
      const z = await getPlayerZ();
      if (z !== null && z > maxZ) {
        maxZ = z;
      }
    }
    console.log('Max Z during jump:', maxZ);

    // Z should increase during jump
    expect(maxZ).toBeGreaterThan(initialZ ?? 0);

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

  test('debug display shows transform value', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('domcontentloaded');

    // Inject content script
    await injectContentScript(page);
    await page.waitForTimeout(500);

    // Check debug display contains transform info
    const debugContent = await page.evaluate(() => {
      const debug = document.getElementById('dom3d-debug');
      return debug?.innerHTML ?? '';
    });

    expect(debugContent).toContain('translate3d');
    expect(debugContent).toContain('transform:');

    console.log('Debug display test passed!');
  });
});
