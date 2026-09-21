// grid a*, cover search, retreat and flank sampling
import { CONFIG, WALLS, hitsWall, losR, los, dist, clamp } from "./game.js";
const { W, H, R } = CONFIG;

const walk = new Uint8Array(W * H);
for (let j = 0; j < H; j++)
  for (let i = 0; i < W; i++) {
    const p = { x: i + 0.5, y: j + 0.5 };
    walk[j * W + i] =
      p.x >= R && p.x <= W - R && p.y >= R && p.y <= H - R && !WALLS.some((w) => hitsWall(p, w)) ? 1 : 0;
  }
export const cellOf = (p) => [clamp(Math.floor(p.x), 0, W - 1), clamp(Math.floor(p.y), 0, H - 1)];
export const centerOf = (i, j) => ({ x: i + 0.5, y: j + 0.5 });
const ok = (i, j) => i >= 0 && j >= 0 && i < W && j < H && walk[j * W + i] === 1;
export const walkable = (p) => {
  const [i, j] = cellOf(p);
  return ok(i, j);
};
export function nearestWalkable(p) {
  if (walkable(p)) return p;
  const [ci, cj] = cellOf(p);
  for (let r = 1; r < 6; r++)
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) if (ok(i, j)) return centerOf(i, j);
  return p;
}

class Heap {
  // min-heap on f
  constructor() {
    this.a = [];
  }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a,
      top = a[0],
      last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}
const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];
// 8-connected a* without corner cutting, string-pulled with body clearance. returns points ending at `to`.
export function findPath(from, to) {
  const t = nearestWalkable(to),
    [si, sj] = cellOf(from),
    [ti, tj] = cellOf(t);
  if (si === ti && sj === tj) return [t];
  const g = new Float32Array(W * H).fill(Infinity),
    prev = new Int32Array(W * H).fill(-1),
    closed = new Uint8Array(W * H);
  const h = (i, j) => {
    const dx = Math.abs(i - ti),
      dy = Math.abs(j - tj);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const open = new Heap();
  const s = sj * W + si;
  g[s] = 0;
  open.push({ i: si, j: sj, f: h(si, sj) });
  let found = false;
  while (open.size) {
    const n = open.pop(),
      ni = n.j * W + n.i;
    if (closed[ni]) continue;
    closed[ni] = 1;
    if (n.i === ti && n.j === tj) {
      found = true;
      break;
    }
    for (const [dx, dy, c] of DIRS) {
      const i = n.i + dx,
        j = n.j + dy;
      if (!ok(i, j)) continue;
      if (dx && dy && !(ok(n.i + dx, n.j) && ok(n.i, n.j + dy))) continue;
      const k = j * W + i,
        ng = g[ni] + c;
      if (ng < g[k]) {
        g[k] = ng;
        prev[k] = ni;
        open.push({ i, j, f: ng + h(i, j) });
      }
    }
  }
  if (!found) return [t];
  const cells = [];
  for (let k = tj * W + ti; k !== -1 && k !== s; k = prev[k]) cells.push(centerOf(k % W, Math.floor(k / W)));
  cells.reverse();
  cells[cells.length - 1] = t;
  const out = [];
  let cur = from,
    i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !losR(cur, cells[j])) j--;
    out.push(cells[j]);
    cur = cells[j];
    i = j + 1;
  }
  return out;
}
export function pathLength(from, path) {
  let L = 0,
    p = from;
  for (const q of path) {
    L += dist(p, q);
    p = q;
  }
  return L;
}
export function alongPath(from, path, d) {
  let p = from;
  for (const q of path) {
    const s = dist(p, q);
    if (s >= d) {
      const k = d / s;
      return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
    }
    d -= s;
    p = q;
  }
  return path[path.length - 1] ?? from;
}
// nearest reachable cell the enemy cannot see
export function nearestCover(from, enemy, maxCells = 16) {
  const [si, sj] = cellOf(from),
    seen = new Uint8Array(W * H),
    q = [[si, sj, 0]];
  seen[sj * W + si] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const [i, j, d] = q[qi],
      c = centerOf(i, j);
    if (d > 0 && !los(c, enemy) && dist(c, enemy) > 2.5) return c;
    if (d >= maxCells) continue;
    for (const [dx, dy] of DIRS.slice(0, 4)) {
      const a = i + dx,
        b = j + dy;
      if (ok(a, b) && !seen[b * W + a]) {
        seen[b * W + a] = 1;
        q.push([a, b, d + 1]);
      }
    }
  }
  return null;
}
// straight step that gains the most distance from the enemy, bonus for breaking line of sight
export function bestRetreat(from, enemy, step = 6) {
  let best = null,
    bs = -1;
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8,
      p = {
        x: clamp(from.x + Math.cos(a) * step, R + 0.2, W - R - 0.2),
        y: clamp(from.y + Math.sin(a) * step, R + 0.2, H - R - 0.2),
      };
    if (!walkable(p) || !losR(from, p) || dist(p, from) < step * 0.6) continue;
    const s = dist(p, enemy) + (los(p, enemy) ? 0 : 3);
    if (s > bs) {
      bs = s;
      best = p;
    }
  }
  return best;
}
// swing around the enemy, pulled in to `radius` if farther
export function flank(from, enemy, sign, deg = 45, radius = null) {
  let vx = from.x - enemy.x,
    vy = from.y - enemy.y;
  const L = Math.hypot(vx, vy) || 1,
    a = (sign * deg * Math.PI) / 180;
  if (radius && L > radius) {
    vx *= radius / L;
    vy *= radius / L;
  }
  const p = {
    x: clamp(enemy.x + vx * Math.cos(a) - vy * Math.sin(a), R + 0.2, W - R - 0.2),
    y: clamp(enemy.y + vx * Math.sin(a) + vy * Math.cos(a), R + 0.2, H - R - 0.2),
  };
  return nearestWalkable(p);
}
