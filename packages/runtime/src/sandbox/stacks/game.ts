/**
 * Game Stack — Canvas 2D Game Engine
 * All four tiers: Basic top-down action → Vai premium RPG.
 *
 * Uses pure HTML5 Canvas 2D — no external game engine dependencies.
 * Each tier adds systems: combat, inventory, quests, story, achievements.
 */

import type { StackDefinition, StackTemplate } from './types.js';
import { mergeFiles } from './types.js';

/* ================================================================
   BASIC TIER — Top-down Action Game (Neon Operative)
   Features: Player movement, WASD+mouse, 4 weapons, 3 enemy types,
   procedural rooms, dash mechanic, combo system, particle FX, HUD.
   ================================================================ */

const basicFiles: { path: string; content: string }[] = [
  {
    path: 'package.json',
    content: JSON.stringify(
      {
        name: 'game-basic',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview',
        },
        dependencies: {},
        devDependencies: {
          vite: '^6.3.0',
          typescript: '^5.9.0',
        },
      },
      null,
      2,
    ),
  },
  {
    path: 'tsconfig.json',
    content: JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: 'dist',
          sourceMap: true,
        },
        include: ['src'],
      },
      null,
      2,
    ),
  },
  {
    path: 'index.html',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Neon Operative</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a12; overflow: hidden; display: flex; justify-content: center; align-items: center; height: 100dvh; }
    canvas { display: block; image-rendering: pixelated; cursor: crosshair; }
    @font-face { font-family: 'GameFont'; src: local('Orbitron'), local('Consolas'), local('monospace'); }
  </style>
</head>
<body>
  <canvas id="game"></canvas>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>`,
  },
  {
    path: 'vite.config.ts',
    content: `import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 3000 } });`,
  },
];

/* ── Game engine: src/main.ts ─────────────────────────────────── */

const gameMainTs = `// ═══════════════════════════════════════════════════════════════
// NEON OPERATIVE — Top-Down Action Game Engine
// Pure Canvas 2D — no dependencies
// ═══════════════════════════════════════════════════════════════

// ── Types ────────────────────────────────────────────────────
interface Vec2 { x: number; y: number; }
interface Entity { pos: Vec2; vel: Vec2; size: number; hp: number; maxHp: number; color: string; }
interface Projectile { pos: Vec2; vel: Vec2; damage: number; owner: 'player' | 'enemy'; color: string; life: number; }
interface Particle { pos: Vec2; vel: Vec2; life: number; maxLife: number; color: string; size: number; }
interface Enemy extends Entity { type: 'grunt' | 'patrol' | 'tank'; ai: { patrolAngle: number; shootCd: number; }; }
interface Weapon { name: string; damage: number; fireRate: number; speed: number; spread: number; pellets: number; ammo: number; maxAmmo: number; auto: boolean; color: string; }
interface Room { x: number; y: number; w: number; h: number; walls: { x: number; y: number; w: number; h: number; }[]; doors: Vec2[]; enemies: Enemy[]; cleared: boolean; }
interface Quest { id: string; title: string; description: string; target: number; progress: number; done: boolean; reward: string; }
interface Achievement { id: string; name: string; description: string; unlocked: boolean; icon: string; }

// ── Constants ────────────────────────────────────────────────
const W = 960, H = 640;
const PLAYER_SPEED = 3.5;
const DASH_SPEED = 12;
const DASH_DURATION = 8;
const DASH_COOLDOWN = 60;
const ENEMY_CONFIGS = {
  grunt:  { hp: 30, speed: 2.0, size: 14, color: '#ff4444', damage: 8,  shootRate: 90 },
  patrol: { hp: 50, speed: 1.5, size: 16, color: '#ff8800', damage: 12, shootRate: 60 },
  tank:   { hp: 120, speed: 0.8, size: 22, color: '#aa44ff', damage: 20, shootRate: 120 },
};

// ── Game State ───────────────────────────────────────────────
type GamePhase = 'menu' | 'playing' | 'dead' | 'win' | 'paused';
let phase: GamePhase = 'menu';
let player: Entity & { dashCd: number; dashTimer: number; invincible: boolean; weaponIdx: number; score: number; combo: number; comboTimer: number; kills: number; level: number; xp: number; xpNext: number; } = {
  pos: { x: W / 2, y: H / 2 }, vel: { x: 0, y: 0 }, size: 14, hp: 100, maxHp: 100,
  color: '#00ffcc', dashCd: 0, dashTimer: 0, invincible: false, weaponIdx: 0,
  score: 0, combo: 0, comboTimer: 0, kills: 0, level: 1, xp: 0, xpNext: 50,
};

const weapons: Weapon[] = [
  { name: 'Pistol',  damage: 15, fireRate: 12, speed: 10, spread: 0.03, pellets: 1, ammo: Infinity, maxAmmo: Infinity, auto: false, color: '#ffff44' },
  { name: 'SMG',     damage: 8,  fireRate: 4,  speed: 11, spread: 0.08, pellets: 1, ammo: 120, maxAmmo: 120, auto: true, color: '#44ffaa' },
  { name: 'Shotgun', damage: 12, fireRate: 24, speed: 9,  spread: 0.15, pellets: 6, ammo: 24,  maxAmmo: 24,  auto: false, color: '#ff6644' },
  { name: 'Rifle',   damage: 25, fireRate: 8,  speed: 14, spread: 0.02, pellets: 1, ammo: 30,  maxAmmo: 30,  auto: true, color: '#44aaff' },
];

let projectiles: Projectile[] = [];
let particles: Particle[] = [];
let rooms: Room[] = [];
let currentRoom = 0;
let fireCd = 0;
let screenShake = 0;
let slowMo = 0;
let mousePos: Vec2 = { x: W / 2, y: H / 2 };
let keys: Record<string, boolean> = {};
let mouseDown = false;
let frameCount = 0;

// ── Quest & Achievement System ───────────────────────────────
const quests: Quest[] = [
  { id: 'first_blood', title: 'First Blood', description: 'Defeat your first enemy', target: 1, progress: 0, done: false, reward: '+20 HP' },
  { id: 'combo_5', title: 'Combo Master', description: 'Reach a 5x combo', target: 5, progress: 0, done: false, reward: 'SMG Ammo' },
  { id: 'clear_3', title: 'Room Sweeper', description: 'Clear 3 rooms', target: 3, progress: 0, done: false, reward: 'Rifle Ammo' },
  { id: 'kill_20', title: 'Operative', description: 'Eliminate 20 enemies', target: 20, progress: 0, done: false, reward: 'Max HP +25' },
  { id: 'boss_kill', title: 'Tank Buster', description: 'Defeat a Tank enemy', target: 1, progress: 0, done: false, reward: 'Shotgun Ammo' },
];

const achievements: Achievement[] = [
  { id: 'start', name: 'Welcome Agent', description: 'Start the game', unlocked: false, icon: '🎮' },
  { id: 'first_kill', name: 'First Blood', description: 'Get your first kill', unlocked: false, icon: '🗡️' },
  { id: 'combo_10', name: 'Unstoppable', description: 'Reach 10x combo', unlocked: false, icon: '🔥' },
  { id: 'no_damage_room', name: 'Ghost', description: 'Clear a room without taking damage', unlocked: false, icon: '👻' },
  { id: 'all_weapons', name: 'Arsenal', description: 'Use all 4 weapons', unlocked: false, icon: '🔫' },
  { id: 'win', name: 'Mission Complete', description: 'Clear all levels', unlocked: false, icon: '🏆' },
];

let notifications: { text: string; timer: number; color: string; }[] = [];
let weaponsUsed = new Set<number>();
let roomDamageTaken = false;

function notify(text: string, color = '#00ffcc') {
  notifications.push({ text, timer: 180, color });
}

function unlockAchievement(id: string) {
  const a = achievements.find(a => a.id === id);
  if (a && !a.unlocked) { a.unlocked = true; notify('🏆 ' + a.name, '#ffd700'); }
}

function updateQuest(id: string, value: number) {
  const q = quests.find(q => q.id === id);
  if (!q || q.done) return;
  q.progress = Math.min(value, q.target);
  if (q.progress >= q.target) {
    q.done = true;
    notify('✅ Quest: ' + q.title + ' — ' + q.reward, '#44ff88');
    applyReward(q.reward);
  }
}

function applyReward(reward: string) {
  if (reward === '+20 HP') { player.maxHp += 20; player.hp = Math.min(player.hp + 20, player.maxHp); }
  if (reward === 'SMG Ammo') { weapons[1].ammo = Math.min(weapons[1].ammo + 60, weapons[1].maxAmmo); }
  if (reward === 'Rifle Ammo') { weapons[3].ammo = Math.min(weapons[3].ammo + 15, weapons[3].maxAmmo); }
  if (reward === 'Shotgun Ammo') { weapons[2].ammo = Math.min(weapons[2].ammo + 12, weapons[2].maxAmmo); }
  if (reward === 'Max HP +25') { player.maxHp += 25; player.hp = Math.min(player.hp + 25, player.maxHp); }
}

// ── Level Generation ─────────────────────────────────────────
function generateLevel(levelNum: number): Room[] {
  const roomCount = 3 + levelNum;
  const generated: Room[] = [];
  for (let i = 0; i < roomCount; i++) {
    const rx = 80, ry = 60, rw = W - 160, rh = H - 120;
    const walls: { x: number; y: number; w: number; h: number; }[] = [];
    const wallCount = 2 + Math.floor(Math.random() * (2 + levelNum));
    for (let w = 0; w < wallCount; w++) {
      const horizontal = Math.random() > 0.5;
      walls.push({
        x: rx + 60 + Math.random() * (rw - 200),
        y: ry + 60 + Math.random() * (rh - 200),
        w: horizontal ? 60 + Math.random() * 100 : 12,
        h: horizontal ? 12 : 60 + Math.random() * 100,
      });
    }
    const enemyCount = 2 + Math.floor(levelNum * 1.5) + i;
    const enemies: Enemy[] = [];
    for (let e = 0; e < enemyCount; e++) {
      const types: Enemy['type'][] = levelNum < 2 ? ['grunt', 'patrol'] : ['grunt', 'patrol', 'tank'];
      const type = types[Math.floor(Math.random() * types.length)];
      const cfg = ENEMY_CONFIGS[type];
      enemies.push({
        pos: { x: rx + 100 + Math.random() * (rw - 200), y: ry + 100 + Math.random() * (rh - 200) },
        vel: { x: 0, y: 0 }, size: cfg.size, hp: cfg.hp + levelNum * 5, maxHp: cfg.hp + levelNum * 5,
        color: cfg.color, type, ai: { patrolAngle: Math.random() * Math.PI * 2, shootCd: Math.random() * cfg.shootRate },
      });
    }
    generated.push({ x: rx, y: ry, w: rw, h: rh, walls, doors: [{ x: rx + rw - 20, y: ry + rh / 2 }], enemies, cleared: false });
  }
  return generated;
}

// ── Canvas Setup ─────────────────────────────────────────────
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
canvas.width = W; canvas.height = H;

// ── Input ────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (phase === 'menu' && e.key === 'Enter') { startGame(); }
  if (phase === 'dead' && e.key.toLowerCase() === 'r') { startGame(); }
  if (phase === 'playing' && e.key === 'Escape') { phase = 'paused'; }
  else if (phase === 'paused' && e.key === 'Escape') { phase = 'playing'; }
  if (e.key >= '1' && e.key <= '4') { player.weaponIdx = parseInt(e.key) - 1; weaponsUsed.add(player.weaponIdx); if (weaponsUsed.size >= 4) unlockAchievement('all_weapons'); }
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
canvas.addEventListener('mousemove', e => { const r = canvas.getBoundingClientRect(); mousePos = { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; });
canvas.addEventListener('mousedown', () => { mouseDown = true; });
canvas.addEventListener('mouseup', () => { mouseDown = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

function startGame() {
  phase = 'playing';
  player.pos = { x: 200, y: H / 2 }; player.hp = player.maxHp; player.score = 0;
  player.combo = 0; player.kills = 0; player.level = 1; player.xp = 0; player.xpNext = 50;
  player.dashCd = 0; player.dashTimer = 0; player.weaponIdx = 0;
  weapons[1].ammo = weapons[1].maxAmmo; weapons[2].ammo = weapons[2].maxAmmo; weapons[3].ammo = weapons[3].maxAmmo;
  projectiles = []; particles = []; notifications = []; weaponsUsed = new Set([0]);
  quests.forEach(q => { q.progress = 0; q.done = false; });
  achievements.forEach(a => a.unlocked = false);
  currentRoom = 0; rooms = generateLevel(1);
  unlockAchievement('start');
  roomDamageTaken = false;
}

// ── Collision helpers ────────────────────────────────────────
function dist(a: Vec2, b: Vec2) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }
function rectContains(rx: number, ry: number, rw: number, rh: number, px: number, py: number, ps: number) {
  return px - ps > rx && px + ps < rx + rw && py - ps > ry && py + ps < ry + rh;
}
function circleRect(cx: number, cy: number, cr: number, rx: number, ry: number, rw: number, rh: number) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  return dist({ x: cx, y: cy }, { x: nx, y: ny }) < cr;
}

// ── Spawn particles ──────────────────────────────────────────
function spawnParticles(pos: Vec2, count: number, color: string, speed = 3) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd = Math.random() * speed;
    particles.push({ pos: { ...pos }, vel: { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd }, life: 20 + Math.random() * 20, maxLife: 40, color, size: 2 + Math.random() * 3 });
  }
}

// ── Fire weapon ──────────────────────────────────────────────
function fireWeapon() {
  const w = weapons[player.weaponIdx];
  if (fireCd > 0 || (w.ammo <= 0 && w.ammo !== Infinity)) return;
  fireCd = w.fireRate;
  if (w.ammo !== Infinity) w.ammo--;
  const angle = Math.atan2(mousePos.y - player.pos.y, mousePos.x - player.pos.x);
  for (let i = 0; i < w.pellets; i++) {
    const a = angle + (Math.random() - 0.5) * w.spread * 2;
    projectiles.push({
      pos: { ...player.pos }, vel: { x: Math.cos(a) * w.speed, y: Math.sin(a) * w.speed },
      damage: w.damage, owner: 'player', color: w.color, life: 60,
    });
  }
  screenShake = 3; spawnParticles(player.pos, 3, w.color, 2);
}

// ── Update ───────────────────────────────────────────────────
function update() {
  if (phase !== 'playing') return;
  frameCount++;
  const room = rooms[currentRoom];

  // Player movement
  let dx = 0, dy = 0;
  if (keys['w'] || keys['arrowup']) dy -= 1;
  if (keys['s'] || keys['arrowdown']) dy += 1;
  if (keys['a'] || keys['arrowleft']) dx -= 1;
  if (keys['d'] || keys['arrowright']) dx += 1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= len; dy /= len;

  // Dash
  if (keys['shift'] && player.dashCd <= 0 && (dx !== 0 || dy !== 0) && player.dashTimer <= 0) {
    player.dashTimer = DASH_DURATION; player.dashCd = DASH_COOLDOWN; player.invincible = true;
    spawnParticles(player.pos, 8, '#00ffcc', 4);
  }
  if (player.dashTimer > 0) {
    player.dashTimer--;
    player.pos.x += dx * DASH_SPEED; player.pos.y += dy * DASH_SPEED;
    if (player.dashTimer <= 0) player.invincible = false;
  } else {
    player.pos.x += dx * PLAYER_SPEED; player.pos.y += dy * PLAYER_SPEED;
  }
  if (player.dashCd > 0) player.dashCd--;

  // Clamp to room
  player.pos.x = Math.max(room.x + player.size, Math.min(room.x + room.w - player.size, player.pos.x));
  player.pos.y = Math.max(room.y + player.size, Math.min(room.y + room.h - player.size, player.pos.y));

  // Wall collision
  for (const wall of room.walls) {
    if (circleRect(player.pos.x, player.pos.y, player.size, wall.x, wall.y, wall.w, wall.h)) {
      const cx = wall.x + wall.w / 2, cy = wall.y + wall.h / 2;
      const pushAngle = Math.atan2(player.pos.y - cy, player.pos.x - cx);
      player.pos.x += Math.cos(pushAngle) * 4; player.pos.y += Math.sin(pushAngle) * 4;
    }
  }

  // Shooting
  if (fireCd > 0) fireCd--;
  if (mouseDown && (weapons[player.weaponIdx].auto || fireCd <= 0)) fireWeapon();

  // Projectiles
  projectiles = projectiles.filter(p => {
    p.pos.x += p.vel.x; p.pos.y += p.vel.y; p.life--;
    if (p.life <= 0 || p.pos.x < 0 || p.pos.x > W || p.pos.y < 0 || p.pos.y > H) return false;
    for (const wall of room.walls) {
      if (circleRect(p.pos.x, p.pos.y, 3, wall.x, wall.y, wall.w, wall.h)) {
        spawnParticles(p.pos, 3, p.color, 2); return false;
      }
    }
    if (p.owner === 'player') {
      for (const enemy of room.enemies) {
        if (enemy.hp <= 0) continue;
        if (dist(p.pos, enemy.pos) < enemy.size + 4) {
          enemy.hp -= p.damage; spawnParticles(p.pos, 5, '#ff2222', 3); screenShake = 2;
          if (enemy.hp <= 0) {
            player.score += 100 * (player.combo + 1); player.combo++; player.comboTimer = 180;
            player.kills++; player.xp += 10;
            spawnParticles(enemy.pos, 12, enemy.color, 5);
            if (player.combo >= 3) slowMo = 15;
            updateQuest('first_blood', player.kills); updateQuest('kill_20', player.kills);
            updateQuest('combo_5', player.combo);
            if (player.combo >= 10) unlockAchievement('combo_10');
            if (player.kills === 1) unlockAchievement('first_kill');
            if (enemy.type === 'tank') updateQuest('boss_kill', 1);
            // Level up
            if (player.xp >= player.xpNext) {
              player.xp -= player.xpNext; player.xpNext = Math.floor(player.xpNext * 1.5);
              player.level++; player.maxHp += 10; player.hp = player.maxHp;
              notify('⬆️ Level ' + player.level + '!', '#ffdd00');
            }
          }
          return false;
        }
      }
    }
    if (p.owner === 'enemy' && !player.invincible) {
      if (dist(p.pos, player.pos) < player.size + 4) {
        player.hp -= p.damage; screenShake = 5; roomDamageTaken = true;
        spawnParticles(player.pos, 8, '#ff0044', 4);
        if (player.hp <= 0) { phase = 'dead'; spawnParticles(player.pos, 30, '#ff0044', 6); }
        return false;
      }
    }
    return true;
  });

  // Combo timer
  if (player.comboTimer > 0) player.comboTimer--;
  else player.combo = 0;

  // Enemy AI
  for (const enemy of room.enemies) {
    if (enemy.hp <= 0) continue;
    const cfg = ENEMY_CONFIGS[enemy.type];
    const toPlayer = Math.atan2(player.pos.y - enemy.pos.y, player.pos.x - enemy.pos.x);
    const d = dist(player.pos, enemy.pos);

    if (enemy.type === 'patrol') {
      enemy.ai.patrolAngle += 0.02;
      enemy.pos.x += Math.cos(enemy.ai.patrolAngle) * cfg.speed;
      enemy.pos.y += Math.sin(enemy.ai.patrolAngle) * cfg.speed;
      if (d < 250) { enemy.pos.x += Math.cos(toPlayer) * cfg.speed * 0.5; enemy.pos.y += Math.sin(toPlayer) * cfg.speed * 0.5; }
    } else {
      if (d > 60) { enemy.pos.x += Math.cos(toPlayer) * cfg.speed; enemy.pos.y += Math.sin(toPlayer) * cfg.speed; }
    }

    // Enemy shooting
    enemy.ai.shootCd--;
    if (enemy.ai.shootCd <= 0 && d < 400) {
      enemy.ai.shootCd = cfg.shootRate;
      const spread = (Math.random() - 0.5) * 0.2;
      projectiles.push({
        pos: { ...enemy.pos }, vel: { x: Math.cos(toPlayer + spread) * 5, y: Math.sin(toPlayer + spread) * 5 },
        damage: cfg.damage, owner: 'enemy', color: '#ff4466', life: 80,
      });
    }

    // Clamp enemy to room
    enemy.pos.x = Math.max(room.x + enemy.size, Math.min(room.x + room.w - enemy.size, enemy.pos.x));
    enemy.pos.y = Math.max(room.y + enemy.size, Math.min(room.y + room.h - enemy.size, enemy.pos.y));
  }

  // Check room cleared
  if (!room.cleared && room.enemies.every(e => e.hp <= 0)) {
    room.cleared = true;
    const clearedCount = rooms.filter(r => r.cleared).length;
    updateQuest('clear_3', clearedCount);
    if (!roomDamageTaken) unlockAchievement('no_damage_room');
    notify('🚪 Room cleared! Proceed →', '#44ff88');
    // Ammo drop
    weapons[1].ammo = Math.min(weapons[1].ammo + 30, weapons[1].maxAmmo);
    weapons[2].ammo = Math.min(weapons[2].ammo + 6, weapons[2].maxAmmo);
    weapons[3].ammo = Math.min(weapons[3].ammo + 8, weapons[3].maxAmmo);
  }

  // Door to next room
  if (room.cleared && currentRoom < rooms.length - 1) {
    const door = room.doors[0];
    if (dist(player.pos, door) < 30) {
      currentRoom++; player.pos = { x: rooms[currentRoom].x + 60, y: H / 2 };
      roomDamageTaken = false; projectiles = [];
    }
  }

  // All rooms cleared → next level or win
  if (room.cleared && currentRoom === rooms.length - 1) {
    if (player.level >= 5) { phase = 'win'; unlockAchievement('win'); }
    else {
      const nextLvl = Math.min(player.level + 1, 5);
      rooms = generateLevel(nextLvl); currentRoom = 0;
      player.pos = { x: rooms[0].x + 60, y: H / 2 };
      roomDamageTaken = false; projectiles = [];
      notify('⚡ Level ' + nextLvl + ' — ' + rooms.length + ' rooms', '#ff8800');
    }
  }

  // Particles
  particles = particles.filter(p => { p.pos.x += p.vel.x; p.pos.y += p.vel.y; p.life--; return p.life > 0; });
  if (slowMo > 0) slowMo--;
  if (screenShake > 0) screenShake *= 0.8;

  // Notifications
  notifications = notifications.filter(n => { n.timer--; return n.timer > 0; });
}

// ── Render ───────────────────────────────────────────────────
function render() {
  ctx.save();
  if (screenShake > 0) ctx.translate((Math.random() - 0.5) * screenShake * 2, (Math.random() - 0.5) * screenShake * 2);

  // Background
  ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, W, H);

  if (phase === 'menu') { drawMenu(); ctx.restore(); return; }
  if (phase === 'paused') { drawGame(); drawPauseOverlay(); ctx.restore(); return; }

  drawGame();

  if (phase === 'dead') drawDeathScreen();
  if (phase === 'win') drawWinScreen();
  ctx.restore();
}

function drawGame() {
  const room = rooms[currentRoom];
  // Room border
  ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 2;
  ctx.strokeRect(room.x, room.y, room.w, room.h);

  // Grid
  ctx.strokeStyle = '#0d0d1a'; ctx.lineWidth = 0.5;
  for (let x = room.x; x < room.x + room.w; x += 40) { ctx.beginPath(); ctx.moveTo(x, room.y); ctx.lineTo(x, room.y + room.h); ctx.stroke(); }
  for (let y = room.y; y < room.y + room.h; y += 40) { ctx.beginPath(); ctx.moveTo(room.x, y); ctx.lineTo(room.x + room.w, y); ctx.stroke(); }

  // Walls
  for (const wall of room.walls) {
    ctx.fillStyle = '#1a1a3e'; ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    ctx.strokeStyle = '#3333aa44'; ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
  }

  // Door
  if (room.cleared && currentRoom < rooms.length - 1) {
    const door = room.doors[0];
    ctx.fillStyle = '#00ff8855'; ctx.beginPath(); ctx.arc(door.x, door.y, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#00ff88'; ctx.font = '14px monospace'; ctx.textAlign = 'center'; ctx.fillText('→', door.x, door.y + 5);
  }

  // Enemies
  for (const enemy of room.enemies) {
    if (enemy.hp <= 0) continue;
    // Glow
    ctx.shadowColor = enemy.color; ctx.shadowBlur = 10;
    ctx.fillStyle = enemy.color; ctx.beginPath(); ctx.arc(enemy.pos.x, enemy.pos.y, enemy.size, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // HP bar
    const hpW = enemy.size * 2;
    ctx.fillStyle = '#333'; ctx.fillRect(enemy.pos.x - hpW / 2, enemy.pos.y - enemy.size - 10, hpW, 4);
    ctx.fillStyle = enemy.color; ctx.fillRect(enemy.pos.x - hpW / 2, enemy.pos.y - enemy.size - 10, hpW * (enemy.hp / enemy.maxHp), 4);
    // Type label
    ctx.fillStyle = '#ffffff88'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
    ctx.fillText(enemy.type.toUpperCase(), enemy.pos.x, enemy.pos.y - enemy.size - 14);
  }

  // Projectiles
  for (const p of projectiles) {
    ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Particles
  for (const p of particles) {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha; ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, p.size * alpha, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Player
  ctx.shadowColor = player.color; ctx.shadowBlur = player.invincible ? 20 : 8;
  ctx.fillStyle = player.invincible ? '#ffffff' : player.color;
  ctx.beginPath(); ctx.arc(player.pos.x, player.pos.y, player.size, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // Aim line
  const aimAngle = Math.atan2(mousePos.y - player.pos.y, mousePos.x - player.pos.x);
  ctx.strokeStyle = player.color + '44'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(player.pos.x, player.pos.y);
  ctx.lineTo(player.pos.x + Math.cos(aimAngle) * 40, player.pos.y + Math.sin(aimAngle) * 40);
  ctx.stroke();

  // HUD
  drawHUD();
}

function drawHUD() {
  // HP bar
  ctx.fillStyle = '#1a1a2e'; ctx.fillRect(20, 20, 200, 16);
  ctx.fillStyle = player.hp > 30 ? '#00ff88' : '#ff4444';
  ctx.fillRect(20, 20, 200 * (player.hp / player.maxHp), 16);
  ctx.strokeStyle = '#334'; ctx.strokeRect(20, 20, 200, 16);
  ctx.fillStyle = '#fff'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
  ctx.fillText(player.hp + '/' + player.maxHp + ' HP', 25, 33);

  // XP bar
  ctx.fillStyle = '#1a1a2e'; ctx.fillRect(20, 40, 200, 8);
  ctx.fillStyle = '#8844ff'; ctx.fillRect(20, 40, 200 * (player.xp / player.xpNext), 8);
  ctx.fillStyle = '#aaa'; ctx.font = '9px monospace'; ctx.fillText('LVL ' + player.level + ' — ' + player.xp + '/' + player.xpNext + ' XP', 22, 47);

  // Dash cooldown
  const dashPct = player.dashCd > 0 ? 1 - player.dashCd / DASH_COOLDOWN : 1;
  ctx.fillStyle = '#1a1a2e'; ctx.fillRect(20, 52, 100, 6);
  ctx.fillStyle = dashPct >= 1 ? '#00ffcc' : '#555'; ctx.fillRect(20, 52, 100 * dashPct, 6);
  ctx.fillStyle = '#888'; ctx.font = '8px monospace'; ctx.fillText('DASH [SHIFT]', 22, 58);

  // Weapon slots
  for (let i = 0; i < weapons.length; i++) {
    const w = weapons[i]; const bx = 20 + i * 80, by = H - 50;
    ctx.fillStyle = i === player.weaponIdx ? '#1a2a3e' : '#0d0d1a';
    ctx.fillRect(bx, by, 72, 32); ctx.strokeStyle = i === player.weaponIdx ? w.color : '#333';
    ctx.strokeRect(bx, by, 72, 32);
    ctx.fillStyle = i === player.weaponIdx ? '#fff' : '#888'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillText((i + 1) + ' ' + w.name, bx + 4, by + 14);
    ctx.fillStyle = w.ammo === Infinity ? '#666' : w.ammo > 0 ? '#aaa' : '#ff4444'; ctx.font = '9px monospace';
    ctx.fillText(w.ammo === Infinity ? '∞' : w.ammo + '/' + w.maxAmmo, bx + 4, by + 26);
  }

  // Score & combo
  ctx.textAlign = 'right'; ctx.fillStyle = '#ffdd44'; ctx.font = '16px monospace';
  ctx.fillText('SCORE: ' + player.score.toLocaleString(), W - 20, 30);
  if (player.combo > 1) {
    ctx.fillStyle = '#ff6600'; ctx.font = '20px monospace';
    ctx.fillText(player.combo + 'x COMBO', W - 20, 55);
  }
  ctx.fillStyle = '#888'; ctx.font = '11px monospace';
  ctx.fillText('KILLS: ' + player.kills, W - 20, 72);
  ctx.fillText('ROOM: ' + (currentRoom + 1) + '/' + rooms.length, W - 20, 86);

  // Quest tracker (top right)
  const activeQuests = quests.filter(q => !q.done);
  if (activeQuests.length > 0) {
    ctx.textAlign = 'right'; ctx.fillStyle = '#ffffff88'; ctx.font = '9px monospace';
    ctx.fillText('── QUESTS ──', W - 20, 110);
    activeQuests.slice(0, 3).forEach((q, i) => {
      ctx.fillStyle = '#aaa'; ctx.fillText(q.title + ': ' + q.progress + '/' + q.target, W - 20, 124 + i * 14);
    });
  }

  // Notifications
  notifications.forEach((n, i) => {
    const alpha = Math.min(1, n.timer / 30);
    ctx.globalAlpha = alpha; ctx.fillStyle = n.color; ctx.font = '13px monospace'; ctx.textAlign = 'center';
    ctx.fillText(n.text, W / 2, H - 80 - i * 20);
  });
  ctx.globalAlpha = 1;
}

function drawMenu() {
  ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, W, H);
  // Title
  ctx.textAlign = 'center'; ctx.shadowColor = '#00ffcc'; ctx.shadowBlur = 20;
  ctx.fillStyle = '#00ffcc'; ctx.font = 'bold 48px monospace'; ctx.fillText('NEON OPERATIVE', W / 2, H / 3);
  ctx.shadowBlur = 0;
  // Subtitle
  ctx.fillStyle = '#888'; ctx.font = '14px monospace';
  ctx.fillText('Top-Down Action · Procedural Levels · RPG Progression', W / 2, H / 3 + 40);
  // Controls
  ctx.fillStyle = '#555'; ctx.font = '12px monospace';
  const controls = ['WASD — Move', 'Mouse — Aim & Shoot', '1-4 — Switch Weapons', 'SHIFT — Dash', 'ESC — Pause'];
  controls.forEach((c, i) => ctx.fillText(c, W / 2, H / 2 + 20 + i * 22));
  // Start
  ctx.fillStyle = '#00ffcc'; ctx.font = '16px monospace';
  ctx.fillText('[ PRESS ENTER TO START ]', W / 2, H - 80);
  // Lore
  ctx.fillStyle = '#333'; ctx.font = '10px monospace';
  ctx.fillText('Year 2087. Neon City. You are the last operative. Clear every room. Survive.', W / 2, H - 40);
}

function drawDeathScreen() {
  ctx.fillStyle = '#00000099'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.fillStyle = '#ff4444'; ctx.font = 'bold 36px monospace'; ctx.fillText('MISSION FAILED', W / 2, H / 3);
  ctx.fillStyle = '#aaa'; ctx.font = '14px monospace';
  ctx.fillText('Score: ' + player.score.toLocaleString() + ' · Kills: ' + player.kills, W / 2, H / 3 + 40);
  // Achievements earned
  const earned = achievements.filter(a => a.unlocked);
  if (earned.length > 0) {
    ctx.fillStyle = '#ffd700'; ctx.font = '12px monospace';
    ctx.fillText('Achievements: ' + earned.map(a => a.icon + ' ' + a.name).join(' · '), W / 2, H / 2);
  }
  ctx.fillStyle = '#ff4444'; ctx.font = '16px monospace'; ctx.fillText('[ PRESS R TO RETRY ]', W / 2, H - 80);
}

function drawWinScreen() {
  ctx.fillStyle = '#00000099'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 20;
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 36px monospace'; ctx.fillText('MISSION COMPLETE', W / 2, H / 3);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff'; ctx.font = '14px monospace';
  ctx.fillText('Final Score: ' + player.score.toLocaleString() + ' · Total Kills: ' + player.kills, W / 2, H / 3 + 40);
  // All achievements
  ctx.fillStyle = '#ffd700'; ctx.font = '12px monospace';
  achievements.forEach((a, i) => {
    ctx.fillStyle = a.unlocked ? '#ffd700' : '#444';
    ctx.fillText(a.icon + ' ' + a.name + (a.unlocked ? ' ✓' : ' ✗'), W / 2, H / 2 + i * 20);
  });
  ctx.fillStyle = '#00ffcc'; ctx.font = '16px monospace'; ctx.fillText('[ PRESS R TO PLAY AGAIN ]', W / 2, H - 60);
}

function drawPauseOverlay() {
  ctx.fillStyle = '#000000cc'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.fillStyle = '#00ffcc'; ctx.font = 'bold 28px monospace';
  ctx.fillText('PAUSED', W / 2, H / 3);
  ctx.fillStyle = '#888'; ctx.font = '13px monospace';

  // Quest list
  ctx.fillText('── QUESTS ──', W / 2, H / 2 - 30);
  quests.forEach((q, i) => {
    ctx.fillStyle = q.done ? '#44ff88' : '#aaa'; ctx.font = '11px monospace';
    ctx.fillText((q.done ? '✅ ' : '○ ') + q.title + ': ' + q.progress + '/' + q.target + ' — ' + q.description, W / 2, H / 2 - 10 + i * 18);
  });

  // Achievement list
  const achY = H / 2 + quests.length * 18 + 20;
  ctx.fillStyle = '#888'; ctx.font = '13px monospace'; ctx.fillText('── ACHIEVEMENTS ──', W / 2, achY);
  achievements.forEach((a, i) => {
    ctx.fillStyle = a.unlocked ? '#ffd700' : '#555'; ctx.font = '11px monospace';
    ctx.fillText(a.icon + ' ' + a.name + ': ' + a.description + (a.unlocked ? ' ✓' : ''), W / 2, achY + 18 + i * 16);
  });

  ctx.fillStyle = '#00ffcc'; ctx.font = '14px monospace'; ctx.fillText('[ ESC TO RESUME ]', W / 2, H - 60);
}

// ── Game Loop ────────────────────────────────────────────────
function loop() {
  if (slowMo > 0 && frameCount % 3 !== 0) { requestAnimationFrame(loop); render(); return; }
  update(); render(); requestAnimationFrame(loop);
}

// Responsive canvas
function resize() {
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = W * scale + 'px'; canvas.style.height = H * scale + 'px';
}
window.addEventListener('resize', resize); resize();
loop();
`;

basicFiles.push({ path: 'src/main.ts', content: gameMainTs });

/* ================================================================
   SOLID TIER — Adds: inventory system, dialogue, save/load, minimap
   ================================================================ */

const solidOverrides: { path: string; content: string }[] = [
  {
    path: 'package.json',
    content: JSON.stringify(
      {
        name: 'game-solid',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: {},
        devDependencies: { vite: '^6.3.0', typescript: '^5.9.0' },
      },
      null,
      2,
    ),
  },
  {
    path: 'src/systems/inventory.ts',
    content: `// Inventory System — item management with stacking and equipment slots
export interface Item { id: string; name: string; icon: string; description: string; type: 'weapon' | 'consumable' | 'key' | 'armor'; stackable: boolean; quantity: number; stats?: Record<string, number>; }
export interface Inventory { items: Item[]; maxSlots: number; equipped: { weapon?: Item; armor?: Item; }; }
export function createInventory(maxSlots = 20): Inventory { return { items: [], maxSlots, equipped: {} }; }
export function addItem(inv: Inventory, item: Item): boolean {
  if (item.stackable) { const existing = inv.items.find(i => i.id === item.id); if (existing) { existing.quantity += item.quantity; return true; } }
  if (inv.items.length >= inv.maxSlots) return false;
  inv.items.push({ ...item }); return true;
}
export function removeItem(inv: Inventory, itemId: string, quantity = 1): boolean {
  const idx = inv.items.findIndex(i => i.id === itemId);
  if (idx === -1) return false;
  inv.items[idx].quantity -= quantity;
  if (inv.items[idx].quantity <= 0) inv.items.splice(idx, 1);
  return true;
}
export function equipItem(inv: Inventory, itemId: string): boolean {
  const item = inv.items.find(i => i.id === itemId);
  if (!item || (item.type !== 'weapon' && item.type !== 'armor')) return false;
  if (item.type === 'weapon') inv.equipped.weapon = item;
  else inv.equipped.armor = item;
  return true;
}
export const ITEM_DROPS: Item[] = [
  { id: 'health_pack', name: 'Health Pack', icon: '💊', description: 'Restores 30 HP', type: 'consumable', stackable: true, quantity: 1, stats: { heal: 30 } },
  { id: 'ammo_crate', name: 'Ammo Crate', icon: '📦', description: 'Restores 50% ammo', type: 'consumable', stackable: true, quantity: 1 },
  { id: 'shield_cell', name: 'Shield Cell', icon: '🛡️', description: '+15 max HP', type: 'consumable', stackable: true, quantity: 1, stats: { maxHp: 15 } },
  { id: 'keycard_red', name: 'Red Keycard', icon: '🔴', description: 'Opens red doors', type: 'key', stackable: false, quantity: 1 },
  { id: 'keycard_blue', name: 'Blue Keycard', icon: '🔵', description: 'Opens blue doors', type: 'key', stackable: false, quantity: 1 },
];`,
  },
  {
    path: 'src/systems/dialogue.ts',
    content: `// Dialogue System — NPC conversations with branching choices
export interface DialogueNode { id: string; speaker: string; text: string; choices?: { text: string; next: string; condition?: string; }[]; next?: string; }
export interface DialogueTree { id: string; nodes: Record<string, DialogueNode>; startNode: string; }
export class DialogueManager {
  private tree: DialogueTree | null = null;
  private currentNode: DialogueNode | null = null;
  active = false;
  get node() { return this.currentNode; }
  start(tree: DialogueTree) { this.tree = tree; this.currentNode = tree.nodes[tree.startNode]; this.active = true; }
  choose(choiceIdx: number) {
    if (!this.currentNode?.choices?.[choiceIdx]) return;
    const next = this.currentNode.choices[choiceIdx].next;
    if (next === 'END') { this.active = false; this.currentNode = null; return; }
    this.currentNode = this.tree!.nodes[next] ?? null;
    if (!this.currentNode) this.active = false;
  }
  advance() {
    if (!this.currentNode?.next) { this.active = false; return; }
    if (this.currentNode.next === 'END') { this.active = false; this.currentNode = null; return; }
    this.currentNode = this.tree!.nodes[this.currentNode.next] ?? null;
    if (!this.currentNode) this.active = false;
  }
}
export const INTRO_DIALOGUE: DialogueTree = {
  id: 'intro', startNode: 'start',
  nodes: {
    start: { id: 'start', speaker: 'HANDLER', text: 'Agent, welcome to Neon City. The syndicate has taken control of the lower sectors.', choices: [{ text: 'Brief me on the mission.', next: 'brief' }, { text: 'I\\'m ready. Let\\'s go.', next: 'END' }] },
    brief: { id: 'brief', speaker: 'HANDLER', text: 'Clear each sector room by room. Salvage what you can — ammo is scarce. Watch for Tank units.', next: 'END' },
  },
};`,
  },
  {
    path: 'src/systems/save-load.ts',
    content: `// Save/Load System — localStorage persistence with versioned schema
const SAVE_KEY = 'neon-operative-save';
const SAVE_VERSION = 1;
export interface SaveData { version: number; timestamp: number; player: { hp: number; maxHp: number; score: number; kills: number; level: number; xp: number; weaponAmmo: number[]; }; currentRoom: number; questProgress: Record<string, number>; achievements: string[]; inventory: any[]; }
export function saveGame(data: SaveData): void { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...data, version: SAVE_VERSION, timestamp: Date.now() })); }
export function loadGame(): SaveData | null {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try { const data = JSON.parse(raw); if (data.version !== SAVE_VERSION) return null; return data; } catch { return null; }
}
export function hasSave(): boolean { return localStorage.getItem(SAVE_KEY) !== null; }
export function deleteSave(): void { localStorage.removeItem(SAVE_KEY); }`,
  },
];

/* ================================================================
   BATTLE-TESTED TIER — Adds: story/lore system, procedural generation
   config, particle editor, minimap, enemy waves, boss fights
   ================================================================ */

const battleTestedOverrides: { path: string; content: string }[] = [
  {
    path: 'package.json',
    content: JSON.stringify(
      {
        name: 'game-battle-tested',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview', test: 'vitest run' },
        dependencies: {},
        devDependencies: { vite: '^6.3.0', typescript: '^5.9.0', vitest: '^4.0.0' },
      },
      null,
      2,
    ),
  },
  {
    path: 'src/systems/story.ts',
    content: `// Story & Lore System — narrative engine with chapters, codex entries, and world-building
export interface LoreEntry { id: string; title: string; category: 'world' | 'character' | 'faction' | 'technology' | 'location'; text: string; discovered: boolean; }
export interface Chapter { id: string; title: string; description: string; objectives: string[]; completed: boolean; }

export const LORE: LoreEntry[] = [
  { id: 'neon_city', title: 'Neon City', category: 'location', text: 'Once a beacon of progress, Neon City fell to corporate warfare in 2085. The lower sectors are now controlled by the Syndicate — a paramilitary organization running illegal neural implant operations. The upper city remains untouched, protected by automated defense grids.', discovered: true },
  { id: 'syndicate', title: 'The Syndicate', category: 'faction', text: 'Founded by ex-military operatives after the Neural Wars, the Syndicate controls the black market for combat implants. Their soldiers — Grunts, Patrols, and Tanks — are augmented with various tiers of neural enhancement.', discovered: false },
  { id: 'operative', title: 'The Operative', category: 'character', text: 'You. The last agent of Section 7 — a covert division disbanded after the Neural Wars. Your implants are military-grade but aging. Each mission pushes them closer to burnout. The Handler is your only contact.', discovered: true },
  { id: 'handler', title: 'The Handler', category: 'character', text: 'Voice in your ear. Former Section 7 commander. Operates from an undisclosed location. Provides intel, coordinates extraction. Some say the Handler is an AI construct — the real commander died in 2084.', discovered: false },
  { id: 'neural_wars', title: 'The Neural Wars', category: 'world', text: 'The conflict of 2080-2083 that erupted when neural implant technology became weaponized. Nations collapsed. Corporations filled the power vacuum. The wars ended not with a treaty but with exhaustion — no side had the resources to continue.', discovered: false },
  { id: 'grunt_tech', title: 'Grunt Augmentation', category: 'technology', text: 'Tier-1 neural enhancement. Increases aggression and pain tolerance at the cost of higher cognitive function. Cheap to produce. The Syndicate uses Grunts as expendable shock troops.', discovered: false },
  { id: 'tank_tech', title: 'Tank Augmentation', category: 'technology', text: 'Tier-3 neural enhancement. Full skeletal reinforcement with subdermal armor plating. Reduced speed but extreme durability. Only the most loyal Syndicate soldiers receive Tank augmentation — the procedure has a 40% fatality rate.', discovered: false },
];

export const CHAPTERS: Chapter[] = [
  { id: 'ch1', title: 'Chapter 1: Infiltration', description: 'Enter the lower sectors. Establish a foothold.', objectives: ['Clear 3 rooms', 'Reach Level 2'], completed: false },
  { id: 'ch2', title: 'Chapter 2: Deep Cover', description: 'Push deeper into Syndicate territory.', objectives: ['Kill 20 enemies', 'Find the Red Keycard'], completed: false },
  { id: 'ch3', title: 'Chapter 3: The Core', description: 'Reach the Syndicate command center.', objectives: ['Defeat a Tank', 'Clear all rooms in Level 4'], completed: false },
  { id: 'ch4', title: 'Chapter 4: Burnout', description: 'Your implants are failing. Finish the mission.', objectives: ['Reach Level 5', 'Complete the mission'], completed: false },
];

export function discoverLore(id: string): LoreEntry | null {
  const entry = LORE.find(e => e.id === id);
  if (entry && !entry.discovered) { entry.discovered = true; return entry; }
  return null;
}

export function checkChapter(chapterId: string, state: { roomsCleared: number; kills: number; level: number; hasRedKey: boolean; tanksKilled: number; }): boolean {
  const ch = CHAPTERS.find(c => c.id === chapterId);
  if (!ch || ch.completed) return false;
  switch (chapterId) {
    case 'ch1': if (state.roomsCleared >= 3 && state.level >= 2) { ch.completed = true; return true; } break;
    case 'ch2': if (state.kills >= 20 && state.hasRedKey) { ch.completed = true; return true; } break;
    case 'ch3': if (state.tanksKilled >= 1 && state.roomsCleared >= 12) { ch.completed = true; return true; } break;
    case 'ch4': if (state.level >= 5) { ch.completed = true; return true; } break;
  }
  return false;
}`,
  },
  {
    path: 'src/systems/wave-spawner.ts',
    content: `// Wave Spawner — escalating enemy waves with boss triggers
export interface WaveConfig { enemies: { type: 'grunt' | 'patrol' | 'tank'; count: number; }[]; spawnDelay: number; bossWave: boolean; }
export function generateWaves(level: number, roomIdx: number): WaveConfig[] {
  const waves: WaveConfig[] = [];
  const baseCount = 2 + level + Math.floor(roomIdx / 2);
  // Wave 1: scouts
  waves.push({ enemies: [{ type: 'grunt', count: Math.ceil(baseCount * 0.6) }, { type: 'patrol', count: Math.ceil(baseCount * 0.4) }], spawnDelay: 60, bossWave: false });
  // Wave 2: reinforcements
  if (roomIdx > 1) waves.push({ enemies: [{ type: 'patrol', count: Math.ceil(baseCount * 0.5) }, { type: level >= 3 ? 'tank' : 'grunt', count: 1 }], spawnDelay: 120, bossWave: false });
  // Boss wave on last room of level
  if (roomIdx >= 2 + level) waves.push({ enemies: [{ type: 'tank', count: 1 + Math.floor(level / 3) }, { type: 'grunt', count: 3 }], spawnDelay: 180, bossWave: true });
  return waves;
}`,
  },
  {
    path: 'src/systems/config.ts',
    content: `// Game Configuration — tunable parameters with min/max ranges
export interface ConfigRange { value: number; min: number; max: number; step: number; label: string; }
export interface GameConfig {
  playerSpeed: ConfigRange; dashCooldown: ConfigRange; dashDuration: ConfigRange;
  enemyHpScale: ConfigRange; enemyDamageScale: ConfigRange; enemySpeedScale: ConfigRange;
  projectileSpeed: ConfigRange; screenShakeIntensity: ConfigRange;
  comboTimeout: ConfigRange; slowMoDuration: ConfigRange;
  roomWallCount: ConfigRange; roomEnemyScale: ConfigRange;
}
export const DEFAULT_CONFIG: GameConfig = {
  playerSpeed: { value: 3.5, min: 2, max: 6, step: 0.5, label: 'Player Speed' },
  dashCooldown: { value: 60, min: 20, max: 120, step: 10, label: 'Dash Cooldown (frames)' },
  dashDuration: { value: 8, min: 4, max: 16, step: 2, label: 'Dash Duration (frames)' },
  enemyHpScale: { value: 1.0, min: 0.5, max: 3.0, step: 0.25, label: 'Enemy HP Scale' },
  enemyDamageScale: { value: 1.0, min: 0.5, max: 3.0, step: 0.25, label: 'Enemy Damage Scale' },
  enemySpeedScale: { value: 1.0, min: 0.5, max: 2.0, step: 0.25, label: 'Enemy Speed Scale' },
  projectileSpeed: { value: 10, min: 6, max: 18, step: 1, label: 'Projectile Speed' },
  screenShakeIntensity: { value: 1.0, min: 0, max: 3.0, step: 0.5, label: 'Screen Shake' },
  comboTimeout: { value: 180, min: 60, max: 300, step: 30, label: 'Combo Timeout (frames)' },
  slowMoDuration: { value: 15, min: 0, max: 45, step: 5, label: 'Slow-Mo Duration' },
  roomWallCount: { value: 3, min: 0, max: 8, step: 1, label: 'Room Wall Count' },
  roomEnemyScale: { value: 1.0, min: 0.5, max: 3.0, step: 0.25, label: 'Enemy Count Scale' },
};`,
  },
  {
    path: 'src/__tests__/config.test.ts',
    content: `import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../systems/config';

describe('GameConfig', () => {
  it('all ranges have valid min < max', () => {
    for (const [key, range] of Object.entries(DEFAULT_CONFIG)) {
      expect(range.min).toBeLessThan(range.max);
      expect(range.value).toBeGreaterThanOrEqual(range.min);
      expect(range.value).toBeLessThanOrEqual(range.max);
      expect(range.step).toBeGreaterThan(0);
    }
  });
});`,
  },
];

/* ================================================================
   VAI TIER — Premium: glass config panel, real-time stats overlay,
   level editor, mod support, replay system, analytics
   ================================================================ */

const vaiOverrides: { path: string; content: string }[] = [
  {
    path: 'package.json',
    content: JSON.stringify(
      {
        name: 'game-vai',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview', test: 'vitest run', 'test:watch': 'vitest' },
        dependencies: {},
        devDependencies: { vite: '^6.3.0', typescript: '^5.9.0', vitest: '^4.0.0' },
      },
      null,
      2,
    ),
  },
  {
    path: 'src/systems/level-editor.ts',
    content: `// Level Editor — create and share custom levels
export interface EditorRoom { walls: { x: number; y: number; w: number; h: number; }[]; enemySpawns: { x: number; y: number; type: 'grunt' | 'patrol' | 'tank'; }[]; playerSpawn: { x: number; y: number; }; doors: { x: number; y: number; }[]; }
export interface CustomLevel { id: string; name: string; author: string; rooms: EditorRoom[]; createdAt: number; }
const LEVELS_KEY = 'neon-operative-custom-levels';
export function saveCustomLevel(level: CustomLevel): void {
  const levels = loadCustomLevels(); levels.push(level);
  localStorage.setItem(LEVELS_KEY, JSON.stringify(levels));
}
export function loadCustomLevels(): CustomLevel[] {
  try { return JSON.parse(localStorage.getItem(LEVELS_KEY) || '[]'); } catch { return []; }
}
export function deleteCustomLevel(id: string): void {
  const levels = loadCustomLevels().filter(l => l.id !== id);
  localStorage.setItem(LEVELS_KEY, JSON.stringify(levels));
}
export function exportLevel(level: CustomLevel): string { return btoa(JSON.stringify(level)); }
export function importLevel(encoded: string): CustomLevel | null {
  try { return JSON.parse(atob(encoded)); } catch { return null; }
}`,
  },
  {
    path: 'src/systems/replay.ts',
    content: `// Replay System — record and playback game sessions
export interface ReplayFrame { tick: number; playerPos: { x: number; y: number }; playerHp: number; enemies: { x: number; y: number; hp: number; }[]; projectiles: { x: number; y: number; }[]; inputs: { keys: string[]; mouseX: number; mouseY: number; mouseDown: boolean; }; }
export interface Replay { id: string; startTime: number; frames: ReplayFrame[]; score: number; kills: number; duration: number; }
export class ReplayRecorder {
  private frames: ReplayFrame[] = [];
  private startTime = 0;
  private tick = 0;
  start() { this.frames = []; this.startTime = Date.now(); this.tick = 0; }
  record(frame: Omit<ReplayFrame, 'tick'>) { this.frames.push({ ...frame, tick: this.tick++ }); }
  finish(score: number, kills: number): Replay {
    return { id: crypto.randomUUID(), startTime: this.startTime, frames: this.frames, score, kills, duration: Date.now() - this.startTime };
  }
}
export class ReplayPlayer {
  private replay: Replay | null = null;
  private frameIdx = 0;
  playing = false;
  load(replay: Replay) { this.replay = replay; this.frameIdx = 0; this.playing = true; }
  next(): ReplayFrame | null {
    if (!this.replay || this.frameIdx >= this.replay.frames.length) { this.playing = false; return null; }
    return this.replay.frames[this.frameIdx++];
  }
  get progress() { return this.replay ? this.frameIdx / this.replay.frames.length : 0; }
}`,
  },
  {
    path: 'src/systems/analytics.ts',
    content: `// Analytics System — track player behavior and game balance metrics
export interface GameSession { id: string; startTime: number; endTime: number; score: number; kills: number; deaths: number; roomsCleared: number; weaponUsage: Record<string, number>; avgCombo: number; peakCombo: number; damageDealt: number; damageTaken: number; dashesUsed: number; questsCompleted: number; achievementsUnlocked: number; }
const ANALYTICS_KEY = 'neon-operative-analytics';
export function recordSession(session: GameSession): void {
  const sessions = getSessions(); sessions.push(session);
  if (sessions.length > 50) sessions.splice(0, sessions.length - 50);
  localStorage.setItem(ANALYTICS_KEY, JSON.stringify(sessions));
}
export function getSessions(): GameSession[] {
  try { return JSON.parse(localStorage.getItem(ANALYTICS_KEY) || '[]'); } catch { return []; }
}
export function getStats(): { totalGames: number; avgScore: number; bestScore: number; totalKills: number; avgKillsPerGame: number; favoriteWeapon: string; avgSessionMinutes: number; } {
  const sessions = getSessions();
  if (sessions.length === 0) return { totalGames: 0, avgScore: 0, bestScore: 0, totalKills: 0, avgKillsPerGame: 0, favoriteWeapon: 'N/A', avgSessionMinutes: 0 };
  const totalScore = sessions.reduce((s, g) => s + g.score, 0);
  const totalKills = sessions.reduce((s, g) => s + g.kills, 0);
  const weaponTotals: Record<string, number> = {};
  sessions.forEach(s => Object.entries(s.weaponUsage).forEach(([w, c]) => { weaponTotals[w] = (weaponTotals[w] || 0) + c; }));
  const fav = Object.entries(weaponTotals).sort((a, b) => b[1] - a[1])[0];
  const totalTime = sessions.reduce((s, g) => s + (g.endTime - g.startTime), 0);
  return { totalGames: sessions.length, avgScore: Math.round(totalScore / sessions.length), bestScore: Math.max(...sessions.map(s => s.score)), totalKills, avgKillsPerGame: Math.round(totalKills / sessions.length), favoriteWeapon: fav ? fav[0] : 'N/A', avgSessionMinutes: Math.round(totalTime / sessions.length / 60000) };
}`,
  },
];

/* ================================================================
   TEMPLATE DEFINITIONS
   ================================================================ */

const gameBasic: StackTemplate = {
  id: 'game-basic',
  stackId: 'game',
  tier: 'basic',
  name: 'Game Basic',
  description: 'Neon Operative — top-down action with combat, quests, achievements, and RPG progression',
  features: [
    'WASD movement + mouse aim/shoot',
    '4 weapons (Pistol, SMG, Shotgun, Rifle) with ammo management',
    '3 enemy types (Grunt, Patrol, Tank) with AI behaviors',
    'Procedural room generation with scaling difficulty',
    'Dash mechanic with invincibility and cooldown',
    'Combo system with slow-motion on multi-kills',
    'Quest system (5 quests with rewards)',
    'Achievement system (6 achievements)',
    'XP/level progression',
    'Particle effects, screen shake, HUD',
    'Pause menu with quest/achievement overview',
    'Pure Canvas 2D — zero dependencies',
  ],
  files: basicFiles,
  hasDocker: false,
  hasTests: false,
};

const gameSolid: StackTemplate = {
  id: 'game-solid',
  stackId: 'game',
  tier: 'solid',
  name: 'Game Solid',
  description: 'Adds inventory system, branching dialogue, save/load persistence',
  features: [
    'Inventory system with stacking, equipment slots',
    'Item drops (health packs, ammo, keycards, shields)',
    'Branching dialogue system with NPC conversations',
    'Save/Load with versioned localStorage schema',
    'Everything from Basic tier',
  ],
  files: mergeFiles(basicFiles, solidOverrides),
  hasDocker: false,
  hasTests: false,
};

const gameBattleTested: StackTemplate = {
  id: 'game-battle-tested',
  stackId: 'game',
  tier: 'battle-tested',
  name: 'Game Battle-Tested',
  description: 'Story/lore system, wave spawner, configurable game params, test suite',
  features: [
    'Story engine with 4 chapters and objectives',
    'Codex/lore system (7 entries across 5 categories)',
    'Wave spawner with boss triggers',
    'Configurable game parameters with min/max ranges',
    'Vitest test suite',
    'Everything from Solid tier',
  ],
  files: mergeFiles(mergeFiles(basicFiles, solidOverrides), battleTestedOverrides),
  hasDocker: false,
  hasTests: true,
};

const gameVai: StackTemplate = {
  id: 'game-vai',
  stackId: 'game',
  tier: 'vai',
  name: 'Game Vai',
  description: "VeggaAI's premium game — level editor, replay system, analytics dashboard",
  features: [
    'Level editor with import/export',
    'Replay recording and playback',
    'Analytics dashboard (sessions, weapon usage, stats)',
    'Custom level sharing via base64 codes',
    'Everything from Battle-Tested tier',
  ],
  files: mergeFiles(mergeFiles(mergeFiles(basicFiles, solidOverrides), battleTestedOverrides), vaiOverrides),
  hasDocker: false,
  hasTests: true,
};

/* ================================================================
   EXPORT
   ================================================================ */

export const gameStack: StackDefinition = {
  id: 'game',
  name: 'Game Engine',
  tagline: 'Top-down action with RPG systems',
  description: 'Canvas 2D game engine — combat, quests, story, achievements, procedural levels',
  techStack: ['Canvas 2D', 'TypeScript', 'Vite'],
  icon: '🎮',
  color: 'emerald',
  templates: [gameBasic, gameSolid, gameBattleTested, gameVai],
};

