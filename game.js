// the arena. no rendering, no ai. units are driven through act() and read through observe().
export const CONFIG = {
  W: 72,
  H: 44,
  R: 0.7,
  hp: 100,
  speed: 7,
  range: 14,
  dmg: 12,
  cooldown: 0.25,
  pspeed: 50,
  spread: 0.04,
  medkitHeal: 50,
  medkitRespawn: 16,
};
const { W, H, R } = CONFIG;

// one quadrant of walls, mirrored across both axes
const QUAD = [
  [22, 8, 3, 6],
  [8, 12, 6, 2],
  [30, 16, 2, 4],
  [12, 3, 2, 5],
  [17, 17, 4, 2],
];
export const WALLS = QUAD.flatMap(([x, y, w, h]) => [
  [x, y, w, h],
  [W - x - w, y, w, h],
  [x, H - y - h, w, h],
  [W - x - w, H - y - h, w, h],
]);
export const PICKUPS = [
  { x: W / 2, y: H / 2 },
  { x: 6, y: 6 },
  { x: W - 6, y: H - 6 },
  { x: 6, y: H - 6 },
  { x: W - 6, y: 6 },
  { x: W / 2, y: 4 },
  { x: W / 2, y: H - 4 },
];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
export const rnd = (a, b) => a + Math.random() * (b - a);
export const inWall = (x, y) => WALLS.some(([wx, wy, w, h]) => x > wx && x < wx + w && y > wy && y < wy + h);
export const hitsWall = (p, [x, y, w, h], r = R) => p.x > x - r && p.x < x + w + r && p.y > y - r && p.y < y + h + r;
export function segHitsRect(a, b, [x, y, w, h]) {
  let t0 = 0,
    t1 = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - x],
    [dx, x + w - a.x],
    [-dy, a.y - y],
    [dy, y + h - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}
export const los = (a, b) => !WALLS.some((r) => segHitsRect(a, b, r)); // can a shot travel from a to b
const INFL = WALLS.map(([x, y, w, h]) => [x - R + 0.03, y - R + 0.03, w + 2 * R - 0.06, h + 2 * R - 0.06]);
export const losR = (a, b) => !INFL.some((r) => segHitsRect(a, b, r)); // can a unit body walk straight from a to b

// circle vs axis-aligned walls: move one axis at a time and slide along whatever we hit
function moveBy(u, dx, dy) {
  if (dx) {
    u.x += dx;
    for (const wl of WALLS) if (hitsWall(u, wl)) u.x = dx > 0 ? wl[0] - R : wl[0] + wl[2] + R;
  }
  if (dy) {
    u.y += dy;
    for (const wl of WALLS) if (hitsWall(u, wl)) u.y = dy > 0 ? wl[1] - R : wl[1] + wl[3] + R;
  }
  u.x = clamp(u.x, R, W - R);
  u.y = clamp(u.y, R, H - R);
}
export function pushOut(u) {
  for (const wl of WALLS)
    if (hitsWall(u, wl)) {
      const [x, y, w, h] = wl,
        l = u.x - (x - R),
        r = x + w + R - u.x,
        t = u.y - (y - R),
        b = y + h + R - u.y,
        m = Math.min(l, r, t, b);
      if (m === l) u.x = x - R;
      else if (m === r) u.x = x + w + R;
      else if (m === t) u.y = y - R;
      else u.y = y + h + R;
    }
  u.x = clamp(u.x, R, W - R);
  u.y = clamp(u.y, R, H - R);
}

export function createGame() {
  const g = { t: 0, units: [], projs: [], pickups: PICKUPS.map((p) => ({ ...p, respawn: 0 })), events: [], W, H, R };
  const byId = (id) => g.units.find((u) => u.id === id);
  g.byId = byId;
  g.addUnit = ({ id, team, x, y, face = 0 }) => {
    const u = {
      id,
      team,
      x,
      y,
      vx: 0,
      vy: 0,
      hp: CONFIG.hp,
      maxhp: CONFIG.hp,
      alive: true,
      face,
      cd: 0,
      underFire: 0,
      lastHit: -9,
      lastFire: -9,
      deadT: 0,
      hurtT: 0,
      moving: false,
      cmd: { mx: 0, my: 0, ax: x + 1, ay: y, fire: false },
    };
    g.units.push(u);
    return u;
  };
  // command: move direction (magnitude up to 1), aim point, fire flag
  g.act = (id, cmd) => {
    const u = byId(id);
    if (u) Object.assign(u.cmd, cmd);
  };
  g.observe = (id) => {
    const u = byId(id);
    return {
      t: g.t,
      me: u,
      enemies: g.units.filter((e) => e.alive && e.team !== u.team),
      allies: g.units.filter((a) => a.alive && a.team === u.team && a !== u),
      projectiles: g.projs,
      medkits: g.pickups.filter((p) => p.respawn <= 0),
      walls: WALLS,
    };
  };
  g.removeDead = () => {
    g.units = g.units.filter((u) => u.alive);
  };
  g.step = (dt) => {
    g.t += dt;
    for (const u of g.units) {
      if (!u.alive) {
        u.deadT += dt;
        continue;
      }
      u.cd -= dt;
      u.underFire -= dt;
      u.hurtT -= dt;
      const px = u.x,
        py = u.y,
        c = u.cmd;
      let L = Math.hypot(c.mx, c.my);
      if (L > 1) {
        c.mx /= L;
        c.my /= L;
        L = 1;
      }
      u.moving = L > 0.01;
      if (u.moving) moveBy(u, c.mx * CONFIG.speed * dt, c.my * CONFIG.speed * dt);
      u.face = Math.atan2(c.ay - u.y, c.ax - u.x);
      u.vx = (u.x - px) / dt;
      u.vy = (u.y - py) / dt;
      if (c.fire && u.cd <= 0) {
        u.cd = CONFIG.cooldown;
        u.lastFire = g.t;
        const a = u.face + rnd(-CONFIG.spread, CONFIG.spread) * (u.moving ? 1.8 : 1);
        g.projs.push({
          x: u.x + Math.cos(a) * (R + 0.3),
          y: u.y + Math.sin(a) * (R + 0.3),
          vx: Math.cos(a) * CONFIG.pspeed,
          vy: Math.sin(a) * CONFIG.pspeed,
          team: u.team,
          owner: u,
          life: CONFIG.range / CONFIG.pspeed + 0.05,
        });
        g.events.push({ type: "fire", unit: u, a });
      }
      for (const p of g.pickups)
        if (p.respawn <= 0 && dist(p, u) < R + 0.5) {
          u.hp = Math.min(u.maxhp, u.hp + CONFIG.medkitHeal);
          p.respawn = CONFIG.medkitRespawn;
          g.events.push({ type: "pickup", unit: u, x: p.x, y: p.y, amount: CONFIG.medkitHeal });
        }
    }
    const alive = g.units.filter((u) => u.alive);
    for (let i = 0; i < alive.length; i++)
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i],
          b = alive[j],
          d = dist(a, b);
        if (d < 2 * R && d > 0.001) {
          const push = (2 * R - d) / 2,
            nx = (b.x - a.x) / d,
            ny = (b.y - a.y) / d;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
          pushOut(a);
          pushOut(b);
        }
      }
    for (let i = g.projs.length - 1; i >= 0; i--) {
      const p = g.projs[i],
        ox = p.x,
        oy = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      let dead = p.life <= 0;
      if (inWall(p.x, p.y)) {
        dead = true;
        g.events.push({ type: "wall", x: ox, y: oy });
      } else
        for (const u of alive) {
          if (u.team === p.team || !u.alive) continue;
          if (Math.hypot(u.x - p.x, u.y - p.y) < R + 0.15) {
            dead = true;
            u.hp -= CONFIG.dmg;
            u.underFire = 1.2;
            u.lastHit = g.t;
            u.hurtT = 0.12;
            g.events.push({ type: "hit", unit: u, by: p.owner, x: p.x, y: p.y, dmg: CONFIG.dmg });
            if (u.hp <= 0) {
              u.alive = false;
              u.deadT = 0;
              g.events.push({ type: "kill", unit: u, by: p.owner });
            }
            break;
          }
        }
      if (dead) g.projs.splice(i, 1);
    }
    for (const p of g.pickups) p.respawn -= dt;
  };
  return g;
}
