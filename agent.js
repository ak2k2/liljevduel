// jev agent. a planner proposes positions, jev picks one, code walks the path, aims, and fires.
import { CONFIG, dist, los } from "./game.js";
import * as nav from "./nav.js";
import { ask } from "./jev.js";

export const DOCTRINE =
  "Duel doctrine. Exchange fire only when it favors me: when my health is not lower than the enemy's, stay in range with line of sight and keep moving sideways so I am hard to hit. When I am more hurt than the enemy, break line of sight first, then reach a medkit if the way there is safe. Never stand still in the open while being shot at. If the enemy is out of range and I am healthy, approach. If the enemy is point blank, back off to fighting range. Prefer moves that keep line of sight when I want to fight and remove it when I want to recover.";
const RULES =
  "Top-down arena duel. Every unit is identical: same health, same speed, same gun. The gun fires only with line of sight and within range, and shots can be dodged by moving sideways. Walls block shots and movement. A medkit restores half health and then disappears for a while. Last one standing wins.";

const hpWord = (u) =>
  u.hp / u.maxhp < 0.2 ? "critical" : u.hp / u.maxhp < 0.45 ? "low" : u.hp / u.maxhp < 0.75 ? "hurt" : "healthy";
export const band = (d) => {
  const r = CONFIG.range;
  return d < 0.3 * r
    ? "point blank"
    : d < 0.65 * r
      ? "close"
      : d <= r
        ? "in range"
        : d < 1.5 * r
          ? "just out of range"
          : "far";
};
export const travelWord = (L) =>
  L < 0.5 ? "here" : L < 4 ? "a couple of steps" : L < 10 ? "a short run" : "a long run";
const aimingAt = (a, b) => Math.cos(a.face - Math.atan2(b.y - a.y, b.x - a.x)) > 0.94;

export function createJevAgent(game, id, { interval = 0.35, getKey = () => "" } = {}) {
  const st = {
    id,
    plan: null,
    path: [],
    pi: 0,
    options: [],
    probs: null,
    chosen: null,
    conf: null,
    situation: null,
    request: null,
    response: null,
    lat: 0,
    inflight: false,
    lastAsk: -1,
    err: "",
    calls: 0,
    tokens: 0,
    aim: null,
    fire: false,
    target: null,
  };

  function candidates(u, e, medkit) {
    const c = [],
      seen = [];
    const add = (name, does, point) => {
      if (!point) return;
      if (seen.some((p) => dist(p, point) < 1.2)) return;
      seen.push(point);
      const path = name === "hold" ? [] : nav.findPath(u, point);
      c.push({ name, does, point, path, travel: nav.pathLength(u, path) });
    };
    add("hold", "stay where I am and shoot if I have a shot", { x: u.x, y: u.y });
    const toEnemy = nav.findPath(u, e),
      near = dist(u, e) < 0.7 * CONFIG.range && los(u, e);
    add("approach", "move toward the enemy", nav.alongPath(u, toEnemy, near ? 3 : 6));
    add("retreat", "move away from the enemy", nav.bestRetreat(u, e, 6));
    add(
      "flank_left",
      "circle around the enemy to the left at fighting range",
      nav.flank(u, e, +1, 45, 0.8 * CONFIG.range),
    );
    add(
      "flank_right",
      "circle around the enemy to the right at fighting range",
      nav.flank(u, e, -1, 45, 0.8 * CONFIG.range),
    );
    add("cover", "get behind the nearest wall that breaks the enemy's line of sight", nav.nearestCover(u, e));
    if (medkit) add("medkit", "run to the nearest medkit", { x: medkit.x, y: medkit.y });
    return c;
  }
  function outlook(u, e, o, medkit) {
    const p = o.point,
      d = dist(p, e),
      sight = los(p, e);
    return {
      does: o.does,
      travel: travelWord(o.travel),
      distance_to_enemy: band(d),
      line_of_sight: sight,
      fire_exchange:
        sight && d <= CONFIG.range
          ? "we can both shoot each other"
          : sight
            ? "we can see each other but out of range"
            : "no one can shoot",
      medkit_there: !!medkit && dist(p, medkit) < 1.5,
    };
  }
  async function decide(u, e, obs) {
    const medkit = obs.medkits.slice().sort((a, b) => dist(a, u) - dist(b, u))[0] ?? null;
    const options = candidates(u, e, medkit);
    if (!options.length) return;
    const d = dist(u, e),
      incoming = obs.projectiles.filter(
        (p) => p.team !== u.team && dist(p, u) < 8 && p.vx * (u.x - p.x) + p.vy * (u.y - p.y) > 0,
      ).length;
    const situation = {
      my_health: hpWord(u),
      enemy_health: hpWord(e),
      weapon_ready: u.cd <= 0,
      being_shot_at: u.underFire > 0,
      incoming_shots: incoming,
      distance_to_enemy: band(d),
      line_of_sight_to_enemy: los(u, e),
      enemy_aiming_at_me: aimingAt(e, u),
      enemy_moving_toward_me: e.moving && e.vx * (u.x - e.x) + e.vy * (u.y - e.y) > 0,
      enemy_is_shooting: game.t - e.lastFire < 0.6,
      medkit_available: !!medkit,
      allies_alive: obs.allies.length,
    };
    const criteria = Object.fromEntries(options.map((o) => [o.name, outlook(u, e, o, medkit)]));
    const state = { rules: RULES, situation };
    const questions = {
      move: {
        type: "choice",
        instructions: {
          doctrine: DOCTRINE,
          question:
            "Following `doctrine`, judging from `situation`, which move should I make right now? Each option says what I do and what my situation will be once I get there.",
        },
        criteria,
      },
    };
    st.inflight = true;
    st.lastAsk = game.t;
    st.options = options;
    st.situation = situation;
    st.request = { state, questions };
    try {
      const r = await ask(state, questions, { key: getKey() });
      st.lat = r.latency;
      st.calls++;
      st.tokens += r.usage?.input_tokens ?? 0;
      st.err = "";
      st.response = { model: r.model, answers: r.answers, usage: r.usage };
      const a = r.answers.move;
      let name = a.choice;
      if (st.chosen && name !== st.chosen && (a.probabilities[st.chosen] ?? 0) > a.probabilities[name] - 0.12)
        name = st.chosen;
      const o = options.find((x) => x.name === name) ?? options[0];
      st.probs = a.probabilities;
      st.conf = a.confidence;
      st.chosen = o.name;
      st.plan = o;
      st.path = o.path;
      st.pi = 0;
    } catch (err) {
      st.err = err.status === 429 ? "rate limited" : err.message;
      if (err.status === 429) st.lastAsk = game.t + 1.5;
    }
    st.inflight = false;
  }
  function tick(dt) {
    const obs = game.observe(id),
      u = obs.me;
    if (!u?.alive) return;
    const e = obs.enemies.slice().sort((a, b) => dist(a, u) - dist(b, u))[0];
    st.target = e ?? null;
    if (!e) {
      game.act(id, { mx: 0, my: 0, fire: false });
      st.fire = false;
      return;
    }
    if (!st.inflight && game.t - st.lastAsk >= interval) decide(u, e, obs);
    let mx = 0,
      my = 0;
    if (st.path.length) {
      while (
        st.pi < st.path.length - 1 &&
        nav.walkable(st.path[st.pi + 1]) &&
        los(u, st.path[st.pi + 1]) &&
        dist(u, st.path[st.pi + 1]) < 8
      )
        st.pi++;
      const wp = st.path[st.pi],
        d = dist(u, wp);
      if (d > 0.35) {
        mx = (wp.x - u.x) / d;
        my = (wp.y - u.y) / d;
      } else if (st.pi < st.path.length - 1) st.pi++;
      else st.path = [];
    }
    const tof = Math.min(0.6, dist(e, u) / CONFIG.pspeed),
      ax = e.x + e.vx * tof * 0.85,
      ay = e.y + e.vy * tof * 0.85;
    st.aim = { x: ax, y: ay };
    st.fire = los(u, e) && dist(e, u) <= CONFIG.range;
    game.act(id, { mx, my, ax, ay, fire: st.fire });
  }
  return { id, tick, snapshot: () => st };
}
