import { DIFFICULTIES, HELICOPTER_COLORS, UPGRADES } from './config.js';
import { scaleForPlayers } from './scaling.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class BlazeSimulation {
  constructor({ width, height, players, difficulty = 'normal', round = 1 }) {
    this.width = width;
    this.height = height;
    this.players = players;
    this.difficulty = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
    this.scaling = scaleForPlayers(players.length, this.difficulty);
    this.round = round;
    this.timeLeft = this.difficulty.roundSeconds;
    this.lastSpread = 0;
    this.lastTick = performance.now();
    this.complete = false;
    this.saved = 0;
    this.extinguished = 0;
    this.upgrades = { tank: 0, refill: 0, speed: 0, drop: 0, power: 0, recovery: 0 };

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
    this.helicopters = players.map((player, i) => ({
      id: player.id,
      name: player.name,
      color: HELICOPTER_COLORS.find((c) => c.id === player.colorId)?.value || '#fff',
      x: width * .2 + (i % 3) * 55,
      y: height * .22 + Math.floor(i / 3) * 55,
      vx: 0,
      vy: 0,
      water: 100,
      capacity: 100,
      refillProgress: 0,
    }));

    for (let i = 0; i < this.scaling.initialFires; i++) this.spawnFire();
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
    if (this.fires.length >= this.scaling.maxFires) return;
    const margin = 80;
    const fx = x ?? margin + Math.random() * Math.max(20, this.width - margin * 2);
    const fy = y ?? margin + Math.random() * Math.max(20, this.height - margin * 2);
    if (distance({ x: fx, y: fy }, this.water) < this.water.radius * 1.5) return this.spawnFire();
    this.fires.push({ x: fx, y: fy, hp: 100, radius: 22 + Math.random() * 8, born: performance.now() });
  }

  applyUpgrade(id) {
    if (!(id in this.upgrades)) return;
    this.upgrades[id] += 1;
    if (id === 'tank') {
      for (const heli of this.helicopters) {
        heli.capacity *= 1.2;
        heli.water = heli.capacity;
      }
    }
  }

  upgradeChoices() {
    const shuffled = [...UPGRADES].sort(() => Math.random() - .5);
    return shuffled.slice(0, 2);
  }

  tick(now = performance.now()) {
    if (this.complete) return;
    const dt = Math.min(.05, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) this.complete = true;

    const speed = 155 * (1 + this.upgrades.speed * .08);
    const dropRadius = 30 * (1 + this.upgrades.drop * .12);
    const extinguishPerSecond = 48 * (1 + this.upgrades.power * .15);
    const refillRate = 42 / Math.max(.35, 1 - this.upgrades.refill * .15);

    for (const heli of this.helicopters) {
      heli.x = clamp(heli.x + heli.vx * speed * dt, 20, this.width - 20);
      heli.y = clamp(heli.y + heli.vy * speed * dt, 20, this.height - 20);

      const overWater = distance(heli, this.water) < this.water.radius;
      if (overWater) {
        heli.refillProgress = clamp(heli.refillProgress + refillRate * dt, 0, 100);
        if (heli.refillProgress >= 100) {
          heli.water = heli.capacity;
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

    const recoverySeconds = 16 / (1 + this.upgrades.recovery * .2);
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
