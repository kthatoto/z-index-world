// ============================================================================
// z-index-world Content Script
// Webページを実際の3D空間として扱う
// DOM要素 = 床/壁、z-index = 高さ
// ============================================================================

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Platform {
  element: Element;
  rect: Rect;
  z: number;  // 床の高さ（上面）
}

interface PlayerState {
  x: number;
  y: number;
  z: number;  // プレイヤーの足元のz位置
  vx: number;
  vy: number;
  vz: number;
}

// ============================================================================
// Constants
// ============================================================================

const PERSPECTIVE = 1200;
const Z_RANGE = 300;
const PLAYER_W = 20;
const PLAYER_H = 20;
const PLAYER_D = 20;  // プレイヤーの高さ（z方向）
const MOVE_SPEED = 4;
const GRAVITY = -0.6;
const JUMP_POWER = 8;
const DEBUG_LIMIT = 30;

const EXCLUDED_TAGS = new Set([
  'HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT',
  'BR', 'WBR', 'TEMPLATE', 'SLOT', 'SVG', 'PATH'
]);

// ============================================================================
// State
// ============================================================================

let root: HTMLDivElement | null = null;
let playerEl: HTMLDivElement | null = null;
let debugContainer: HTMLDivElement | null = null;
let startMarkerEl: HTMLDivElement | null = null;
let goalMarkerEl: HTMLDivElement | null = null;

let platforms: Platform[] = [];
let player: PlayerState = { x: 100, y: 100, z: 0, vx: 0, vy: 0, vz: 0 };
let keys = { h: false, j: false, k: false, l: false, space: false };
let isGrounded = true;

let startPlatform: Platform | null = null;
let goalPlatform: Platform | null = null;

let running = false;
let rafId: number | null = null;

// ============================================================================
// Init
// ============================================================================

function init() {
  console.log('[DOM3D] Starting...');

  createOverlay();
  scanPlatforms();
  pickStartGoal();
  createPlayer();
  createMarkers();
  renderDebug();
  setupInput();
  setupMessageListener();

  running = true;
  rafId = requestAnimationFrame(loop);

  // スクロール/リサイズ時に再スキャン
  window.addEventListener('scroll', onScrollResize, { passive: true });
  window.addEventListener('resize', onScrollResize, { passive: true });

  console.log(`[DOM3D] Found ${platforms.length} platforms`);
  console.log(`[DOM3D] Player at (${player.x.toFixed(0)}, ${player.y.toFixed(0)}, z=${player.z.toFixed(0)})`);
}

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
    perspective: ${PERSPECTIVE}px;
    perspective-origin: 50% 50%;
  `;
  document.body.appendChild(root);

  debugContainer = document.createElement('div');
  debugContainer.id = 'dom3d-debug-walls';
  debugContainer.style.cssText = `
    position: absolute;
    left: 0; top: 0;
    transform-style: preserve-3d;
  `;
  root.appendChild(debugContainer);
}

// ============================================================================
// Platform Scanning - DOM要素を床として読み取る
// ============================================================================

function scanPlatforms() {
  platforms = [];
  const zValues: number[] = [];

  for (const el of document.querySelectorAll('*')) {
    if (EXCLUDED_TAGS.has(el.tagName)) continue;
    if ((el as HTMLElement).id?.startsWith('dom3d-')) continue;

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (parseFloat(style.opacity) === 0) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) continue;

    let rawZ = parseInt(style.zIndex, 10);
    if (isNaN(rawZ) || rawZ < 0) rawZ = 0;

    zValues.push(rawZ);
    platforms.push({
      element: el,
      rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      z: rawZ,  // 後で正規化
    });
  }

  // z-indexを実際の高さに正規化
  const minZ = Math.min(...zValues, 0);
  const maxZ = Math.max(...zValues, 1);
  const range = maxZ - minZ || 1;

  for (const p of platforms) {
    p.z = ((p.z - minZ) / range) * Z_RANGE;
  }
}

function updatePlatformRects() {
  for (const p of platforms) {
    const rect = p.element.getBoundingClientRect();
    p.rect.x = rect.left;
    p.rect.y = rect.top;
    p.rect.w = rect.width;
    p.rect.h = rect.height;
  }
}

// ============================================================================
// Start/Goal - 画面内で選ぶ
// ============================================================================

function pickStartGoal() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 画面内のプラットフォームのみ
  const visible = platforms.filter(p =>
    p.rect.x >= -10 && p.rect.x + p.rect.w <= vw + 10 &&
    p.rect.y >= -10 && p.rect.y + p.rect.h <= vh + 10
  );

  const candidates = visible.length > 0 ? visible : platforms;
  if (candidates.length === 0) return;

  // Start: z低め、左下寄り
  let bestStart = -Infinity;
  for (const p of candidates) {
    const score = -p.z + (p.rect.y / vh) * 50 - (p.rect.x / vw) * 30 + Math.log(p.rect.w * p.rect.h);
    if (score > bestStart) {
      bestStart = score;
      startPlatform = p;
    }
  }

  // Goal: z高め、右上寄り、画面内
  let bestGoal = -Infinity;
  for (const p of candidates) {
    if (p === startPlatform) continue;

    // 画面外ペナルティ
    let penalty = 0;
    const cx = p.rect.x + p.rect.w / 2;
    const cy = p.rect.y + p.rect.h / 2;
    if (cx < 0 || cx > vw || cy < 0 || cy > vh) penalty = -500;

    const score = p.z + -(p.rect.y / vh) * 50 + (p.rect.x / vw) * 30 + Math.log(p.rect.w * p.rect.h) + penalty;
    if (score > bestGoal) {
      bestGoal = score;
      goalPlatform = p;
    }
  }
}

// ============================================================================
// Player
// ============================================================================

function createPlayer() {
  if (!root) return;

  playerEl = document.createElement('div');
  playerEl.id = 'dom3d-player';
  playerEl.style.cssText = `
    position: absolute;
    left: 0; top: 0;
    width: ${PLAYER_W}px;
    height: ${PLAYER_H}px;
    background: #e74c3c;
    border: 2px solid #c0392b;
    border-radius: 4px;
    transform-style: preserve-3d;
  `;
  root.appendChild(playerEl);

  // スタート位置
  if (startPlatform) {
    player.x = startPlatform.rect.x + startPlatform.rect.w / 2 - PLAYER_W / 2;
    player.y = startPlatform.rect.y + startPlatform.rect.h / 2 - PLAYER_H / 2;
    player.z = startPlatform.z;  // 床の上に立つ
  }

  updatePlayerDOM();
}

function updatePlayerDOM() {
  if (!playerEl) return;
  playerEl.style.transform = `translate3d(${player.x}px, ${player.y}px, ${player.z}px)`;
}

// ============================================================================
// Markers - DOM要素の位置にピッタリ配置
// ============================================================================

function createMarkers() {
  if (!root) return;

  if (startPlatform) {
    startMarkerEl = document.createElement('div');
    startMarkerEl.id = 'dom3d-start-marker';
    startMarkerEl.textContent = 'S';
    startMarkerEl.style.cssText = `
      position: absolute;
      left: 0; top: 0;
      width: 24px; height: 24px;
      background: #27ae60;
      border: 2px solid #1e8449;
      border-radius: 50%;
      color: white;
      font: bold 14px sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      transform-style: preserve-3d;
    `;
    updateMarker(startMarkerEl, startPlatform);
    root.appendChild(startMarkerEl);
  }

  if (goalPlatform) {
    goalMarkerEl = document.createElement('div');
    goalMarkerEl.id = 'dom3d-goal-marker';
    goalMarkerEl.textContent = 'G';
    goalMarkerEl.style.cssText = `
      position: absolute;
      left: 0; top: 0;
      width: 24px; height: 24px;
      background: #3498db;
      border: 2px solid #2980b9;
      border-radius: 50%;
      color: white;
      font: bold 14px sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      transform-style: preserve-3d;
    `;
    updateMarker(goalMarkerEl, goalPlatform);
    root.appendChild(goalMarkerEl);
  }
}

function updateMarker(el: HTMLElement, p: Platform) {
  const x = p.rect.x + p.rect.w / 2 - 12;
  const y = p.rect.y + p.rect.h / 2 - 12;
  const z = p.z + 1;
  el.style.transform = `translate3d(${x}px, ${y}px, ${z}px)`;
}

function updateMarkers() {
  if (startMarkerEl && startPlatform) updateMarker(startMarkerEl, startPlatform);
  if (goalMarkerEl && goalPlatform) updateMarker(goalMarkerEl, goalPlatform);
}

// ============================================================================
// Debug - プラットフォームを可視化
// ============================================================================

function renderDebug() {
  if (!debugContainer) return;
  debugContainer.innerHTML = '';

  // 大きい順に上位N個
  const sorted = [...platforms].sort((a, b) => (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h));
  const top = sorted.slice(0, DEBUG_LIMIT);

  for (const p of top) {
    const div = document.createElement('div');
    div.className = 'dom3d-debug-wall';

    // 高さで色分け: 青(低) → 赤(高)
    const ratio = p.z / Z_RANGE;
    const r = Math.floor(ratio * 200);
    const b = Math.floor((1 - ratio) * 200);

    div.style.cssText = `
      position: absolute;
      left: 0; top: 0;
      width: ${p.rect.w}px;
      height: ${p.rect.h}px;
      background: rgba(${r}, 50, ${b}, 0.15);
      border: 1px solid rgba(${r}, 50, ${b}, 0.4);
      transform: translate3d(${p.rect.x}px, ${p.rect.y}px, ${p.z}px);
      transform-style: preserve-3d;
    `;
    debugContainer.appendChild(div);
  }
}

// ============================================================================
// Input
// ============================================================================

function setupInput() {
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
}

function onKeyDown(e: KeyboardEvent) {
  if (isInput(e.target as Element)) return;
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

function isInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

// ============================================================================
// Physics - 実際の3D衝突
// ============================================================================

function loop() {
  if (!running) return;

  // 入力
  let dx = 0, dy = 0;
  if (keys.h) dx -= MOVE_SPEED;
  if (keys.l) dx += MOVE_SPEED;
  if (keys.k) dy -= MOVE_SPEED;
  if (keys.j) dy += MOVE_SPEED;

  // ジャンプ
  if (keys.space && isGrounded) {
    player.vz = JUMP_POWER;
    isGrounded = false;
  }

  // 重力
  player.vz += GRAVITY;

  // X移動 + 衝突
  player.x += dx;
  for (const p of platforms) {
    if (collideXY(p) && collidesZ(p)) {
      // 壁として押し戻し
      if (dx > 0) player.x = p.rect.x - PLAYER_W;
      else if (dx < 0) player.x = p.rect.x + p.rect.w;
    }
  }

  // Y移動 + 衝突
  player.y += dy;
  for (const p of platforms) {
    if (collideXY(p) && collidesZ(p)) {
      if (dy > 0) player.y = p.rect.y - PLAYER_H;
      else if (dy < 0) player.y = p.rect.y + p.rect.h;
    }
  }

  // Z移動 + 床判定
  player.z += player.vz;
  isGrounded = false;

  // 床に乗る判定
  for (const p of platforms) {
    if (collideXY(p)) {
      // プレイヤーがこの床の上にいるべきか？
      const floorTop = p.z;  // 床の上面
      const playerBottom = player.z;  // プレイヤーの足元
      const playerTop = player.z + PLAYER_D;  // プレイヤーの頭

      // 落下中に床を通過しようとしている
      if (player.vz < 0 && playerBottom <= floorTop && playerBottom > floorTop - 10) {
        player.z = floorTop;
        player.vz = 0;
        isGrounded = true;
      }
      // 床の中にめり込んでいる
      else if (playerBottom < floorTop && playerTop > floorTop) {
        player.z = floorTop;
        player.vz = 0;
        isGrounded = true;
      }
    }
  }

  // 絶対的な地面 (z=0)
  if (player.z < 0) {
    player.z = 0;
    player.vz = 0;
    isGrounded = true;
  }

  // DOM更新
  updatePlayerDOM();

  // ゴール判定
  if (goalPlatform && collideXY(goalPlatform) && Math.abs(player.z - goalPlatform.z) < 30) {
    console.log('[DOM3D] 🎉 GOAL!');
  }

  rafId = requestAnimationFrame(loop);
}

// プレイヤーとプラットフォームがXY平面で重なっているか
function collideXY(p: Platform): boolean {
  return player.x < p.rect.x + p.rect.w &&
         player.x + PLAYER_W > p.rect.x &&
         player.y < p.rect.y + p.rect.h &&
         player.y + PLAYER_H > p.rect.y;
}

// プレイヤーのZ範囲がプラットフォームのZ範囲と重なっているか
function collidesZ(p: Platform): boolean {
  const playerBottom = player.z;
  const playerTop = player.z + PLAYER_D;
  const floorTop = p.z;
  const floorBottom = p.z - 10;  // 床の厚み

  return playerBottom < floorTop && playerTop > floorBottom;
}

// ============================================================================
// Scroll/Resize
// ============================================================================

function onScrollResize() {
  updatePlatformRects();
  updateMarkers();
  renderDebug();
}

// ============================================================================
// Cleanup
// ============================================================================

function setupMessageListener() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _, res) => {
      if (msg.action === 'cleanup') { cleanup(); res({ ok: true }); }
      return true;
    });
  }
}

function cleanup() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('keyup', onKeyUp, true);
  window.removeEventListener('scroll', onScrollResize);
  window.removeEventListener('resize', onScrollResize);
  root?.remove();
  (window as any).__DOM3D_ACTIVE__ = false;
  console.log('[DOM3D] Cleaned up');
}

// ============================================================================
// Entry
// ============================================================================

if ((window as any).__DOM3D_ACTIVE__) {
  console.log('[DOM3D] Already running');
} else {
  (window as any).__DOM3D_ACTIVE__ = true;
  init();
}
