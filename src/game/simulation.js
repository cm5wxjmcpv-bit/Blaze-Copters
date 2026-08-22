import {
  DEFAULT_HELICOPTER_TYPE,
  DIFFICULTIES,
  HELICOPTER_COLORS,
  UPGRADES,
  normalizeHelicopterType,
} from './config.js';
import { controllerForMode, createModeState } from './mode-controllers.js';
import {
  DEFAULT_LEVEL_ID,
  DEFAULT_MODE_ID,
  GAME_LEVELS,
  GAME_MODES,
  SNAPSHOT_VERSION,
  defaultLevelForMode,
  fireLimitForMode,
  isValidLevel,
  isValidMode,
  maximumFireHealth,
  roundDurationForMode,
} from './modes.js';
import { scaleForPlayers } from './scaling.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return distance(point, start);

  const progress = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1,
  );
  return distance(point, {
    x: start.x + dx * progress,
    y: start.y + dy * progress,
  });
}

export class BlazeSimulation {
  constructor({
    width,
    height,
    players,
    difficulty = 'normal',
    round = 1,
    mode = DEFAULT_MODE_ID,
    level = DEFAULT_LEVEL_ID,
    roundEndsAt = null,
    upgrades = {},
    spawnInitialFires = true,
  }) {
    this.width = width;
    this.height = height;
    this.players = players;
    this.difficulty = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
    this.round = round;
    this.mode = isValidMode(mode) ? mode : DEFAULT_MODE_ID;
    this.level = isValidLevel(this.mode, level) ? level : defaultLevelForMode(this.mode);
    this.modeConfig = GAME_MODES[this.mode];
    this.levelConfig = GAME_LEVELS[this.level] || GAME_LEVELS[DEFAULT_LEVEL_ID];
    this.modeController = controllerForMode(this.mode);
    this.maximumFireHealth = maximumFireHealth(this.mode);
    this.scaling = scaleForPlayers(players.length, this.difficulty);
    this.scaling.maxFires = fireLimitForMode(this.mode, this.scaling.maxFires);
    this.teamPressure = 1 + Math.max(0, Math.min(5, players.length - 1)) * .18;
    this.durationSeconds = roundDurationForMode(this.mode, this.level, this.difficulty.roundSeconds);
    this.roundEndsAt = Number.isFinite(Number(roundEndsAt)) && Number(roundEndsAt) > 0
      ? Number(roundEndsAt)
      : null;
    this.timeLeft = this.durationSeconds ?? 0;
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

    const map = this.levelConfig.map;
    const minDimension = Math.min(width, height);
    this.water = {
      x: width * map.water.x,
      y: height * map.water.y,
      radius: Math.max(56, minDimension * map.water.radius),
    };
    this.fireStation = { x: width * map.station.x, y: height * map.station.y };
    this.helipad = {
      x: width * map.helipad.x,
      y: height * map.helipad.y,
      radius: Math.max(24, minDimension * map.helipad.radius),
    };
    this.cabins = this.mode === 'protect-town' ? [] : [
      { x: width * .72, y: height * .20 },
      { x: width * .83, y: height * .24 },
      { x: width * .75, y: height * .34 },
      { x: width * .87, y: height * .37 },
    ];
    this.campground = this.mode === 'convoy-protection' ? [] : [
      { x: width * .69, y: height * .72 },
      { x: width * .79, y: height * .77 },
      { x: width * .86, y: height * .68 },
    ];
    this.route = map.road.map((point) => ({ x: point.x * width, y: point.y * height }));
    this.trees = this.buildTrees();
    this.fires = [];
    this.burned = [];
    this.helicopters = players.map((player, i) => this.createHelicopter(player, i));
    this.state = createModeState(this.mode, players.length);
    this.modeController.initialize(this, spawnInitialFires);
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
      helicopterType: normalizeHelicopterType(player.helicopterType),
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
        heli.helicopterType = normalizeHelicopterType(player.helicopterType);
      } else {
        this.helicopters.push(this.createHelicopter(player, index));
      }
    });

    this.players = players;
    this.scaling = scaleForPlayers(players.length, this.difficulty);
    this.scaling.maxFires = fireLimitForMode(this.mode, this.scaling.maxFires);
    this.teamPressure = 1 + Math.max(0, Math.min(5, players.length - 1)) * .18;
  }

  resize(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

    const sx = width / this.width;
    const sy = height / this.height;
    const oldMinDimension = Math.max(1, Math.min(this.width, this.height));
    const radialScale = Math.min(width, height) / oldMinDimension;

    const positioned = [
      this.helicopters,
      this.fires,
      this.burned,
      this.trees,
      this.cabins,
      this.campground,
      this.route,
      this.state.buildings,
      this.state.warnings,
      this.state.units,
      this.state.convoyVehicles,
    ];
    for (const list of positioned) {
      for (const item of list) { item.x *= sx; item.y *= sy; }
    }

    for (const chunk of this.state.chunks) {
      chunk.x *= sx;
      chunk.width *= sx;
    }

    for (const list of [this.fires, this.burned]) {
      for (const item of list) item.radius *= radialScale;
    }

    for (const item of [this.water, this.fireStation, this.helipad]) {
      item.x *= sx;
      item.y *= sy;
    }
    this.water.radius *= radialScale;
    this.helipad.radius *= radialScale;
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

  objectiveIgnitionClearance() {
    return Math.max(58, Math.min(96, Math.min(this.width, this.height) * .16));
  }

  isProtectedIgnition(position) {
    const clearance = this.objectiveIgnitionClearance();
    const protectedActors = this.mode === 'protect-town'
      ? this.state.buildings
      : this.mode === 'evacuation'
        ? this.state.units
        : this.mode === 'convoy-protection'
          ? this.state.convoyVehicles
          : [];

    if (protectedActors.some((actor) => actor.hp > 0 && distance(position, actor) < clearance)) {
      return true;
    }

    if (this.mode !== 'evacuation' && this.mode !== 'convoy-protection') return false;

    for (let index = 1; index < this.route.length; index += 1) {
      if (distanceToSegment(position, this.route[index - 1], this.route[index]) < clearance) {
        return true;
      }
    }

    return false;
  }

  spawnFire(x, y, { hp = 100, kind = 'wildfire', spreading = false } = {}) {
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
      if (!spreading && this.isProtectedIgnition({ x: fx, y: fy })) continue;

      this.fires.push({
        x: fx,
        y: fy,
        hp: clamp(Number(hp) || 100, 10, this.maximumFireHealth),
        radius: 22 + Math.random() * 8,
        kind,
        born: performance.now(),
      });
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

  finish(outcome, reason) {
    if (this.complete) return false;
    this.complete = true;
    this.state.outcome = outcome === 'won' ? 'won' : 'lost';
    this.state.reason = String(reason || 'Mission complete.');
    return true;
  }

  createSnapshot(now = performance.now()) {
    const minDimension = Math.max(1, Math.min(this.width, this.height));
    const normalizeX = (value) => clamp(value / Math.max(1, this.width), 0, 1);
    const normalizeY = (value) => clamp(value / Math.max(1, this.height), 0, 1);
    const normalizeActor = (item) => ({ ...item, x: normalizeX(item.x), y: normalizeY(item.y) });
    const state = this.state;

    return {
      version: SNAPSHOT_VERSION,
      round: this.round,
      mode: this.mode,
      level: this.level,
      timeLeft: this.timeLeft,
      complete: this.complete,
      extinguished: this.extinguished,
      spreadElapsedMs: Math.max(0, now - this.lastSpread),
      map: {
        waterRadius: this.water.radius / minDimension,
        helipadRadius: this.helipad.radius / minDimension,
      },
      fires: this.fires.map((fire) => ({
        x: normalizeX(fire.x),
        y: normalizeY(fire.y),
        hp: fire.hp,
        radius: fire.radius / minDimension,
        kind: fire.kind || 'wildfire',
      })),
      burned: this.burned.map((patch) => ({
        x: normalizeX(patch.x),
        y: normalizeY(patch.y),
        age: patch.age,
        radius: patch.radius / minDimension,
      })),
      helicopters: this.helicopters.map((heli) => ({
        id: heli.id,
        helicopterType: normalizeHelicopterType(heli.helicopterType),
        x: normalizeX(heli.x),
        y: normalizeY(heli.y),
        vx: heli.vx,
        vy: heli.vy,
        water: heli.water,
        capacity: heli.capacity,
        refillProgress: heli.refillProgress,
      })),
      modeState: {
        elapsed: state.elapsed,
        danger: state.danger,
        dangerSeconds: state.dangerSeconds,
        difficultyTier: state.difficultyTier,
        highestDifficulty: state.highestDifficulty,
        teamWaterDropped: state.teamWaterDropped,
        outcome: state.outcome,
        reason: state.reason,
        objectivePhase: state.objectivePhase,
        objectiveSeconds: state.objectiveSeconds,
        warningCooldown: state.warningCooldown,
        warnings: state.warnings.map(normalizeActor),
        buildings: state.buildings.map(normalizeActor),
        buildingsLost: state.buildingsLost,
        units: state.units.map(normalizeActor),
        evacuated: state.evacuated,
        unitsLost: state.unitsLost,
        unitsRequired: state.unitsRequired,
        vehicleCooldown: state.vehicleCooldown,
        routeBlocked: state.routeBlocked,
        blockedSeconds: state.blockedSeconds,
        distanceMeters: state.distanceMeters,
        convoyIntegrity: state.convoyIntegrity,
        convoyVehicles: state.convoyVehicles.map(normalizeActor),
        chunks: state.chunks.map((chunk) => ({
          ...chunk,
          x: chunk.x / Math.max(1, this.width),
          width: chunk.width / Math.max(1, this.width),
        })),
        nextChunkIndex: state.nextChunkIndex,
        nextEventId: state.nextEventId,
      },
    };
  }

  applySnapshot(snapshot, now = performance.now()) {
    if (!snapshot || Number(snapshot.round) !== this.round) return false;
    if (snapshot.mode !== this.mode || snapshot.level !== this.level) return false;

    const minDimension = Math.max(1, Math.min(this.width, this.height));
    const denormalizeX = (value) => clamp(Number(value) || 0, 0, 1) * this.width;
    const denormalizeY = (value) => clamp(Number(value) || 0, 0, 1) * this.height;
    const playersById = new Map(this.players.map((player) => [player.id, player]));

    this.timeLeft = clamp(Number(snapshot.timeLeft) || 0, 0, this.durationSeconds ?? 43200);
    this.complete = Boolean(snapshot.complete);
    this.extinguished = Math.max(0, Math.floor(Number(snapshot.extinguished) || 0));
    this.lastSpread = now - clamp(Number(snapshot.spreadElapsedMs) || 0, 0, 60000);
    this.lastTick = now;

    if (snapshot.map) {
      this.water.radius = clamp(Number(snapshot.map.waterRadius) || .1, .025, .35) * minDimension;
      this.helipad.radius = clamp(Number(snapshot.map.helipadRadius) || .05, .015, .2) * minDimension;
    }

    this.fires = Array.isArray(snapshot.fires)
      ? snapshot.fires.map((fire) => ({
          x: denormalizeX(fire.x),
          y: denormalizeY(fire.y),
          hp: clamp(Number(fire.hp) || 0, 0, this.maximumFireHealth),
          radius: clamp(Number(fire.radius) || .03, .005, .12) * minDimension,
          kind: String(fire.kind || 'wildfire'),
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
          helicopterType: DEFAULT_HELICOPTER_TYPE,
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
          helicopterType: normalizeHelicopterType(player?.helicopterType ?? remoteHeli.helicopterType),
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

    if (snapshot.modeState && typeof snapshot.modeState === 'object') {
      const incoming = snapshot.modeState;
      const base = createModeState(this.mode, this.players.length);
      const restoreActor = (item) => ({
        ...item,
        x: denormalizeX(item.x),
        y: denormalizeY(item.y),
      });

      this.state = {
        ...base,
        elapsed: clamp(Number(incoming.elapsed) || 0, 0, 43200),
        danger: clamp(Number(incoming.danger) || 0, 0, 100),
        dangerSeconds: clamp(Number(incoming.dangerSeconds) || 0, 0, 600),
        difficultyTier: Math.max(1, Math.floor(Number(incoming.difficultyTier) || 1)),
        highestDifficulty: Math.max(1, Math.floor(Number(incoming.highestDifficulty) || 1)),
        teamWaterDropped: Math.max(0, Number(incoming.teamWaterDropped) || 0),
        outcome: ['active', 'won', 'lost'].includes(incoming.outcome) ? incoming.outcome : 'active',
        reason: String(incoming.reason || '').slice(0, 160),
        objectivePhase: incoming.objectivePhase === 'containment' ? 'containment' : 'active',
        objectiveSeconds: clamp(Number(incoming.objectiveSeconds) || 0, 0, 1200),
        warningCooldown: clamp(Number(incoming.warningCooldown) || 0, 0, 300),
        warnings: Array.isArray(incoming.warnings)
          ? incoming.warnings.slice(0, 16).map(restoreActor)
          : [],
        buildings: Array.isArray(incoming.buildings)
          ? incoming.buildings.slice(0, 16).map(restoreActor)
          : base.buildings,
        buildingsLost: Math.max(0, Math.floor(Number(incoming.buildingsLost) || 0)),
        units: Array.isArray(incoming.units)
          ? incoming.units.slice(0, 20).map(restoreActor)
          : [],
        evacuated: Math.max(0, Math.floor(Number(incoming.evacuated) || 0)),
        unitsLost: Math.max(0, Math.floor(Number(incoming.unitsLost) || 0)),
        unitsRequired: Math.max(0, Math.floor(Number(incoming.unitsRequired) || 0)),
        vehicleCooldown: clamp(Number(incoming.vehicleCooldown) || 0, 0, 120),
        routeBlocked: Boolean(incoming.routeBlocked),
        blockedSeconds: clamp(Number(incoming.blockedSeconds) || 0, 0, 1200),
        distanceMeters: Math.max(0, Number(incoming.distanceMeters) || 0),
        convoyIntegrity: clamp(Number(incoming.convoyIntegrity) || 0, 0, 100),
        convoyVehicles: Array.isArray(incoming.convoyVehicles)
          ? incoming.convoyVehicles.slice(0, 8).map(restoreActor)
          : [],
        chunks: Array.isArray(incoming.chunks)
          ? incoming.chunks.slice(0, 8).map((chunk) => ({
              ...chunk,
              index: Math.floor(Number(chunk.index) || 0),
              x: clamp(Number(chunk.x) || 0, -3, 4) * this.width,
              width: clamp(Number(chunk.width) || .64, .15, 1.5) * this.width,
              variant: Math.max(0, Math.floor(Number(chunk.variant) || 0)),
              activated: Boolean(chunk.activated),
            }))
          : [],
        nextChunkIndex: Math.max(0, Math.floor(Number(incoming.nextChunkIndex) || 0)),
        nextEventId: Math.max(1, Math.floor(Number(incoming.nextEventId) || 1)),
      };
    } else if (this.complete && this.state.outcome === 'active') {
      this.state.outcome = this.mode === 'classic' ? 'won' : 'lost';
    }

    return true;
  }

  tick(now = performance.now()) {
    if (this.complete) return;
    const elapsed = Math.max(0, (now - this.lastTick) / 1000);
    const dt = Math.min(.05, elapsed);
    this.lastTick = now;
    this.state.elapsed += elapsed;

    if (this.durationSeconds !== null) {
      this.timeLeft = Math.max(0, this.timeLeft - elapsed);
      if (this.roundEndsAt) {
        this.timeLeft = Math.min(this.timeLeft, Math.max(0, (this.roundEndsAt - Date.now()) / 1000));
      }
      if (this.timeLeft <= 0) {
        this.finish(
          this.mode === 'classic' ? 'won' : 'lost',
          this.mode === 'classic' ? 'The team completed the training round.' : 'The mission ran out of time.',
        );
        return;
      }
    }

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
          if (activelyDropping) {
            const spent = Math.min(heli.water, 19 * dt);
            heli.water = Math.max(0, heli.water - spent);
            this.state.teamWaterDropped += spent;
          }
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

    this.modeController.update(this, dt, elapsed);
    if (this.complete) return;

    if (now - this.lastSpread >= this.modeController.spreadInterval(this)) {
      this.lastSpread = now;
      this.modeController.spread(this);
    }
  }
}
