// ============================================================================
// z-index-world Content Script
// シンプルな実装: z-indexを高さとして扱う3Dプラットフォーマー
// ============================================================================

// ============================================================================
// Types
// ============================================================================

interface Platform {
  element: Element;
  x: number;
  y: number;
  z: number;  // 正規化されたz-index (高さ)
  w: number;
  h: number;
}

// ============================================================================
// Constants
// ============================================================================

const PERSPECTIVE = 1200;
const Z_SCALE = 1;  // z-indexをそのままピクセルとして使用

const PLAYER_SIZE = 24;
const MOVE_SPEED = 5;
const JUMP_POWER = 12;
const GRAVITY = 0.5;

const EXCLUDED_TAGS = new Set([
  'HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT',
  'BR', 'WBR', 'TEMPLATE', 'SLOT', 'SVG', 'PATH', 'IFRAME'
]);

// ============================================================================
// State
// ============================================================================

let root: HTMLDivElement | null = null;
let playerEl: HTMLDivElement | null = null;
let debugContainer: HTMLDivElement | null = null;
let infoEl: HTMLDivElement | null = null;
let startMarkerEl: HTMLDivElement | null = null;
let goalMarkerEl: HTMLDivElement | null = null;

let platforms: Platform[] = [];
let startPlatform: Platform | null = null;
let goalPlatform: Platform | null = null;

let px = 100, py = 100, pz = 0;  // プレイヤー位置
let vz = 0;  // z方向の速度
let isGrounded = true;

let keys = { h: false, j: false, k: false, l: false, space: false };

let running = false;
let rafId: number | null = null;

// ============================================================================
// Initialization
// ============================================================================

function init() {
  console.log('[DOM3D] Starting...');

  createOverlay();
  scanPlatforms();
  createPlayer();
  createMarkers();
  createDebugWalls();
  setupInput();
  setupMessageListener();

  running = true;
  rafId = requestAnimationFrame(loop);

  console.log(`[DOM3D] Found ${platforms.length} platforms`);
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

  // Debug info
  infoEl = document.createElement('div');
  infoEl.id = 'dom3d-info';
  infoEl.style.cssText = `
    position: fixed;
    top: 10px; right: 10px;
    background: rgba(0,0,0,0.8);
    color: #0f0;
    font: 12px monospace;
    padding: 10px;
    border-radius: 5px;
    z-index: 2147483647;
  `;
  document.body.appendChild(infoEl);

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
// Platform Scanning
// ============================================================================

function scanPlatforms() {
  platforms = [];

  for (const el of document.querySelectorAll('*')) {
    if (EXCLUDED_TAGS.has(el.tagName)) continue;
    if ((el as HTMLElement).id?.startsWith('dom3d-')) continue;

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) continue;

    let zIndex = parseInt(style.zIndex, 10);
    if (isNaN(zIndex) || zIndex < 0) zIndex = 0;

    platforms.push({
      element: el,
      x: rect.left,
      y: rect.top,
      z: zIndex * Z_SCALE,  // z-indexをそのまま高さとして使用
      w: rect.width,
      h: rect.height
    });
  }

  // 大きい順にソート
  platforms.sort((a, b) => (b.w * b.h) - (a.w * a.h));

  // スタート位置を決定（z=0に近いプラットフォームの上）
  startPlatform = platforms.find(p => p.z < 50) || platforms[0];
  if (startPlatform) {
    px = startPlatform.x + startPlatform.w / 2 - PLAYER_SIZE / 2;
    py = startPlatform.y + startPlatform.h / 2 - PLAYER_SIZE / 2;
    pz = startPlatform.z;
  }

  // ゴール（最もzが高いプラットフォーム）
  goalPlatform = platforms.reduce((max, p) => p.z > max.z ? p : max, platforms[0]);
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
    width: ${PLAYER_SIZE}px;
    height: ${PLAYER_SIZE}px;
    background: #e74c3c;
    border: 3px solid #c0392b;
    border-radius: 4px;
    transform-style: preserve-3d;
  `;
  root.appendChild(playerEl);

  updatePlayerTransform();
}

function updatePlayerTransform() {
  if (!playerEl) return;
  // translate3d(x, y, z) でzを直接指定
  playerEl.style.transform = `translate3d(${px}px, ${py}px, ${pz}px)`;
}

// ============================================================================
// Markers
// ============================================================================

function createMarkers() {
  if (!root) return;

  if (startPlatform) {
    startMarkerEl = document.createElement('div');
    startMarkerEl.id = 'dom3d-start-marker';
    startMarkerEl.textContent = 'S';
    startMarkerEl.style.cssText = `
      position: absolute;
      width: 24px; height: 24px;
      background: #27ae60;
      border: 2px solid #1e8449;
      border-radius: 50%;
      color: white;
      font: bold 14px sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: translate3d(${startPlatform.x + startPlatform.w/2 - 12}px, ${startPlatform.y + startPlatform.h/2 - 12}px, ${startPlatform.z + 5}px);
    `;
    root.appendChild(startMarkerEl);
  }

  if (goalPlatform) {
    goalMarkerEl = document.createElement('div');
    goalMarkerEl.id = 'dom3d-goal-marker';
    goalMarkerEl.textContent = 'G';
    goalMarkerEl.style.cssText = `
      position: absolute;
      width: 24px; height: 24px;
      background: #3498db;
      border: 2px solid #2980b9;
      border-radius: 50%;
      color: white;
      font: bold 14px sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: translate3d(${goalPlatform.x + goalPlatform.w/2 - 12}px, ${goalPlatform.y + goalPlatform.h/2 - 12}px, ${goalPlatform.z + 5}px);
    `;
    root.appendChild(goalMarkerEl);
  }
}

// ============================================================================
// Debug Walls
// ============================================================================

function createDebugWalls() {
  if (!debugContainer) return;

  // 上位30個のプラットフォームを描画
  const top = platforms.slice(0, 30);

  for (const p of top) {
    const div = document.createElement('div');
    div.className = 'dom3d-debug-wall';

    // zが高いほど赤く
    const maxZ = Math.max(...platforms.map(x => x.z), 1);
    const ratio = p.z / maxZ;
    const r = Math.floor(50 + ratio * 200);
    const b = Math.floor(200 - ratio * 150);

    div.style.cssText = `
      position: absolute;
      width: ${p.w}px;
      height: ${p.h}px;
      background: rgba(${r}, 50, ${b}, 0.15);
      border: 2px solid rgba(${r}, 50, ${b}, 0.5);
      box-sizing: border-box;
      transform: translate3d(${p.x}px, ${p.y}px, ${p.z}px);
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
  if (isInputElement(e.target as Element)) return;
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

function isInputElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable;
}

// ============================================================================
// Physics Loop
// ============================================================================

function loop() {
  if (!running) return;

  // XY移動
  if (keys.h) px -= MOVE_SPEED;
  if (keys.l) px += MOVE_SPEED;
  if (keys.k) py -= MOVE_SPEED;
  if (keys.j) py += MOVE_SPEED;

  // ジャンプ（z方向に飛ぶ）
  if (keys.space && isGrounded) {
    vz = JUMP_POWER;
    isGrounded = false;
    console.log('[DOM3D] Jump! vz =', vz);
  }

  // 重力（zを減少させる）
  vz -= GRAVITY;
  pz += vz;

  // 床判定
  isGrounded = false;

  // プラットフォームとの衝突
  for (const p of platforms) {
    // XY範囲内にいるか
    if (px + PLAYER_SIZE > p.x && px < p.x + p.w &&
        py + PLAYER_SIZE > p.y && py < p.y + p.h) {

      // 落下中にプラットフォームの高さに達した
      if (vz < 0 && pz <= p.z && pz > p.z - 20) {
        pz = p.z;
        vz = 0;
        isGrounded = true;
        break;
      }
    }
  }

  // 最低でもz=0（地面）
  if (pz < 0) {
    pz = 0;
    vz = 0;
    isGrounded = true;
  }

  // 描画更新
  updatePlayerTransform();
  updateInfo();

  rafId = requestAnimationFrame(loop);
}

function updateInfo() {
  if (!infoEl) return;
  infoEl.textContent = `x: ${px.toFixed(0)} y: ${py.toFixed(0)} z: ${pz.toFixed(0)} | vz: ${vz.toFixed(1)} | grounded: ${isGrounded}`;
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
  root?.remove();
  infoEl?.remove();
  root = null;
  playerEl = null;
  debugContainer = null;
  infoEl = null;
  startMarkerEl = null;
  goalMarkerEl = null;
  platforms = [];
  startPlatform = null;
  goalPlatform = null;
  (window as any).__DOM3D_ACTIVE__ = false;
  console.log('[DOM3D] Cleanup complete');
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
