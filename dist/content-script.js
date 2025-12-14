"use strict";
// ============================================================================
// z-index-world: 3D Box AABB Collision System
// 軸分離衝突判定：X解決時はYZ重なり、Y解決時はXZ重なり、Z解決時はXY重なりで判定
// ============================================================================
// ============================================================================
// Constants
// ============================================================================
const BOX_D = 80;
const GRID_CELL = 200;
const SCAN_INTERVAL = 800;
const VIEWPORT_MARGIN = 300;
const PLAYER_SIZE = 20;
const PLAYER_DEPTH = 20;
// Z normalization: clamp extreme z-index values
const Z_MAX = 10000;
// Step-up: player can climb obstacles up to this height
const STEP_HEIGHT = 32;
// Physics constants (per second, will be multiplied by dt)
const MOVE_SPEED = 300; // pixels per second
const GRAVITY = 800; // pixels per second^2
const JUMP_VZ = 350; // pixels per second
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
let debugWallEls = [];
let boxes = [];
let grid = new Map();
let startBox = null;
let goalBox = null;
let player = {
    x: 100, y: 100, z: 0,
    w: PLAYER_SIZE, h: PLAYER_SIZE, d: PLAYER_DEPTH,
    vx: 0, vy: 0, vz: 0
};
let keys = { h: false, j: false, k: false, l: false, space: false };
let jumpQueued = false;
let isGrounded = false;
let groundZ = 0; // Z position of the floor the player is standing on (or would land on)
let running = false;
let rafId = null;
let scanTimerId = null;
let lastTime = 0;
// Track current transform for debug display
let currentTransform = '';
// ============================================================================
// 3D AABB Collision - Axis Separated
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
// Full 3D intersection (for reference, but NOT used in axis resolution)
function intersects(a, b) {
    return overlapX(a, b) && overlapY(a, b) && overlapZ(a, b);
}
// ============================================================================
// Uniform Grid
// ============================================================================
function cellKey(cx, cy) {
    return `${cx},${cy}`;
}
function buildGrid(boxList) {
    const g = new Map();
    for (const box of boxList) {
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
// DOM Scan -> Boxes (unified scan function)
// ============================================================================
function normalizeZ(rawZ) {
    // Clamp extreme z-index values to prevent scale issues
    return Math.max(-Z_MAX, Math.min(Z_MAX, rawZ));
}
function scanDOM(initPlayer = false) {
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
        // Skip elements with auto z-index (position: static or no z-index set)
        // Only include positioned elements with explicit z-index
        const position = style.position;
        if (position === 'static')
            continue;
        const zIndexStr = style.zIndex;
        if (zIndexStr === 'auto' || zIndexStr === '')
            continue;
        const zIndex = parseInt(zIndexStr, 10);
        if (isNaN(zIndex))
            continue; // Skip NaN z-index entirely
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10)
            continue;
        if (rect.right < -VIEWPORT_MARGIN || rect.left > vw + VIEWPORT_MARGIN)
            continue;
        if (rect.bottom < -VIEWPORT_MARGIN || rect.top > vh + VIEWPORT_MARGIN)
            continue;
        boxes.push({
            x: rect.left,
            y: rect.top,
            z: normalizeZ(Math.max(0, zIndex)),
            w: rect.width,
            h: rect.height,
            d: BOX_D
        });
    }
    // Add base floor from documentElement (real element-derived floor, not virtual clamp)
    const docRect = document.documentElement.getBoundingClientRect();
    const baseFloor = {
        x: docRect.left,
        y: docRect.top,
        z: 0,
        w: docRect.width,
        h: docRect.height,
        d: 1 // thin floor at z=0
    };
    boxes.push(baseFloor);
    grid = buildGrid(boxes);
    if (initPlayer) {
        pickStartGoal();
        initPlayerPosition();
    }
}
function pickStartGoal() {
    // Base floor is always added in scanDOM, so boxes is never empty
    if (boxes.length === 0)
        return;
    startBox = boxes.reduce((a, b) => a.z < b.z ? a : b);
    goalBox = boxes.reduce((a, b) => a.z > b.z ? a : b);
}
function initPlayerPosition() {
    if (boxes.length === 0 || !startBox)
        return;
    // Only initialize if player hasn't moved yet
    if (player.z !== 0 || player.vz !== 0)
        return;
    player.x = startBox.x + startBox.w / 2 - player.w / 2;
    player.y = startBox.y + startBox.h / 2 - player.h / 2;
    // Find highest box top at spawn position
    let maxTop = startBox.z + startBox.d;
    for (const box of boxes) {
        if (overlapX(player, box) && overlapY(player, box)) {
            const top = box.z + box.d;
            if (top > maxTop)
                maxTop = top;
        }
    }
    player.z = maxTop;
}
// ============================================================================
// Physics - Axis Separated AABB Resolution
// ============================================================================
function physics(dt) {
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
    // Jump: only when grounded
    if (jumpQueued && isGrounded) {
        player.vz = JUMP_VZ;
        isGrounded = false;
    }
    jumpQueued = false;
    // 2) Gravity
    player.vz -= GRAVITY * dt;
    // 3) Get nearby boxes
    const nearby = queryNearby(player);
    // 4) Resolve X axis with step-up
    // Move X, then check boxes where Y and Z overlap -> resolve X penetration or step-up
    player.x += player.vx * dt;
    for (const box of nearby) {
        // Condition for X resolution: Y and Z must overlap
        if (overlapY(player, box) && overlapZ(player, box) && overlapX(player, box)) {
            // Check if this is a low step we can climb
            const boxTop = box.z + box.d;
            const stepHeight = boxTop - player.z;
            if (stepHeight > 0 && stepHeight <= STEP_HEIGHT) {
                // Step-up: raise player to stand on top of obstacle
                player.z = boxTop;
                player.vz = 0;
                isGrounded = true;
                groundZ = boxTop; // Update groundZ on step-up
                // No X pushback - we climbed over it
            }
            else {
                // Calculate penetration from both sides
                const penLeft = (player.x + player.w) - box.x; // player's right into box's left
                const penRight = (box.x + box.w) - player.x; // box's right into player's left
                // Push out from the side with less penetration
                if (penLeft < penRight) {
                    player.x = box.x - player.w;
                }
                else {
                    player.x = box.x + box.w;
                }
                player.vx = 0;
            }
        }
    }
    // 5) Resolve Y axis with step-up
    // Move Y, then check boxes where X and Z overlap -> resolve Y penetration or step-up
    player.y += player.vy * dt;
    for (const box of nearby) {
        // Condition for Y resolution: X and Z must overlap
        if (overlapX(player, box) && overlapZ(player, box) && overlapY(player, box)) {
            // Check if this is a low step we can climb
            const boxTop = box.z + box.d;
            const stepHeight = boxTop - player.z;
            if (stepHeight > 0 && stepHeight <= STEP_HEIGHT) {
                // Step-up: raise player to stand on top of obstacle
                player.z = boxTop;
                player.vz = 0;
                isGrounded = true;
                groundZ = boxTop; // Update groundZ on step-up
                // No Y pushback - we climbed over it
            }
            else {
                const penTop = (player.y + player.h) - box.y; // player's bottom into box's top
                const penBottom = (box.y + box.h) - player.y; // box's bottom into player's top
                if (penTop < penBottom) {
                    player.y = box.y - player.h;
                }
                else {
                    player.y = box.y + box.h;
                }
                player.vy = 0;
            }
        }
    }
    // 6) Resolve Z axis
    // Move Z, then check boxes where X and Y overlap -> resolve Z penetration
    player.z += player.vz * dt;
    isGrounded = false; // Will be set true if we land on something
    for (const box of nearby) {
        // Condition for Z resolution: X and Y must overlap
        if (overlapX(player, box) && overlapY(player, box) && overlapZ(player, box)) {
            const penFront = (player.z + player.d) - box.z; // player's top into box's bottom
            const penBack = (box.z + box.d) - player.z; // box's top into player's bottom
            if (penFront < penBack) {
                // Hit ceiling
                player.z = box.z - player.d;
                player.vz = 0;
            }
            else {
                // Land on floor
                const floorTop = box.z + box.d;
                player.z = floorTop;
                player.vz = 0;
                isGrounded = true;
                groundZ = floorTop; // Update groundZ on landing
            }
        }
    }
    // 7) Update groundZ for shadow calculation (find floor beneath player)
    // Look for the highest box top that is at or below player's feet
    let bestGroundZ = 0; // base floor at z=0
    for (const box of nearby) {
        if (overlapX(player, box) && overlapY(player, box)) {
            const boxTop = box.z + box.d;
            // Box top is at or below player's feet (with small epsilon)
            if (boxTop <= player.z + 1) {
                if (boxTop > bestGroundZ) {
                    bestGroundZ = boxTop;
                }
            }
        }
    }
    groundZ = bestGroundZ;
    // No virtual floor clamp - floor is determined by Box collision only
}
// ============================================================================
// Render - Using translate3d for X, Y, Z positioning
// ============================================================================
function render() {
    if (!playerEl)
        return;
    // Use translate3d for positioning - Z is now properly reflected in CSS!
    // Shadow based on height above ground (not absolute Z)
    const heightAboveGround = Math.max(0, player.z - groundZ);
    const shadowBlur = heightAboveGround / 5;
    const shadowOffset = heightAboveGround / 10;
    currentTransform = `translate3d(${player.x.toFixed(1)}px, ${player.y.toFixed(1)}px, ${player.z.toFixed(1)}px)`;
    playerEl.style.transform = currentTransform;
    playerEl.style.boxShadow = `${shadowOffset}px ${shadowOffset}px ${shadowBlur}px rgba(0,0,0,0.4)`;
    // Debug walls are rebuilt after scanDOM, not every frame
    // Update debug display
    if (debugEl) {
        debugEl.innerHTML = `
      <div style="margin-bottom: 4px; color: #fff; font-weight: bold;">z-index-world</div>
      <div>X: <span style="color: #f66">${player.x.toFixed(0)}</span></div>
      <div>Y: <span style="color: #6f6">${player.y.toFixed(0)}</span></div>
      <div>Z: <span style="color: #66f">${player.z.toFixed(0)}</span></div>
      <div>vZ: <span style="color: #ff0">${player.vz.toFixed(0)}</span></div>
      <div>groundZ: <span style="color: #f0f">${groundZ.toFixed(0)}</span></div>
      <div>Grounded: <span style="color: ${isGrounded ? '#0f0' : '#f00'}">${isGrounded ? 'Yes' : 'No'}</span></div>
      <div style="margin-top: 6px; font-size: 9px; color: #aaa; word-break: break-all;">
        transform:<br><span style="color: #0ff">${currentTransform}</span>
      </div>
      <div style="margin-top: 4px; font-size: 10px; color: #888;">HJKL:Move Space:Jump</div>
    `;
    }
}
// ============================================================================
// Create Overlay (with preserve-3d for proper 3D transform)
// ============================================================================
function createOverlay() {
    root = document.createElement('div');
    root.id = 'dom3d-root';
    root.style.cssText = `
    position: fixed;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647;
    transform-style: preserve-3d;
    transform: translateZ(0px);
    perspective: 1000000px;
  `;
    document.body.appendChild(root);
}
// ============================================================================
// Create Player (2D div with translate3d positioning)
// ============================================================================
function createPlayer() {
    if (!root)
        return;
    playerEl = document.createElement('div');
    playerEl.id = 'dom3d-player';
    playerEl.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: ${PLAYER_SIZE}px;
    height: ${PLAYER_SIZE}px;
    background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
    border: 2px solid #fff;
    border-radius: 4px;
    box-sizing: border-box;
    will-change: transform;
    transform-style: preserve-3d;
  `;
    root.appendChild(playerEl);
    render();
}
// ============================================================================
// Create Debug Display
// ============================================================================
function createDebugDisplay() {
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
    max-width: 200px;
  `;
    document.body.appendChild(debugEl);
}
// ============================================================================
// Create Markers (Start / Goal)
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
      left: 0;
      top: 0;
      width: 30px;
      height: 30px;
      background: rgba(46, 204, 113, 0.8);
      border: 2px solid #27ae60;
      border-radius: 50%;
      box-shadow: 0 0 10px rgba(46, 204, 113, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 14px;
      font-family: sans-serif;
      will-change: transform;
      transform: translate3d(${startBox.x + startBox.w / 2 - 15}px, ${startBox.y + startBox.h / 2 - 15}px, ${startBox.z + startBox.d}px);
    `;
        startMarkerEl.textContent = 'S';
        root.appendChild(startMarkerEl);
    }
    // Goal marker
    if (goalBox) {
        goalMarkerEl = document.createElement('div');
        goalMarkerEl.id = 'dom3d-goal-marker';
        goalMarkerEl.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 30px;
      height: 30px;
      background: rgba(241, 196, 15, 0.8);
      border: 2px solid #f39c12;
      border-radius: 50%;
      box-shadow: 0 0 15px rgba(241, 196, 15, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 14px;
      font-family: sans-serif;
      will-change: transform;
      transform: translate3d(${goalBox.x + goalBox.w / 2 - 15}px, ${goalBox.y + goalBox.h / 2 - 15}px, ${goalBox.z + goalBox.d}px);
      animation: dom3d-pulse 1.5s ease-in-out infinite;
    `;
        goalMarkerEl.textContent = 'G';
        root.appendChild(goalMarkerEl);
    }
    // Add pulse animation
    const style = document.createElement('style');
    style.id = 'dom3d-marker-style';
    style.textContent = `
    @keyframes dom3d-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
  `;
    document.head.appendChild(style);
}
// ============================================================================
// Debug Wall Visualization (show ALL boxes, element pool reuse)
// ============================================================================
function createDebugWallElement() {
    const el = document.createElement('div');
    el.className = 'dom3d-debug-wall';
    el.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  `;
    return el;
}
// Rebuild debug walls from ALL boxes (called after scanDOM, not every frame)
function rebuildDebugWalls() {
    if (!root)
        return;
    const requiredCount = boxes.length;
    // Add more elements if needed (pool expansion)
    while (debugWallEls.length < requiredCount) {
        const el = createDebugWallElement();
        root.appendChild(el);
        debugWallEls.push(el);
    }
    // Remove excess elements (pool shrink)
    while (debugWallEls.length > requiredCount) {
        const el = debugWallEls.pop();
        el?.remove();
    }
    // Update all elements with box data
    for (let i = 0; i < requiredCount; i++) {
        const box = boxes[i];
        const el = debugWallEls[i];
        // Color based on Z height (lower = green, higher = red)
        const zRatio = Math.min(1, (box.z + box.d) / 500);
        const r = Math.floor(255 * zRatio);
        const g = Math.floor(255 * (1 - zRatio));
        const b = 100;
        el.style.width = `${box.w}px`;
        el.style.height = `${box.h}px`;
        el.style.background = `rgba(${r}, ${g}, ${b}, 0.2)`;
        el.style.border = `1px solid rgba(${r}, ${g}, ${b}, 0.6)`;
        el.style.transform = `translate3d(${box.x}px, ${box.y}px, ${box.z}px)`;
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
// Main Loop (with delta time)
// ============================================================================
function loop(currentTime) {
    if (!running)
        return;
    // Calculate delta time (capped to prevent huge jumps)
    const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
    lastTime = currentTime;
    physics(dt);
    render();
    rafId = requestAnimationFrame(loop);
}
// ============================================================================
// Scroll/Resize
// ============================================================================
function onScrollResize() {
    scanDOM(false); // rescan without reinitializing player
    rebuildDebugWalls();
    updateMarkers();
}
function updateMarkers() {
    if (startMarkerEl && startBox) {
        startMarkerEl.style.transform = `translate3d(${startBox.x + startBox.w / 2 - 15}px, ${startBox.y + startBox.h / 2 - 15}px, ${startBox.z + startBox.d}px)`;
    }
    if (goalMarkerEl && goalBox) {
        goalMarkerEl.style.transform = `translate3d(${goalBox.x + goalBox.w / 2 - 15}px, ${goalBox.y + goalBox.h / 2 - 15}px, ${goalBox.z + goalBox.d}px)`;
    }
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
    // Guard: if already running or root exists, do nothing
    if (running)
        return;
    if (document.getElementById('dom3d-root'))
        return;
    createOverlay();
    scanDOM(true); // scan with player initialization
    rebuildDebugWalls(); // build walls for ALL boxes
    createPlayer();
    createDebugDisplay();
    createMarkers();
    setupInput();
    setupMessageListener();
    // Periodic rescan (also rebuilds debug walls)
    scanTimerId = window.setInterval(() => {
        scanDOM(false);
        rebuildDebugWalls();
    }, SCAN_INTERVAL);
    window.addEventListener('scroll', onScrollResize, { passive: true });
    window.addEventListener('resize', onScrollResize, { passive: true });
    running = true;
    lastTime = performance.now();
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
    // Clean up debug walls
    for (const el of debugWallEls) {
        el.remove();
    }
    debugWallEls = [];
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
        w: PLAYER_SIZE, h: PLAYER_SIZE, d: PLAYER_DEPTH,
        vx: 0, vy: 0, vz: 0
    };
    jumpQueued = false;
    isGrounded = false;
    groundZ = 0;
    lastTime = 0;
    currentTransform = '';
    window.__DOM3D_ACTIVE__ = false;
}
// ============================================================================
// Entry
// ============================================================================
// Toggle behavior: if already active, cleanup; otherwise init
if (window.__DOM3D_ACTIVE__ || document.getElementById('dom3d-root')) {
    cleanup();
}
else {
    window.__DOM3D_ACTIVE__ = true;
    init();
}
