import assert from 'node:assert/strict';
import test from 'node:test';
import { DIFFICULTIES } from '../src/game/config.js';
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
  levelsForMode,
  playableModes,
  roundDurationForMode,
} from '../src/game/modes.js';
import { scaleForPlayers } from '../src/game/scaling.js';
import { addPlayer, canStart, chooseColor, createRoom } from '../src/game/room-state.js';
import { BlazeSimulation } from '../src/game/simulation.js';
import { attachJoystick } from '../src/ui/joystick.js';
import { drawSimulation } from '../src/ui/render.js';

function players(count = 2) {
  const colors = ['red', 'blue', 'yellow', 'green', 'purple', 'orange'];
  return Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? 'host-id' : `guest-${index - 1}`,
    name: `Player ${index + 1}`,
    colorId: colors[index],
  }));
}

function modeSimulation(mode, options = {}) {
  return new BlazeSimulation({
    width: 1000,
    height: 600,
    players: players(1),
    mode,
    level: defaultLevelForMode(mode),
    ...options,
  });
}

function advance(sim, seconds, { clearFires = false } = {}) {
  const frames = Math.ceil(seconds / .05);
  for (let frame = 0; frame < frames && !sim.complete; frame += 1) {
    if (clearFires) sim.fires = [];
    sim.tick(sim.lastTick + 50);
  }
}

test('the shared mode registry exposes Classic Co-op and its starter level', () => {
  assert.equal(GAME_MODES[DEFAULT_MODE_ID].label, 'Classic Co-op');
  assert.equal(defaultLevelForMode(DEFAULT_MODE_ID), DEFAULT_LEVEL_ID);
  assert.equal(isValidMode(DEFAULT_MODE_ID), true);
  assert.equal(isValidMode('unknown-mode'), false);
  assert.equal(isValidLevel(DEFAULT_MODE_ID, DEFAULT_LEVEL_ID), true);
  assert.equal(isValidLevel(DEFAULT_MODE_ID, 'unknown-level'), false);
  assert.equal(levelsForMode(DEFAULT_MODE_ID)[0].id, DEFAULT_LEVEL_ID);
});

test('the public mission registry exposes exactly five selectable modes and one valid level per mode', () => {
  const ids = playableModes().map((mode) => mode.id);
  assert.deepEqual(ids, [
    'wildfire-survival',
    'protect-town',
    'spot-fire',
    'evacuation',
    'convoy-protection',
  ]);

  for (const mode of playableModes()) {
    assert.equal(isValidMode(mode.id), true);
    assert.ok(mode.description.length > 10);
    assert.ok(levelsForMode(mode.id).length >= 1);
    assert.equal(isValidLevel(mode.id, defaultLevelForMode(mode.id)), true);
    assert.equal(GAME_LEVELS[defaultLevelForMode(mode.id)].map.water.radius > 0, true);
  }
  assert.equal(GAME_MODES.classic.selectable, false);
});

test('endless modes have no round deadline while mission modes have their configured durations', () => {
  assert.equal(roundDurationForMode('wildfire-survival', 'survival-grounds', 150), null);
  assert.equal(roundDurationForMode('convoy-protection', 'endless-fire-road', 150), null);
  assert.equal(roundDurationForMode('protect-town', 'pine-ridge-town', 150), 300);
  assert.equal(roundDurationForMode('spot-fire', 'ember-valley', 150), 240);
  assert.equal(roundDurationForMode('evacuation', 'cedar-creek-road', 150), 300);
});

test('local room helpers use the same mode, level, upgrades, and active-player rules', () => {
  const room = createRoom({ roomCode: 'TEST', hostId: 'host-id' });
  assert.equal(room.mode, DEFAULT_MODE_ID);
  assert.equal(room.level, DEFAULT_LEVEL_ID);
  assert.deepEqual(room.upgrades, { tank: 0, speed: 0, power: 0 });
  chooseColor(room, 'host-id', 'red');

  for (let index = 0; index < 5; index += 1) {
    addPlayer(room, { id: `guest-${index}`, name: `Guest ${index}` });
  }
  assert.doesNotThrow(() => addPlayer(room, { id: 'host-id', name: 'Returning host' }));
  assert.throws(() => addPlayer(room, { id: 'seventh' }), /Room is full/);

  for (const player of room.players.slice(1)) player.connected = false;
  assert.equal(canStart(room, 'host-id'), true);
});

test('a local room automatically selects the correct first level for any mission', () => {
  for (const mode of playableModes()) {
    const room = createRoom({ roomCode: 'TEST', hostId: 'host-id', mode: mode.id });
    assert.equal(room.mode, mode.id);
    assert.equal(room.level, defaultLevelForMode(mode.id));
  }
});

test('the simulation and every snapshot identify their shared mode and level', () => {
  const sim = new BlazeSimulation({ width: 1000, height: 600, players: players() });
  const snapshot = sim.createSnapshot();
  assert.equal(snapshot.version, SNAPSHOT_VERSION);
  assert.equal(snapshot.mode, DEFAULT_MODE_ID);
  assert.equal(snapshot.level, DEFAULT_LEVEL_ID);
  assert.equal(sim.applySnapshot({ ...snapshot, mode: 'unknown-mode' }), false);
  assert.equal(sim.applySnapshot({ ...snapshot, level: 'unknown-level' }), false);
});

test('a guest receives the same normalized fire positions and health as its host', () => {
  const host = new BlazeSimulation({ width: 1000, height: 600, players: players() });
  const guest = new BlazeSimulation({ width: 500, height: 300, players: players(), spawnInitialFires: false });
  assert.equal(guest.fires.length, 0);
  host.fires[0].hp = 37;
  assert.equal(guest.applySnapshot(host.createSnapshot()), true);
  assert.equal(guest.fires.length, host.fires.length);
  assert.equal(guest.fires[0].hp, 37);

  host.fires.forEach((fire, index) => {
    assert.ok(Math.abs(fire.x / host.width - guest.fires[index].x / guest.width) < 1e-9);
    assert.ok(Math.abs(fire.y / host.height - guest.fires[index].y / guest.height) < 1e-9);
  });
});

test('the refill lake and helipad use the same normalized radii on every device', () => {
  const host = new BlazeSimulation({ width: 1200, height: 600, players: players(), spawnInitialFires: false });
  const guest = new BlazeSimulation({ width: 300, height: 600, players: players(), spawnInitialFires: false });
  assert.equal(guest.applySnapshot(host.createSnapshot()), true);

  assert.equal(
    host.water.radius / Math.min(host.width, host.height),
    guest.water.radius / Math.min(guest.width, guest.height),
  );
  assert.equal(
    host.helipad.radius / Math.min(host.width, host.height),
    guest.helipad.radius / Math.min(guest.width, guest.height),
  );
});

test('rotating the screen and rotating back preserves map landmark sizes', () => {
  const sim = new BlazeSimulation({ width: 1200, height: 500, players: players(1), spawnInitialFires: false });
  const lakeRadius = sim.water.radius;
  const helipadRadius = sim.helipad.radius;
  sim.resize(500, 1200);
  sim.resize(1200, 500);
  assert.equal(sim.water.radius, lakeRadius);
  assert.equal(sim.helipad.radius, helipadRadius);
});

test('fire and burned-patch radii resize proportionally with the map', () => {
  const sim = new BlazeSimulation({ width: 1000, height: 600, players: players(1), spawnInitialFires: false });
  sim.fires.push({ x: 500, y: 300, hp: 100, radius: 30, born: 0 });
  sim.burned.push({ x: 600, y: 300, radius: 40, age: 1 });
  sim.resize(500, 300);
  assert.equal(sim.fires[0].radius, 15);
  assert.equal(sim.burned[0].radius, 20);
});

test('the round clock catches up after a backgrounded host resumes', () => {
  const sim = new BlazeSimulation({ width: 1000, height: 600, players: players(1), spawnInitialFires: false });
  const initial = sim.timeLeft;
  sim.tick(sim.lastTick + 10000);
  assert.equal(initial - sim.timeLeft, 10);
});

test('an authoritative room deadline limits the remaining round time', () => {
  const sim = new BlazeSimulation({
    width: 1000,
    height: 600,
    players: players(1),
    roundEndsAt: Date.now() + 3000,
    spawnInitialFires: false,
  });
  sim.tick(sim.lastTick + 50);
  assert.ok(sim.timeLeft <= 3);
});

test('automatic suppression spends water and full refills stop their progress indicator', () => {
  const sim = new BlazeSimulation({ width: 1000, height: 600, players: players(1), spawnInitialFires: false });
  const heli = sim.helicopters[0];
  sim.fires.push({ x: 500, y: 300, hp: 100, radius: 24, born: 0 });
  heli.x = 500;
  heli.y = 300;
  sim.tick(sim.lastTick + 50);
  assert.ok(sim.fires[0].hp < 100);
  assert.ok(heli.water < heli.capacity);

  heli.x = sim.water.x;
  heli.y = sim.water.y;
  heli.water = heli.capacity - .1;
  sim.tick(sim.lastTick + 50);
  assert.equal(heli.water, heli.capacity);
  assert.equal(heli.refillProgress, 0);
});

test('water, speed, and effectiveness upgrades retain their current gameplay effects', () => {
  const sim = new BlazeSimulation({
    width: 1000,
    height: 600,
    players: players(1),
    upgrades: { tank: 2, speed: 1, power: 1 },
    spawnInitialFires: false,
  });
  const heli = sim.helicopters[0];
  assert.equal(heli.capacity, 140);
  heli.x = 500;
  heli.y = 300;
  heli.vx = 1;
  sim.fires.push({ x: 500, y: 300, hp: 100, radius: 24, born: 0 });
  sim.tick(sim.lastTick + 50);
  assert.ok(heli.x > 500 + 155 * .05);
  assert.ok(sim.fires[0].hp < 100 - 48 * .05);
  assert.deepEqual(sim.upgradeChoices().map((upgrade) => upgrade.id), ['tank', 'speed', 'power']);
});

test('fire scaling remains valid across every difficulty and player count', () => {
  for (const difficulty of Object.values(DIFFICULTIES)) {
    let previousMax = 0;
    for (let count = 1; count <= 6; count += 1) {
      const scaled = scaleForPlayers(count, difficulty);
      assert.ok(scaled.maxFires > previousMax);
      assert.ok(scaled.initialFires <= scaled.maxFires);
      assert.ok(scaled.spreadMs >= 1300);
      previousMax = scaled.maxFires;
    }
  }

  assert.equal(scaleForPlayers(6, DIFFICULTIES.wildfire).maxFires, 43);
});

test('invalid resize events cannot corrupt the active map', () => {
  const sim = new BlazeSimulation({ width: 1000, height: 600, players: players(1), spawnInitialFires: false });
  const lakeRadius = sim.water.radius;
  sim.resize(0, 0);
  sim.resize(Number.NaN, 500);
  assert.equal(sim.width, 1000);
  assert.equal(sim.height, 600);
  assert.equal(sim.water.radius, lakeRadius);
});

test('the touch joystick emits directional input and resets when released', () => {
  const listeners = new Map();
  const inputs = [];
  const zone = {
    clientWidth: 172,
    addEventListener(type, listener) { listeners.set(type, listener); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 172, height: 172 }; },
    setPointerCapture() {},
  };
  const knob = {
    clientWidth: 72,
    style: { setProperty() {} },
  };
  attachJoystick(zone, knob, (x, y) => inputs.push({ x, y }));
  listeners.get('pointerdown')({ pointerId: 7, button: 0, clientX: 128, clientY: 86, preventDefault() {} });
  assert.ok(inputs.at(-1).x > .99);
  assert.equal(inputs.at(-1).y, 0);
  listeners.get('pointerup')({ pointerId: 7, preventDefault() {} });
  assert.deepEqual(inputs.at(-1), { x: 0, y: 0 });
});

test('the current map renderer accepts shared simulation state without throwing', () => {
  const sim = new BlazeSimulation({ width: 1000, height: 600, players: players() });
  sim.burned.push({ x: 400, y: 300, age: 2, radius: 20 });
  const context = new Proxy({}, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  assert.doesNotThrow(() => drawSimulation(context, sim));
});

test('every mission initializes without independent guest-side fire or convoy generation', () => {
  for (const mode of playableModes()) {
    const host = modeSimulation(mode.id);
    const guest = modeSimulation(mode.id, {
      width: 480,
      height: 840,
      spawnInitialFires: false,
    });

    assert.equal(guest.fires.length, 0, `${mode.id} guest created its own fires`);
    if (mode.id === 'convoy-protection') {
      assert.equal(guest.state.convoyVehicles.length, 0);
      assert.equal(guest.state.chunks.length, 0);
      assert.equal(host.state.convoyVehicles.length, 4);
    }

    assert.equal(guest.applySnapshot(host.createSnapshot()), true);
    assert.equal(guest.fires.length, host.fires.length);
    assert.equal(guest.state.buildings.length, host.state.buildings.length);
    assert.equal(guest.state.convoyVehicles.length, host.state.convoyVehicles.length);
    assert.equal(guest.state.chunks.length, host.state.chunks.length);
  }
});

test('mission snapshots synchronize objective objects across different phone and computer sizes', () => {
  const host = modeSimulation('spot-fire');
  const guest = modeSimulation('spot-fire', { width: 430, height: 930, spawnInitialFires: false });
  host.state.warnings.push({ id: 'warning-7', x: 710, y: 210, timeLeft: 1.7, duration: 2.4, kind: 'spot' });
  host.state.teamWaterDropped = 84;
  host.state.difficultyTier = 3;
  host.state.highestDifficulty = 3;

  assert.equal(guest.applySnapshot(host.createSnapshot()), true);
  assert.equal(guest.state.warnings[0].id, 'warning-7');
  assert.equal(guest.state.warnings[0].timeLeft, 1.7);
  assert.ok(Math.abs(guest.state.warnings[0].x / guest.width - host.state.warnings[0].x / host.width) < 1e-9);
  assert.ok(Math.abs(guest.state.warnings[0].y / guest.height - host.state.warnings[0].y / host.height) < 1e-9);
  assert.equal(guest.state.teamWaterDropped, 84);
  assert.equal(guest.state.difficultyTier, 3);
});

test('wildfire survival continues past the former fixed timer and escalates gradually', () => {
  const sim = modeSimulation('wildfire-survival', { difficulty: 'easy' });
  sim.lastSpread = Number.POSITIVE_INFINITY;
  advance(sim, 160);
  assert.equal(sim.complete, false);
  assert.equal(sim.timeLeft, 0);
  assert.ok(sim.state.elapsed >= 159.9);
  assert.ok(sim.state.difficultyTier >= 5);
});

test('wildfire survival fails only after sustained overwhelming fire danger', () => {
  const sim = modeSimulation('wildfire-survival');
  sim.lastSpread = Number.POSITIVE_INFINITY;
  sim.fires = Array.from({ length: sim.scaling.maxFires }, (_, index) => ({
    x: 560 + index,
    y: 360,
    hp: 100,
    radius: 20,
    kind: 'wildfire',
  }));

  advance(sim, 7.5);
  assert.equal(sim.complete, false);
  advance(sim, 1);
  assert.equal(sim.complete, true);
  assert.equal(sim.state.outcome, 'lost');
  assert.equal(sim.state.danger, 100);
});

test('protect the town starts with resilient synchronized buildings and can be won', () => {
  const sim = modeSimulation('protect-town');
  assert.equal(sim.state.buildings.length, 7);
  assert.ok(sim.state.buildings.every((building) => building.hp === 100));

  sim.state.elapsed = 2;
  sim.extinguished = sim.fires.length;
  sim.fires = [];
  sim.tick(sim.lastTick + 50);
  assert.equal(sim.complete, true);
  assert.equal(sim.state.outcome, 'won');
  assert.equal(sim.state.buildingsLost, 0);
});

test('protect the town fails after several buildings burn down over time', () => {
  const sim = modeSimulation('protect-town');
  sim.lastSpread = Number.POSITIVE_INFINITY;
  sim.fires = sim.state.buildings.slice(0, 3).map((building) => ({
    x: building.x,
    y: building.y,
    hp: 130,
    radius: 24,
    kind: 'wildfire',
  }));

  advance(sim, 4);
  assert.equal(sim.complete, false);
  assert.ok(sim.state.buildings[0].hp < 100);
  advance(sim, 6);
  assert.equal(sim.complete, true);
  assert.equal(sim.state.outcome, 'lost');
  assert.ok(sim.state.buildingsLost >= 3);
});

test('spot fires provide a synchronized warning before igniting', () => {
  const sim = modeSimulation('spot-fire');
  sim.lastSpread = Number.POSITIVE_INFINITY;
  sim.state.warningCooldown = .01;
  sim.tick(sim.lastTick + 50);
  assert.equal(sim.state.warnings.length, 1);
  const warning = { ...sim.state.warnings[0] };
  const initialCount = sim.fires.length;

  advance(sim, 2.5);
  assert.equal(sim.state.warnings.length, 0);
  assert.ok(sim.fires.length > initialCount);
  assert.ok(sim.fires.some((fire) => Math.abs(fire.x - warning.x) < 1 && Math.abs(fire.y - warning.y) < 1));
});

test('spot fire enters a cleanup phase and ends when all remaining fires are contained', () => {
  const sim = modeSimulation('spot-fire');
  sim.state.elapsed = sim.modeConfig.rules.controlSeconds;
  sim.state.warnings = [];
  sim.fires = [];
  sim.tick(sim.lastTick + 50);
  assert.equal(sim.state.objectivePhase, 'containment');
  assert.equal(sim.complete, true);
  assert.equal(sim.state.outcome, 'won');
});

test('evacuation vehicles stop for road fires and resume after the team clears them', () => {
  const sim = modeSimulation('evacuation');
  sim.lastSpread = Number.POSITIVE_INFINITY;
  sim.fires = [];
  sim.state.vehicleCooldown = 0;
  sim.tick(sim.lastTick + 50);
  assert.equal(sim.state.units.length, 1);

  const vehicle = sim.state.units[0];
  const before = vehicle.progress;
  sim.fires = [{ x: vehicle.x + 35, y: vehicle.y, hp: 100, radius: 25, kind: 'route' }];
  sim.tick(sim.lastTick + 50);
  assert.equal(vehicle.status, 'blocked');
  assert.equal(sim.state.routeBlocked, true);
  assert.equal(vehicle.progress, before);

  sim.fires = [];
  sim.tick(sim.lastTick + 50);
  assert.equal(vehicle.status, 'moving');
  assert.ok(vehicle.progress > before);
});

test('evacuation is won once the required number of vehicles reach safety', () => {
  const sim = modeSimulation('evacuation');
  sim.fires = [];
  sim.lastSpread = Number.POSITIVE_INFINITY;
  sim.state.evacuated = sim.state.unitsRequired - 1;
  sim.state.units = [{
    id: 'vehicle-last',
    kind: 'car',
    x: sim.route.at(-1).x,
    y: sim.route.at(-1).y,
    progress: .999,
    hp: 100,
    maxHp: 100,
    status: 'moving',
  }];

  sim.tick(sim.lastTick + 50);
  assert.equal(sim.complete, true);
  assert.equal(sim.state.outcome, 'won');
  assert.equal(sim.state.evacuated, sim.state.unitsRequired);
});

test('convoy protection scrolls a bounded reusable chunk stream and tracks distance', () => {
  const sim = modeSimulation('convoy-protection');
  const startingIndices = sim.state.chunks.map((chunk) => chunk.index);
  sim.lastSpread = Number.POSITIVE_INFINITY;
  advance(sim, 48, { clearFires: true });

  assert.equal(sim.complete, false);
  assert.ok(sim.state.distanceMeters > 1500);
  assert.ok(sim.state.difficultyTier >= 2);
  assert.ok(sim.state.chunks.length <= sim.modeConfig.rules.maximumChunks);
  assert.ok(sim.state.chunks.some((chunk) => chunk.index > Math.max(...startingIndices)));
  assert.ok(sim.state.chunks.every((chunk) => chunk.x + chunk.width > -sim.width * .45));
});

test('convoy fires stop the vehicles and damage their integrity before ending the run', () => {
  const sim = modeSimulation('convoy-protection');
  const lead = sim.state.convoyVehicles[0];
  sim.lastSpread = Number.POSITIVE_INFINITY;
  sim.fires = [{ x: lead.x + 30, y: lead.y, hp: 120, radius: 24, kind: 'route' }];
  const distanceBefore = sim.state.distanceMeters;
  sim.tick(sim.lastTick + 50);
  assert.equal(sim.state.routeBlocked, true);
  assert.equal(sim.state.distanceMeters, distanceBefore);
  assert.equal(sim.complete, false);

  sim.state.blockedSeconds = 12;
  sim.state.convoyIntegrity = .05;
  sim.tick(sim.lastTick + 50);
  assert.equal(sim.complete, true);
  assert.equal(sim.state.outcome, 'lost');
});

test('mission objects and moving chunks resize safely with screen rotation', () => {
  const town = modeSimulation('protect-town');
  const initialBuilding = { ...town.state.buildings[0] };
  town.resize(500, 300);
  assert.equal(town.state.buildings[0].x, initialBuilding.x / 2);
  assert.equal(town.state.buildings[0].y, initialBuilding.y / 2);

  const convoy = modeSimulation('convoy-protection');
  const initialWidth = convoy.state.chunks[0].width;
  convoy.resize(500, 300);
  assert.equal(convoy.state.chunks[0].width, initialWidth / 2);
  assert.equal(convoy.state.convoyVehicles[0].x, 185);
});

test('team sizes increase mission pressure without multiplying every objective by player count', () => {
  for (const mode of playableModes()) {
    const solo = modeSimulation(mode.id, { players: players(1) });
    const full = modeSimulation(mode.id, { players: players(6) });
    assert.ok(full.scaling.maxFires > solo.scaling.maxFires);
    assert.ok(full.teamPressure < 2);
    assert.ok(fireLimitForMode(mode.id, scaleForPlayers(6, DIFFICULTIES.normal).maxFires) <= 96);
    if (mode.id === 'evacuation') {
      assert.ok(full.state.unitsRequired > solo.state.unitsRequired);
      assert.ok(full.state.unitsRequired < solo.state.unitsRequired * 2);
    }
  }
});

test('a full multiplayer convoy snapshot remains below the Cloudflare WebSocket message limit', () => {
  const sim = modeSimulation('convoy-protection', { players: players(6) });
  sim.fires = Array.from({ length: sim.scaling.maxFires }, (_, index) => ({
    x: 50 + (index * 17) % 900,
    y: 50 + (index * 23) % 500,
    hp: 140,
    radius: 27,
    kind: 'route',
  }));
  sim.state.warnings = Array.from({ length: 16 }, (_, index) => ({
    id: `warning-${index}`,
    x: 100 + index * 40,
    y: 300,
    timeLeft: 1.4,
    duration: 2.4,
    kind: 'spot',
  }));

  const message = JSON.stringify({ type: 'matchSnapshot', snapshot: sim.createSnapshot() });
  assert.ok(Buffer.byteLength(message) < 96 * 1024);
});

test('all five mode renderers accept their shared buildings, warnings, vehicles, and chunks', () => {
  const context = new Proxy({}, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });

  for (const mode of playableModes()) {
    const sim = modeSimulation(mode.id);
    if (mode.id === 'spot-fire') {
      sim.state.warnings.push({ id: 'warning-1', x: 600, y: 300, timeLeft: 1, duration: 2 });
    }
    assert.doesNotThrow(() => drawSimulation(context, sim), mode.id);
  }
});
