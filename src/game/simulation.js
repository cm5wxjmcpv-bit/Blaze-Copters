import { DIFFICULTIES, HELICOPTER_COLORS, UPGRADES } from './config.js';
import { scaleForPlayers } from './scaling.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class BlazeSimulation {
  constructor({ width, height, players, difficulty = 'normal', round = 1, upgrades = {} }) {
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

    this.water = { x: width * .12, y: height * .74, radius: Math.max(52, Math.min(width, height) * .075) };
    this.cabins = [
      { x: width * .76, y: height * .22 },
      { x: width * .82, y: height * .69 },
    ];
    this.trees = Array.from({ length: 42 }, (_, i) => ({
      x: 50 + ((i * 83) % Math.max(100, width - 100)),
      y: 70 + ((i * 137) % Math.max(100, height - 140)),
      alive: true,
    }));
    this.fires = [];
    this.burned = [];
    this.helicopters = players.map((player, i) => this.createHelicopter(player, i));

    let attempts = 0;
    while (this.fires.length < this.scaling.initialFires && attempts < this.scaling.initialFires * 12) {
      this.spawnFire();
      attempts += 1;
    }
  }

  createHelicopter(player, index = 0) {
    const capacity = 100 * (1 + this.upgrades.tank * .2);
    return {
      id: player.id,
      name: player.name,
      color: HELICOPTER_COLORS.find((c) => c.id === player.colorId)?.value || '#fff',
      x: this.width * .2 + (index % 3) * 55,
      y: this.height * .22 + Math.floor(index / 3) * 55,
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
  }

  resize(width, height) {
    const sx = width / this.width;
    const sy = height / this.height;
    for (const list of [this.helicopters, this.fires, this.burned, this.trees, this.cabins]) {
      for (const item of list) { item.x *= sx; item.y *= sy; }
    }
    this.water.x *= sx; this.water.y *= sy;
    this.width = width; this.height = height;
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
