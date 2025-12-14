"use strict";
// ============================================================================
// z-index-world: 3D Box AABB Collision System
// 床板モデル禁止。全てBox vs Boxの3D AABBのみ。
// ============================================================================
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
let root = null;
let playerEl = null;
let debugEl = null;
let startMarkerEl = null;
let goalMarkerEl = null;
let boxes = [];
let grid = new Map();
let startBox = null;
let goalBox = null;
let player = {
    x: 100, y: 100, z: 0,
    w: PLAYER_SIZE, h: PLAYER_SIZE, d: PLAYER_SIZE,
    vx: 0, vy: 0, vz: 0
};
let keys = { h: false, j: false, k: false, l: false, space: false };
let jumpQueued = false;
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
// Uniform Grid
// ============================================================================
function cellKey(cx, cy) {
    return `${cx},${cy}`;
}
function buildGrid(boxes) {
    const g = new Map();
    for (const box of boxes) {
        const x1 = Math.floor(box.x / GRID_CELL);
        const x2 = Math.floor((box.x + box.w) / GRID_CELL);
        const y1 = Math.floor(box.y / GRID_CELL);
        const y2 = Math.floor((box.y + box.h) / GRID_CELL);
        for (let cx = x1; cx <= x2; cx++) {
            for (let cy = y1; cy <= y2; cy++) {
                const key = cellKey(cx, cy);
                if (!g.has(key))
                    g.set(key, []);
                g.get(key).push(box);
            }
        }
    }
    return g;
}
function queryNearby(p) {
    const result = new Set();
    const margin = GRID_CELL;
    const x1 = Math.floor((p.x - margin) / GRID_CELL);
    const x2 = Math.floor((p.x + p.w + margin) / GRID_CELL);
    const y1 = Math.floor((p.y - margin) / GRID_CELL);
    const y2 = Math.floor((p.y + p.h + margin) / GRID_CELL);
    for (let cx = x1; cx <= x2; cx++) {
        for (let cy = y1; cy <= y2; cy++) {
            const list = grid.get(cellKey(cx, cy));
            if (list)
                for (const b of list)
                    result.add(b);
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
        if (rect.right < -VIEWPORT_MARGIN || rect.left > vw + VIEWPORT_MARGIN)
            continue;
        if (rect.bottom < -VIEWPORT_MARGIN || rect.top > vh + VIEWPORT_MARGIN)
            continue;
        let zIndex = parseInt(style.zIndex, 10);
        if (isNaN(zIndex) || zIndex < 0)
            zIndex = 0;
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
    // スタート: 最もzが低いボックス、ゴール: 最もzが高いボックス
    if (boxes.length > 0) {
        startBox = boxes.reduce((a, b) => a.z < b.z ? a : b);
        goalBox = boxes.reduce((a, b) => a.z > b.z ? a : b);
    }
    // 初期位置: スタートボックスの上（ただし重なる全ボックスの最上部に配置）
    if (boxes.length > 0 && player.z === 0 && player.vz === 0 && startBox) {
        player.x = startBox.x + startBox.w / 2 - player.w / 2;
        player.y = startBox.y + startBox.h / 2 - player.h / 2;
        // スポーン位置で重なっている全ボックスの最上部を探す
        let maxTop = startBox.z + startBox.d;
        for (const box of boxes) {
            if (player.x < box.x + box.w && player.x + player.w > box.x &&
                player.y < box.y + box.h && player.y + player.h > box.y) {
                const top = box.z + box.d;
                if (top > maxTop)
                    maxTop = top;
            }
        }
        player.z = maxTop;
    }
}
function rescan() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    boxes = [];
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
        if (rect.right < -VIEWPORT_MARGIN || rect.left > vw + VIEWPORT_MARGIN)
            continue;
        if (rect.bottom < -VIEWPORT_MARGIN || rect.top > vh + VIEWPORT_MARGIN)
            continue;
        let zIndex = parseInt(style.zIndex, 10);
        if (isNaN(zIndex) || zIndex < 0)
            zIndex = 0;
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
    if (keys.h)
        player.vx = -MOVE_SPEED;
    if (keys.l)
        player.vx = MOVE_SPEED;
    if (keys.k)
        player.vy = -MOVE_SPEED;
    if (keys.j)
        player.vy = MOVE_SPEED;
    // Jump: キュー方式（keydownイベントで即座にキュー）
    if (jumpQueued) {
        player.vz = JUMP_VZ;
        jumpQueued = false;
    }
    // 2) Gravity
    player.vz -= GRAVITY;
    // 3) Get nearby boxes
    const nearby = queryNearby(player);
    // Helper: check if player was already intersecting before move (for X/Y only)
    const wasIntersectingX = (box, oldX) => oldX < box.x + box.w && oldX + player.w > box.x &&
        player.y < box.y + box.h && player.y + player.h > box.y &&
        player.z < box.z + box.d && player.z + player.d > box.z;
    const wasIntersectingY = (box, oldY) => player.x < box.x + box.w && player.x + player.w > box.x &&
        oldY < box.y + box.h && oldY + player.h > box.y &&
        player.z < box.z + box.d && player.z + player.d > box.z;
    // 4) Move X -> resolve (only if newly entered box)
    const oldX = player.x;
    player.x += player.vx;
    for (const box of nearby) {
        if (!wasIntersectingX(box, oldX) && intersects(player, box)) {
            const penL = (player.x + player.w) - box.x;
            const penR = (box.x + box.w) - player.x;
            if (penL < penR) {
                player.x -= penL;
            }
            else {
                player.x += penR;
            }
            player.vx = 0;
        }
    }
    // Move Y -> resolve (only if newly entered box)
    const oldY = player.y;
    player.y += player.vy;
    for (const box of nearby) {
        if (!wasIntersectingY(box, oldY) && intersects(player, box)) {
            const penT = (player.y + player.h) - box.y;
            const penB = (box.y + box.h) - player.y;
            if (penT < penB) {
                player.y -= penT;
            }
            else {
                player.y += penB;
            }
            player.vy = 0;
        }
    }
    // Move Z -> resolve (ALWAYS resolve Z to ensure proper landing/ceiling collision)
    player.z += player.vz;
    for (const box of nearby) {
        if (intersects(player, box)) {
            const penF = (player.z + player.d) - box.z;
            const penB = (box.z + box.d) - player.z;
            if (penF < penB) {
                player.z -= penF;
            }
            else {
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
    if (!playerEl)
        return;
    playerEl.style.transform = `translate3d(${player.x}px, ${player.y}px, ${player.z}px)`;
    // Update debug display
    if (debugEl) {
        debugEl.innerHTML = `
      <div style="margin-bottom: 4px; color: #fff; font-weight: bold;">🎮 z-index-world</div>
      <div>X: <span style="color: #f66">${player.x.toFixed(0)}</span></div>
      <div>Y: <span style="color: #6f6">${player.y.toFixed(0)}</span></div>
      <div>Z: <span style="color: #66f">${player.z.toFixed(0)}</span></div>
      <div style="margin-top: 4px; font-size: 10px; color: #888;">HJKL:移動 Space:ジャンプ</div>
    `;
    }
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
    if (!root)
        return;
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
// Create Debug Display
// ============================================================================
function createDebugDisplay() {
    if (!root)
        return;
    debugEl = document.createElement('div');
    debugEl.id = 'dom3d-debug';
    debugEl.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: linear-gradient(135deg, rgba(0, 0, 0, 0.9) 0%, rgba(30, 30, 50, 0.9) 100%);
    color: #0ff;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    padding: 10px 14px;
    border-radius: 6px;
    border: 1px solid rgba(0, 255, 255, 0.3);
    box-shadow: 0 0 20px rgba(0, 255, 255, 0.2), inset 0 0 30px rgba(0, 0, 0, 0.3);
    z-index: 2147483647;
    pointer-events: none;
    text-shadow: 0 0 5px rgba(0, 255, 255, 0.5);
  `;
    document.body.appendChild(debugEl);
}
// ============================================================================
// Create Markers
// ============================================================================
function createMarkers() {
    if (!root)
        return;
    // Start marker
    if (startBox) {
        startMarkerEl = document.createElement('div');
        startMarkerEl.id = 'dom3d-start-marker';
        startMarkerEl.style.cssText = `
      position: absolute;
      width: 30px;
      height: 30px;
      background: rgba(46, 204, 113, 0.8);
      border: 2px solid #27ae60;
      border-radius: 50%;
      transform: translate3d(${startBox.x + startBox.w / 2 - 15}px, ${startBox.y + startBox.h / 2 - 15}px, ${startBox.z + startBox.d + 1}px);
      box-shadow: 0 0 10px rgba(46, 204, 113, 0.5);
    `;
        // Add "S" label
        const label = document.createElement('div');
        label.style.cssText = `
      position: absolute;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 14px;
      font-family: sans-serif;
    `;
        label.textContent = 'S';
        startMarkerEl.appendChild(label);
        root.appendChild(startMarkerEl);
    }
    // Goal marker
    if (goalBox) {
        goalMarkerEl = document.createElement('div');
        goalMarkerEl.id = 'dom3d-goal-marker';
        goalMarkerEl.style.cssText = `
      position: absolute;
      width: 30px;
      height: 30px;
      background: rgba(241, 196, 15, 0.8);
      border: 2px solid #f39c12;
      border-radius: 50%;
      transform: translate3d(${goalBox.x + goalBox.w / 2 - 15}px, ${goalBox.y + goalBox.h / 2 - 15}px, ${goalBox.z + goalBox.d + 1}px);
      box-shadow: 0 0 15px rgba(241, 196, 15, 0.7);
      animation: pulse 1.5s ease-in-out infinite;
    `;
        // Add "G" label
        const label = document.createElement('div');
        label.style.cssText = `
      position: absolute;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 14px;
      font-family: sans-serif;
    `;
        label.textContent = 'G';
        goalMarkerEl.appendChild(label);
        root.appendChild(goalMarkerEl);
    }
    // Add pulse animation
    const style = document.createElement('style');
    style.id = 'dom3d-marker-style';
    style.textContent = `
    @keyframes pulse {
      0%, 100% { transform: translate3d(${goalBox ? goalBox.x + goalBox.w / 2 - 15 : 0}px, ${goalBox ? goalBox.y + goalBox.h / 2 - 15 : 0}px, ${goalBox ? goalBox.z + goalBox.d + 1 : 0}px) scale(1); }
      50% { transform: translate3d(${goalBox ? goalBox.x + goalBox.w / 2 - 15 : 0}px, ${goalBox ? goalBox.y + goalBox.h / 2 - 15 : 0}px, ${goalBox ? goalBox.z + goalBox.d + 1 : 0}px) scale(1.1); }
    }
  `;
    document.head.appendChild(style);
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
    if (isInputEl(e.target))
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
        jumpQueued = true;
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
function isInputEl(el) {
    if (!el)
        return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        el.isContentEditable;
}
// ============================================================================
// Main Loop
// ============================================================================
function loop() {
    if (!running)
        return;
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
    createDebugDisplay();
    createMarkers();
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
    debugEl?.remove();
    document.getElementById('dom3d-marker-style')?.remove();
    root = null;
    playerEl = null;
    debugEl = null;
    startMarkerEl = null;
    goalMarkerEl = null;
    boxes = [];
    grid.clear();
    startBox = null;
    goalBox = null;
    player = {
        x: 100, y: 100, z: 0,
        w: PLAYER_SIZE, h: PLAYER_SIZE, d: PLAYER_SIZE,
        vx: 0, vy: 0, vz: 0
    };
    jumpQueued = false;
    window.__DOM3D_ACTIVE__ = false;
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
