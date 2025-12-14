// ============================================================================
// z-index-world: 3D Box AABB Collision System
// 床板モデル禁止。全てBox vs Boxの3D AABBのみ。
// ============================================================================

// ============================================================================
// Types
// ============================================================================

type Box = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
};

type Player = Box & {
  vx: number;
  vy: number;
  vz: number;
};

// ============================================================================
// Constants
// ============================================================================

const BOX_D = 80;
const GRID_CELL = 200;
const SCAN_INTERVAL = 800;
const VIEWPORT_MARGIN = 300;

const PLAYER_SIZE = 20;
const MOVE_SPEED = 5;
const GRAVITY = 0.5;
const JUMP_VZ = 12;

const EXCLUDED_TAGS = new Set([
  'HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT',
  'BR', 'WBR', 'TEMPLATE', 'SLOT', 'SVG', 'PATH', 'IFRAME'
]);

// ============================================================================
// State
// ============================================================================

let root: HTMLDivElement | null = null;
let playerEl: HTMLDivElement | null = null;

let boxes: Box[] = [];
let grid: Map<string, Box[]> = new Map();

let player: Player = {
  x: 100, y: 100, z: 0,
  w: PLAYER_SIZE, h: PLAYER_SIZE, d: PLAYER_SIZE,
  vx: 0, vy: 0, vz: 0
};

let keys = { h: false, j: false, k: false, l: false, space: false };
let spaceWasPressed = false;

let running = false;
let rafId: number | null = null;
let scanTimerId: number | null = null;

// ============================================================================
// 3D AABB Collision
// ============================================================================

function overlapX(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x;
}

function overlapY(a: Box, b: Box): boolean {
  return a.y < b.y + b.h && a.y + a.h > b.y;
}

function overlapZ(a: Box, b: Box): boolean {
  return a.z < b.z + b.d && a.z + a.d > b.z;
}

function intersects(a: Box, b: Box): boolean {
  return overlapX(a, b) && overlapY(a, b) && overlapZ(a, b);
}

// ============================================================================
// Uniform Grid
// ============================================================================

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function buildGrid(boxes: Box[]): Map<string, Box[]> {
  const g = new Map<string, Box[]>();
  for (const box of boxes) {
    const x1 = Math.floor(box.x / GRID_CELL);
    const x2 = Math.floor((box.x + box.w) / GRID_CELL);
    const y1 = Math.floor(box.y / GRID_CELL);
    const y2 = Math.floor((box.y + box.h) / GRID_CELL);
    for (let cx = x1; cx <= x2; cx++) {
      for (let cy = y1; cy <= y2; cy++) {
        const key = cellKey(cx, cy);
        if (!g.has(key)) g.set(key, []);
        g.get(key)!.push(box);
      }
    }
  }
  return g;
}

function queryNearby(p: Player): Box[] {
  const result = new Set<Box>();
  const margin = GRID_CELL;
  const x1 = Math.floor((p.x - margin) / GRID_CELL);
  const x2 = Math.floor((p.x + p.w + margin) / GRID_CELL);
  const y1 = Math.floor((p.y - margin) / GRID_CELL);
  const y2 = Math.floor((p.y + p.h + margin) / GRID_CELL);
  for (let cx = x1; cx <= x2; cx++) {
    for (let cy = y1; cy <= y2; cy++) {
      const list = grid.get(cellKey(cx, cy));
      if (list) for (const b of list) result.add(b);
    }
  }
  return Array.from(result);
}

// ============================================================================
// DOM Scan -> Boxes
// ============================================================================

function scan() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  boxes = [];

  for (const el of document.querySelectorAll('*')) {
    if (EXCLUDED_TAGS.has(el.tagName)) continue;
    if ((el as HTMLElement).id?.startsWith('dom3d-')) continue;

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) continue;
    if (rect.right < -VIEWPORT_MARGIN || rect.left > vw + VIEWPORT_MARGIN) continue;
    if (rect.bottom < -VIEWPORT_MARGIN || rect.top > vh + VIEWPORT_MARGIN) continue;

    let zIndex = parseInt(style.zIndex, 10);
    if (isNaN(zIndex) || zIndex < 0) zIndex = 0;

    boxes.push({
      x: rect.left,
      y: rect.top,
      z: zIndex,
      w: rect.width,
      h: rect.height,
      d: BOX_D
    });
  }

  grid = buildGrid(boxes);

  // 初期位置: 最もzが低いボックスの上
  if (boxes.length > 0 && player.z === 0 && player.vz === 0) {
    const start = boxes.reduce((a, b) => a.z < b.z ? a : b);
    player.x = start.x + start.w / 2 - player.w / 2;
    player.y = start.y + start.h / 2 - player.h / 2;
    player.z = start.z + start.d;
  }
}

function rescan() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  boxes = [];

  for (const el of document.querySelectorAll('*')) {
    if (EXCLUDED_TAGS.has(el.tagName)) continue;
    if ((el as HTMLElement).id?.startsWith('dom3d-')) continue;

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) continue;
    if (rect.right < -VIEWPORT_MARGIN || rect.left > vw + VIEWPORT_MARGIN) continue;
    if (rect.bottom < -VIEWPORT_MARGIN || rect.top > vh + VIEWPORT_MARGIN) continue;

    let zIndex = parseInt(style.zIndex, 10);
    if (isNaN(zIndex) || zIndex < 0) zIndex = 0;

    boxes.push({
      x: rect.left,
      y: rect.top,
      z: zIndex,
      w: rect.width,
      h: rect.height,
      d: BOX_D
    });
  }

  grid = buildGrid(boxes);
}

// ============================================================================
// Physics (AABB Only)
// ============================================================================

function physics() {
  // 1) Input -> velocity
  player.vx = 0;
  player.vy = 0;
  if (keys.h) player.vx = -MOVE_SPEED;
  if (keys.l) player.vx = MOVE_SPEED;
  if (keys.k) player.vy = -MOVE_SPEED;
  if (keys.j) player.vy = MOVE_SPEED;

  // Jump: space押下時にvzを設定（1回のみ）
  if (keys.space && !spaceWasPressed) {
    player.vz = JUMP_VZ;
    spaceWasPressed = true;
  }
  if (!keys.space) {
    spaceWasPressed = false;
  }

  // 2) Gravity
  player.vz -= GRAVITY;

  // 3) Get nearby boxes
  const nearby = queryNearby(player);

  // 4) Move X -> resolve
  player.x += player.vx;
  for (const box of nearby) {
    if (intersects(player, box)) {
      const penL = (player.x + player.w) - box.x;
      const penR = (box.x + box.w) - player.x;
      if (penL < penR) {
        player.x -= penL;
      } else {
        player.x += penR;
      }
      player.vx = 0;
    }
  }

  // Move Y -> resolve
  player.y += player.vy;
  for (const box of nearby) {
    if (intersects(player, box)) {
      const penT = (player.y + player.h) - box.y;
      const penB = (box.y + box.h) - player.y;
      if (penT < penB) {
        player.y -= penT;
      } else {
        player.y += penB;
      }
      player.vy = 0;
    }
  }

  // Move Z -> resolve
  player.z += player.vz;
  for (const box of nearby) {
    if (intersects(player, box)) {
      const penF = (player.z + player.d) - box.z;
      const penB = (box.z + box.d) - player.z;
      if (penF < penB) {
        player.z -= penF;
      } else {
        player.z = box.z + box.d;
      }
      player.vz = 0;
    }
  }

  // 5) Floor at z=0
  if (player.z < 0) {
    player.z = 0;
    player.vz = 0;
  }
}

// ============================================================================
// Render
// ============================================================================

function render() {
  if (!playerEl) return;
  playerEl.style.transform = `translate3d(${player.x}px, ${player.y}px, ${player.z}px)`;
}

// ============================================================================
// Create Overlay
// ============================================================================

function createOverlay() {
  root = document.createElement('div');
  root.id = 'dom3d-game-root';
  root.style.cssText = `
    position: fixed;
    left: 0; top: 0;
    width: 100vw; height: 100vh;
    pointer-events: none;
    z-index: 2147483647;
    transform-style: preserve-3d;
  `;
  document.body.appendChild(root);
}

// ============================================================================
// Create 6-Face Player Cube
// ============================================================================

function createPlayer() {
  if (!root) return;

  playerEl = document.createElement('div');
  playerEl.id = 'dom3d-player';
  playerEl.style.cssText = `
    position: absolute;
    width: ${PLAYER_SIZE}px;
    height: ${PLAYER_SIZE}px;
    transform-style: preserve-3d;
  `;

  const half = PLAYER_SIZE / 2;
  const faces = [
    { transform: `translateZ(${half}px)`, bg: '#e74c3c' },
    { transform: `rotateY(180deg) translateZ(${half}px)`, bg: '#c0392b' },
    { transform: `rotateY(-90deg) translateZ(${half}px)`, bg: '#e67e22' },
    { transform: `rotateY(90deg) translateZ(${half}px)`, bg: '#d35400' },
    { transform: `rotateX(90deg) translateZ(${half}px)`, bg: '#f1c40f' },
    { transform: `rotateX(-90deg) translateZ(${half}px)`, bg: '#f39c12' },
  ];

  for (const face of faces) {
    const div = document.createElement('div');
    div.style.cssText = `
      position: absolute;
      width: ${PLAYER_SIZE}px;
      height: ${PLAYER_SIZE}px;
      background: ${face.bg};
      border: 1px solid rgba(0,0,0,0.3);
      box-sizing: border-box;
      transform: ${face.transform};
      backface-visibility: hidden;
    `;
    playerEl.appendChild(div);
  }

  root.appendChild(playerEl);
  render();
}

// ============================================================================
// Input
// ============================================================================

function setupInput() {
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
}

function removeInput() {
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
}

function onKeyDown(e: KeyboardEvent) {
  if (isInputEl(e.target as Element)) return;
  const k = e.key.toLowerCase();
  if (k === 'h') { keys.h = true; e.preventDefault(); }
  if (k === 'j') { keys.j = true; e.preventDefault(); }
  if (k === 'k') { keys.k = true; e.preventDefault(); }
  if (k === 'l') { keys.l = true; e.preventDefault(); }
  if (k === ' ') { keys.space = true; e.preventDefault(); }
}

function onKeyUp(e: KeyboardEvent) {
  const k = e.key.toLowerCase();
  if (k === 'h') keys.h = false;
  if (k === 'j') keys.j = false;
  if (k === 'k') keys.k = false;
  if (k === 'l') keys.l = false;
  if (k === ' ') keys.space = false;
}

function isInputEl(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable;
}

// ============================================================================
// Main Loop
// ============================================================================

function loop() {
  if (!running) return;
  physics();
  render();
  rafId = requestAnimationFrame(loop);
}

// ============================================================================
// Scroll/Resize
// ============================================================================

function onScrollResize() {
  rescan();
}

// ============================================================================
// Message Listener
// ============================================================================

function setupMessageListener() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _, res) => {
      if (msg.action === 'cleanup') {
        cleanup();
        res({ ok: true });
      }
      return true;
    });
  }
}

// ============================================================================
// Init / Cleanup
// ============================================================================

function init() {
  createOverlay();
  scan();
  createPlayer();
  setupInput();
  setupMessageListener();

  scanTimerId = window.setInterval(rescan, SCAN_INTERVAL);
  window.addEventListener('scroll', onScrollResize, { passive: true });
  window.addEventListener('resize', onScrollResize, { passive: true });

  running = true;
  rafId = requestAnimationFrame(loop);
}

function cleanup() {
  running = false;

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (scanTimerId !== null) {
    clearInterval(scanTimerId);
    scanTimerId = null;
  }

  removeInput();
  window.removeEventListener('scroll', onScrollResize);
  window.removeEventListener('resize', onScrollResize);

  root?.remove();
  root = null;
  playerEl = null;
  boxes = [];
  grid.clear();

  player = {
    x: 100, y: 100, z: 0,
    w: PLAYER_SIZE, h: PLAYER_SIZE, d: PLAYER_SIZE,
    vx: 0, vy: 0, vz: 0
  } as Player;

  (window as any).__DOM3D_ACTIVE__ = false;
}

// ============================================================================
// Entry
// ============================================================================

if ((window as any).__DOM3D_ACTIVE__) {
  cleanup();
} else {
  (window as any).__DOM3D_ACTIVE__ = true;
  init();
}
