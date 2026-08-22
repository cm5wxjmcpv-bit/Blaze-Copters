import { DIFFICULTIES, HELICOPTER_COLORS, UPGRADES } from './config.js';
import { scaleForPlayers } from './scaling.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class BlazeSimulation {
  constructor({
    width,
    height,
    players,
    difficulty = 'normal',
    round = 1,
    upgrades = {},
    spawnInitialFires = true,
  }) {
    this.width = width;
    this.height = height;
    this.players = players;
    this.difficulty = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
    this.scaling = scaleForPlayers(players.length, this.difficulty);
    this.round = round;
    this.timeLeft = this.difficulty.roundSeconds;
    this.lastTick = performance.now();
    this.lastSpread = this.lastTick;
    this.complete = false;
    this.saved = 0;
    this.extinguished = 0;
    this.upgrades = {
      tank: Math.max(0, Number(upgrades.tank) || 0),
      speed: Math.max(0, Number(upgrades.speed) || 0),
      power: Math.max(0, Number(upgrades.power) || 0),
    };

    // Starting map: one compact, readable single-screen training area.
    // Larger scrolling maps will be added later as co-op levels.
    this.water = {
      x: width * .14,
      y: height * .68,
      radius: Math.max(56, Math.min(width, height) * .09),
    };
    this.fireStation = { x: width * .22, y: height * .24 };
    this.helipad = {
      x: width * .31,
      y: height * .24,
      radius: Math.max(24, Math.min(width, height) * .04),
    };
    this.cabins = [
      { x: width * .72, y: height * .20 },
      { x: width * .83, y: height * .24 },
      { x: width * .75, y: height * .34 },
      { x: width * .87, y: height * .37 },
    ];
    this.campground = [
      { x: width * .69, y: height * .72 },
      { x: width * .79, y: height * .77 },
      { x: width * .86, y: height * .68 },
    ];
    this.trees = this.buildTrees();
    this.fires = [];
    this.burned = [];
    this.helicopters = players.map((player, i) => this.createHelicopter(player, i));

    if (spawnInitialFires) {
      let attempts = 0;
      while (this.fires.length < this.scaling.initialFires && attempts < this.scaling.initialFires * 12) {
        this.spawnFire();
        attempts += 1;
      }
    }
  }

  buildTrees() {
    const clusters = [
      { x: .09, y: .14, rx: .10, ry: .12, count: 11 },
      { x: .49, y: .12, rx: .14, ry: .08, count: 10 },
      { x: .08, y: .43, rx: .08, ry: .11, count: 8 },
      { x: .46, y: .84, rx: .18, ry: .08, count: 13 },
      { x: .94, y: .55, rx: .07, ry: .13, count: 10 },
    ];
    const trees = [];

    for (const cluster of clusters) {
      for (let i = 0; i < cluster.count; i += 1) {
        const angle = i * 2.399963229728653;
        const ring = .28 + ((i * 37) % 71) / 100;
        const x = clamp((cluster.x + Math.cos(angle) * cluster.rx * ring) * this.width, 18, this.width - 18);
        const y = clamp((cluster.y + Math.sin(angle) * cluster.ry * ring) * this.height, 18, this.height - 18);
        trees.push({ x, y, alive: true });
      }
    }

    return trees;
  }

  createHelicopter(player, index = 0) {
    const capacity = 100 * (1 + this.upgrades.tank * .2);
    const spawnOffsets = [
      { x: -22, y: -18 }, { x: 22, y: -18 },
      { x: -22, y: 18 }, { x: 22, y: 18 },
      { x: 0, y: -36 }, { x: 0, y: 36 },
    ];
    const offset = spawnOffsets[index % spawnOffsets.length];
    return {
      id: player.id,
      name: player.name,
      color: HELICOPTER_COLORS.find((c) => c.id === player.colorId)?.value || '#fff',
      x: this.helipad.x + offset.x,
      y: this.helipad.y + offset.y,
      vx: 0,
      vy: 0,
      water: capacity,
      capacity,
      refillProgress: 0,
    };
  }

  syncPlayers(players) {
    const activeIds = new Set(players.map((player) => player.id));
    this.helicopters = this.helicopters.filter((heli) => activeIds.has(heli.id));

    players.forEach((player, index) => {
      const heli = this.helicopters.find((item) => item.id === player.id);
      if (heli) {
        heli.name = player.name;
        heli.color = HELICOPTER_COLORS.find((c) => c.id === player.colorId)?.value || heli.color;
      } else {
        this.helicopters.push(this.createHelicopter(player, index));
      }
    });

    this.players = players;
    this.scaling = scaleForPlayers(players.length, this.difficulty);
  }

  resize(width, height) {
    const sx = width / this.width;
    const sy = height / this.height;
    for (const list of [this.helicopters, this.fires, this.burned, this.trees, this.cabins, this.campground]) {
      for (const item of list) { item.x *= sx; item.y *= sy; }
    }
    for (const item of [this.water, this.fireStation, this.helipad]) {
      item.x *= sx;
      item.y *= sy;
    }
    this.water.radius *= Math.min(sx, sy);
    this.helipad.radius *= Math.min(sx, sy);
    this.width = width;
    this.height = height;
  }

  setInput(playerId, x, y) {
    const heli = this.helicopters.find((h) => h.id === playerId);
    if (!heli) return;
    const length = Math.hypot(x, y) || 1;
    const scale = length > 1 ? 1 / length : 1;
    heli.vx = x * scale;
    heli.vy = y * scale;
  }

  spawnFire(x, y) {
    if (this.fires.length >= this.scaling.maxFires) return false;

    const margin = Math.min(80, Math.max(24, Math.min(this.width, this.height) * .16));
    const minX = margin;
    const maxX = Math.max(minX, this.width - margin);
    const minY = margin;
    const maxY = Math.max(minY, this.height - margin);
    const suppliedPosition = Number.isFinite(x) && Number.isFinite(y);
    const attempts = suppliedPosition ? 1 : 16;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const fx = suppliedPosition
        ? clamp(x, minX, maxX)
        : minX + Math.random() * Math.max(1, maxX - minX);
      const fy = suppliedPosition
        ? clamp(y, minY, maxY)
        : minY + Math.random() * Math.max(1, maxY - minY);

      if (distance({ x: fx, y: fy }, this.water) < this.water.radius * 1.5) continue;
      if (!suppliedPosition && distance({ x: fx, y: fy }, this.helipad) < this.helipad.radius * 2.2) continue;

      this.fires.push({ x: fx, y: fy, hp: 100, radius: 22 + Math.random() * 8, born: performance.now() });
      return true;
    }

    return false;
  }

  applyUpgrade(id) {
    if (!(id in this.upgrades)) return false;
    this.upgrades[id] += 1;
    return true;
  }

  upgradeChoices() {
    return [...UPGRADES];
  }

  createSnapshot(now = performance.now()) {
    const minDimension = Math.max(1, Math.min(this.width, this.height));
    const normalizeX = (value) => clamp(value / Math.max(1, this.width), 0, 1);
    const normalizeY = (value) => clamp(value / Math.max(1, this.height), 0, 1);

    return {
      version: 1,
      round: this.round,
      timeLeft: this.timeLeft,
      complete: this.complete,
      extinguished: this.extinguished,
      spreadElapsedMs: Math.max(0, now - this.lastSpread),
      fires: this.fires.map((fire) => ({
        x: normalizeX(fire.x),
        y: normalizeY(fire.y),
        hp: fire.hp,
        radius: fire.radius / minDimension,
      })),
      burned: this.burned.map((patch) => ({
        x: normalizeX(patch.x),
        y: normalizeY(patch.y),
        age: patch.age,
        radius: patch.radius / minDimension,
      })),
      helicopters: this.helicopters.map((heli) => ({
        id: heli.id,
        x: normalizeX(heli.x),
        y: normalizeY(heli.y),
        vx: heli.vx,
        vy: heli.vy,
        water: heli.water,
        capacity: heli.capacity,
        refillProgress: heli.refillProgress,
      })),
    };
  }

  applySnapshot(snapshot, now = performance.now()) {
    if (!snapshot || Number(snapshot.round) !== this.round) return false;

    const minDimension = Math.max(1, Math.min(this.width, this.height));
    const denormalizeX = (value) => clamp(Number(value) || 0, 0, 1) * this.width;
    const denormalizeY = (value) => clamp(Number(value) || 0, 0, 1) * this.height;
    const playersById = new Map(this.players.map((player) => [player.id, player]));

    this.timeLeft = clamp(Number(snapshot.timeLeft) || 0, 0, this.difficulty.roundSeconds);
    this.complete = Boolean(snapshot.complete);
    this.extinguished = Math.max(0, Math.floor(Number(snapshot.extinguished) || 0));
    this.lastSpread = now - clamp(Number(snapshot.spreadElapsedMs) || 0, 0, 60000);
    this.lastTick = now;

    this.fires = Array.isArray(snapshot.fires)
      ? snapshot.fires.map((fire) => ({
          x: denormalizeX(fire.x),
          y: denormalizeY(fire.y),
          hp: clamp(Number(fire.hp) || 0, 0, 100),
          radius: clamp(Number(fire.radius) || .03, .005, .12) * minDimension,
          born: now,
        }))
      : [];

    this.burned = Array.isArray(snapshot.burned)
      ? snapshot.burned.map((patch) => ({
          x: denormalizeX(patch.x),
          y: denormalizeY(patch.y),
          age: clamp(Number(patch.age) || 0, 0, 16),
          radius: clamp(Number(patch.radius) || .03, .005, .15) * minDimension,
        }))
      : [];

    if (Array.isArray(snapshot.helicopters)) {
      this.helicopters = snapshot.helicopters.map((remoteHeli, index) => {
        const player = playersById.get(remoteHeli.id);
        const fallback = player ? this.createHelicopter(player, index) : {
          id: remoteHeli.id,
          name: 'Player',
          color: '#fff',
          x: this.helipad.x,
          y: this.helipad.y,
          vx: 0,
          vy: 0,
          water: 100,
          capacity: 100,
          refillProgress: 0,
        };

        return {
          ...fallback,
          id: remoteHeli.id,
          name: player?.name || fallback.name,
          color: player
            ? HELICOPTER_COLORS.find((c) => c.id === player.colorId)?.value || fallback.color
            : fallback.color,
          x: denormalizeX(remoteHeli.x),
          y: denormalizeY(remoteHeli.y),
          vx: clamp(Number(remoteHeli.vx) || 0, -1, 1),
          vy: clamp(Number(remoteHeli.vy) || 0, -1, 1),
          water: Math.max(0, Number(remoteHeli.water) || 0),
          capacity: Math.max(1, Number(remoteHeli.capacity) || 100),
          refillProgress: clamp(Number(remoteHeli.refillProgress) || 0, 0, 100),
        };
      });
    }

    return true;
  }

  tick(now = performance.now()) {
    if (this.complete) return;
    const dt = Math.min(.05, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) this.complete = true;

    const speed = 155 * (1 + this.upgrades.speed * .08);
    const dropRadius = 30;
    const extinguishPerSecond = 48 * (1 + this.upgrades.power * .15);
    const refillRate = 42;

    for (const heli of this.helicopters) {
      heli.x = clamp(heli.x + heli.vx * speed * dt, 20, this.width - 20);
      heli.y = clamp(heli.y + heli.vy * speed * dt, 20, this.height - 20);

      const overWater = distance(heli, this.water) < this.water.radius;
      if (overWater) {
        if (heli.water < heli.capacity) {
          const waterPerSecond = heli.capacity * (refillRate / 100);
          heli.water = clamp(heli.water + waterPerSecond * dt, 0, heli.capacity);
          heli.refillProgress = heli.water >= heli.capacity
            ? 0
            : (heli.water / heli.capacity) * 100;
        } else {
          heli.refillProgress = 0;
        }
      } else {
        heli.refillProgress = 0;
        if (heli.water > 0) {
          let activelyDropping = false;
          for (const fire of this.fires) {
            if (distance(heli, fire) <= dropRadius + fire.radius) {
              fire.hp -= extinguishPerSecond * dt;
              activelyDropping = true;
            }
          }
          if (activelyDropping) heli.water = Math.max(0, heli.water - 19 * dt);
        }
      }
    }

    const extinguished = this.fires.filter((fire) => fire.hp <= 0);
    for (const fire of extinguished) {
      this.extinguished += 1;
      this.burned.push({ x: fire.x, y: fire.y, age: 0, radius: fire.radius * 1.25 });
    }
    this.fires = this.fires.filter((fire) => fire.hp > 0);

    const recoverySeconds = 16;
    for (const patch of this.burned) patch.age += dt;
    this.burned = this.burned.filter((patch) => patch.age < recoverySeconds);

    if (now - this.lastSpread >= this.scaling.spreadMs) {
      this.lastSpread = now;
      if (this.fires.length) {
        const source = this.fires[Math.floor(Math.random() * this.fires.length)];
        const angle = Math.random() * Math.PI * 2;
        const d = 55 + Math.random() * 80;
        this.spawnFire(source.x + Math.cos(angle) * d, source.y + Math.sin(angle) * d);
      } else {
        this.spawnFire();
      }
    }
  }
}
