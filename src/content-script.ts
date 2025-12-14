// ============================================================================
// z-index-world Content Script
// Turn any webpage into a 3D platformer using z-index as height
// ============================================================================

// ============================================================================
// Types
// ============================================================================

interface AABB3D {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

interface Collider {
  element: Element;
  aabb: AABB3D;
  rawZIndex: number;
}

interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  isGrounded: boolean;
}

interface KeyState {
  h: boolean;
  j: boolean;
  k: boolean;
  l: boolean;
  space: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const PERSPECTIVE = 1200;
const Z_RANGE = 400;
const WALL_DEPTH = 30;
const PLAYER_SIZE = 24;
const PLAYER_DEPTH = 24;
const MOVE_SPEED = 4;
const GRAVITY_Z = -0.8;
const JUMP_POWER = 10;
const CELL_SIZE = 100;
const COLLIDER_UPDATE_INTERVAL = 500;
const DEBUG_WALL_LIMIT = 50;
const MIN_ELEMENT_AREA = 100;

// Excluded tag names for collider scanning
const EXCLUDED_TAGS = new Set([
  'HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT',
  'BR', 'WBR', 'TEMPLATE', 'SLOT'
]);

// ============================================================================
// Game State
// ============================================================================

let root: HTMLDivElement | null = null;
let playerEl: HTMLDivElement | null = null;
let startMarker: HTMLDivElement | null = null;
let goalMarker: HTMLDivElement | null = null;
let debugWallsContainer: HTMLDivElement | null = null;

let player: PlayerState = {
  x: 100,
  y: 100,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  isGrounded: true,
};

let keys: KeyState = {
  h: false,
  j: false,
  k: false,
  l: false,
  space: false,
};

let colliders: Collider[] = [];
let spatialGrid: Map<string, Collider[]> = new Map();
let startCollider: Collider | null = null;
let goalCollider: Collider | null = null;

let isRunning = false;
let rafId: number | null = null;
let colliderUpdateInterval: number | null = null;

// ============================================================================
// Initialization
// ============================================================================

function initGame() {
  console.log('[DOM3D] Initializing game...');

  // Create overlay root
  createOverlay();

  // Scan DOM and build colliders
  scanAndBuildColliders();

  // Find start and goal positions
  findStartAndGoal();

  // Create player at start position
  createPlayer();

  // Create markers
  createMarkers();

  // Render debug walls
  renderDebugWalls();

  // Set up input handlers
  setupInputHandlers();

  // Set up message listener for cleanup
  setupMessageListener();

  // Start game loop
  isRunning = true;
  rafId = requestAnimationFrame(gameLoop);

  // Set up periodic collider updates
  colliderUpdateInterval = window.setInterval(() => {
    if (isRunning) {
      updateColliderRects();
    }
  }, COLLIDER_UPDATE_INTERVAL);

  console.log('[DOM3D] Game initialized!');
  console.log('[DOM3D] Controls: h/j/k/l to move, Space to jump');
  console.log(`[DOM3D] Found ${colliders.length} colliders`);
  console.log(`[DOM3D] Player start: (${player.x.toFixed(0)}, ${player.y.toFixed(0)}, ${player.z.toFixed(0)})`);
}

// ============================================================================
// Overlay System
// ============================================================================

function createOverlay() {
  root = document.createElement('div');
  root.id = 'dom3d-game-root';
  root.style.cssText = `
    position: fixed;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647;
    transform-style: preserve-3d;
    perspective: ${PERSPECTIVE}px;
    perspective-origin: 50% 50%;
    overflow: visible;
  `;
  document.body.appendChild(root);

  // Container for debug walls
  debugWallsContainer = document.createElement('div');
  debugWallsContainer.id = 'dom3d-debug-walls';
  debugWallsContainer.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
    pointer-events: none;
  `;
  root.appendChild(debugWallsContainer);
}

// ============================================================================
// Collider System
// ============================================================================

function scanAndBuildColliders() {
  colliders = [];
  const rawZIndexes: number[] = [];

  const allElements = document.querySelectorAll('*');

  for (const el of allElements) {
    if (EXCLUDED_TAGS.has(el.tagName)) continue;
    if ((el as HTMLElement).id?.startsWith('dom3d-')) continue;

    const style = getComputedStyle(el);
    if (style.display === 'none') continue;
    if (style.visibility === 'hidden') continue;
    if (parseFloat(style.opacity) === 0) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.width * rect.height < MIN_ELEMENT_AREA) continue;

    let rawZIndex = parseInt(style.zIndex, 10);
    if (isNaN(rawZIndex) || rawZIndex < 0) {
      rawZIndex = 0;
    }

    rawZIndexes.push(rawZIndex);

    colliders.push({
      element: el,
      aabb: {
        x: rect.left,
        y: rect.top,
        z: 0,
        w: rect.width,
        h: rect.height,
        d: WALL_DEPTH,
      },
      rawZIndex,
    });
  }

  // Normalize z-index to z coordinate
  normalizeZValues(rawZIndexes);
  buildSpatialGrid();
}

function normalizeZValues(rawZIndexes: number[]) {
  if (colliders.length === 0) return;

  const minZ = Math.min(...rawZIndexes);
  const maxZ = Math.max(...rawZIndexes);
  const range = maxZ - minZ || 1;

  for (const c of colliders) {
    // z=0 is the ground level, higher z-index means higher z
    c.aabb.z = ((c.rawZIndex - minZ) / range) * Z_RANGE;
  }
}

function buildSpatialGrid() {
  spatialGrid.clear();

  for (const c of colliders) {
    const minCellX = Math.floor(c.aabb.x / CELL_SIZE);
    const maxCellX = Math.floor((c.aabb.x + c.aabb.w) / CELL_SIZE);
    const minCellY = Math.floor(c.aabb.y / CELL_SIZE);
    const maxCellY = Math.floor((c.aabb.y + c.aabb.h) / CELL_SIZE);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = `${cx},${cy}`;
        if (!spatialGrid.has(key)) {
          spatialGrid.set(key, []);
        }
        spatialGrid.get(key)!.push(c);
      }
    }
  }
}

function updateColliderRects() {
  for (const c of colliders) {
    const rect = c.element.getBoundingClientRect();
    c.aabb.x = rect.left;
    c.aabb.y = rect.top;
    c.aabb.w = rect.width;
    c.aabb.h = rect.height;
  }
  buildSpatialGrid();
  renderDebugWalls();
}

function getNearbyColliders(x: number, y: number): Collider[] {
  const result: Collider[] = [];
  const seen = new Set<Element>();

  const margin = PLAYER_SIZE + 50;
  const minCellX = Math.floor((x - margin) / CELL_SIZE);
  const maxCellX = Math.floor((x + margin) / CELL_SIZE);
  const minCellY = Math.floor((y - margin) / CELL_SIZE);
  const maxCellY = Math.floor((y + margin) / CELL_SIZE);

  for (let cx = minCellX; cx <= maxCellX; cx++) {
    for (let cy = minCellY; cy <= maxCellY; cy++) {
      const key = `${cx},${cy}`;
      const cell = spatialGrid.get(key);
      if (cell) {
        for (const c of cell) {
          if (!seen.has(c.element)) {
            seen.add(c.element);
            result.push(c);
          }
        }
      }
    }
  }

  return result;
}

// ============================================================================
// Start/Goal System
// ============================================================================

function findStartAndGoal() {
  if (colliders.length === 0) {
    startCollider = null;
    goalCollider = null;
    return;
  }

  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  // Filter colliders that are within viewport
  const visibleColliders = colliders.filter(c => {
    return c.aabb.x >= -50 && c.aabb.x + c.aabb.w <= viewW + 50 &&
           c.aabb.y >= -50 && c.aabb.y + c.aabb.h <= viewH + 50;
  });

  const candidates = visibleColliders.length > 0 ? visibleColliders : colliders;

  // Start: lowest z, prefer bottom-left, large area
  let bestStartScore = -Infinity;
  for (const c of candidates) {
    const zScore = -c.aabb.z;
    const posScore = (c.aabb.y / viewH) * 10 - (c.aabb.x / viewW) * 5;
    const sizeScore = Math.log(c.aabb.w * c.aabb.h + 1) * 2;
    const score = zScore + posScore + sizeScore;

    if (score > bestStartScore) {
      bestStartScore = score;
      startCollider = c;
    }
  }

  // Goal: highest z, prefer top-right, within viewport
  let bestGoalScore = -Infinity;
  for (const c of candidates) {
    if (c === startCollider) continue;

    const zScore = c.aabb.z;
    const posScore = -(c.aabb.y / viewH) * 10 + (c.aabb.x / viewW) * 5;
    const sizeScore = Math.log(c.aabb.w * c.aabb.h + 1) * 2;

    // Penalty if outside viewport
    let viewportPenalty = 0;
    if (c.aabb.x + c.aabb.w > viewW || c.aabb.y + c.aabb.h > viewH ||
        c.aabb.x < 0 || c.aabb.y < 0) {
      viewportPenalty = -100;
    }

    const score = zScore + posScore + sizeScore + viewportPenalty;

    if (score > bestGoalScore) {
      bestGoalScore = score;
      goalCollider = c;
    }
  }

  // Fallback: if no goal found, use last collider
  if (!goalCollider && candidates.length > 0) {
    goalCollider = candidates[candidates.length - 1];
  }
}

// ============================================================================
// Player System
// ============================================================================

function createPlayer() {
  if (!root) return;

  playerEl = document.createElement('div');
  playerEl.id = 'dom3d-player';
  playerEl.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: ${PLAYER_SIZE}px;
    height: ${PLAYER_SIZE}px;
    background: linear-gradient(135deg, #ff6b6b, #c92a2a);
    border: 2px solid #a61e1e;
    border-radius: 4px;
    box-shadow: 0 0 10px rgba(255, 0, 0, 0.5);
    transform-style: preserve-3d;
    pointer-events: none;
  `;
  root.appendChild(playerEl);

  // Set initial position on start platform
  if (startCollider) {
    player.x = startCollider.aabb.x + startCollider.aabb.w / 2 - PLAYER_SIZE / 2;
    player.y = startCollider.aabb.y + startCollider.aabb.h / 2 - PLAYER_SIZE / 2;
    player.z = startCollider.aabb.z + startCollider.aabb.d;
  } else {
    player.x = 100;
    player.y = 100;
    player.z = 0;
  }

  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.isGrounded = true;

  updatePlayerDOM();
}

function updatePlayerDOM() {
  if (!playerEl) return;
  // No scale - just translate3d
  playerEl.style.transform = `translate3d(${player.x}px, ${player.y}px, ${player.z}px)`;
}

// ============================================================================
// Markers System
// ============================================================================

function createMarkers() {
  if (!root) return;

  // Start marker (green)
  if (startCollider) {
    startMarker = document.createElement('div');
    startMarker.id = 'dom3d-start-marker';
    const x = startCollider.aabb.x + startCollider.aabb.w / 2 - 15;
    const y = startCollider.aabb.y + startCollider.aabb.h / 2 - 15;
    const z = startCollider.aabb.z + startCollider.aabb.d + 1;

    startMarker.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 30px;
      height: 30px;
      background: rgba(76, 175, 80, 0.8);
      border: 2px solid #2e7d32;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 16px;
      color: white;
      text-shadow: 1px 1px 2px black;
      transform-style: preserve-3d;
      pointer-events: none;
      transform: translate3d(${x}px, ${y}px, ${z}px);
    `;
    startMarker.textContent = 'S';
    root.appendChild(startMarker);
  }

  // Goal marker (blue)
  if (goalCollider) {
    goalMarker = document.createElement('div');
    goalMarker.id = 'dom3d-goal-marker';
    const x = goalCollider.aabb.x + goalCollider.aabb.w / 2 - 15;
    const y = goalCollider.aabb.y + goalCollider.aabb.h / 2 - 15;
    const z = goalCollider.aabb.z + goalCollider.aabb.d + 1;

    goalMarker.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 30px;
      height: 30px;
      background: rgba(33, 150, 243, 0.8);
      border: 2px solid #1565c0;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 16px;
      color: white;
      text-shadow: 1px 1px 2px black;
      transform-style: preserve-3d;
      pointer-events: none;
      transform: translate3d(${x}px, ${y}px, ${z}px);
    `;
    goalMarker.textContent = 'G';
    root.appendChild(goalMarker);
  }
}

// ============================================================================
// Debug Visualization
// ============================================================================

function renderDebugWalls() {
  if (!debugWallsContainer) return;

  debugWallsContainer.innerHTML = '';

  // Sort by area (descending) and take top N
  const sorted = [...colliders].sort((a, b) =>
    (b.aabb.w * b.aabb.h) - (a.aabb.w * a.aabb.h)
  );
  const sample = sorted.slice(0, DEBUG_WALL_LIMIT);

  for (const c of sample) {
    const el = document.createElement('div');
    el.className = 'dom3d-debug-wall';

    // Color based on z height
    const zRatio = c.aabb.z / Z_RANGE;
    const r = Math.floor(zRatio * 255);
    const b = Math.floor((1 - zRatio) * 255);

    el.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: ${c.aabb.w}px;
      height: ${c.aabb.h}px;
      background: rgba(${r}, 50, ${b}, 0.2);
      border: 1px solid rgba(${r}, 50, ${b}, 0.5);
      transform: translate3d(${c.aabb.x}px, ${c.aabb.y}px, ${c.aabb.z}px);
      transform-style: preserve-3d;
      pointer-events: none;
    `;
    debugWallsContainer.appendChild(el);
  }
}

// ============================================================================
// Input System
// ============================================================================

function setupInputHandlers() {
  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('keyup', handleKeyUp, true);
}

function removeInputHandlers() {
  window.removeEventListener('keydown', handleKeyDown, true);
  window.removeEventListener('keyup', handleKeyUp, true);
}

function handleKeyDown(e: KeyboardEvent) {
  if (isInputElement(e.target as Element)) return;
  if (!isRunning) return;

  switch (e.key.toLowerCase()) {
    case 'h':
      keys.h = true;
      e.preventDefault();
      break;
    case 'j':
      keys.j = true;
      e.preventDefault();
      break;
    case 'k':
      keys.k = true;
      e.preventDefault();
      break;
    case 'l':
      keys.l = true;
      e.preventDefault();
      break;
    case ' ':
      keys.space = true;
      e.preventDefault();
      break;
  }
}

function handleKeyUp(e: KeyboardEvent) {
  switch (e.key.toLowerCase()) {
    case 'h':
      keys.h = false;
      break;
    case 'j':
      keys.j = false;
      break;
    case 'k':
      keys.k = false;
      break;
    case 'l':
      keys.l = false;
      break;
    case ' ':
      keys.space = false;
      break;
  }
}

function isInputElement(el: Element | null): boolean {
  if (!el) return false;
  const tagName = el.tagName.toUpperCase();
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }
  if ((el as HTMLElement).isContentEditable) {
    return true;
  }
  return false;
}

// ============================================================================
// Physics & Collision
// ============================================================================

function gameLoop(_timestamp: number) {
  if (!isRunning) return;

  // 1. Apply input velocity
  player.vx = 0;
  player.vy = 0;

  if (keys.h) player.vx -= MOVE_SPEED;
  if (keys.l) player.vx += MOVE_SPEED;
  if (keys.k) player.vy -= MOVE_SPEED;
  if (keys.j) player.vy += MOVE_SPEED;

  // 2. Handle jump
  if (keys.space && player.isGrounded) {
    player.vz = JUMP_POWER;
    player.isGrounded = false;
  }

  // 3. Apply gravity
  if (!player.isGrounded) {
    player.vz += GRAVITY_Z;
  }

  // 4. Move and collide on each axis separately
  // X axis
  player.x += player.vx;
  resolveCollisionsX();

  // Y axis
  player.y += player.vy;
  resolveCollisionsY();

  // Z axis
  player.z += player.vz;
  resolveCollisionsZ();

  // 5. Ground check (z = 0 is absolute ground)
  if (player.z <= 0) {
    player.z = 0;
    player.vz = 0;
    player.isGrounded = true;
  }

  // 6. Update DOM
  updatePlayerDOM();

  // 7. Check goal
  if (checkGoal()) {
    console.log('[DOM3D] GOAL reached!');
  }

  // 8. Next frame
  rafId = requestAnimationFrame(gameLoop);
}

function getPlayerAABB(): AABB3D {
  return {
    x: player.x,
    y: player.y,
    z: player.z,
    w: PLAYER_SIZE,
    h: PLAYER_SIZE,
    d: PLAYER_DEPTH,
  };
}

function aabbIntersects(a: AABB3D, b: AABB3D): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x &&
    a.y < b.y + b.h && a.y + a.h > b.y &&
    a.z < b.z + b.d && a.z + a.d > b.z
  );
}

function resolveCollisionsX() {
  const pAABB = getPlayerAABB();
  const nearby = getNearbyColliders(player.x, player.y);

  for (const c of nearby) {
    if (!aabbIntersects(pAABB, c.aabb)) continue;

    // Push out of collision on X axis
    if (player.vx > 0) {
      // Moving right, push left
      player.x = c.aabb.x - PLAYER_SIZE;
    } else if (player.vx < 0) {
      // Moving left, push right
      player.x = c.aabb.x + c.aabb.w;
    }
    player.vx = 0;
    pAABB.x = player.x;
  }
}

function resolveCollisionsY() {
  const pAABB = getPlayerAABB();
  const nearby = getNearbyColliders(player.x, player.y);

  for (const c of nearby) {
    if (!aabbIntersects(pAABB, c.aabb)) continue;

    // Push out of collision on Y axis
    if (player.vy > 0) {
      // Moving down, push up
      player.y = c.aabb.y - PLAYER_SIZE;
    } else if (player.vy < 0) {
      // Moving up, push down
      player.y = c.aabb.y + c.aabb.h;
    }
    player.vy = 0;
    pAABB.y = player.y;
  }
}

function resolveCollisionsZ() {
  const pAABB = getPlayerAABB();
  const nearby = getNearbyColliders(player.x, player.y);

  for (const c of nearby) {
    if (!aabbIntersects(pAABB, c.aabb)) continue;

    if (player.vz < 0) {
      // Falling down, land on top of platform
      player.z = c.aabb.z + c.aabb.d;
      player.vz = 0;
      player.isGrounded = true;
    } else if (player.vz > 0) {
      // Jumping up, hit bottom of platform
      player.z = c.aabb.z - PLAYER_DEPTH;
      player.vz = 0;
    }
    pAABB.z = player.z;
  }
}

function checkGoal(): boolean {
  if (!goalCollider) return false;

  const px = player.x + PLAYER_SIZE / 2;
  const py = player.y + PLAYER_SIZE / 2;
  const pz = player.z + PLAYER_DEPTH / 2;

  const gx = goalCollider.aabb.x + goalCollider.aabb.w / 2;
  const gy = goalCollider.aabb.y + goalCollider.aabb.h / 2;
  const gz = goalCollider.aabb.z + goalCollider.aabb.d / 2;

  const dx = px - gx;
  const dy = py - gy;
  const dz = pz - gz;

  return Math.sqrt(dx * dx + dy * dy + dz * dz) < 60;
}

// ============================================================================
// Message Handling & Cleanup
// ============================================================================

function setupMessageListener() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action === 'cleanup') {
        cleanup();
        sendResponse({ success: true });
      }
      return true;
    });
  }
}

function cleanup() {
  console.log('[DOM3D] Cleaning up...');

  isRunning = false;

  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (colliderUpdateInterval !== null) {
    clearInterval(colliderUpdateInterval);
    colliderUpdateInterval = null;
  }

  removeInputHandlers();

  if (root) {
    root.remove();
    root = null;
  }

  playerEl = null;
  startMarker = null;
  goalMarker = null;
  debugWallsContainer = null;
  colliders = [];
  spatialGrid.clear();
  startCollider = null;
  goalCollider = null;

  keys = { h: false, j: false, k: false, l: false, space: false };

  (window as any).__DOM3D_ACTIVE__ = false;

  console.log('[DOM3D] Cleanup complete');
}

// ============================================================================
// Entry Point
// ============================================================================

if ((window as any).__DOM3D_ACTIVE__) {
  console.log('[DOM3D] Already active, skipping injection');
} else {
  (window as any).__DOM3D_ACTIVE__ = true;
  initGame();
}
