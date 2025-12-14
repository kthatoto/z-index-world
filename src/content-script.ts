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
const Z_RANGE = 800;
const WALL_DEPTH = 50;
const PLAYER_SIZE = 24;
const MOVE_SPEED = 5;
const GRAVITY_Z = -0.5;
const MIN_JUMP_POWER = 8;
const MAX_JUMP_POWER = 20;
const CELL_SIZE = 100;
const VIEWPORT_MARGIN = 200;
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
  z: 100,
  vx: 0,
  vy: 0,
  vz: 0,
  isGrounded: false,
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
let jumpPower = 12;

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

  // Calculate jump power based on z distribution
  jumpPower = calculateJumpPower();

  // Find start and goal positions
  findStartAndGoal();

  // Create player
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
      updateColliders();
    }
  }, COLLIDER_UPDATE_INTERVAL);

  // Set up scroll/resize handlers
  window.addEventListener('scroll', handleScrollResize, { passive: true });
  window.addEventListener('resize', handleScrollResize, { passive: true });

  console.log('[DOM3D] Game initialized!');
  console.log('[DOM3D] Controls: h/j/k/l to move, Space to jump');
  console.log(`[DOM3D] Found ${colliders.length} colliders`);
}

// ============================================================================
// Overlay System
// ============================================================================

function createOverlay() {
  root = document.createElement('div');
  root.id = 'dom3d-game-root';
  root.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483647;
    transform-style: preserve-3d;
    perspective: ${PERSPECTIVE}px;
    transform-origin: center center;
    overflow: hidden;
  `;
  document.body.appendChild(root);

  // Container for debug walls (to easily clear them)
  debugWallsContainer = document.createElement('div');
  debugWallsContainer.id = 'dom3d-debug-walls';
  debugWallsContainer.style.cssText = `
    position: absolute;
    inset: 0;
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

  // Scan all elements
  const allElements = document.querySelectorAll('*');

  for (const el of allElements) {
    // Skip excluded tags
    if (EXCLUDED_TAGS.has(el.tagName)) continue;

    // Skip our own elements
    if ((el as HTMLElement).id?.startsWith('dom3d-')) continue;

    const style = getComputedStyle(el);

    // Skip invisible elements
    if (style.display === 'none') continue;
    if (style.visibility === 'hidden') continue;
    if (parseFloat(style.opacity) === 0) continue;

    const rect = el.getBoundingClientRect();

    // Skip zero-size elements
    if (rect.width === 0 || rect.height === 0) continue;

    // Skip tiny elements
    if (rect.width * rect.height < MIN_ELEMENT_AREA) continue;

    // Parse z-index
    let rawZIndex = parseInt(style.zIndex, 10);
    if (isNaN(rawZIndex) || rawZIndex < 0) {
      rawZIndex = 0;
    }

    rawZIndexes.push(rawZIndex);

    colliders.push({
      element: el,
      aabb: {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        z: 0, // Will be normalized later
        w: rect.width,
        h: rect.height,
        d: WALL_DEPTH,
      },
      rawZIndex,
    });
  }

  // Normalize z-index to z coordinate
  normalizeZValues(rawZIndexes);

  // Build spatial grid
  buildSpatialGrid();
}

function normalizeZValues(rawZIndexes: number[]) {
  if (colliders.length === 0) return;

  const minZ = Math.min(...rawZIndexes);
  const maxZ = Math.max(...rawZIndexes);
  const range = maxZ - minZ || 1;

  for (const c of colliders) {
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

function updateColliders() {
  // Update bounding rects for existing colliders
  for (const c of colliders) {
    const rect = c.element.getBoundingClientRect();
    c.aabb.x = rect.left + window.scrollX;
    c.aabb.y = rect.top + window.scrollY;
    c.aabb.w = rect.width;
    c.aabb.h = rect.height;
  }

  // Rebuild spatial grid
  buildSpatialGrid();
}

function getNearbyColliders(x: number, y: number): Collider[] {
  const result: Collider[] = [];
  const seen = new Set<Element>();

  const minCellX = Math.floor((x - PLAYER_SIZE - VIEWPORT_MARGIN) / CELL_SIZE);
  const maxCellX = Math.floor((x + PLAYER_SIZE + VIEWPORT_MARGIN) / CELL_SIZE);
  const minCellY = Math.floor((y - PLAYER_SIZE - VIEWPORT_MARGIN) / CELL_SIZE);
  const maxCellY = Math.floor((y + PLAYER_SIZE + VIEWPORT_MARGIN) / CELL_SIZE);

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
    // Default positions if no colliders
    startCollider = null;
    goalCollider = null;
    return;
  }

  // Score for start: low z, bottom-left, large
  let bestStartScore = -Infinity;
  let bestGoalScore = -Infinity;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  for (const c of colliders) {
    // Normalize position scores
    const posX = c.aabb.x / viewportWidth;
    const posY = c.aabb.y / viewportHeight;
    const sizeScore = Math.log(c.aabb.w * c.aabb.h + 1);
    const zNorm = c.aabb.z / Z_RANGE;

    // Start: low z, high y (bottom), low x (left)
    const startScore = -zNorm * 30 + posY * 20 - posX * 10 + sizeScore * 5;

    // Goal: high z, low y (top), high x (right)
    const goalScore = zNorm * 30 - posY * 20 + posX * 10 + sizeScore * 5;

    if (startScore > bestStartScore) {
      bestStartScore = startScore;
      startCollider = c;
    }

    if (goalScore > bestGoalScore) {
      bestGoalScore = goalScore;
      goalCollider = c;
    }
  }

  // Ensure start and goal are different
  if (startCollider === goalCollider && colliders.length > 1) {
    // Find second best goal
    let secondBestScore = -Infinity;
    let secondBest: Collider | null = null;

    for (const c of colliders) {
      if (c === startCollider) continue;
      const posX = c.aabb.x / viewportWidth;
      const posY = c.aabb.y / viewportHeight;
      const sizeScore = Math.log(c.aabb.w * c.aabb.h + 1);
      const zNorm = c.aabb.z / Z_RANGE;
      const goalScore = zNorm * 30 - posY * 20 + posX * 10 + sizeScore * 5;

      if (goalScore > secondBestScore) {
        secondBestScore = goalScore;
        secondBest = c;
      }
    }

    goalCollider = secondBest;
  }
}

function calculateJumpPower(): number {
  if (colliders.length < 2) return MIN_JUMP_POWER;

  const zValues = colliders.map(c => c.aabb.z).sort((a, b) => a - b);

  // Find significant z-level differences
  const deltas: number[] = [];
  for (let i = 1; i < zValues.length; i++) {
    const delta = zValues[i] - zValues[i - 1];
    if (delta > 10) {
      deltas.push(delta);
    }
  }

  if (deltas.length === 0) return MIN_JUMP_POWER;

  // Use median delta for more stability
  deltas.sort((a, b) => a - b);
  const medianDelta = deltas[Math.floor(deltas.length / 2)];

  // jumpPower = sqrt(2 * |gravity| * delta) * multiplier for some headroom
  const power = Math.sqrt(2 * Math.abs(GRAVITY_Z) * medianDelta) * 1.5;

  return Math.max(MIN_JUMP_POWER, Math.min(power, MAX_JUMP_POWER));
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

  // Set initial position
  if (startCollider) {
    player.x = startCollider.aabb.x + startCollider.aabb.w / 2 - PLAYER_SIZE / 2;
    player.y = startCollider.aabb.y + startCollider.aabb.h / 2 - PLAYER_SIZE / 2;
    player.z = startCollider.aabb.z + WALL_DEPTH + 1;
  } else {
    player.x = window.innerWidth / 2;
    player.y = window.innerHeight / 2;
    player.z = 100;
  }

  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.isGrounded = false;

  updatePlayerDOM();
}

function updatePlayerDOM() {
  if (!playerEl) return;

  // Apply perspective scale
  const scale = getScale(player.z);

  // Adjust position for scroll
  const viewX = player.x - window.scrollX;
  const viewY = player.y - window.scrollY;

  playerEl.style.transform = `translate3d(${viewX}px, ${viewY}px, ${player.z}px) scale(${scale})`;
}

function getScale(z: number): number {
  const s = PERSPECTIVE / (PERSPECTIVE - z);
  return Math.max(0.1, Math.min(s, 10));
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
    const x = startCollider.aabb.x + startCollider.aabb.w / 2 - 20;
    const y = startCollider.aabb.y + startCollider.aabb.h / 2 - 20;
    const z = startCollider.aabb.z + WALL_DEPTH + 2;
    const scale = getScale(z);

    startMarker.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 40px;
      height: 40px;
      background: rgba(76, 175, 80, 0.7);
      border: 3px solid #2e7d32;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 20px;
      color: white;
      text-shadow: 1px 1px 2px black;
      transform-style: preserve-3d;
      pointer-events: none;
      transform: translate3d(${x - window.scrollX}px, ${y - window.scrollY}px, ${z}px) scale(${scale});
    `;
    startMarker.textContent = 'S';
    root.appendChild(startMarker);
  }

  // Goal marker (blue)
  if (goalCollider) {
    goalMarker = document.createElement('div');
    goalMarker.id = 'dom3d-goal-marker';
    const x = goalCollider.aabb.x + goalCollider.aabb.w / 2 - 20;
    const y = goalCollider.aabb.y + goalCollider.aabb.h / 2 - 20;
    const z = goalCollider.aabb.z + WALL_DEPTH + 2;
    const scale = getScale(z);

    goalMarker.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 40px;
      height: 40px;
      background: rgba(33, 150, 243, 0.7);
      border: 3px solid #1565c0;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 20px;
      color: white;
      text-shadow: 1px 1px 2px black;
      transform-style: preserve-3d;
      pointer-events: none;
      transform: translate3d(${x - window.scrollX}px, ${y - window.scrollY}px, ${z}px) scale(${scale});
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

  // Clear existing
  debugWallsContainer.innerHTML = '';

  // Sort by area (descending) and take top N
  const sorted = [...colliders].sort((a, b) =>
    (b.aabb.w * b.aabb.h) - (a.aabb.w * a.aabb.h)
  );
  const sample = sorted.slice(0, DEBUG_WALL_LIMIT);

  for (const c of sample) {
    const el = document.createElement('div');
    el.className = 'dom3d-debug-wall';

    const viewX = c.aabb.x - window.scrollX;
    const viewY = c.aabb.y - window.scrollY;

    el.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: ${c.aabb.w}px;
      height: ${c.aabb.h}px;
      background: rgba(0, 100, 255, 0.15);
      border: 1px solid rgba(0, 100, 255, 0.4);
      transform: translate3d(${viewX}px, ${viewY}px, ${c.aabb.z}px);
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

function gameLoop(timestamp: number) {
  if (!isRunning) return;

  // 1. Apply gravity
  player.vz += GRAVITY_Z;

  // 2. Apply input velocity
  player.vx = 0;
  player.vy = 0;

  if (keys.h) player.vx -= MOVE_SPEED;
  if (keys.l) player.vx += MOVE_SPEED;
  if (keys.k) player.vy -= MOVE_SPEED;
  if (keys.j) player.vy += MOVE_SPEED;

  // 3. Handle jump
  if (keys.space && player.isGrounded) {
    player.vz = jumpPower;
    player.isGrounded = false;
  }

  // 4. Calculate next position
  let nextX = player.x + player.vx;
  let nextY = player.y + player.vy;
  let nextZ = player.z + player.vz;

  // 5. Clamp to ground (z >= 0)
  if (nextZ < 0) {
    nextZ = 0;
    player.vz = 0;
    player.isGrounded = true;
  }

  // 6. Collision detection and resolution
  const playerAABB: AABB3D = {
    x: nextX,
    y: nextY,
    z: nextZ,
    w: PLAYER_SIZE,
    h: PLAYER_SIZE,
    d: PLAYER_SIZE,
  };

  const nearby = getNearbyColliders(nextX, nextY);
  let groundedThisFrame = nextZ <= 0;

  for (const c of nearby) {
    if (intersectsAABB(playerAABB, c.aabb)) {
      const resolution = resolveCollision(playerAABB, c.aabb);

      nextX += resolution.x;
      nextY += resolution.y;
      nextZ += resolution.z;

      playerAABB.x = nextX;
      playerAABB.y = nextY;
      playerAABB.z = nextZ;

      // Check if landed on top of wall
      if (resolution.z > 0) {
        player.vz = 0;
        groundedThisFrame = true;
      }

      // Stop horizontal velocity if hitting wall
      if (resolution.x !== 0) player.vx = 0;
      if (resolution.y !== 0) player.vy = 0;
    }
  }

  player.isGrounded = groundedThisFrame;

  // 7. Update player position
  player.x = nextX;
  player.y = nextY;
  player.z = nextZ;

  // 8. Update DOM
  updatePlayerDOM();

  // 9. Check goal
  if (checkGoal()) {
    console.log('[DOM3D] GOAL reached!');
  }

  // 10. Next frame
  rafId = requestAnimationFrame(gameLoop);
}

function intersectsAABB(a: AABB3D, b: AABB3D): boolean {
  // X-axis overlap
  const xOverlap = a.x < b.x + b.w && a.x + a.w > b.x;
  // Y-axis overlap
  const yOverlap = a.y < b.y + b.h && a.y + a.h > b.y;
  // Z-axis overlap (a.z is bottom of player going up, b.z is bottom of wall going up)
  // Player occupies [a.z, a.z + a.d], Wall occupies [b.z, b.z + b.d]
  const zOverlap = a.z < b.z + b.d && a.z + a.d > b.z;

  return xOverlap && yOverlap && zOverlap;
}

function resolveCollision(player: AABB3D, wall: AABB3D): { x: number; y: number; z: number } {
  // Calculate overlap on each axis
  const overlapLeft = (player.x + player.w) - wall.x;
  const overlapRight = (wall.x + wall.w) - player.x;
  const overlapTop = (player.y + player.h) - wall.y;
  const overlapBottom = (wall.y + wall.h) - player.y;
  const overlapBelow = (player.z + player.d) - wall.z;  // Player above wall
  const overlapAbove = (wall.z + wall.d) - player.z;    // Player below wall

  const minOverlapX = Math.min(overlapLeft, overlapRight);
  const minOverlapY = Math.min(overlapTop, overlapBottom);
  const minOverlapZ = Math.min(overlapBelow, overlapAbove);

  // Find minimum penetration axis
  const minOverlap = Math.min(minOverlapX, minOverlapY, minOverlapZ);

  const result = { x: 0, y: 0, z: 0 };

  if (minOverlap === minOverlapX) {
    // Resolve X
    if (overlapLeft < overlapRight) {
      result.x = -overlapLeft;
    } else {
      result.x = overlapRight;
    }
  } else if (minOverlap === minOverlapY) {
    // Resolve Y
    if (overlapTop < overlapBottom) {
      result.y = -overlapTop;
    } else {
      result.y = overlapBottom;
    }
  } else {
    // Resolve Z
    if (overlapBelow < overlapAbove) {
      // Player is above wall, push up
      result.z = wall.z + wall.d - player.z;
    } else {
      // Player is below wall, push down
      result.z = -(player.z + player.d - wall.z);
    }
  }

  return result;
}

function checkGoal(): boolean {
  if (!goalCollider) return false;

  const playerCenterX = player.x + PLAYER_SIZE / 2;
  const playerCenterY = player.y + PLAYER_SIZE / 2;

  const goalCenterX = goalCollider.aabb.x + goalCollider.aabb.w / 2;
  const goalCenterY = goalCollider.aabb.y + goalCollider.aabb.h / 2;
  const goalZ = goalCollider.aabb.z + WALL_DEPTH;

  const dx = playerCenterX - goalCenterX;
  const dy = playerCenterY - goalCenterY;
  const dz = player.z - goalZ;

  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return dist < 50;
}

// ============================================================================
// Event Handlers
// ============================================================================

function handleScrollResize() {
  // Update debug walls positions on scroll
  renderDebugWalls();

  // Update markers
  updateMarkerPositions();
}

function updateMarkerPositions() {
  if (startMarker && startCollider) {
    const x = startCollider.aabb.x + startCollider.aabb.w / 2 - 20 - window.scrollX;
    const y = startCollider.aabb.y + startCollider.aabb.h / 2 - 20 - window.scrollY;
    const z = startCollider.aabb.z + WALL_DEPTH + 2;
    const scale = getScale(z);
    startMarker.style.transform = `translate3d(${x}px, ${y}px, ${z}px) scale(${scale})`;
  }

  if (goalMarker && goalCollider) {
    const x = goalCollider.aabb.x + goalCollider.aabb.w / 2 - 20 - window.scrollX;
    const y = goalCollider.aabb.y + goalCollider.aabb.h / 2 - 20 - window.scrollY;
    const z = goalCollider.aabb.z + WALL_DEPTH + 2;
    const scale = getScale(z);
    goalMarker.style.transform = `translate3d(${x}px, ${y}px, ${z}px) scale(${scale})`;
  }
}

// ============================================================================
// Message Handling & Cleanup
// ============================================================================

function setupMessageListener() {
  // Check if chrome.runtime is available (not available in test environment)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  // Stop animation frame
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  // Stop interval
  if (colliderUpdateInterval !== null) {
    clearInterval(colliderUpdateInterval);
    colliderUpdateInterval = null;
  }

  // Remove event listeners
  removeInputHandlers();
  window.removeEventListener('scroll', handleScrollResize);
  window.removeEventListener('resize', handleScrollResize);

  // Remove DOM
  if (root) {
    root.remove();
    root = null;
  }

  // Reset state
  playerEl = null;
  startMarker = null;
  goalMarker = null;
  debugWallsContainer = null;
  colliders = [];
  spatialGrid.clear();
  startCollider = null;
  goalCollider = null;

  keys = { h: false, j: false, k: false, l: false, space: false };

  // Clear flag
  (window as any).__DOM3D_ACTIVE__ = false;

  console.log('[DOM3D] Cleanup complete');
}

// ============================================================================
// Entry Point
// ============================================================================

// Prevent multiple injections
if ((window as any).__DOM3D_ACTIVE__) {
  console.log('[DOM3D] Already active, skipping injection');
} else {
  (window as any).__DOM3D_ACTIVE__ = true;
  initGame();
}
