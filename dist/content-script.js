"use strict";
// ============================================================================
// z-index-world Content Script
// 3D Box (AABB) Collision System
// ============================================================================
// ============================================================================
// Constants
// ============================================================================
const D_DEFAULT = 80;
const GRID_CELL = 200;
const SCAN_INTERVAL = 800;
const VIEWPORT_MARGIN = 300;
const PLAYER_W = 20;
const PLAYER_H = 20;
const PLAYER_D = 20;
const MOVE_SPEED = 5;
const JUMP_POWER = 12;
const GRAVITY = 0.6;
const EXCLUDED_TAGS = new Set([
    'HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT',
    'BR', 'WBR', 'TEMPLATE', 'SLOT', 'SVG', 'PATH', 'IFRAME'
]);
// ============================================================================
// State
// ============================================================================
let root = null;
let playerEl = null;
let startMarkerEl = null;
let goalMarkerEl = null;
let debugContainer = null;
let infoEl = null;
let colliders = [];
let grid = new Map();
let player = {
    x: 100, y: 100, z: 0,
    w: PLAYER_W, h: PLAYER_H, d: PLAYER_D,
    vx: 0, vy: 0, vz: 0
};
let keys = { h: false, j: false, k: false, l: false, space: false };
let isGrounded = false;
let startBox = null;
let goalBox = null;
let running = false;
let rafId = null;
let scanTimerId = null;
// ============================================================================
// 3D AABB Collision
// ============================================================================
function overlapX(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x;
}
function overlapY(a, b) {
    return a.y < b.y + b.h && a.y + a.h > b.y;
}
function overlapZ(a, b) {
    return a.z < b.z + b.d && a.z + a.d > b.z;
}
function intersects(a, b) {
    return overlapX(a, b) && overlapY(a, b) && overlapZ(a, b);
}
// ============================================================================
// Spatial Grid
// ============================================================================
function cellKey(cx, cy) {
    return `${cx},${cy}`;
}
function rebuildGrid() {
    grid.clear();
    for (const col of colliders) {
        const x1 = Math.floor(col.x / GRID_CELL);
        const x2 = Math.floor((col.x + col.w) / GRID_CELL);
        const y1 = Math.floor(col.y / GRID_CELL);
        const y2 = Math.floor((col.y + col.h) / GRID_CELL);
        for (let cx = x1; cx <= x2; cx++) {
            for (let cy = y1; cy <= y2; cy++) {
                const key = cellKey(cx, cy);
                if (!grid.has(key))
                    grid.set(key, []);
                grid.get(key).push(col);
            }
        }
    }
}
function getCandidates(box) {
    const result = new Set();
    const margin = GRID_CELL;
    const x1 = Math.floor((box.x - margin) / GRID_CELL);
    const x2 = Math.floor((box.x + box.w + margin) / GRID_CELL);
    const y1 = Math.floor((box.y - margin) / GRID_CELL);
    const y2 = Math.floor((box.y + box.h + margin) / GRID_CELL);
    for (let cx = x1; cx <= x2; cx++) {
        for (let cy = y1; cy <= y2; cy++) {
            const cols = grid.get(cellKey(cx, cy));
            if (cols)
                for (const c of cols)
                    result.add(c);
        }
    }
    return Array.from(result);
}
// ============================================================================
// Collider Scanning
// ============================================================================
function scanColliders() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    colliders = [];
    for (const el of document.querySelectorAll('*')) {
        if (EXCLUDED_TAGS.has(el.tagName))
            continue;
        if (el.id?.startsWith('dom3d-'))
            continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden')
            continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10)
            continue;
        // Viewport + margin filter
        if (rect.right < -VIEWPORT_MARGIN || rect.left > vw + VIEWPORT_MARGIN)
            continue;
        if (rect.bottom < -VIEWPORT_MARGIN || rect.top > vh + VIEWPORT_MARGIN)
            continue;
        let zIndex = parseInt(style.zIndex, 10);
        if (isNaN(zIndex) || zIndex < 0)
            zIndex = 0;
        // z-index をそのまま z 座標として使用
        colliders.push({
            element: el,
            x: rect.left,
            y: rect.top,
            z: zIndex,
            w: rect.width,
            h: rect.height,
            d: D_DEFAULT
        });
    }
    rebuildGrid();
    pickStartGoal();
    renderDebug();
    console.log(`[DOM3D] Scanned ${colliders.length} colliders`);
}
function updateColliderRects() {
    for (const col of colliders) {
        const rect = col.element.getBoundingClientRect();
        col.x = rect.left;
        col.y = rect.top;
        col.w = rect.width;
        col.h = rect.height;
    }
    rebuildGrid();
}
function pickStartGoal() {
    if (colliders.length === 0)
        return;
    // Start: 最も z が低く、左下寄り
    let bestStart = colliders[0];
    let bestStartScore = -Infinity;
    for (const c of colliders) {
        const score = -c.z * 10 + c.y - c.x * 0.5;
        if (score > bestStartScore) {
            bestStartScore = score;
            bestStart = c;
        }
    }
    startBox = bestStart;
    // Goal: 最も z が高く、右上寄り
    let bestGoal = colliders[0];
    let bestGoalScore = -Infinity;
    for (const c of colliders) {
        if (c === startBox)
            continue;
        const score = c.z * 10 - c.y + c.x * 0.5;
        if (score > bestGoalScore) {
            bestGoalScore = score;
            bestGoal = c;
        }
    }
    goalBox = bestGoal !== startBox ? bestGoal : null;
    // プレイヤー初期位置（startBox の上面）
    if (startBox) {
        player.x = startBox.x + startBox.w / 2 - player.w / 2;
        player.y = startBox.y + startBox.h / 2 - player.h / 2;
        player.z = startBox.z + startBox.d;
        player.vx = 0;
        player.vy = 0;
        player.vz = 0;
    }
}
// ============================================================================
// Overlay Creation
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
    // Debug info
    infoEl = document.createElement('div');
    infoEl.id = 'dom3d-info';
    infoEl.style.cssText = `
    position: fixed;
    top: 10px; right: 10px;
    background: rgba(0,0,0,0.85);
    color: #0f0;
    font: 12px monospace;
    padding: 10px;
    border-radius: 5px;
    z-index: 2147483647;
  `;
    document.body.appendChild(infoEl);
    // Debug container
    debugContainer = document.createElement('div');
    debugContainer.id = 'dom3d-debug-walls';
    debugContainer.style.cssText = `
    position: absolute;
    left: 0; top: 0;
    transform-style: preserve-3d;
  `;
    root.appendChild(debugContainer);
}
function createPlayer() {
    if (!root)
        return;
    playerEl = document.createElement('div');
    playerEl.id = 'dom3d-player';
    playerEl.style.cssText = `
    position: absolute;
    width: ${PLAYER_W}px;
    height: ${PLAYER_H}px;
    background: #e74c3c;
    border: 3px solid #c0392b;
    border-radius: 4px;
    transform-style: preserve-3d;
  `;
    root.appendChild(playerEl);
    updatePlayerTransform();
}
function updatePlayerTransform() {
    if (!playerEl)
        return;
    playerEl.style.transform = `translate3d(${player.x}px, ${player.y}px, ${player.z}px)`;
}
function createMarkers() {
    if (!root)
        return;
    if (startBox) {
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
    `;
        updateMarkerTransform(startMarkerEl, startBox);
        root.appendChild(startMarkerEl);
    }
    if (goalBox) {
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
    `;
        updateMarkerTransform(goalMarkerEl, goalBox);
        root.appendChild(goalMarkerEl);
    }
}
function updateMarkerTransform(el, box) {
    const x = box.x + box.w / 2 - 12;
    const y = box.y + box.h / 2 - 12;
    const z = box.z + box.d + 5;
    el.style.transform = `translate3d(${x}px, ${y}px, ${z}px)`;
}
function renderDebug() {
    if (!debugContainer)
        return;
    debugContainer.innerHTML = '';
    // 上位30個のコライダを描画
    const sorted = [...colliders].sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const top = sorted.slice(0, 30);
    const maxZ = Math.max(...colliders.map(c => c.z), 1);
    for (const col of top) {
        const div = document.createElement('div');
        div.className = 'dom3d-debug-wall';
        const ratio = col.z / maxZ;
        const r = Math.floor(50 + ratio * 200);
        const b = Math.floor(200 - ratio * 150);
        div.style.cssText = `
      position: absolute;
      width: ${col.w}px;
      height: ${col.h}px;
      background: rgba(${r}, 50, ${b}, 0.12);
      border: 2px solid rgba(${r}, 50, ${b}, 0.5);
      box-sizing: border-box;
      transform: translate3d(${col.x}px, ${col.y}px, ${col.z}px);
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
function removeInput() {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
}
function onKeyDown(e) {
    if (isInputElement(e.target))
        return;
    const k = e.key.toLowerCase();
    if (k === 'h') {
        keys.h = true;
        e.preventDefault();
    }
    if (k === 'j') {
        keys.j = true;
        e.preventDefault();
    }
    if (k === 'k') {
        keys.k = true;
        e.preventDefault();
    }
    if (k === 'l') {
        keys.l = true;
        e.preventDefault();
    }
    if (k === ' ') {
        keys.space = true;
        e.preventDefault();
    }
}
function onKeyUp(e) {
    const k = e.key.toLowerCase();
    if (k === 'h')
        keys.h = false;
    if (k === 'j')
        keys.j = false;
    if (k === 'k')
        keys.k = false;
    if (k === 'l')
        keys.l = false;
    if (k === ' ')
        keys.space = false;
}
function isInputElement(el) {
    if (!el)
        return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        el.isContentEditable;
}
// ============================================================================
// Physics Loop
// ============================================================================
function loop() {
    if (!running)
        return;
    // 1. 入力から速度決定
    player.vx = 0;
    player.vy = 0;
    if (keys.h)
        player.vx = -MOVE_SPEED;
    if (keys.l)
        player.vx = MOVE_SPEED;
    if (keys.k)
        player.vy = -MOVE_SPEED;
    if (keys.j)
        player.vy = MOVE_SPEED;
    // ジャンプ
    if (keys.space && isGrounded) {
        player.vz = JUMP_POWER;
        isGrounded = false;
    }
    // 2. 重力
    player.vz -= GRAVITY;
    // 3. 近傍コライダ取得
    const candidates = getCandidates(player);
    // 4. 軸ごとに移動＋衝突解決
    // X軸
    player.x += player.vx;
    resolveX(candidates);
    // Y軸
    player.y += player.vy;
    resolveY(candidates);
    // Z軸
    player.z += player.vz;
    resolveZ(candidates);
    // 5. 地面 (z=0)
    if (player.z < 0) {
        player.z = 0;
        player.vz = 0;
        isGrounded = true;
    }
    // 6. 描画
    updatePlayerTransform();
    updateInfo();
    // ゴール判定
    if (goalBox && intersects(player, goalBox)) {
        console.log('[DOM3D] GOAL!');
    }
    rafId = requestAnimationFrame(loop);
}
function resolveX(candidates) {
    for (const col of candidates) {
        if (!intersects(player, col))
            continue;
        const penLeft = (player.x + player.w) - col.x;
        const penRight = (col.x + col.w) - player.x;
        if (penLeft < penRight) {
            player.x -= penLeft;
        }
        else {
            player.x += penRight;
        }
        player.vx = 0;
    }
}
function resolveY(candidates) {
    for (const col of candidates) {
        if (!intersects(player, col))
            continue;
        const penTop = (player.y + player.h) - col.y;
        const penBottom = (col.y + col.h) - player.y;
        if (penTop < penBottom) {
            player.y -= penTop;
        }
        else {
            player.y += penBottom;
        }
        player.vy = 0;
    }
}
function resolveZ(candidates) {
    isGrounded = false;
    for (const col of candidates) {
        if (!intersects(player, col))
            continue;
        const penFront = (player.z + player.d) - col.z;
        const penBack = (col.z + col.d) - player.z;
        if (penFront < penBack) {
            // プレイヤーがボックスの手前に侵入 → 押し戻す
            player.z -= penFront;
            if (player.vz > 0)
                player.vz = 0;
        }
        else {
            // プレイヤーがボックスの上に着地
            player.z = col.z + col.d;
            if (player.vz < 0) {
                player.vz = 0;
                isGrounded = true;
            }
        }
    }
}
function updateInfo() {
    if (!infoEl)
        return;
    infoEl.innerHTML = `
x: ${player.x.toFixed(0)} y: ${player.y.toFixed(0)} z: ${player.z.toFixed(0)}<br>
vz: ${player.vz.toFixed(1)} grounded: ${isGrounded}<br>
colliders: ${colliders.length}
  `.trim();
}
// ============================================================================
// Scroll/Resize
// ============================================================================
function onScrollResize() {
    updateColliderRects();
    renderDebug();
    if (startMarkerEl && startBox)
        updateMarkerTransform(startMarkerEl, startBox);
    if (goalMarkerEl && goalBox)
        updateMarkerTransform(goalMarkerEl, goalBox);
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
    console.log('[DOM3D] Initializing 3D Box Collision System...');
    createOverlay();
    scanColliders();
    createPlayer();
    createMarkers();
    setupInput();
    setupMessageListener();
    // 定期スキャン
    scanTimerId = window.setInterval(updateColliderRects, SCAN_INTERVAL);
    // Scroll/Resize
    window.addEventListener('scroll', onScrollResize, { passive: true });
    window.addEventListener('resize', onScrollResize, { passive: true });
    running = true;
    rafId = requestAnimationFrame(loop);
    console.log(`[DOM3D] Started. Colliders: ${colliders.length}`);
}
function cleanup() {
    console.log('[DOM3D] Cleanup...');
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
    infoEl?.remove();
    root = null;
    playerEl = null;
    startMarkerEl = null;
    goalMarkerEl = null;
    debugContainer = null;
    infoEl = null;
    colliders = [];
    grid.clear();
    startBox = null;
    goalBox = null;
    window.__DOM3D_ACTIVE__ = false;
    console.log('[DOM3D] Cleanup complete');
}
// ============================================================================
// Entry
// ============================================================================
if (window.__DOM3D_ACTIVE__) {
    cleanup();
}
else {
    window.__DOM3D_ACTIVE__ = true;
    init();
}
