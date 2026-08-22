import assert from 'node:assert/strict';
import test from 'node:test';
import { DIFFICULTIES } from '../src/game/config.js';
import {
  GAME_MODES,
  SNAPSHOT_VERSION,
  defaultLevelForMode,
  fireLimitForMode,
  playableModes,
  roundDurationForMode,
} from '../src/game/modes.js';
import { scaleForPlayers } from '../src/game/scaling.js';
import { BlazeSimulation } from '../src/game/simulation.js';
import {
  createContext,
  createFixture,
  GameRoom,
  makeSnapshot,
  sanitizeSnapshot,
  tokenFor,
  worker,
} from './helpers/worker-fixture.mjs';

test('the Worker health endpoint responds without room storage', async () => {
  const result = await worker.fetch(new Request('https://example.test/api/health'), {});
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, service: 'blaze-copters' });
});

test('room creation requires a valid private session token', async () => {
  const result = await worker.fetch(new Request('https://example.test/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hostId: 'host-id' }),
  }), {});
  assert.equal(result.status, 400);
});

test('the public room preview never exposes player identities or session credentials', async () => {
  const { game, host } = await createFixture();
  const response = await game.fetch(new Request('https://example.test/api/rooms/TEST/state'));
  const preview = (await response.json()).room;
  assert.equal(preview.roomCode, 'TEST');
  assert.equal(preview.mode, 'classic');
  assert.equal(preview.level, 'starter');
  assert.equal(preview.joinable, true);
  assert.equal(Object.hasOwn(preview, 'hostId'), false);
  assert.equal(Object.hasOwn(preview, 'players'), false);

  const state = host.sent.findLast((message) => message.type === 'state').room;
  assert.ok(state.players.every((player) => !Object.hasOwn(player, 'sessionToken')));
  assert.ok(state.players.every((player) => !Object.hasOwn(player, 'connectionId')));
});

test('a guessed or stolen player identity cannot reconnect without its private token', async () => {
  const { game, connect } = await createFixture();
  const attacker = await connect('host-id', 'Impersonator', { token: tokenFor('attacker') });
  assert.equal(attacker.response.status, 403);
  assert.equal(attacker.socket, null);
  const room = await game.getRoom();
  assert.equal(room.players.find((player) => player.id === 'host-id').name, 'Host');
});

test('a legitimate reconnect replaces the previous socket without disconnecting the new session', async () => {
  const { game, host, connect } = await createFixture();
  const replacement = await connect('host-id', 'Host reconnected');
  assert.equal(replacement.response.status, 101);
  assert.equal(host.closed, true);
  assert.equal(host.closeCode, 4001);

  await game.webSocketClose(host);
  const room = await game.getRoom();
  const currentHost = room.players.find((player) => player.id === 'host-id');
  assert.equal(currentHost.connected, true);
  assert.equal(currentHost.colorId, 'red');
  assert.equal(room.hostId, 'host-id');

  await game.webSocketMessage(host, JSON.stringify({ type: 'setDifficulty', difficulty: 'wildfire' }));
  assert.equal((await game.getRoom()).difficulty, 'normal');
});

test('disconnected teammates keep their helicopter color when reconnecting', async () => {
  const { game, guests, connect } = await createFixture({ start: true });
  await game.webSocketClose(guests[0]);
  const replacement = await connect('guest-0', 'Guest returned');
  assert.equal(replacement.response.status, 101);
  const player = (await game.getRoom()).players.find((item) => item.id === 'guest-0');
  assert.equal(player.connected, true);
  assert.equal(player.colorId, 'blue');
});

test('new players cannot join after a round starts, but existing teammates can reconnect', async () => {
  const { game, guests, connect } = await createFixture({ start: true });
  const late = await connect('late-player', 'Late player');
  assert.equal(late.response.status, 409);

  await game.webSocketClose(guests[0]);
  const reconnect = await connect('guest-0', 'Returning teammate');
  assert.equal(reconnect.response.status, 101);
});

test('rooms enforce six connected players', async () => {
  const { connect } = await createFixture({ guests: 5 });
  const seventh = await connect('guest-six', 'Too many');
  assert.equal(seventh.response.status, 409);
});

test('a returning player cannot reconnect as a seventh active lobby participant', async () => {
  const { game, guests, connect } = await createFixture({ guests: 5 });
  await game.webSocketClose(guests[0]);
  const replacement = await connect('replacement-player', 'Replacement');
  assert.equal(replacement.response.status, 101);

  const returning = await connect('guest-0', 'Returning guest');
  assert.equal(returning.response.status, 409);
  assert.equal((await game.getRoom()).players.filter((player) => player.connected).length, 6);
});

test('duplicate helicopter colors are rejected', async () => {
  const { game, guests } = await createFixture();
  await game.webSocketMessage(guests[0], JSON.stringify({ type: 'setColor', colorId: 'red' }));
  assert.equal(guests[0].sent.at(-1).type, 'error');
  assert.equal((await game.getRoom()).players.find((player) => player.id === 'guest-0').colorId, 'blue');
});

test('only the current host can start a room after all players select colors', async () => {
  const { game, host, guests } = await createFixture();
  await game.webSocketMessage(guests[0], JSON.stringify({ type: 'start' }));
  assert.equal((await game.getRoom()).phase, 'lobby');
  await game.webSocketMessage(host, JSON.stringify({ type: 'start' }));
  const room = await game.getRoom();
  assert.equal(room.phase, 'playing');
  assert.ok(room.roundEndsAt > Date.now());
});

test('host privileges move to a connected teammate after the current host disconnects', async () => {
  const { game, host } = await createFixture({ start: true });
  await game.webSocketClose(host);
  const room = await game.getRoom();
  assert.equal(room.hostId, 'guest-0');
  assert.equal(room.players.find((player) => player.id === 'guest-0').isHost, true);
});

test('difficulty, mode, level, and color settings cannot change during a round', async () => {
  const { game, host } = await createFixture({ start: true });
  await game.webSocketMessage(host, JSON.stringify({ type: 'setDifficulty', difficulty: 'wildfire' }));
  await game.webSocketMessage(host, JSON.stringify({ type: 'setMode', mode: 'classic' }));
  await game.webSocketMessage(host, JSON.stringify({ type: 'setLevel', level: 'starter' }));
  await game.webSocketMessage(host, JSON.stringify({ type: 'setColor', colorId: 'green' }));
  const room = await game.getRoom();
  assert.equal(room.difficulty, 'normal');
  assert.equal(room.mode, 'classic');
  assert.equal(room.level, 'starter');
  assert.equal(room.players.find((player) => player.id === 'host-id').colorId, 'red');
});

test('invalid game modes and levels are rejected before starting', async () => {
  const { game, host } = await createFixture();
  await game.webSocketMessage(host, JSON.stringify({ type: 'setMode', mode: 'fake-mode' }));
  await game.webSocketMessage(host, JSON.stringify({ type: 'setLevel', level: 'fake-level' }));
  const room = await game.getRoom();
  assert.equal(room.mode, 'classic');
  assert.equal(room.level, 'starter');
});

test('non-host snapshots cannot overwrite a shared match', async () => {
  const { game, host, guests } = await createFixture({ start: true });
  const previousCount = host.sent.length;
  await game.webSocketMessage(guests[0], JSON.stringify({
    type: 'matchSnapshot',
    snapshot: makeSnapshot(await game.getRoom()),
  }));
  assert.equal(host.sent.length, previousCount);
});

test('snapshots from another mode or level cannot overwrite the current match', async () => {
  const { game, host, guests } = await createFixture({ start: true });
  const previousCount = guests[0].sent.length;
  const room = await game.getRoom();
  await game.webSocketMessage(host, JSON.stringify({
    type: 'matchSnapshot',
    snapshot: makeSnapshot(room, { mode: 'different-mode' }),
  }));
  await game.webSocketMessage(host, JSON.stringify({
    type: 'matchSnapshot',
    snapshot: makeSnapshot(room, { level: 'different-level' }),
  }));
  assert.equal(guests[0].sent.length, previousCount);
});

test('all 43 fires remain synchronized in six-player Wildfire mode', async () => {
  const { game, host, guests } = await createFixture({ guests: 5 });
  await game.webSocketMessage(host, JSON.stringify({ type: 'setDifficulty', difficulty: 'wildfire' }));
  await game.webSocketMessage(host, JSON.stringify({ type: 'start' }));
  const room = await game.getRoom();
  const maxFires = scaleForPlayers(6, DIFFICULTIES.wildfire).maxFires;
  const fires = Array.from({ length: maxFires }, (_, index) => ({
    x: index / maxFires,
    y: .5,
    hp: 100,
    radius: .03,
  }));
  await game.webSocketMessage(host, JSON.stringify({
    type: 'matchSnapshot',
    snapshot: makeSnapshot(room, { fires }),
  }));
  const received = guests[0].sent.at(-1).snapshot;
  assert.equal(maxFires, 43);
  assert.equal(received.fires.length, maxFires);
});

test('existing fires stay synchronized when a player disconnects from a full Wildfire room', async () => {
  const { game, host, guests } = await createFixture({ guests: 5 });
  await game.webSocketMessage(host, JSON.stringify({ type: 'setDifficulty', difficulty: 'wildfire' }));
  await game.webSocketMessage(host, JSON.stringify({ type: 'start' }));
  let room = await game.getRoom();
  const fires = Array.from({ length: 43 }, (_, index) => ({ x: index / 43, y: .5, hp: 100, radius: .03 }));
  await game.webSocketMessage(host, JSON.stringify({ type: 'matchSnapshot', snapshot: makeSnapshot(room, { fires }) }));

  await game.webSocketClose(guests[4]);
  room = await game.getRoom();
  await game.webSocketMessage(host, JSON.stringify({ type: 'matchSnapshot', snapshot: makeSnapshot(room, { fires }) }));
  assert.equal(guests[0].sent.at(-1).snapshot.fires.length, 43);
});

test('the Worker clamps unsafe snapshot values and shares normalized map sizes', async () => {
  const { game, host, guests } = await createFixture({ start: true });
  const room = await game.getRoom();
  await game.webSocketMessage(host, JSON.stringify({
    type: 'matchSnapshot',
    snapshot: makeSnapshot(room, {
      fires: [{ x: -2, y: 4, hp: 500, radius: 1 }],
      map: { waterRadius: 10, helipadRadius: -10 },
      helicopters: [{ id: 'host-id', x: 2, y: -1, water: 9000, capacity: 9000 }],
    }),
  }));
  const snapshot = guests[0].sent.at(-1).snapshot;
  assert.deepEqual(snapshot.fires[0], { x: 0, y: 1, hp: 100, radius: .12 });
  assert.deepEqual(snapshot.map, { waterRadius: .35, helipadRadius: .015 });
  assert.equal(snapshot.helicopters[0].water, 1000);
  assert.equal(snapshot.helicopters[0].capacity, 1000);
});

test('a reconnect receives the latest saved match snapshot immediately', async () => {
  const { game, host, guests, connect } = await createFixture({ start: true });
  const room = await game.getRoom();
  await game.webSocketMessage(host, JSON.stringify({
    type: 'matchSnapshot',
    snapshot: makeSnapshot(room, {
      fires: [{ x: .25, y: .75, hp: 60, radius: .03 }],
    }),
  }));
  await game.webSocketClose(guests[0]);
  const replacement = await connect('guest-0', 'Guest returned');
  const restored = replacement.socket.sent.findLast((message) => message.type === 'matchSnapshot');
  assert.equal(restored.restore, true);
  assert.equal(restored.snapshot.fires[0].hp, 60);
});

test('the cloud alarm ends an inactive host round using its authoritative deadline', async () => {
  const { game, host, guests } = await createFixture({ start: true });
  let room = await game.getRoom();
  await game.webSocketMessage(host, JSON.stringify({
    type: 'matchSnapshot',
    snapshot: makeSnapshot(room, { fires: [{ x: .3, y: .4, hp: 90, radius: .04 }] }),
  }));

  room = await game.getRoom();
  room.roundEndsAt = Date.now() - 1;
  await game.saveRoom(room);
  await game.alarm();

  const completed = await game.getRoom();
  assert.equal(completed.phase, 'roundEnd');
  assert.equal(completed.roundEndsAt, null);
  assert.equal(completed.lastSnapshot.timeLeft, 0);
  assert.equal(completed.lastSnapshot.complete, true);
  assert.equal(guests[0].sent.findLast((message) => message.type === 'matchSnapshot').snapshot.complete, true);
});

test('a stalled host is replaced automatically so connected teammates can continue playing', async () => {
  const { game, guests } = await createFixture({ start: true });
  const room = await game.getRoom();
  room.hostAssignedAt = Date.now() - 7000;
  room.snapshotSavedAt = Date.now() - 7000;
  await game.saveRoom(room);
  await game.alarm();

  const updated = await game.getRoom();
  assert.equal(updated.phase, 'playing');
  assert.equal(updated.hostId, 'guest-0');
  assert.equal(updated.players.find((player) => player.id === 'guest-0').isHost, true);
  assert.equal(guests[0].sent.at(-1).room.hostId, 'guest-0');
});

test('completed rounds accept one team upgrade and advance to the next lobby', async () => {
  const { game, host } = await createFixture({ start: true });
  const room = await game.getRoom();
  await game.webSocketMessage(host, JSON.stringify({
    type: 'matchSnapshot',
    snapshot: makeSnapshot(room, { timeLeft: 0, complete: true }),
  }));
  assert.equal((await game.getRoom()).phase, 'roundEnd');
  await game.webSocketMessage(host, JSON.stringify({ type: 'chooseUpgrade', upgradeId: 'tank' }));
  await game.webSocketMessage(host, JSON.stringify({ type: 'chooseUpgrade', upgradeId: 'power' }));
  assert.deepEqual((await game.getRoom()).upgrades, { tank: 1, speed: 0, power: 0 });
  await game.webSocketMessage(host, JSON.stringify({ type: 'returnLobby' }));
  const nextRoom = await game.getRoom();
  assert.equal(nextRoom.phase, 'lobby');
  assert.equal(nextRoom.round, 2);
  assert.equal(nextRoom.selectedUpgrade, null);
  assert.equal(nextRoom.lastSnapshot, null);
});

test('empty rooms receive expiration alarms and are deleted when their deadline passes', async () => {
  const { game, host, ctx } = await createFixture({ guests: 0 });
  await game.webSocketClose(host);
  const room = await game.getRoom();
  assert.ok(ctx.alarms.length > 0);
  assert.equal(room.players.filter((player) => player.connected).length, 0);
  room.expiresAt = Date.now() - 1;
  await game.saveRoom(room);
  await game.alarm();
  assert.equal(await game.getRoom(), null);
});

test('connected rooms renew their expiration instead of being deleted', async () => {
  const { game } = await createFixture();
  const room = await game.getRoom();
  room.expiresAt = Date.now() - 1;
  await game.saveRoom(room);
  await game.alarm();
  const renewed = await game.getRoom();
  assert.ok(renewed.expiresAt > Date.now());
  assert.equal(renewed.players.filter((player) => player.connected).length, 2);
});

test('oversized or invalid WebSocket messages cannot modify room state', async () => {
  const { game, host } = await createFixture();
  await game.webSocketMessage(host, 'x'.repeat(96 * 1024 + 1));
  assert.equal((await game.getRoom()).difficulty, 'normal');
  await game.webSocketMessage(host, '{');
  assert.equal(host.sent.at(-1).type, 'error');
});

test('snapshot sanitization never permits more fires than the selected difficulty can support', async () => {
  const { game } = await createFixture({ start: true });
  const room = await game.getRoom();
  const snapshot = sanitizeSnapshot(makeSnapshot(room, {
    fires: Array.from({ length: 100 }, () => ({ x: .4, y: .5, hp: 100, radius: .03 })),
  }), room);
  assert.equal(snapshot.fires.length, scaleForPlayers(6, DIFFICULTIES.normal).maxFires);
});

test('the Durable Object rejects malformed initial host credentials', async () => {
  const game = new GameRoom(createContext(), {});
  const response = await game.fetch(new Request('https://example.test/api/rooms/TEST/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'TEST', hostId: 'host-id', sessionToken: 'short' }),
  }));
  assert.equal(response.status, 400);
});

test('new room requests preserve the selected mission and level before anyone connects', async () => {
  let forwarded;
  const env = {
    GAME_ROOMS: {
      idFromName(code) { return code; },
      get() {
        return {
          async fetch(request) {
            forwarded = await request.json();
            return { status: 200, ok: true };
          },
        };
      },
    },
  };

  const response = await worker.fetch(new Request('https://example.test/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hostId: 'host-id',
      hostName: 'Micah',
      sessionToken: tokenFor('host-id'),
      mode: 'convoy-protection',
      level: 'endless-fire-road',
    }),
  }), env);

  assert.equal(response.status, 201);
  assert.equal(forwarded.mode, 'convoy-protection');
  assert.equal(forwarded.level, 'endless-fire-road');
});

test('room creation rejects invalid mission and level combinations', async () => {
  const game = new GameRoom(createContext(), {});
  const response = await game.fetch(new Request('https://example.test/api/rooms/TEST/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'TEST',
      hostId: 'host-id',
      hostName: 'Host',
      sessionToken: tokenFor('host-id'),
      mode: 'protect-town',
      level: 'endless-fire-road',
    }),
  }));
  assert.equal(response.status, 400);
});

test('every selectable mission starts with the correct shared mode and timer behavior', async () => {
  for (const mode of playableModes()) {
    const { game } = await createFixture({ mode: mode.id, start: true });
    const room = await game.getRoom();
    assert.equal(room.mode, mode.id);
    assert.equal(room.level, defaultLevelForMode(mode.id));

    const duration = roundDurationForMode(mode.id, room.level, 150);
    if (duration === null) {
      assert.equal(room.roundEndsAt, null, mode.id);
    } else {
      assert.ok(room.roundEndsAt > Date.now() + (duration - 2) * 1000, mode.id);
      assert.ok(room.roundEndsAt <= Date.now() + duration * 1000, mode.id);
    }
  }
});

test('endless rooms still replace a stalled multiplayer host without imposing a round deadline', async () => {
  for (const mode of ['wildfire-survival', 'convoy-protection']) {
    const { game } = await createFixture({ mode, start: true });
    const room = await game.getRoom();
    assert.equal(room.roundEndsAt, null);
    room.hostAssignedAt = Date.now() - 7000;
    room.snapshotSavedAt = Date.now() - 7000;
    await game.saveRoom(room);
    await game.alarm();

    const updated = await game.getRoom();
    assert.equal(updated.phase, 'playing');
    assert.equal(updated.roundEndsAt, null);
    assert.equal(updated.hostId, 'guest-0');
  }
});

test('all mission objectives, random events, and moving objects reach every guest identically', async () => {
  for (const mode of playableModes()) {
    const { game, host, guests } = await createFixture({ mode: mode.id, guests: 2, start: true });
    const room = await game.getRoom();
    const simulation = new BlazeSimulation({
      width: 1200,
      height: 700,
      players: room.players,
      difficulty: room.difficulty,
      round: room.round,
      mode: room.mode,
      level: room.level,
      roundEndsAt: room.roundEndsAt,
    });

    simulation.state.elapsed = 34;
    simulation.state.teamWaterDropped = 48;
    if (mode.id === 'protect-town') {
      simulation.state.buildings[0].hp = 61;
      simulation.state.buildings[0].status = 'burning';
    }
    if (mode.id === 'spot-fire') {
      simulation.state.warnings.push({
        id: 'warning-shared', x: 850, y: 320, timeLeft: 1.4, duration: 2.4, kind: 'spot',
      });
    }
    if (mode.id === 'evacuation') {
      simulation.state.units.push({
        id: 'vehicle-shared', kind: 'bus', x: 410, y: 350, progress: .35,
        hp: 79, maxHp: 100, status: 'blocked',
      });
      simulation.state.routeBlocked = true;
      simulation.state.evacuated = 2;
    }
    if (mode.id === 'convoy-protection') {
      simulation.state.distanceMeters = 2680;
      simulation.state.convoyIntegrity = 72;
      simulation.state.convoyVehicles[0].hp = 64;
    }

    await game.webSocketMessage(host, JSON.stringify({
      type: 'matchSnapshot',
      snapshot: simulation.createSnapshot(),
    }));

    const first = guests[0].sent.findLast((message) => message.type === 'matchSnapshot').snapshot;
    const second = guests[1].sent.findLast((message) => message.type === 'matchSnapshot').snapshot;
    assert.deepEqual(first, second, mode.id);
    assert.equal(first.version, SNAPSHOT_VERSION);
    assert.equal(first.mode, mode.id);
    assert.equal(first.modeState.elapsed, 34);
    assert.equal(first.modeState.teamWaterDropped, 48);

    const guestSimulation = new BlazeSimulation({
      width: 430,
      height: 932,
      players: room.players,
      difficulty: room.difficulty,
      round: room.round,
      mode: room.mode,
      level: room.level,
      roundEndsAt: room.roundEndsAt,
      spawnInitialFires: false,
    });
    assert.equal(guestSimulation.applySnapshot(first), true, mode.id);
    assert.equal(guestSimulation.fires.length, simulation.fires.length, mode.id);
    assert.equal(guestSimulation.state.teamWaterDropped, 48, mode.id);

    if (mode.id === 'protect-town') {
      assert.equal(first.modeState.buildings[0].hp, 61);
      assert.equal(guestSimulation.state.buildings[0].hp, 61);
    }
    if (mode.id === 'spot-fire') {
      assert.equal(first.modeState.warnings[0].id, 'warning-shared');
      assert.equal(guestSimulation.state.warnings[0].id, 'warning-shared');
    }
    if (mode.id === 'evacuation') {
      assert.equal(first.modeState.units[0].status, 'blocked');
      assert.equal(first.modeState.evacuated, 2);
      assert.equal(guestSimulation.state.units[0].status, 'blocked');
    }
    if (mode.id === 'convoy-protection') {
      assert.equal(first.modeState.distanceMeters, 2680);
      assert.equal(first.modeState.convoyIntegrity, 72);
      assert.equal(first.modeState.convoyVehicles[0].hp, 64);
      assert.ok(first.modeState.chunks.length > 0);
      assert.equal(guestSimulation.state.convoyVehicles[0].hp, 64);
      assert.equal(guestSimulation.state.chunks.length, first.modeState.chunks.length);
    }
  }
});

test('mission snapshots reject objective objects that do not belong to the active mode', async () => {
  const { game } = await createFixture({ mode: 'protect-town', start: true });
  const room = await game.getRoom();
  const sanitized = sanitizeSnapshot(makeSnapshot(room, {
    modeState: {
      warnings: [{ id: 'fake-warning', x: .5, y: .5 }],
      units: [{ id: 'fake-unit', x: .5, y: .5 }],
      convoyVehicles: [{ id: 'fake-convoy', x: .5, y: .5 }],
      chunks: [{ index: 5, x: .2, width: .6 }],
      buildings: [{ id: 'real-building', x: .8, y: .3, hp: 500, status: 'unsafe' }],
    },
  }), room);

  assert.deepEqual(sanitized.modeState.warnings, []);
  assert.deepEqual(sanitized.modeState.units, []);
  assert.deepEqual(sanitized.modeState.convoyVehicles, []);
  assert.deepEqual(sanitized.modeState.chunks, []);
  assert.equal(sanitized.modeState.buildings[0].hp, 100);
  assert.equal(sanitized.modeState.buildings[0].status, 'safe');
});

test('convoy snapshots clamp unsafe chunks, vehicles, integrity, and fire health', async () => {
  const { game } = await createFixture({ mode: 'convoy-protection', start: true });
  const room = await game.getRoom();
  const sanitized = sanitizeSnapshot(makeSnapshot(room, {
    fires: [{ x: 4, y: -2, hp: 9999, radius: 5, kind: 'unsafe' }],
    modeState: {
      distanceMeters: -100,
      convoyIntegrity: 999,
      convoyVehicles: [{ id: '<bad>', kind: 'unsafe', x: 8, y: -1, hp: 400, status: 'unsafe' }],
      chunks: Array.from({ length: 15 }, (_, index) => ({ index, x: 20, width: 9, variant: 200 })),
    },
  }), room);

  assert.equal(sanitized.fires[0].hp, GAME_MODES['convoy-protection'].rules.maximumFireHealth);
  assert.equal(sanitized.fires[0].kind, 'wildfire');
  assert.equal(sanitized.modeState.distanceMeters, 0);
  assert.equal(sanitized.modeState.convoyIntegrity, 100);
  assert.equal(sanitized.modeState.convoyVehicles[0].kind, 'utility');
  assert.equal(sanitized.modeState.convoyVehicles[0].x, 1);
  assert.equal(sanitized.modeState.convoyVehicles[0].hp, 100);
  assert.equal(sanitized.modeState.chunks.length, GAME_MODES['convoy-protection'].rules.maximumChunks);
  assert.equal(sanitized.modeState.chunks[0].x, 4);
  assert.equal(sanitized.modeState.chunks[0].width, 1.5);
});

test('mission fire budgets preserve every synchronized fire even after a teammate disconnects', async () => {
  const { game, host, guests } = await createFixture({ mode: 'wildfire-survival', guests: 5, start: true });
  const room = await game.getRoom();
  const limit = fireLimitForMode(room.mode, scaleForPlayers(6, DIFFICULTIES.normal).maxFires);
  const fires = Array.from({ length: limit }, (_, index) => ({
    x: (index + 1) / (limit + 2), y: .5, hp: 120, radius: .03, kind: 'wildfire',
  }));

  await game.webSocketClose(guests[0]);
  const current = await game.getRoom();
  await game.webSocketMessage(host, JSON.stringify({
    type: 'matchSnapshot',
    snapshot: makeSnapshot(current, { fires }),
  }));

  const shared = guests[1].sent.findLast((message) => message.type === 'matchSnapshot').snapshot;
  assert.equal(shared.fires.length, limit);
});

test('rejoining a moving convoy restores the same distance, vehicles, and live map chunks', async () => {
  const { game, host, guests, connect } = await createFixture({ mode: 'convoy-protection', start: true });
  const room = await game.getRoom();
  const simulation = new BlazeSimulation({
    width: 1000,
    height: 600,
    players: room.players,
    mode: room.mode,
    level: room.level,
  });
  simulation.state.distanceMeters = 3400;
  simulation.state.convoyIntegrity = 68;
  await game.webSocketMessage(host, JSON.stringify({
    type: 'matchSnapshot',
    snapshot: simulation.createSnapshot(),
  }));

  await game.webSocketClose(guests[0]);
  const replacement = await connect('guest-0', 'Returning teammate');
  const restored = replacement.socket.sent.findLast((message) => message.type === 'matchSnapshot');

  assert.equal(restored.restore, true);
  assert.equal(restored.snapshot.modeState.distanceMeters, 3400);
  assert.equal(restored.snapshot.modeState.convoyIntegrity, 68);
  assert.equal(restored.snapshot.modeState.convoyVehicles.length, 4);
  assert.ok(restored.snapshot.modeState.chunks.length > 0);
});

test('a guest cannot inject fake mission objectives or moving convoy state', async () => {
  const { game, guests } = await createFixture({ mode: 'convoy-protection', start: true });
  const room = await game.getRoom();
  const sentBefore = guests[0].sent.length;

  await game.webSocketMessage(guests[0], JSON.stringify({
    type: 'matchSnapshot',
    snapshot: makeSnapshot(room, {
      complete: true,
      modeState: { outcome: 'won', distanceMeters: 999999, convoyIntegrity: 100 },
    }),
  }));

  assert.equal((await game.getRoom()).phase, 'playing');
  assert.equal(guests[0].sent.length, sentBefore);
});
