'use strict';

/*
  Submarine Battle — Fixed-size subs + stable growth + always-visible torpedoes
  - 120s timer
  - Background image (assets/backgrounds/ocean_bg.jpg)
  - Mini-map (top-right)
  - Buttons: Start, Pause/Resume, Sound toggle, End, Fire
  - HP bars: HP = level * 3; torpedo deals 1 dmg
  - Two pickups: normal (+1 point) and super (+2 levels, no size change), super pool halved
  - HERO/ENEMY sizes fixed: Hero 256×128, Enemy 224×112 (no scale with level/boost)
  - Torpedoes drawn ON TOP so they’re visible even when close
  - Joystick visible only while playing & never starts over UI/buttons
  - End Game returns to main screen; messages: “You are defeated!” / “Time’s up!”
  - On enemy death: drop a cache of normal + occasional super bubbles
  - Growth curve slower (levels require more points), bubbles smaller
*/

/* ==============================
   DOM + CANVAS
============================== */

const timerSelect = document.getElementById('timerSelect');


const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const VIEW_W = canvas.width;
const VIEW_H = canvas.height;

const WORLD_W = 6000;
const WORLD_H = 4000;

const camera = { x: 0, y: 0 };

// HUD / UI
const $ = (id) => document.getElementById(id);
const elTimer = $('timer');
const elLevel = $('level');
const elSize  = $('size');
const elEnemyCount = $('enemyCount');

const overlay = $('overlay');
const startBtnOverlay = $('startBtn');

const resultOverlay = $('result');
const restartBtn = $('restartBtn');
const resultTitle = $('resultTitle');
const resultSummary = $('resultSummary');

const minimapWrap = $('minimapWrap');
const minimap = $('minimap');
const mctx = minimap.getContext('2d');

const btnStart = $('btnStart');
const btnPause = $('btnPause');
const btnSound = $('btnSound');
const btnEnd   = $('btnEnd');
const btnFire  = $('btnFire');

const hudEl = $('hud');
const hudButtonsEl = $('hudButtons');

/* ==============================
   ASSETS
============================== */
const imgHero    = loadImage('assets/sprites/hero_sub.png');      // faces LEFT by default
const imgEnemy   = loadImage('assets/sprites/enemy_sub.png');     // faces LEFT by default
const imgPoint   = loadImage('assets/sprites/bubble_point.png');  // smaller now
const imgPointSuper = loadImage('assets/sprites/bubble_point_super.png'); // smaller now
const imgTile    = loadImage('assets/sprites/ocean_tile.png');
const imgBG      = loadImage('assets/backgrounds/ocean_bg.jpg');
const imgTorpedo = loadImage('assets/sprites/torpedo.png');       // faces RIGHT by default

/* ==============================
   AUDIO (optional)
============================== */
const sfx = {
  move:    makeAudio('assets/sfx/move.wav',    { loop: true }),
  shoot:   makeAudio('assets/sfx/shoot.wav'),
  destroy: makeAudio('assets/sfx/destroy.wav'),
};
const music = {
  bgm:     makeAudio('assets/music/bgm.mp3',   { loop: true }),
  victory: makeAudio('assets/music/victory.mp3'),
  defeat:  makeAudio('assets/music/defeat.mp3'),
};
let audioUnlocked = false;
let audioMuted = false;

function unlockAudio() {
  if (audioUnlocked) return;
  const all = [sfx.move, sfx.shoot, sfx.destroy, music.bgm, music.victory, music.defeat].filter(Boolean);
  for (const a of all) {
    try { a.muted = true; a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(()=>{}); } catch {}
  }
  audioUnlocked = true;
}
function setMuteAll(mute) {
  audioMuted = mute;
  const all = [sfx.move, sfx.shoot, sfx.destroy, music.bgm, music.victory, music.defeat].filter(Boolean);
  for (const a of all) a.muted = mute;
  btnSound.textContent = mute ? 'Sound: Off' : 'Sound: On';
}

/* ==============================
   INPUT + JOYSTICK
============================== */
const keys = new Set();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  keys.add(k);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
function isDown(k){ return keys.has(k) || keys.has(k.toLowerCase()); }

let joystick = { active:false, id:null, startX:0, startY:0, dx:0, dy:0, show:false };
function getForbiddenRects() {
  const rects = [];
  for (const el of [hudEl, hudButtonsEl, minimapWrap, btnFire]) {
    if (!el) continue;
    const r = el.getBoundingClientRect();
    rects.push(r);
  }
  return rects;
}
function inForbidden(x, y) { return getForbiddenRects().some(r => x>=r.left && x<=r.right && y>=r.top && y<=r.bottom); }
function pointerId(e) { if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0].identifier; return 'mouse'; }
function getXY(e) { if (e.changedTouches && e.changedTouches[0]) { const t=e.changedTouches[0]; return {x:t.clientX,y:t.clientY}; } return {x:e.clientX,y:e.clientY}; }

function onTouchStart(e) {
  if (!running) return;
  const { x, y } = getXY(e);

  // ✅ Don't activate joystick on UI or right side (fire button area)
  if (inForbidden(x, y)) return;

const screenMid = window.innerWidth * 0.4;

  // ✅ Only allow joystick activation on the left half of the screen
  if (x < screenMid && !joystick.active) {
    joystick = {
      active: true,
      id: pointerId(e),
      startX: x,
      startY: y,
      dx: 0,
      dy: 0,
      show: true
    };
  }
}

function onTouchMove(e) {
  if (!joystick.active || !running) return;
  const { x, y } = getXY(e);
  joystick.dx = x - joystick.startX;
  joystick.dy = y - joystick.startY;
}
function onTouchEnd() { joystick.active=false; joystick.id=null; joystick.dx=0; joystick.dy=0; joystick.show=false; }

canvas.addEventListener('touchstart', onTouchStart, { passive: true });
canvas.addEventListener('touchmove',  onTouchMove,  { passive: true });
canvas.addEventListener('touchend',   onTouchEnd,   { passive: true });
canvas.addEventListener('touchcancel',onTouchEnd,   { passive: true });
// ✅ Prevent page scroll but still allow multitouch (joystick + fire button)
window.addEventListener('touchmove', (e) => {
  // Only prevent scrolling when the user is interacting with the canvas itself
  if (running && e.target === canvas) {
    e.preventDefault();
  }
}, { passive: false });

/* ==============================
   UTIL
============================== */
function rand(min,max){ return Math.random()*(max-min)+min; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function nearest(list, x,y){ let best=null, bd=1e9; for (const it of list){ const d=(it.cx-x)**2+(it.cy-y)**2; if (d<bd){ bd=d; best=it; } } return best; }
function loadImage(src){ const i=new Image(); i.src=src; return i; }
function makeAudio(src, opts){ try { const a=new Audio(src); if (opts?.loop) a.loop=true; return a; } catch { return null; } }

/* ==============================
   FIXED SIZES & BUBBLE TUNING
============================== */
const BASE = {
  HERO_W: 256, HERO_H: 128,   // fixed
  ENE_W:  224, ENE_H:  112,   // fixed
  TORP_W: 96,  TORP_H: 32,
  PNT_W:  40,  PNT_H:  40,    // smaller normal bubble
  SPNT_W: 80,  SPNT_H: 80,    // smaller super bubble
};
const LEVEL_POINTS = 12;       // slower growth: +1 level per 12 points
const TARGET_POINTS = 260;     // keep plenty of normals
const TARGET_SUPER  = 5;       // half of 10

/* ==============================
   ENTITIES
============================== */
class Entity {
  constructor(x,y,w,h){ this.x=x; this.y=y; this.w=w; this.h=h; this.vx=0; this.vy=0; this.dead=false; }
  get cx(){ return this.x + this.w/2; }
  get cy(){ return this.y + this.h/2; }
  intersects(o){ return !(this.x+this.w < o.x || this.x > o.x+o.w || this.y+this.h < o.y || this.y > o.y+o.h); }
}

class Point extends Entity {
  constructor(x,y){ super(x,y,BASE.PNT_W,BASE.PNT_H); this.type = 'normal'; }
  draw(){
    const sx = this.x - camera.x; const sy = this.y - camera.y;
    if (imgPoint && imgPoint.complete && imgPoint.naturalWidth) {
      ctx.drawImage(imgPoint, sx, sy, this.w, this.h);
    } else {
      ctx.save(); ctx.translate(sx+this.w/2, sy+this.h/2);
      ctx.fillStyle = '#5df2ff'; ctx.shadowColor = '#5df2ff'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(0,0,this.w*0.38,0,Math.PI*2); ctx.fill(); ctx.restore();
    }
  }
}
class SuperPoint extends Entity {
  constructor(x,y){ super(x,y,BASE.SPNT_W,BASE.SPNT_H); this.type = 'super'; }
  draw(){
    const sx = this.x - camera.x; const sy = this.y - camera.y;
    if (imgPointSuper && imgPointSuper.complete && imgPointSuper.naturalWidth) {
      ctx.drawImage(imgPointSuper, sx, sy, this.w, this.h);
    } else {
      ctx.save(); ctx.translate(sx+this.w/2, sy+this.h/2);
      ctx.fillStyle = '#b0ff5d'; ctx.shadowColor = '#b0ff5d'; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(0,0,this.w*0.38,0,Math.PI*2); ctx.fill(); ctx.restore();
    }
  }
}

class Torpedo extends Entity {
  constructor(owner, x,y, dir){ super(x,y,BASE.TORP_W,BASE.TORP_H); this.owner=owner; this.dir = dir; const speed=12; this.vx = dir*speed; this.life=210; }
  update(){ this.x+=this.vx; this.life--; if (this.life<=0) this.dead=true; }
  draw(){
    const sx=this.x-camera.x, sy=this.y-camera.y;
    ctx.save();
    if (imgTorpedo && imgTorpedo.complete && imgTorpedo.naturalWidth) {
      // Torpedo faces RIGHT by default; flip for left shots.
      ctx.translate(sx + this.w/2, sy + this.h/2);
      ctx.scale(this.dir >= 0 ? 1 : -1, 1);
      ctx.drawImage(imgTorpedo, -this.w/2, -this.h/2, this.w, this.h);
    } else {
      ctx.fillStyle='#ffcc66'; ctx.fillRect(sx,sy,this.w,this.h);
    }
    ctx.restore();
  }
}

class Submarine extends Entity {
  constructor(x,y,isPlayer=false){
    const baseW = isPlayer?BASE.HERO_W:BASE.ENE_W; const baseH = isPlayer?BASE.HERO_H:BASE.ENE_H;
    super(x,y,baseW,baseH);
    this.isPlayer = isPlayer;
    this.level = 1;
    this.score = 0;
    this.facing = -1; // default left
    this.speed = isPlayer ? 5.0 : 3.8; // hero faster
    this.fireCooldown = 0;
    this.invul = 0;
    this.hp = this.maxHP;
  }
  get baseW(){ return this.isPlayer?BASE.HERO_W:BASE.ENE_W; }
  get baseH(){ return this.isPlayer?BASE.HERO_H:BASE.ENE_H; }
  get maxHP(){ return this.level * 3; }
  // FIXED SIZE: no sizeScale, width/height stay constant

  grow(){
    const prev = this.level;
    // Level increases more slowly
    this.level = Math.max(1, 1 + Math.floor(this.score / LEVEL_POINTS));
    if (this.level > prev) this.hp = this.maxHP;
    if (this.isPlayer && this.level > prev) flashes.push({ text: `Level ${this.level}!`, t: 90 });
  }

  applySuper(){
    // Super bubble: +2 levels (no size change)
    const prev = this.level;
    this.level = Math.min(this.level + 2, 99);
    if (this.level > prev) this.hp = this.maxHP;
    if (this.isPlayer) flashes.push({ text: `Mega Power!`, t: 100 });
  }

  takeDamage(dmg){
    if (this.invul > 0) return false;
    this.hp -= dmg;
    if (this.hp <= 0){ this.dead = true; }
    return this.dead;
  }

  update(){
    if (this.isPlayer){
      let movx = 0, movy = 0;
      if (isDown('arrowleft')||isDown('a')) movx -= 1;
      if (isDown('arrowright')||isDown('d')) movx += 1;
      if (isDown('arrowup')||isDown('w')) movy -= 1;
      if (isDown('arrowdown')||isDown('s')) movy += 1;

      // Joystick movement (normalized, deadzone)
      if (joystick.active) {
        const dx = joystick.dx, dy = joystick.dy;
        const mag = Math.hypot(dx, dy);
        if (mag > 10) { movx = dx/mag; movy = dy/mag; } else { movx=0; movy=0; }
      }

      const moving = movx||movy;
      if (moving) {
        const len = Math.hypot(movx,movy)||1; movx/=len; movy/=len;
        this.vx = movx * this.speed; this.vy = movy * this.speed;
        if (sfx.move && sfx.move.paused && !audioMuted) sfx.move.play().catch(()=>{});
      } else {
        this.vx *= 0.9; this.vy *= 0.9; if (sfx.move && !sfx.move.paused) sfx.move.pause();
      }

      if (Math.abs(this.vx) > 0.05) this.facing = (this.vx >= 0) ? 1 : -1;

      if ((isDown(' ') || isDown('space')) && this.fireCooldown<=0){
        fire(this);
        this.fireCooldown = 16;
      }
      this.fireCooldown = Math.max(0, this.fireCooldown-1);
    } else {
      // Enemy AI: seek nearest point; sometimes shoot
      const pt = nearest(points, this.cx, this.cy);
      if (pt){
        const dx = pt.cx - this.cx, dy = pt.cy - this.cy;
        const len = Math.hypot(dx,dy)||1;
        this.vx = (dx/len)*this.speed*0.9; this.vy = (dy/len)*this.speed*0.9;
        this.facing = (dx>=0)?1:-1;
      }
      if (player && this.fireCooldown<=0){
        if (Math.abs(player.cy - this.cy) < 70){
          const dir = (player.cx > this.cx)?1:-1; fire(this, dir);
          this.fireCooldown = 70 + Math.random()*60;
        }
      } else {
        this.fireCooldown = Math.max(0,this.fireCooldown-1);
      }
    }

    this.x += this.vx; this.y += this.vy;
    this.x = clamp(this.x, 0, WORLD_W - this.w);
    this.y = clamp(this.y, 0, WORLD_H - this.h);
    if (this.invul > 0) this.invul--;
  }

  draw(){
    const sx = this.x - camera.x, sy = this.y - camera.y;
    const img = this.isPlayer ? imgHero : imgEnemy;

    // Sub sprite: default LEFT; flip when moving RIGHT
    ctx.save();
    ctx.translate(sx + this.w/2, sy + this.h/2);
    ctx.scale(this.facing, 1);
    if (img && img.complete && img.naturalWidth){
      ctx.globalAlpha = (this.invul>0 && this.isPlayer) ? (0.5 + 0.5*Math.sin(this.invul/3)) : 1;
      ctx.drawImage(img, -this.w/2, -this.h/2, this.w, this.h);
    } else {
      ctx.fillStyle = this.isPlayer? '#7dd3fc' : '#fca5a5';
      ctx.strokeStyle = '#01232f'; ctx.lineWidth=3;
      ctx.fillRect(-this.w/2, -this.h*0.25, this.w, this.h*0.5);
      ctx.strokeRect(-this.w/2, -this.h*0.25, this.w, this.h*0.5);
    }
    ctx.restore();

    // HP bar (above head)
    const barW = Math.max(60, this.w * 0.5);
    const barH = 10;
    const pct = clamp(this.hp / this.maxHP, 0, 1);
    const bx = sx + (this.w - barW)/2;
    const by = sy - 18;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = this.isPlayer ? '#7dfc7d' : '#ff8e8e'; ctx.fillRect(bx, by, barW * pct, barH);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.strokeRect(bx, by, barW, barH);

    // Level text above HP bar
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = this.isPlayer ? `Lv ${this.level}` : `Lv ${this.level}`;
    ctx.fillText(label, sx + this.w/2, by - 6);
  }
}

function fire(owner, forcedDir){
  if (sfx.shoot && !audioMuted) { sfx.shoot.currentTime = 0; sfx.shoot.play().catch(()=>{}); }
  const dir = forcedDir ?? (owner.facing>=0?1:-1);
  const x = owner.cx + dir*(owner.w/2 - 10);
  const y = owner.cy - BASE.TORP_H/2;
  torpedoes.push(new Torpedo(owner, x, y, dir));
}

/* ==============================
   GAME STATE
============================== */
let player; let enemies=[]; let points=[]; let torpedoes=[]; let flashes=[];
let running=false; let timeLeft=120; let timerAcc=0;

function spawnPoint(){ points.push(new Point(rand(0, WORLD_W-BASE.PNT_W), rand(0, WORLD_H-BASE.PNT_H))); }
function spawnSuperPoint(){ points.push(new SuperPoint(rand(0, WORLD_W-BASE.SPNT_W), rand(0, WORLD_H-BASE.SPNT_H))); }
function currentSuperCount(){ return points.filter(p => p instanceof SuperPoint && !p.dead).length; }

function spawnDeathDrops(cx, cy){
  // Drop a generous cache of normals + a chance of super
  for (let i=0;i<10;i++) points.push(new Point(cx+rand(-220,220), cy+rand(-220,220)));
  if (currentSuperCount() < TARGET_SUPER && Math.random() < 0.7) {
    points.push(new SuperPoint(cx+rand(-180,180), cy+rand(-180,180)));
  }
}

function resetGame(){
  player = new Submarine(WORLD_W/2-BASE.HERO_W/2, WORLD_H/2-BASE.HERO_H/2, true);
  enemies = [];
  for (let i=0;i<7;i++) enemies.push(new Submarine(rand(0,WORLD_W-BASE.ENE_W), rand(0,WORLD_H-BASE.ENE_H), false));
  points = [];
  for (let i=0;i<TARGET_POINTS;i++) spawnPoint();
  for (let i=0;i<TARGET_SUPER; i++) spawnSuperPoint();
  torpedoes = []; flashes = [];
  timeLeft = 120; timerAcc = 0; running = false;
  updateUI();
}

function updateUI(){
  elLevel.textContent = String(player.level);
  elSize.textContent = `1.0x`; // fixed size
  elEnemyCount.textContent = String(enemies.length);
  elTimer.textContent = String(Math.max(0, Math.ceil(timeLeft)));
}

function startGame() {
  unlockAudio(); // prime all sounds
  timeLeft = parseInt(timerSelect?.value || 120, 10);
  running = true;
  overlay.classList.remove('show');
  btnPause.textContent = 'Pause';

  // ✅ Small delay lets browsers register the user gesture first
  setTimeout(() => {
    if (music.bgm) {
      try {
        music.bgm.currentTime = 0;
        if (!audioMuted) {
          music.bgm.play().then(() => {
            console.log('BGM started successfully');
          }).catch((err) => {
            console.warn('Autoplay blocked, waiting for next touch', err);
            const resumeAudio = () => {
              if (!audioMuted) {
                music.bgm.play().catch(()=>{});
              }
              document.body.removeEventListener('click', resumeAudio);
              document.body.removeEventListener('touchstart', resumeAudio);
            };
            document.body.addEventListener('click', resumeAudio, { once: true });
            document.body.addEventListener('touchstart', resumeAudio, { once: true });
          });
        }
      } catch (err) {
        console.warn('BGM start error', err);
      }
    }
  }, 100);
}

function pauseGame() {
  running = false;
  if (sfx.move && !sfx.move.paused) sfx.move.pause();

  // ✅ Pause only if BGM is actually playing
  if (music.bgm && !music.bgm.paused) {
    music.bgm.pause();
  }

  btnPause.textContent = 'Resume';
}

function resumeGame() {
  running = true;
  if (sfx.move && !audioMuted) sfx.move.play().catch(()=>{});

  // ✅ Resume music only if not muted
  if (music.bgm && audioUnlocked && !audioMuted) {
    music.bgm.play().catch(()=>{});
  }

  btnPause.textContent = 'Pause';
}

function endGame(msg) {
  running = false;

  // ✅ Stop move sound & music fully
  if (sfx.move && !sfx.move.paused) sfx.move.pause();
  if (music.bgm) {
    music.bgm.pause();
    music.bgm.currentTime = 0; // reset
  }

  const topLvl = enemies.reduce((m,e)=>Math.max(m,e.level),0);
  resultTitle.textContent = msg;
  resultSummary.textContent = `Your Level: ${player.level} • Top Enemy Level: ${topLvl} • Enemies Remaining: ${enemies.length}`;
  resultOverlay.classList.remove('hidden');
  resultOverlay.classList.add('show');
}

/* ==============================
   BUTTONS / UI EVENTS
============================== */
startBtnOverlay.addEventListener('click', () => { resetGame(); startGame(); });
btnStart.addEventListener('click', () => { resetGame(); startGame(); });

btnPause.addEventListener('click', () => { if (running) pauseGame(); else resumeGame(); });
btnSound.addEventListener('click', () => { setMuteAll(!audioMuted); });
btnEnd.addEventListener('click', () => {
  // End immediately to main menu
  pauseGame();
  resultOverlay.classList.add('hidden'); resultOverlay.classList.remove('show');
  overlay.classList.add('show');
});
btnFire.addEventListener('click', () => {
  if (!player || !running) return;
  if (player.fireCooldown<=0) { fire(player); player.fireCooldown = 16; }
});
restartBtn.addEventListener('click', () => {
  resultOverlay.classList.add('hidden'); resultOverlay.classList.remove('show');
  overlay.classList.add('show');
});

/* ==============================
   MAIN LOOP
============================== */
let last = performance.now();
function loop(now){
  const dt = Math.min(33, now-last); last = now;
  requestAnimationFrame(loop);

  if (running){
    timerAcc += dt/1000;
    if (timerAcc >= 1){
      timeLeft -= Math.floor(timerAcc);
      timerAcc -= Math.floor(timerAcc);
      if (timeLeft <= 0) endGame("Time’s up!");
    }
  }

  update(dt);
  draw();
}
requestAnimationFrame(loop);

/* ==============================
   UPDATE & DRAW
============================== */
function update(_dt){
  if (!player) return;
  if (!running){ updateUI(); return; }

  player.update();
  for (const e of enemies) e.update();
  for (const t of torpedoes) t.update();

  // Torpedo hits
  for (const t of torpedoes){
    if (t.dead) continue;
    const targets = t.owner.isPlayer ? enemies : [player];
    for (const target of targets){
      if (!target.dead && t.intersects(target)){
        t.dead = true;
        const died = target.takeDamage(1);
        if (died){
          if (sfx.destroy && !audioMuted) { sfx.destroy.currentTime=0; sfx.destroy.play().catch(()=>{}); }
          target.dead = true;
          if (!target.isPlayer){
            enemies = enemies.filter(e=>!e.dead);
            t.owner.score += 2; t.owner.grow();
            spawnDeathDrops(target.cx, target.cy);  // drop normal + maybe super
            if (enemies.length===0) return endGame('Victory!');
          } else {
            return endGame('You are defeated!');
          }
        }
        break;
      }
    }
  }

  // Collect points
  for (const p of points){
    if (p.dead) continue;
    const who = [player, ...enemies];
    for (const s of who){
      if (s.intersects(p)){
        p.dead = true;
        if (p.type === 'normal'){ s.score += 1; s.grow(); }
        else if (p.type === 'super'){ s.applySuper(); }
        break;
      }
    }
  }

  // Cleanup/respawn pools
  points = points.filter(p=>!p.dead);
  torpedoes = torpedoes.filter(t=>!t.dead);

  // Keep pools topped up (super capped)
  while (points.filter(p=>p.type==='normal').length < TARGET_POINTS) spawnPoint();
  while (points.filter(p=>p.type==='super').length < TARGET_SUPER) spawnSuperPoint();

  // Camera follow
  camera.x = clamp(player.cx - VIEW_W/2, 0, WORLD_W - VIEW_W);
  camera.y = clamp(player.cy - VIEW_H/2, 0, WORLD_H - VIEW_H);

  // UI + flashes
  updateUI();
  for (const f of flashes){ f.t--; }
  flashes = flashes.filter(f=>f.t>0);
}

function drawBackground() {
  // Background image first
  if (imgBG && imgBG.complete && imgBG.naturalWidth){
    ctx.drawImage(imgBG, -camera.x, -camera.y, WORLD_W, WORLD_H);
  } else if (imgTile && imgTile.complete && imgTile.naturalWidth) {
    const tile = 512;
    const startX = Math.floor(camera.x / tile) * tile;
    const startY = Math.floor(camera.y / tile) * tile;
    for (let y = startY; y < camera.y + VIEW_H + tile; y += tile) {
      for (let x = startX; x < camera.x + VIEW_W + tile; x += tile) {
        ctx.drawImage(imgTile, x - camera.x, y - camera.y, tile, tile);
      }
    }
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#02263a'); g.addColorStop(1, '#001a28');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

function draw(){
  if (!player) return;
  ctx.clearRect(0,0,VIEW_W,VIEW_H);
  drawBackground();

  // Points
  for (const p of points) p.draw();

  // Submarines
  for (const e of enemies) e.draw();
  player.draw();

  // Torpedoes ON TOP so they are always visible even when close
  for (const t of torpedoes) t.draw();

  // Flashes (UI text)
  for (const f of flashes){
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, f.t/30));
    ctx.fillStyle='#fff';
    ctx.font='bold 30px system-ui, sans-serif';
    ctx.textAlign='center';
    ctx.fillText(f.text, VIEW_W/2, 70);
    ctx.restore();
  }

  drawMiniMap();
  drawJoystick();
}

/* ==============================
   MINIMAP
============================== */
function drawMiniMap(){
  if (!mctx || !minimap) return;
  const MW = minimap.width, MH = minimap.height;

  mctx.clearRect(0,0,MW,MH);
  mctx.fillStyle = 'rgba(0,20,30,0.9)';
  mctx.fillRect(0,0,MW,MH);

  mctx.strokeStyle = 'rgba(93,242,255,0.5)';
  mctx.lineWidth = 2;
  mctx.strokeRect(4,4, MW-8, MH-8);

  const scaleX = (MW-8) / WORLD_W;
  const scaleY = (MH-8) / WORLD_H;

  // Camera rect
  const vx = 4 + camera.x * scaleX;
  const vy = 4 + camera.y * scaleY;
  const vw = VIEW_W * scaleX;
  const vh = VIEW_H * scaleY;
  mctx.strokeStyle = 'rgba(255,255,255,0.6)';
  mctx.lineWidth = 1;
  mctx.strokeRect(vx, vy, vw, vh);

  // Enemies
  for (const e of enemies) {
    const ex = 4 + e.cx * scaleX;
    const ey = 4 + e.cy * scaleY;
    mctx.fillStyle = 'rgba(252,165,165,0.9)';
    mctx.fillRect(ex-2, ey-2, 4, 4);
  }

  // Player
  const px = 4 + player.cx * scaleX;
  const py = 4 + player.cy * scaleY;
  mctx.fillStyle = 'rgba(125,211,252,0.95)';
  mctx.beginPath(); mctx.arc(px, py, 3, 0, Math.PI*2); mctx.fill();
}

/* ==============================
   JOYSTICK RENDER
============================== */
function drawJoystick(){
  if (!running || !joystick.show) return;
  const rect = canvas.getBoundingClientRect();
  const baseX = joystick.startX - rect.left;
  const baseY = joystick.startY - rect.top;
  const curX  = baseX + joystick.dx;
  const curY  = baseY + joystick.dy;

  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = 'rgba(93,242,255,0.15)';
  ctx.strokeStyle = 'rgba(93,242,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(baseX, baseY, 60, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(curX,  curY,  34, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

/* ==============================
   INIT (Fixed Window)
============================== */

// ✅ Lock the canvas size once — same on all devices
canvas.width = 1280;
canvas.height = 720;

// Optional: center it visually (handled by CSS)
canvas.style.width = '1280px';
canvas.style.height = '720px';

// Prevent pinch-zoom gestures entirely (iOS/Safari safety)
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());
document.addEventListener('gestureend', e => e.preventDefault());

// Initialize the game
resetGame();

