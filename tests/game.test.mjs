import assert from 'node:assert/strict';
import test from 'node:test';
import { DIFFICULTIES } from '../src/game/config.js';
import {
  DEFAULT_LEVEL_ID,
  DEFAULT_MODE_ID,
  GAME_MODES,
  defaultLevelForMode,
  isValidLevel,
  isValidMode,
  levelsForMode,
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

test('the shared mode registry exposes Classic Co-op and its starter level', () => {
  assert.equal(GAME_MODES[DEFAULT_MODE_ID].label, 'Classic Co-op');
  assert.equal(defaultLevelForMode(DEFAULT_MODE_ID), DEFAULT_LEVEL_ID);
  assert.equal(isValidMode(DEFAULT_MODE_ID), true);
  assert.equal(isValidMode('unknown-mode'), false);
  assert.equal(isValidLevel(DEFAULT_MODE_ID, DEFAULT_LEVEL_ID), true);
  assert.equal(isValidLevel(DEFAULT_MODE_ID, 'unknown-level'), false);
  assert.equal(levelsForMode(DEFAULT_MODE_ID)[0].id, DEFAULT_LEVEL_ID);
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

test('the simulation and every snapshot identify their shared mode and level', () => {
  const sim = new BlazeSimulation({ width: 1000, height: 600, players: players() });
  const snapshot = sim.createSnapshot();
  assert.equal(snapshot.version, 2);
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
