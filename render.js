// three.js scene, models, effects, sounds, agent overlay. reads game state only.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skClone } from "three/addons/utils/SkeletonUtils.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { CONFIG, WALLS, PICKUPS, inWall, dist, rnd, los } from "./game.js";
const { W, H, R } = CONFIG;
const TEX = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r169/examples/textures/";
export const COL = { A: 0x9fdcff, B: 0xff7a86 };

let AC = null;
export function blip(f, dur, type = "square", g = 0.04) {
  try {
    AC ??= new AudioContext();
    const o = AC.createOscillator(),
      v = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, AC.currentTime);
    o.frequency.exponentialRampToValueAtTime(f / 3, AC.currentTime + dur);
    v.gain.setValueAtTime(g, AC.currentTime);
    v.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(v).connect(AC.destination);
    o.start();
    o.stop(AC.currentTime + dur);
  } catch {}
}

export function createRenderer({ canvas, labels, dbgLabels, flash }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  const scene = new THREE.Scene();
  {
    const cv = document.createElement("canvas");
    cv.width = 4;
    cv.height = 256;
    const g = cv.getContext("2d");
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, "#c9d4ff");
    gr.addColorStop(0.55, "#efe3ee");
    gr.addColorStop(1, "#ffd9c4");
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    scene.background = t;
  }
  scene.fog = new THREE.Fog(0xe8dfe9, 42, 95);
  const cam = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
  }
  addEventListener("resize", resize);
  resize();
  const P = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
  const texLoader = new THREE.TextureLoader();
  const tex = (name, rep, srgb = true) => {
    const t = texLoader.load(TEX + name);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep[0], rep[1]);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const sparkTex = texLoader.load(TEX + "sprites/spark1.png"),
    discTex = texLoader.load(TEX + "sprites/disc.png");
  const glowMat = (color, opacity) =>
    new THREE.SpriteMaterial({
      map: sparkTex,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

  const capMat = new THREE.MeshStandardMaterial({ color: 0xd8d0c4, roughness: 0.7 });
  {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshStandardMaterial({
        map: tex("terrain/grasslight-big.jpg", [W / 10, H / 10]),
        color: 0xc7d2b4,
        roughness: 0.95,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0.36, -H / 2);
    floor.receiveShadow = true;
    scene.add(floor);
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({
        map: tex("terrain/grasslight-big.jpg", [40, 40]),
        color: 0xb8c4a6,
        roughness: 1,
      }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(W / 2, 0, -H / 2);
    outer.receiveShadow = true;
    scene.add(outer);
    const rimMat = new THREE.MeshStandardMaterial({
      map: tex("brick_diffuse.jpg", [3, 0.4]),
      bumpMap: tex("brick_bump.jpg", [3, 0.4], false),
      bumpScale: 0.6,
      color: 0xcdc3b6,
      roughness: 0.85,
    });
    for (const [x, y, w, h] of [
      [-0.6, -0.6, W + 1.2, 0.6],
      [-0.6, H, W + 1.2, 0.6],
      [-0.6, 0, 0.6, H],
      [W, 0, 0.6, H],
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, h), rimMat);
      m.position.set(x + w / 2, 0.35, -(y + h / 2));
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
    const wallMat = new THREE.MeshStandardMaterial({
      map: tex("brick_diffuse.jpg", [1.5, 1]),
      bumpMap: tex("brick_bump.jpg", [1.5, 1], false),
      bumpScale: 0.8,
      color: 0xcfc5b8,
      roughness: 0.85,
    });
    for (const [x, y, w, h] of WALLS) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, h), wallMat);
      m.position.set(x + w / 2, 0.36 + 1.2, -(y + h / 2));
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.25, 0.18, h + 0.25), capMat);
      cap.position.set(x + w / 2, 0.36 + 2.45, -(y + h / 2));
      cap.castShadow = true;
      scene.add(cap);
    }
    const m4 = new THREE.Matrix4(),
      col = new THREE.Color(),
      q = new THREE.Quaternion(),
      v3 = new THREE.Vector3();
    const N = 110,
      trunks = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.22, 0.36, 2.4, 7),
        new THREE.MeshStandardMaterial({ color: 0x8b6a4e, roughness: 0.9 }),
        N,
      );
    const canopies = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1.5, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
      N * 2,
    );
    for (let i = 0, ci = 0; i < N; i++) {
      let x, y;
      do {
        x = rnd(-36, W + 36);
        y = rnd(-28, H + 28);
      } while (x > -5 && x < W + 5 && y > -5 && y < H + 5);
      const sc = rnd(0.8, 1.6);
      trunks.setMatrixAt(i, m4.compose(P(x, y, 1.2 * sc), q, v3.set(sc, sc, sc)));
      for (let k = 0; k < 2; k++, ci++) {
        const s2 = sc * rnd(0.8, 1.15);
        canopies.setMatrixAt(
          ci,
          m4.compose(
            P(x + rnd(-0.5, 0.5) * sc, y + rnd(-0.5, 0.5) * sc, (2.4 + k * 0.9) * sc),
            q,
            v3.set(s2, s2 * 0.85, s2),
          ),
        );
        canopies.setColorAt(ci, col.setHSL(rnd(0.2, 0.36), rnd(0.35, 0.55), rnd(0.5, 0.7)));
      }
    }
    trunks.instanceMatrix.needsUpdate = canopies.instanceMatrix.needsUpdate = canopies.instanceColor.needsUpdate = true;
    trunks.castShadow = canopies.castShadow = trunks.receiveShadow = canopies.receiveShadow = true;
    scene.add(trunks, canopies);
    const pillarMat = new THREE.MeshStandardMaterial({
        map: tex("brick_diffuse.jpg", [1, 1]),
        color: 0xcfc5b8,
        roughness: 0.85,
      }),
      pillarGeo = new THREE.CylinderGeometry(0.55, 0.68, 3.8, 12),
      pcapGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.25, 12);
    for (const [x, y] of [
      [0, 0],
      [W, 0],
      [0, H],
      [W, H],
      [W / 2, -0.4],
      [W / 2, H + 0.4],
      [-0.4, H / 2],
      [W + 0.4, H / 2],
    ]) {
      const m = new THREE.Mesh(pillarGeo, pillarMat);
      m.position.set(x, 0.36 + 1.9, -y);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      const cp = new THREE.Mesh(pcapGeo, capMat);
      cp.position.set(x, 0.36 + 3.9, -y);
      cp.castShadow = true;
      scene.add(cp);
    }
    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(7.5, 56),
      new THREE.MeshStandardMaterial({
        map: tex("brick_diffuse.jpg", [5, 5]),
        color: 0xd9d0c2,
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(W / 2, 0.365, -H / 2);
    plaza.receiveShadow = true;
    scene.add(plaza);
    const ringm = new THREE.Mesh(
      new THREE.RingGeometry(7.5, 8.1, 56),
      new THREE.MeshStandardMaterial({
        color: 0xe8e0d4,
        roughness: 0.8,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    ringm.rotation.x = -Math.PI / 2;
    ringm.position.set(W / 2, 0.366, -H / 2);
    scene.add(ringm);
    const FN = 1100,
      fp = new Float32Array(FN * 3),
      fc = new Float32Array(FN * 3),
      pal = [0xffffff, 0xffc9d9, 0xfff2a8, 0xd9c9ff, 0xffd6a8, 0xffffff];
    for (let i = 0; i < FN; i++) {
      let x, y;
      do {
        x = rnd(1, W - 1);
        y = rnd(1, H - 1);
      } while (inWall(x, y) || Math.hypot(x - W / 2, y - H / 2) < 8.2);
      fp[i * 3] = x;
      fp[i * 3 + 1] = 0.44;
      fp[i * 3 + 2] = -y;
      col.set(pal[i % pal.length]);
      fc[i * 3] = col.r;
      fc[i * 3 + 1] = col.g;
      fc[i * 3 + 2] = col.b;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.BufferAttribute(fp, 3));
    fg.setAttribute("color", new THREE.BufferAttribute(fc, 3));
    scene.add(
      new THREE.Points(
        fg,
        new THREE.PointsMaterial({ size: 0.3, map: discTex, vertexColors: true, alphaTest: 0.5, transparent: true }),
      ),
    );
    const n = 800,
      pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rnd(-14, W + 14);
      pos[i * 3 + 1] = rnd(0.5, 9);
      pos[i * 3 + 2] = -rnd(-14, H + 14);
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    scene.add(
      new THREE.Points(
        mg,
        new THREE.PointsMaterial({
          size: 0.28,
          map: discTex,
          color: 0xfff4e0,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    // light count never changes, so shaders compile once
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x8a9a7a, 0.7));
    const sun = new THREE.DirectionalLight(0xffe4c8, 1.7);
    sun.position.set(W / 2 - 22, 38, -H / 2 + 26);
    sun.target.position.set(W / 2, 0, -H / 2);
    scene.add(sun, sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 30, bottom: -30, near: 5, far: 120 });
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 3;
  }
  const pickObjs = PICKUPS.map((p) => {
    const g = new THREE.Group();
    g.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0xd8ffe8, emissive: 0x8fffc0, emissiveIntensity: 1.4, roughness: 0.2 }),
      ),
    );
    const halo = new THREE.Sprite(glowMat(0xbfffd8, 0.8));
    halo.scale.setScalar(3.2);
    g.add(halo);
    const l = new THREE.PointLight(0x9fffc8, 6, 7);
    g.add(l);
    g.position.copy(P(p.x, p.y, 1.3));
    scene.add(g);
    return { g, l };
  });
  const projGeo = new THREE.CapsuleGeometry(0.11, 0.9, 4, 8);
  projGeo.rotateZ(Math.PI / 2);
  const projMat = {
      A: new THREE.MeshBasicMaterial({ color: 0xbff4ff, toneMapped: false }),
      B: new THREE.MeshBasicMaterial({ color: 0xffb0b8, toneMapped: false }),
    },
    projGlow = { A: glowMat(0x9fe8ff, 0.9), B: glowMat(0xff9aa4, 0.9) };
  const projObjs = [];
  function newProj() {
    const m = new THREE.Mesh(projGeo, projMat.B);
    const sp = new THREE.Sprite(projGlow.B);
    sp.scale.setScalar(1.6);
    m.add(sp);
    m.visible = false;
    scene.add(m);
    projObjs.push(m);
    return m;
  }
  for (let i = 0; i < 12; i++) newProj();
  const flashObjs = [];
  let flashI = 0;
  for (let i = 0; i < 10; i++) {
    const sp = new THREE.Sprite(glowMat(0xffffff, 1));
    sp.scale.setScalar(0.01);
    sp.visible = false;
    scene.add(sp);
    flashObjs.push({ sp, life: 0 });
  }
  const NP = 800,
    pPos = new Float32Array(NP * 3),
    pCol = new Float32Array(NP * 3),
    parts = [];
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const pPts = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({
      size: 0.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      map: sparkTex,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  pPts.frustumCulled = false;
  scene.add(pPts);
  function burst(x, y, n, colr, spd) {
    const c = new THREE.Color(colr);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        v = spd * (0.3 + Math.random());
      parts.push({
        x,
        y,
        z: 0.8 + Math.random() * 0.8,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        vz: rnd(2, 7),
        life: 0.4 + Math.random() * 0.5,
        r: c.r,
        g: c.g,
        b: c.b,
      });
    }
    if (parts.length > NP) parts.splice(0, parts.length - NP);
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= 18 * dt;
      if (p.z < 0.4) {
        p.z = 0.4;
        p.vz *= -0.4;
      }
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= dt;
      if (p.life <= 0) parts.splice(i, 1);
    }
  }
  const aimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const aimLine = new THREE.Line(
    aimGeo,
    new THREE.LineBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.35, toneMapped: false }),
  );
  aimLine.visible = false;
  scene.add(aimLine);

  // agent overlay: paths, candidates, aim, line of sight, range
  const dbg = new THREE.Group();
  dbg.visible = false;
  scene.add(dbg);
  const LN = 64,
    lines = new Map(),
    dots = new Map(),
    dlabels = new Map();
  function getLine(key, color, opacity = 0.8) {
    let l = lines.get(key);
    if (!l) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(LN * 3), 3));
      l = new THREE.Line(g, new THREE.LineBasicMaterial({ transparent: true, toneMapped: false, depthTest: false }));
      l.frustumCulled = false;
      l.renderOrder = 10;
      dbg.add(l);
      lines.set(key, l);
    }
    l.material.color.set(color);
    l.material.opacity = opacity;
    l.visible = true;
    return l;
  }
  function setLine(l, pts, h) {
    const a = l.geometry.attributes.position,
      n = Math.min(pts.length, LN);
    for (let i = 0; i < n; i++) a.setXYZ(i, pts[i].x, h, -pts[i].y);
    a.needsUpdate = true;
    l.geometry.setDrawRange(0, n);
  }
  const circle = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    circle.push([Math.cos(a), Math.sin(a)]);
  }
  const dotGeo = new THREE.CircleGeometry(0.3, 18);
  function getDot(key) {
    let d = dots.get(key);
    if (!d) {
      d = new THREE.Mesh(
        dotGeo,
        new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthTest: false }),
      );
      d.rotation.x = -Math.PI / 2;
      d.renderOrder = 11;
      dbg.add(d);
      dots.set(key, d);
    }
    d.visible = true;
    return d;
  }
  function dlabel(key, x, y, text) {
    let el = dlabels.get(key);
    if (!el) {
      el = document.createElement("div");
      el.className = "dl";
      dbgLabels.appendChild(el);
      dlabels.set(key, el);
    }
    const [sx, sy] = project(x, y, 0.6);
    el.style.transform = `translate(${sx}px, ${sy}px)`;
    el.textContent = text;
    el.style.display = "";
  }
  function overlay(game, focusId, agents) {
    for (const l of lines.values()) l.visible = false;
    for (const d of dots.values()) d.visible = false;
    for (const el of dlabels.values()) el.style.display = "none";
    const ring = (u, color, key) =>
      setLine(
        getLine(key, color, 0.22),
        circle.map(([c, s]) => ({ x: u.x + c * CONFIG.range, y: u.y + s * CONFIG.range })),
        0.42,
      );
    const sight = (key, a, b) => {
      const ok = los(a, b);
      setLine(getLine(key, ok ? 0x8fffc0 : 0xff5a5a, ok ? 0.55 : 0.35), [a, b], 1.4);
    };
    const you = game.byId(focusId);
    if (you?.alive) {
      ring(you, COL.A, "you:range");
      for (const e of game.units) if (e.alive && e.team !== you.team) sight("you:los:" + e.id, you, e);
    }
    for (const a of agents) {
      const s = a.snapshot(),
        u = game.byId(a.id);
      if (!u?.alive) continue;
      ring(u, COL.B, a.id + ":range");
      if (s.target?.alive) sight(a.id + ":los", u, s.target);
      if (s.path.length) setLine(getLine(a.id + ":path", 0xffffff, 0.85), [u, ...s.path.slice(s.pi)], 0.5);
      if (s.aim) {
        const L = s.fire ? CONFIG.range : 2.5,
          ang = Math.atan2(s.aim.y - u.y, s.aim.x - u.x);
        setLine(
          getLine(a.id + ":aim", s.fire ? 0xffd27a : 0xffffff, s.fire ? 0.9 : 0.3),
          [u, { x: u.x + Math.cos(ang) * L, y: u.y + Math.sin(ang) * L }],
          1.4,
        );
      }
      for (const o of s.options) {
        const p = s.probs?.[o.name] ?? 0,
          pick = o.name === s.chosen,
          d = getDot(a.id + ":" + o.name);
        d.material.color.set(pick ? 0xffffff : COL.B);
        d.material.opacity = 0.3 + 0.7 * p;
        d.scale.setScalar(pick ? 1.6 : 0.7 + p);
        d.position.set(o.point.x, 0.42, -o.point.y);
        dlabel(a.id + ":" + o.name, o.point.x, o.point.y, `${o.name.replace("_", " ")} ${Math.round(p * 100)}`);
      }
    }
  }

  const models = new Map();
  let robot = null;
  function tint(root, color) {
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.material = o.material.clone();
        if (/Main/i.test(o.material.name)) {
          o.material.color.set(color);
          o.material.emissive.set(color);
          o.material.emissiveIntensity = 0.25;
        }
      }
    });
  }
  function addModel(u) {
    const root = new THREE.Group();
    scene.add(root);
    const color = COL[u.team] ?? 0xffffff;
    let mixer = null,
      actions = {};
    if (robot) {
      const m = skClone(robot.scene);
      m.scale.setScalar(0.55);
      tint(m, color);
      root.add(m);
      mixer = new THREE.AnimationMixer(m);
      for (const clip of robot.animations) actions[clip.name] = mixer.clipAction(clip);
      actions.Idle?.play();
    } else {
      const m = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.5, 0.8, 4, 12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 }),
      );
      m.position.y = 0.9;
      m.castShadow = true;
      root.add(m);
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R + 0.05, R + 0.2, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    root.add(ring);
    const mains = [];
    root.traverse((o) => {
      if (o.isMesh && /Main/i.test(o.material.name)) mains.push(o.material);
    });
    const o = { u, root, mixer, actions, cur: "Idle", ring, mains };
    models.set(u.id, o);
    return o;
  }
  function playAnim(u, name, loop = true) {
    const o = models.get(u.id);
    if (!o?.mixer || o.cur === name || o.cur === "Death") return;
    const a = o.actions[name];
    if (!a) return;
    const prev = o.actions[o.cur];
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce);
    a.clampWhenFinished = !loop;
    a.fadeIn(0.12).play();
    prev?.fadeOut(0.12);
    o.cur = name;
  }
  const labelEls = new Map();
  function project(x, y, h) {
    const v = P(x, y, h).project(cam);
    return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
  }
  function floatText(x, y, text, cls = "") {
    const [sx, sy] = project(x, y, 2.4);
    const d = document.createElement("div");
    d.className = "dmg " + cls;
    d.style.left = sx + "px";
    d.style.top = sy + "px";
    d.textContent = text;
    labels.appendChild(d);
    setTimeout(() => d.remove(), 700);
  }
  let shake = 0;
  const camLean = { x: 0, y: 0 },
    camTarget = new THREE.Vector3(W / 2, 0, -H / 2);
  const ray = new THREE.Raycaster(),
    aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.4),
    hit = new THREE.Vector3();

  const api = { debugOn: false };
  api.setDebug = (v) => {
    api.debugOn = v;
    dbg.visible = v;
    if (!v) for (const el of dlabels.values()) el.style.display = "none";
  };
  api.screenToWorld = (sx, sy) => {
    ray.setFromCamera({ x: sx * 2 - 1, y: -sy * 2 + 1 }, cam);
    return ray.ray.intersectPlane(aimPlane, hit) ? { x: hit.x, y: -hit.z } : null;
  };
  api.project = project;
  api.floatText = floatText;
  api.resetCamera = (u) => camTarget.set(u.x, 0, -u.y);
  api.forget = (ids) => {
    for (const id of ids) {
      const o = models.get(id);
      if (o) {
        scene.remove(o.root);
        models.delete(id);
      }
      labelEls.get(id)?.remove();
      labelEls.delete(id);
    }
  };
  api.effect = (ev, focusId) => {
    switch (ev.type) {
      case "fire": {
        const f = flashObjs[flashI++ % flashObjs.length],
          u = ev.unit;
        f.sp.position.copy(P(u.x + Math.cos(ev.a) * 1.2, u.y + Math.sin(ev.a) * 1.2, 1.4));
        f.sp.material.color.set(u.team === "A" ? 0xaef0ff : 0xffb0b8);
        f.life = 0.07;
        f.sp.visible = true;
        f.sp.scale.setScalar(2.2);
        blip(u.id === focusId ? 620 : 480, 0.06, "square", u.id === focusId ? 0.035 : 0.022);
        break;
      }
      case "hit": {
        const you = ev.unit.id === focusId;
        burst(ev.x, ev.y, 7, ev.by.team === "A" ? 0x9fdcff : 0xff8a7a, 7);
        floatText(ev.unit.x, ev.unit.y, String(ev.dmg), you ? "hurt" : "");
        blip(180, 0.05, "triangle", 0.02);
        if (you) {
          flash.style.opacity = 0.4;
          setTimeout(() => (flash.style.opacity = 0), 80);
          shake = Math.max(shake, 0.25);
        }
        break;
      }
      case "kill":
        burst(ev.unit.x, ev.unit.y, 60, COL[ev.unit.team], 15);
        shake = 0.7;
        blip(70, 0.5, "sawtooth", 0.09);
        playAnim(ev.unit, "Death", false);
        break;
      case "pickup":
        burst(ev.x, ev.y, 20, 0xa9f2c6, 8);
        floatText(ev.unit.x, ev.unit.y, "+" + ev.amount, "heal");
        blip(1100, 0.25, "sine", 0.05);
        break;
      case "wall":
        burst(ev.x, ev.y, 5, 0xc9d4ff, 6);
        break;
    }
  };
  api.draw = (game, { focusId, agents = [], mouse = { sx: 0.5, sy: 0.5 } }, dt) => {
    const you = game.byId(focusId) ?? game.units[0];
    if (you) {
      camLean.x += ((mouse.sx - 0.5) * 4 - camLean.x) * (1 - Math.pow(0.05, dt));
      camLean.y += ((0.5 - mouse.sy) * 3 - camLean.y) * (1 - Math.pow(0.05, dt));
      camTarget.lerp(P(you.x + camLean.x, you.y + camLean.y, 0), 1 - Math.pow(0.00001, dt));
    }
    cam.position.set(camTarget.x, 31, camTarget.z + 17);
    if (shake > 0) {
      shake -= dt;
      cam.position.x += rnd(-shake, shake) * 0.4;
      cam.position.z += rnd(-shake, shake) * 0.4;
    }
    cam.lookAt(camTarget.x, 0, camTarget.z - 1.5);
    cam.updateMatrixWorld();
    stepParts(dt);
    for (const u of game.units) {
      const o = models.get(u.id) ?? addModel(u);
      o.root.position.copy(P(u.x, u.y, 0.36));
      o.root.rotation.y = u.face + Math.PI / 2;
      if (u.alive) playAnim(u, u.moving ? "Running" : "Idle");
      o.mixer?.update(dt * (u.moving && u.alive ? 1.3 : 1));
      for (const m of o.mains) m.emissiveIntensity = u.hurtT > 0 ? 1.4 : 0.25;
      o.ring.visible = u.alive;
      if (!u.alive && u.deadT > 1.2) o.root.position.y -= u.deadT - 1.2;
      if (u.id !== focusId) {
        let l = labelEls.get(u.id);
        if (!l) {
          l = document.createElement("div");
          l.className = "bot";
          l.innerHTML = `<div class="nm">${u.id}</div><div class="bar"><i></i></div>`;
          labels.appendChild(l);
          labelEls.set(u.id, l);
        }
        const [sx, sy] = project(u.x, u.y, 3.1);
        l.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
        l.style.display = u.alive ? "" : "none";
        l.lastChild.firstChild.style.width = (100 * Math.max(0, u.hp)) / u.maxhp + "%";
      }
    }
    for (const [id] of models) if (!game.units.some((u) => u.id === id)) api.forget([id]);
    if (you?.alive) {
      const pa = aimGeo.attributes.position,
        L = 4;
      pa.setXYZ(0, you.x + Math.cos(you.face) * 1.0, 1.4, -(you.y + Math.sin(you.face) * 1.0));
      pa.setXYZ(1, you.x + Math.cos(you.face) * L, 1.4, -(you.y + Math.sin(you.face) * L));
      pa.needsUpdate = true;
      aimLine.visible = true;
    } else aimLine.visible = false;
    if (api.debugOn) overlay(game, focusId, agents);
    pickObjs.forEach(({ g, l }, i) => {
      const p = game.pickups[i],
        on = p.respawn <= 0;
      g.children[0].visible = g.children[1].visible = on;
      l.intensity = on ? 6 : 0;
      g.rotation.y += dt * 0.8;
      g.position.y = 1.3 + 0.2 * Math.sin(performance.now() / 500 + i);
    });
    while (projObjs.length < game.projs.length) newProj();
    projObjs.forEach((m, i) => {
      const p = game.projs[i];
      m.visible = !!p;
      if (p) {
        m.position.copy(P(p.x, p.y, 1.4));
        m.rotation.y = Math.atan2(p.vy, p.vx);
        m.material = projMat[p.team];
        m.children[0].material = projGlow[p.team];
      }
    });
    for (const f of flashObjs)
      if (f.life > 0) {
        f.life -= dt;
        f.sp.scale.setScalar(2.2 * Math.max(0.2, f.life / 0.07));
        if (f.life <= 0) f.sp.visible = false;
      }
    for (let i = 0; i < NP; i++) {
      const p = parts[i];
      if (p) {
        pPos[i * 3] = p.x;
        pPos[i * 3 + 1] = p.z;
        pPos[i * 3 + 2] = -p.y;
        pCol[i * 3] = p.r;
        pCol[i * 3 + 1] = p.g;
        pCol[i * 3 + 2] = p.b;
      } else pPos[i * 3 + 1] = -50;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    renderer.render(scene, cam);
  };
  api.idle = () => {
    pickObjs.forEach(({ g }) => (g.rotation.y += 0.02));
    renderer.render(scene, cam);
  };
  cam.position.copy(P(W / 2, H / 2 - 16, 26));
  cam.lookAt(P(W / 2, H / 2, 0));

  // load assets, then compile every shader once so nothing stalls mid-fight
  const env = new Promise((res) =>
    new RGBELoader().load(
      TEX + "equirectangular/venice_sunset_1k.hdr",
      (h) => {
        const pm = new THREE.PMREMGenerator(renderer);
        scene.environment = pm.fromEquirectangular(h).texture;
        scene.environmentIntensity = 0.55;
        h.dispose();
        pm.dispose();
        res(true);
      },
      undefined,
      () => res(false),
    ),
  );
  const model = new Promise((res) =>
    new GLTFLoader().load(
      "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r169/examples/models/gltf/RobotExpressive/RobotExpressive.glb",
      (g) => {
        robot = g;
        res(true);
      },
      undefined,
      () => res(false),
    ),
  );
  api.ready = Promise.all([env, model]).then(async ([e, m]) => {
    const tmp = { id: "__warm", team: "B", alive: true, face: 0, x: -50, y: -50, hurtT: 0 },
      o = addModel(tmp);
    for (const p of projObjs) p.visible = true;
    for (const f of flashObjs) f.sp.visible = true;
    getLine("__warm", 0xffffff);
    getDot("__warm");
    dbg.visible = true;
    try {
      await renderer.compileAsync(scene, cam);
    } catch {}
    dbg.visible = api.debugOn;
    for (const p of projObjs) p.visible = false;
    for (const f of flashObjs) f.sp.visible = false;
    scene.remove(o.root);
    models.delete(tmp.id);
    return { env: e, model: m };
  });
  return api;
}
