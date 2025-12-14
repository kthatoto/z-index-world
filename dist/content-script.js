"use strict";
// ============================================================================
// z-index-world Content Script
// 3D Box Collision System - DOM elements as AABB walls
// ============================================================================
// ============================================================================
// Constants
// ============================================================================
const DEBUG = true;
const PERSPECTIVE = 1200;
const Z_RANGE = 800;
const COLLIDER_DEPTH = 80;
const PLAYER_W = 24;
const PLAYER_H = 24;
const PLAYER_D = 24;
const MOVE_SPEED = 6;
const JUMP_POWER = 15;
const GRAVITY = 0.8;
const GRID_CELL = 100;
const SCAN_INTERVAL = 800;
const VIEWPORT_MARGIN = 200;
const MAX_COLLIDERS = 100;
const SCALE_MIN = 0.5;
const SCALE_MAX = 2.5;
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
let allColliders = [];
let activeColliders = [];
let grid = new Map();
let player = { x: 100, y: 100, z: 0, vx: 0, vy: 0, vz: 0 };
let keys = { h: false, j: false, k: false, l: false, space: false };
let isGrounded = false;
let startCollider = null;
let goalCollider = null;
let running = false;
let rafId = null;
let scanIntervalId = null;
// ============================================================================
// 3D AABB Collision Detection
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
function getPlayerBox() {
    return {
        x: player.x,
        y: player.y,
        z: player.z,
        w: PLAYER_W,
        h: PLAYER_H,
        d: PLAYER_D
    };
}
// Minimum penetration resolution
function resolveCollision(pBox, col) {
    if (!intersects(pBox, col))
        return null;
    // Calculate penetration depths
    const overlapLeft = (pBox.x + pBox.w) - col.x;
    const overlapRight = (col.x + col.w) - pBox.x;
    const overlapTop = (pBox.y + pBox.h) - col.y;
    const overlapBottom = (col.y + col.h) - pBox.y;
    const overlapFront = (pBox.z + pBox.d) - col.z;
    const overlapBack = (col.z + col.d) - pBox.z;
    const penX = Math.min(overlapLeft, overlapRight);
    const penY = Math.min(overlapTop, overlapBottom);
    const penZ = Math.min(overlapFront, overlapBack);
    // Push out on minimum penetration axis
    if (penX <= penY && penX <= penZ) {
        const delta = overlapLeft < overlapRight ? -overlapLeft : overlapRight;
        return { axis: 'x', delta };
    }
    else if (penY <= penX && penY <= penZ) {
        const delta = overlapTop < overlapBottom ? -overlapTop : overlapBottom;
        return { axis: 'y', delta };
    }
    else {
        const delta = overlapFront < overlapBack ? -overlapFront : overlapBack;
        return { axis: 'z', delta };
    }
}
// ============================================================================
// Spatial Grid for Collision Optimization
// ============================================================================
function getCellKey(x, y) {
    const cx = Math.floor(x / GRID_CELL);
    const cy = Math.floor(y / GRID_CELL);
    return `${cx},${cy}`;
}
function getColliderCells(col) {
    const keys = [];
    const x1 = Math.floor(col.x / GRID_CELL);
    const x2 = Math.floor((col.x + col.w) / GRID_CELL);
    const y1 = Math.floor(col.y / GRID_CELL);
    const y2 = Math.floor((col.y + col.h) / GRID_CELL);
    for (let cx = x1; cx <= x2; cx++) {
        for (let cy = y1; cy <= y2; cy++) {
            keys.push(`${cx},${cy}`);
        }
    }
    return keys;
}
function rebuildGrid() {
    grid.clear();
    for (const col of activeColliders) {
        const cells = getColliderCells(col);
        for (const key of cells) {
            if (!grid.has(key))
                grid.set(key, []);
            grid.get(key).push(col);
        }
    }
}
function getNearbyColliders(pBox) {
    const result = new Set();
    const margin = GRID_CELL;
    const x1 = Math.floor((pBox.x - margin) / GRID_CELL);
    const x2 = Math.floor((pBox.x + pBox.w + margin) / GRID_CELL);
    const y1 = Math.floor((pBox.y - margin) / GRID_CELL);
    const y2 = Math.floor((pBox.y + pBox.h + margin) / GRID_CELL);
    for (let cx = x1; cx <= x2; cx++) {
        for (let cy = y1; cy <= y2; cy++) {
            const key = `${cx},${cy}`;
            const cols = grid.get(key);
            if (cols) {
                for (const c of cols)
                    result.add(c);
            }
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
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const zValues = [];
    const candidates = [];
    for (const el of document.querySelectorAll('*')) {
        if (EXCLUDED_TAGS.has(el.tagName))
            continue;
        if (el.id?.startsWith('dom3d-'))
            continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden')
            continue;
        if (parseFloat(style.opacity) === 0)
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
        zValues.push(zIndex);
        candidates.push({ el, rect, zIndex });
    }
    // Normalize z-index to Z_RANGE
    const minZ = Math.min(...zValues, 0);
    const maxZ = Math.max(...zValues, 1);
    const range = maxZ - minZ || 1;
    allColliders = [];
    for (const c of candidates) {
        const normalizedZ = ((c.zIndex - minZ) / range) * Z_RANGE;
        allColliders.push({
            element: c.el,
            x: c.rect.left,
            y: c.rect.top,
            z: normalizedZ,
            w: c.rect.width,
            h: c.rect.height,
            d: COLLIDER_DEPTH
        });
    }
    // Sort by area and take top MAX_COLLIDERS
    allColliders.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    activeColliders = allColliders.slice(0, MAX_COLLIDERS);
    rebuildGrid();
    pickStartGoal();
    renderDebugColliders();
    console.log(`[DOM3D] Scanned ${allColliders.length} colliders, active: ${activeColliders.length}`);
}
function updateColliderRects() {
    for (const col of activeColliders) {
        const rect = col.element.getBoundingClientRect();
        col.x = rect.left;
        col.y = rect.top;
        col.w = rect.width;
        col.h = rect.height;
    }
    rebuildGrid();
}
// ============================================================================
// Start / Goal Selection
// ============================================================================
function pickStartGoal() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Visible colliders only
    const visible = activeColliders.filter(c => c.x >= -50 && c.x + c.w <= vw + 50 &&
        c.y >= -50 && c.y + c.h <= vh + 50);
    const candidates = visible.length > 0 ? visible : activeColliders;
    if (candidates.length === 0)
        return;
    // Start: low z, bottom-left
    let bestStartScore = -Infinity;
    for (const c of candidates) {
        const score = -c.z + (c.y / vh) * 100 - (c.x / vw) * 50 + Math.log(c.w * c.h + 1);
        if (score > bestStartScore) {
            bestStartScore = score;
            startCollider = c;
        }
    }
    // Goal: high z, top-right, within viewport
    let bestGoalScore = -Infinity;
    for (const c of candidates) {
        if (c === startCollider)
            continue;
        const cx = c.x + c.w / 2;
        const cy = c.y + c.h / 2;
        let penalty = 0;
        if (cx < 0 || cx > vw || cy < 0 || cy > vh)
            penalty = -1000;
        const score = c.z + -(c.y / vh) * 100 + (c.x / vw) * 50 + Math.log(c.w * c.h + 1) + penalty;
        if (score > bestGoalScore) {
            bestGoalScore = score;
            goalCollider = c;
        }
    }
}
// ============================================================================
// Overlay & Player Creation
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
    perspective: ${PERSPECTIVE}px;
    perspective-origin: 50% 50%;
    overflow: visible;
  `;
    document.body.appendChild(root);
}
function createPlayer() {
    if (!root)
        return;
    playerEl = document.createElement('div');
    playerEl.id = 'dom3d-player';
    playerEl.style.cssText = `
    position: absolute;
    left: 0; top: 0;
    width: ${PLAYER_W}px;
    height: ${PLAYER_H}px;
    transform-style: preserve-3d;
  `;
    // Create 6 faces for the cube
    const halfD = PLAYER_D / 2;
    const halfW = PLAYER_W / 2;
    const halfH = PLAYER_H / 2;
    const faces = [
        { name: 'front', transform: `translateZ(${halfD}px)`, bg: 'rgba(231, 76, 60, 0.9)' },
        { name: 'back', transform: `rotateY(180deg) translateZ(${halfD}px)`, bg: 'rgba(192, 57, 43, 0.9)' },
        { name: 'left', transform: `rotateY(-90deg) translateZ(${halfW}px)`, bg: 'rgba(211, 84, 0, 0.9)' },
        { name: 'right', transform: `rotateY(90deg) translateZ(${halfW}px)`, bg: 'rgba(230, 126, 34, 0.9)' },
        { name: 'top', transform: `rotateX(90deg) translateZ(${halfH}px)`, bg: 'rgba(241, 196, 15, 0.9)' },
        { name: 'bottom', transform: `rotateX(-90deg) translateZ(${halfH}px)`, bg: 'rgba(243, 156, 18, 0.9)' },
    ];
    for (const face of faces) {
        const div = document.createElement('div');
        div.className = `dom3d-player-face dom3d-player-${face.name}`;
        div.style.cssText = `
      position: absolute;
      width: ${PLAYER_W}px;
      height: ${PLAYER_H}px;
      background: ${face.bg};
      border: 2px solid #c0392b;
      box-sizing: border-box;
      transform-origin: center center;
      transform: ${face.transform};
      backface-visibility: hidden;
    `;
        playerEl.appendChild(div);
    }
    root.appendChild(playerEl);
    // Initialize player position on start platform
    if (startCollider) {
        player.x = startCollider.x + startCollider.w / 2 - PLAYER_W / 2;
        player.y = startCollider.y + startCollider.h / 2 - PLAYER_H / 2;
        player.z = startCollider.z + startCollider.d; // Stand on top
    }
    updatePlayerTransform();
}
function getScale(z) {
    const s = PERSPECTIVE / (PERSPECTIVE - z);
    return Math.max(SCALE_MIN, Math.min(SCALE_MAX, s));
}
function updatePlayerTransform() {
    if (!playerEl)
        return;
    const s = getScale(player.z);
    playerEl.style.transform = `translate3d(${player.x}px, ${player.y}px, ${player.z}px) scale(${s})`;
}
// ============================================================================
// Markers (Start / Goal)
// ============================================================================
function createMarkers() {
    if (!root)
        return;
    if (startCollider) {
        startMarkerEl = document.createElement('div');
        startMarkerEl.id = 'dom3d-start-marker';
        startMarkerEl.textContent = 'S';
        startMarkerEl.style.cssText = `
      position: absolute;
      left: 0; top: 0;
      width: 28px; height: 28px;
      background: #27ae60;
      border: 3px solid #1e8449;
      border-radius: 50%;
      color: white;
      font: bold 16px sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      transform-style: preserve-3d;
    `;
        updateMarkerTransform(startMarkerEl, startCollider);
        root.appendChild(startMarkerEl);
    }
    if (goalCollider) {
        goalMarkerEl = document.createElement('div');
        goalMarkerEl.id = 'dom3d-goal-marker';
        goalMarkerEl.textContent = 'G';
        goalMarkerEl.style.cssText = `
      position: absolute;
      left: 0; top: 0;
      width: 28px; height: 28px;
      background: #3498db;
      border: 3px solid #2980b9;
      border-radius: 50%;
      color: white;
      font: bold 16px sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      transform-style: preserve-3d;
      box-shadow: 0 0 20px rgba(52, 152, 219, 0.8);
    `;
        updateMarkerTransform(goalMarkerEl, goalCollider);
        root.appendChild(goalMarkerEl);
    }
}
function updateMarkerTransform(el, col) {
    const x = col.x + col.w / 2 - 14;
    const y = col.y + col.h / 2 - 14;
    const z = col.z + col.d + 5;
    const s = getScale(z);
    el.style.transform = `translate3d(${x}px, ${y}px, ${z}px) scale(${s})`;
}
function updateMarkers() {
    if (startMarkerEl && startCollider)
        updateMarkerTransform(startMarkerEl, startCollider);
    if (goalMarkerEl && goalCollider)
        updateMarkerTransform(goalMarkerEl, goalCollider);
}
// ============================================================================
// Debug Rendering
// ============================================================================
function createDebugContainer() {
    if (!root || !DEBUG)
        return;
    debugContainer = document.createElement('div');
    debugContainer.id = 'dom3d-debug-walls';
    debugContainer.style.cssText = `
    position: absolute;
    left: 0; top: 0;
    transform-style: preserve-3d;
  `;
    root.appendChild(debugContainer);
    // Test cubes at different z levels
    createTestCube(100, 100, 0, 50, 'rgba(0, 100, 255, 0.5)', 'Z=0');
    createTestCube(200, 100, 400, 50, 'rgba(255, 100, 0, 0.5)', 'Z=400');
}
function createTestCube(x, y, z, size, color, label) {
    if (!debugContainer)
        return;
    const cube = document.createElement('div');
    cube.className = 'dom3d-test-cube';
    cube.style.cssText = `
    position: absolute;
    left: 0; top: 0;
    width: ${size}px;
    height: ${size}px;
    transform-style: preserve-3d;
  `;
    const s = getScale(z);
    cube.style.transform = `translate3d(${x}px, ${y}px, ${z}px) scale(${s})`;
    const halfSize = size / 2;
    const faces = [
        { transform: `translateZ(${halfSize}px)` },
        { transform: `rotateY(180deg) translateZ(${halfSize}px)` },
        { transform: `rotateY(-90deg) translateZ(${halfSize}px)` },
        { transform: `rotateY(90deg) translateZ(${halfSize}px)` },
        { transform: `rotateX(90deg) translateZ(${halfSize}px)` },
        { transform: `rotateX(-90deg) translateZ(${halfSize}px)` },
    ];
    for (const face of faces) {
        const div = document.createElement('div');
        div.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border: 2px solid rgba(255,255,255,0.5);
      box-sizing: border-box;
      transform: ${face.transform};
      backface-visibility: hidden;
    `;
        cube.appendChild(div);
    }
    // Label
    const labelEl = document.createElement('div');
    labelEl.textContent = label;
    labelEl.style.cssText = `
    position: absolute;
    left: 50%; top: 50%;
    transform: translate(-50%, -50%) translateZ(${halfSize + 1}px);
    color: white;
    font: bold 12px sans-serif;
    text-shadow: 1px 1px 2px black;
  `;
    cube.appendChild(labelEl);
    debugContainer.appendChild(cube);
}
function renderDebugColliders() {
    if (!debugContainer || !DEBUG)
        return;
    // Clear old debug walls (keep test cubes)
    const walls = debugContainer.querySelectorAll('.dom3d-debug-wall');
    walls.forEach(w => w.remove());
    // Render top colliders as wireframe boxes
    const top = activeColliders.slice(0, 30);
    for (const col of top) {
        const div = document.createElement('div');
        div.className = 'dom3d-debug-wall';
        // Color by z: blue (low) to red (high)
        const ratio = col.z / Z_RANGE;
        const r = Math.floor(ratio * 200);
        const b = Math.floor((1 - ratio) * 200);
        const s = getScale(col.z);
        div.style.cssText = `
      position: absolute;
      left: 0; top: 0;
      width: ${col.w}px;
      height: ${col.h}px;
      background: rgba(${r}, 50, ${b}, 0.1);
      border: 2px solid rgba(${r}, 50, ${b}, 0.6);
      box-sizing: border-box;
      transform: translate3d(${col.x}px, ${col.y}px, ${col.z}px) scale(${s});
      transform-style: preserve-3d;
    `;
        debugContainer.appendChild(div);
    }
}
// ============================================================================
// Input Handling
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
    // Input -> velocity
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
    // Jump
    if (keys.space && isGrounded) {
        player.vz = JUMP_POWER;
        isGrounded = false;
    }
    // Gravity
    player.vz -= GRAVITY;
    // Get nearby colliders
    const pBox = getPlayerBox();
    const nearby = getNearbyColliders(pBox);
    // Move X and resolve
    player.x += player.vx;
    resolveAxis('x', nearby);
    // Move Y and resolve
    player.y += player.vy;
    resolveAxis('y', nearby);
    // Move Z and resolve
    player.z += player.vz;
    isGrounded = false;
    // Z collision with landing detection
    const pBoxZ = getPlayerBox();
    for (const col of nearby) {
        if (intersects(pBoxZ, col)) {
            const resolution = resolveCollision(pBoxZ, col);
            if (resolution && resolution.axis === 'z') {
                player.z += resolution.delta;
                // Landing: pushed up means we landed on top of something
                if (resolution.delta > 0 && player.vz < 0) {
                    player.vz = 0;
                    isGrounded = true;
                }
                // Hit head: pushed down
                else if (resolution.delta < 0 && player.vz > 0) {
                    player.vz = 0;
                }
            }
        }
    }
    // Ground floor at z = 0
    if (player.z < 0) {
        player.z = 0;
        player.vz = 0;
        isGrounded = true;
    }
    // Update DOM
    updatePlayerTransform();
    updateMarkers();
    // Goal check
    if (goalCollider) {
        const pFinal = getPlayerBox();
        const goalBox = {
            x: goalCollider.x,
            y: goalCollider.y,
            z: goalCollider.z,
            w: goalCollider.w,
            h: goalCollider.h,
            d: goalCollider.d + 50 // Generous z range for goal
        };
        if (intersects(pFinal, goalBox)) {
            console.log('[DOM3D] GOAL REACHED!');
        }
    }
    rafId = requestAnimationFrame(loop);
}
function resolveAxis(axis, nearby) {
    const pBox = getPlayerBox();
    for (const col of nearby) {
        if (intersects(pBox, col)) {
            const resolution = resolveCollision(pBox, col);
            if (resolution && resolution.axis === axis) {
                if (axis === 'x')
                    player.x += resolution.delta;
                if (axis === 'y')
                    player.y += resolution.delta;
            }
        }
    }
}
// ============================================================================
// Scroll / Resize Handling
// ============================================================================
function onScrollResize() {
    updateColliderRects();
    updateMarkers();
    renderDebugColliders();
}
// ============================================================================
// Message Handling (for cleanup from background)
// ============================================================================
function setupMessageListener() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
            if (msg.action === 'cleanup') {
                cleanup();
                sendResponse({ ok: true });
            }
            return true;
        });
    }
}
// ============================================================================
// Initialization & Cleanup
// ============================================================================
function init() {
    console.log('[DOM3D] Initializing 3D Box Collision System...');
    createOverlay();
    createDebugContainer(); // Must be before scanColliders
    scanColliders();
    createPlayer();
    createMarkers();
    setupInput();
    setupMessageListener();
    // Periodic re-scan
    scanIntervalId = window.setInterval(() => {
        updateColliderRects();
    }, SCAN_INTERVAL);
    // Scroll/resize listeners
    window.addEventListener('scroll', onScrollResize, { passive: true });
    window.addEventListener('resize', onScrollResize, { passive: true });
    running = true;
    rafId = requestAnimationFrame(loop);
    console.log(`[DOM3D] Started with ${activeColliders.length} colliders`);
    if (startCollider) {
        console.log(`[DOM3D] Player at (${player.x.toFixed(0)}, ${player.y.toFixed(0)}, z=${player.z.toFixed(0)})`);
    }
}
function cleanup() {
    console.log('[DOM3D] Cleaning up...');
    running = false;
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    if (scanIntervalId) {
        clearInterval(scanIntervalId);
        scanIntervalId = null;
    }
    removeInput();
    window.removeEventListener('scroll', onScrollResize);
    window.removeEventListener('resize', onScrollResize);
    root?.remove();
    root = null;
    playerEl = null;
    startMarkerEl = null;
    goalMarkerEl = null;
    debugContainer = null;
    allColliders = [];
    activeColliders = [];
    grid.clear();
    window.__DOM3D_ACTIVE__ = false;
    console.log('[DOM3D] Cleanup complete');
}
// ============================================================================
// Entry Point
// ============================================================================
if (window.__DOM3D_ACTIVE__) {
    console.log('[DOM3D] Already running, cleaning up...');
    cleanup();
}
else {
    window.__DOM3D_ACTIVE__ = true;
    init();
}
