import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DEFAULT_HELICOPTER_TYPE,
  DIFFICULTIES,
  HELICOPTER_COLORS,
  HELICOPTER_TYPES,
} from '../src/game/config.js';
import {
  GAME_MODES,
  defaultLevelForMode,
  levelsForMode,
  nextLevelForMode,
  playableModes,
} from '../src/game/modes.js';
import { BlazeSimulation } from '../src/game/simulation.js';
import { helicopterPreviewMarkup } from '../src/ui/helicopters.js';

const clientSource = (await readFile(new URL('../src/main.js', import.meta.url), 'utf8'))
  .replace(/^import .*;$/gm, '');
const pageMarkup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const pageStyles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

class FakeElement {
  constructor(owner, id = '', tag = 'div') {
    this.owner = owner;
    this.id = id;
    this.tag = tag;
    this.listeners = new Map();
    this.dataset = {};
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.isConnected = true;
    this.clientWidth = tag === 'canvas' ? 1000 : 172;
    this.style = { setProperty() {} };
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (this.id !== 'app') return;

    this.owner.content.clear();
    this.owner.colorButtons = [];
    this.owner.helicopterButtons = [];
    this.owner.upgradeButtons = [];
    this.owner.modeButtons = [];
    const tags = value.matchAll(/<([a-z]+)\b([^>]*)>/gi);
    for (const [, tag, attributes] of tags) {
      const id = attributes.match(/\bid="([^"]+)"/)?.[1] || '';
      const color = attributes.match(/\bdata-color="([^"]+)"/)?.[1];
      const helicopter = attributes.match(/\bdata-helicopter="([^"]+)"/)?.[1];
      const upgrade = attributes.match(/\bdata-upgrade="([^"]+)"/)?.[1];
      const mode = attributes.match(/\bdata-mode="([^"]+)"/)?.[1];
      if (!id && !color && !helicopter && !upgrade && !mode) continue;

      const element = new FakeElement(this.owner, id, tag.toLowerCase());
      element.disabled = /\bdisabled\b/.test(attributes);
      element.value = attributes.match(/\bvalue="([^"]*)"/)?.[1] || '';
      if (color) {
        element.dataset.color = color;
        this.owner.colorButtons.push(element);
      }
      if (helicopter) {
        element.dataset.helicopter = helicopter;
        this.owner.helicopterButtons.push(element);
      }
      if (upgrade) {
        element.dataset.upgrade = upgrade;
        this.owner.upgradeButtons.push(element);
      }
      if (mode) {
        element.dataset.mode = mode;
        this.owner.modeButtons.push(element);
      }
      if (id) this.owner.content.set(id, element);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  addEventListener(type, listener) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(listener);
    this.listeners.set(type, handlers);
  }

  async trigger(type, properties = {}) {
    const event = { target: this, preventDefault() {}, ...properties };
    for (const handler of this.listeners.get(type) || []) await handler(event);
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  append(element) {
    if (element.id) this.owner.detached.set(element.id, element);
  }

  remove() {
    this.owner.detached.delete(this.id);
    this.owner.content.delete(this.id);
    this.isConnected = false;
  }

  getBoundingClientRect() {
    return { width: 1000, height: 600, top: 0, left: 0 };
  }

  getContext() {
    return { setTransform() {} };
  }
}

function createRuntime({ saved = {}, search = '', preview = null } = {}) {
  const values = new Map(Object.entries(saved));
  const sessionStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };

  const document = {
    content: new Map(),
    detached: new Map(),
    colorButtons: [],
    helicopterButtons: [],
    upgradeButtons: [],
    modeButtons: [],
    querySelector(selector) {
      if (selector === '#app') return this.app;
      if (selector.startsWith('#')) return this.detached.get(selector.slice(1)) || this.content.get(selector.slice(1)) || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-color]') return this.colorButtons;
      if (selector === '[data-helicopter]') return this.helicopterButtons;
      if (selector === '[data-mode]') return this.modeButtons;
      if (selector === '.upgrade-choice') return this.upgradeButtons;
      return [];
    },
    createElement(tag) { return new FakeElement(this, '', tag); },
  };
  document.app = new FakeElement(document, 'app', 'main');
  document.body = new FakeElement(document, '', 'body');

  const location = {
    protocol: 'https:',
    host: 'example.test',
    origin: 'https://example.test',
    pathname: '/',
    search,
    href: `https://example.test/${search}`,
  };
  const history = {
    replaceState(_state, _title, next) {
      const url = new URL(next, location.origin);
      location.href = url.href;
      location.search = url.search;
      location.pathname = url.pathname;
    },
  };
  const window = {
    innerWidth: 1000,
    innerHeight: 600,
    addEventListener() {},
    removeEventListener() {},
    alert() {},
    onkeydown: null,
    onkeyup: null,
  };

  const timers = new Map();
  let nextTimer = 0;
  function setFakeTimeout(callback, delay) {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  }
  function clearFakeTimeout(id) {
    timers.delete(id);
  }
  function runTimer(delay) {
    const entry = [...timers.entries()].find(([, item]) => item.delay === delay);
    assert.ok(entry, `No pending timer with delay ${delay}`);
    timers.delete(entry[0]);
    entry[1].callback();
  }

  const animationFrames = [];
  const sockets = [];
  class FakeWebSocket {
    static OPEN = 1;

    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.OPEN;
      this.listeners = new Map();
      this.sent = [];
      sockets.push(this);
    }

    addEventListener(type, listener) {
      const handlers = this.listeners.get(type) || [];
      handlers.push(listener);
      this.listeners.set(type, handlers);
    }

    send(value) {
      this.sent.push(JSON.parse(value));
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      for (const listener of this.listeners.get('close') || []) listener({});
    }

    receive(message) {
      for (const listener of this.listeners.get('message') || []) {
        listener({ data: JSON.stringify(message) });
      }
    }
  }

  const requests = [];
  async function fakeFetch(path, options = {}) {
    requests.push({ path, options });
    if (path === '/api/rooms') {
      return { ok: true, async json() { return { code: 'TEST' }; } };
    }
    if (path.endsWith('/state')) {
      if (!preview) return { ok: false, async json() { return {}; } };
      return { ok: true, async json() { return { room: preview }; } };
    }
    throw new Error(`Unexpected request: ${path}`);
  }

  const loadClient = new Function(
    'document',
    'window',
    'sessionStorage',
    'crypto',
    'location',
    'history',
    'WebSocket',
    'fetch',
    'setTimeout',
    'clearTimeout',
    'requestAnimationFrame',
    'devicePixelRatio',
    'DEFAULT_HELICOPTER_TYPE',
    'DIFFICULTIES',
    'HELICOPTER_COLORS',
    'HELICOPTER_TYPES',
    'GAME_MODES',
    'defaultLevelForMode',
    'levelsForMode',
    'nextLevelForMode',
    'playableModes',
    'BlazeSimulation',
    'attachJoystick',
    'helicopterPreviewMarkup',
    'drawSimulation',
    `${clientSource}\nreturn { session, connectToRoom, createOnlineRoom, leaveRoom, roomPreview };`,
  );
  const client = loadClient(
    document,
    window,
    sessionStorage,
    crypto,
    location,
    history,
    FakeWebSocket,
    fakeFetch,
    setFakeTimeout,
    clearFakeTimeout,
    (callback) => animationFrames.push(callback),
    1,
    DEFAULT_HELICOPTER_TYPE,
    DIFFICULTIES,
    HELICOPTER_COLORS,
    HELICOPTER_TYPES,
    GAME_MODES,
    defaultLevelForMode,
    levelsForMode,
    nextLevelForMode,
    playableModes,
    BlazeSimulation,
    () => {},
    helicopterPreviewMarkup,
    () => {},
  );

  return {
    client,
    document,
    location,
    sessionStorage,
    timers,
    runTimer,
    sockets,
    requests,
    animationFrames,
    window,
    WebSocket: FakeWebSocket,
  };
}

function roomFor(runtime, overrides = {}) {
  return {
    roomCode: 'TEST',
    phase: 'lobby',
    hostId: runtime.client.session.playerId,
    difficulty: 'normal',
    mode: 'classic',
    level: 'starter',
    round: 1,
    roundEndsAt: null,
    upgrades: { tank: 0, speed: 0, power: 0 },
    selectedUpgrade: null,
    hasSnapshot: false,
    players: [{
      id: runtime.client.session.playerId,
      name: 'Micah',
      colorId: 'red',
      helicopterType: DEFAULT_HELICOPTER_TYPE,
      connected: true,
      isHost: true,
    }],
    ...overrides,
  };
}

async function connectHost(runtime, overrides = {}) {
  const connected = runtime.client.connectToRoom('TEST', 'Micah');
  const socket = runtime.sockets.at(-1);
  socket.receive({ type: 'state', room: roomFor(runtime, overrides) });
  await connected;
  return socket;
}

test('room creation and WebSocket connections use the same private session token', async () => {
  const runtime = createRuntime();
  assert.equal(await runtime.client.createOnlineRoom('Micah'), 'TEST');
  const payload = JSON.parse(runtime.requests[0].options.body);
  assert.equal(payload.sessionToken, runtime.client.session.sessionToken);

  const socket = await connectHost(runtime);
  const url = new URL(socket.url);
  assert.equal(url.searchParams.get('token'), payload.sessionToken);
  assert.equal(runtime.sessionStorage.getItem('blaze-copters-active-room'), 'TEST');
});

test('mobile zoom remains locked while oversized lobby screens remain scrollable', () => {
  assert.match(pageMarkup, /maximum-scale=1/);
  assert.match(pageMarkup, /user-scalable=no/);
  assert.match(pageMarkup, /gesturestart/);
  assert.match(pageStyles, /\.screen\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(pageStyles, /\.game-screen\s*\{[^}]*touch-action:\s*none/s);
  assert.match(pageStyles, /\.game-screen\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(pageStyles, /\.mode-grid\s*\{/);
});

test('creating a game first displays exactly five clear playable mission cards', async () => {
  const runtime = createRuntime();
  const name = runtime.document.querySelector('#player-name');
  name.value = 'Micah';
  await runtime.document.querySelector('#create-game').trigger('click');

  assert.equal(runtime.client.session.view, 'mode-select');
  assert.equal(runtime.document.modeButtons.length, 5);
  assert.match(runtime.document.app.innerHTML, /Wildfire Survival/);
  assert.match(runtime.document.app.innerHTML, /Protect the Town/);
  assert.match(runtime.document.app.innerHTML, /Spot Fire/);
  assert.match(runtime.document.app.innerHTML, /Evacuation/);
  assert.match(runtime.document.app.innerHTML, /Convoy Protection/);
  assert.doesNotMatch(runtime.document.app.innerHTML, /Classic Co-op/);
});

test('choosing a mission creates the room with its authoritative mode and first level', async () => {
  const runtime = createRuntime();
  runtime.document.querySelector('#player-name').value = 'Micah';
  await runtime.document.querySelector('#create-game').trigger('click');
  const creating = runtime.document.querySelector('#play-mode-evacuation').trigger('click');

  for (let index = 0; index < 5 && !runtime.sockets.length; index += 1) await Promise.resolve();
  const socket = runtime.sockets.at(-1);
  assert.ok(socket);
  const payload = JSON.parse(runtime.requests[0].options.body);
  assert.equal(payload.mode, 'evacuation');
  assert.equal(payload.level, 'cedar-creek-road');

  socket.receive({
    type: 'state',
    room: roomFor(runtime, { mode: 'evacuation', level: 'cedar-creek-road' }),
  });
  await creating;
  assert.equal(runtime.client.session.view, 'lobby');
  assert.match(runtime.document.app.innerHTML, /Cedar Creek Road/);
});

test('the lobby shows the current mode and starter level selectors', async () => {
  const runtime = createRuntime();
  await connectHost(runtime);
  assert.match(runtime.document.app.innerHTML, /Classic Co-op/);
  assert.match(runtime.document.app.innerHTML, /Starter Training Grounds/);
  assert.ok(runtime.document.querySelector('#game-mode'));
  assert.ok(runtime.document.querySelector('#game-level'));
});

test('the lobby presents all four animated, eye-equipped helicopter choices separately from player colors', async () => {
  const runtime = createRuntime();
  await connectHost(runtime);

  assert.equal(runtime.document.helicopterButtons.length, 4);
  assert.deepEqual(runtime.document.helicopterButtons.map((button) => button.dataset.helicopter), [
    'chinook', 'kamov', 'skycrane', 'firehawk',
  ]);
  assert.equal(runtime.document.colorButtons.length, 6);
  assert.match(runtime.document.app.innerHTML, /Choose your helicopter/);
  assert.match(runtime.document.app.innerHTML, /Choose your color/);
  assert.match(runtime.document.app.innerHTML, /Every helicopter flies and fights fire the same/);
  assert.match(runtime.document.app.innerHTML, /class="preview-rotor/);
  assert.match(runtime.document.app.innerHTML, /class="preview-bucket"/);
  assert.match(runtime.document.app.innerHTML, /fill="#fff"/);
  assert.match(pageStyles, /@keyframes copter-hover/);
  assert.match(pageStyles, /@keyframes preview-rotor-spin/);
  assert.match(pageStyles, /@keyframes bucket-sway/);
});

test('choosing a helicopter sends its cosmetic selection through the multiplayer room', async () => {
  const runtime = createRuntime();
  const socket = await connectHost(runtime);

  await runtime.document.querySelector('#helicopter-skycrane').trigger('click');
  assert.deepEqual(socket.sent.at(-1), {
    type: 'setHelicopter',
    helicopterType: 'skycrane',
  });

  const room = roomFor(runtime);
  room.players[0].helicopterType = 'skycrane';
  socket.receive({ type: 'state', room });
  assert.match(runtime.document.app.innerHTML, /data-helicopter="skycrane" class="helicopter-choice selected-helicopter"/);
  assert.match(runtime.document.app.innerHTML, /class="player-helicopter">Skycrane/);
});

test('a connected host can reopen the mission screen and choose a synchronized new mode', async () => {
  const runtime = createRuntime();
  const socket = await connectHost(runtime);
  await runtime.document.querySelector('#choose-game-mode').trigger('click');
  assert.equal(runtime.client.session.view, 'mode-select');

  await runtime.document.querySelector('#play-mode-protect-town').trigger('click');
  assert.deepEqual(socket.sent.at(-1), { type: 'setMode', mode: 'protect-town' });
  socket.receive({
    type: 'state',
    room: roomFor(runtime, { mode: 'protect-town', level: 'pine-ridge-town' }),
  });
  assert.equal(runtime.client.session.view, 'lobby');
  assert.match(runtime.document.app.innerHTML, /Protect the Town/);
});

test('an active host publishes snapshots containing the current mode and level', async () => {
  const runtime = createRuntime();
  const socket = await connectHost(runtime);
  socket.receive({
    type: 'state',
    room: roomFor(runtime, { phase: 'playing', roundEndsAt: Date.now() + 150000 }),
  });
  assert.equal(runtime.client.session.sim.mode, 'classic');
  assert.equal(runtime.client.session.sim.level, 'starter');
  const frame = runtime.animationFrames.shift();
  frame(performance.now() + 100);
  const snapshot = socket.sent.find((message) => message.type === 'matchSnapshot').snapshot;
  assert.equal(snapshot.mode, 'classic');
  assert.equal(snapshot.level, 'starter');
});

test('the mobile-friendly HUD changes objectives for each playable mission', async () => {
  const expectations = {
    'wildfire-survival': ['Time', 'Danger'],
    'protect-town': ['Town', 'burning'],
    'spot-fire': ['Ember watch', 'Embers'],
    evacuation: ['Evac', 'remaining'],
    'convoy-protection': ['Distance', 'Convoy'],
  };

  for (const mode of playableModes()) {
    const runtime = createRuntime();
    const level = defaultLevelForMode(mode.id);
    const socket = await connectHost(runtime, { mode: mode.id, level });
    socket.receive({
      type: 'state',
      room: roomFor(runtime, {
        mode: mode.id,
        level,
        phase: 'playing',
        roundEndsAt: mode.endless ? null : Date.now() + 240000,
      }),
    });

    const frame = runtime.animationFrames.shift();
    frame(performance.now() + 100);
    const round = runtime.document.querySelector('#round-hud').textContent;
    const fire = runtime.document.querySelector('#fire-hud').textContent;
    const objective = runtime.document.querySelector('#objective-hud').textContent;
    const displayed = `${round} ${fire} ${objective}`;
    for (const phrase of expectations[mode.id]) assert.match(displayed, new RegExp(phrase), mode.id);
    assert.match(runtime.document.querySelector('#water-hud').textContent, /Water/);
  }
});

test('keyboard movement keeps using the shared multiplayer input channel', async () => {
  const runtime = createRuntime();
  const socket = await connectHost(runtime);
  socket.receive({
    type: 'state',
    room: roomFor(runtime, { phase: 'playing', roundEndsAt: Date.now() + 150000 }),
  });

  runtime.window.onkeydown({ code: 'KeyD' });
  assert.deepEqual(socket.sent.at(-1), { type: 'input', x: 1, y: 0 });
  runtime.window.onkeyup({ code: 'KeyD' });
  assert.deepEqual(socket.sent.at(-1), { type: 'input', x: 0, y: 0 });
});

test('all playable missions keep gameplay free of extra action buttons', async () => {
  for (const mode of playableModes()) {
    const runtime = createRuntime();
    const level = defaultLevelForMode(mode.id);
    const socket = await connectHost(runtime, { mode: mode.id, level });
    socket.receive({
      type: 'state',
      room: roomFor(runtime, {
        mode: mode.id,
        level,
        phase: 'playing',
        roundEndsAt: mode.endless ? null : Date.now() + 240000,
      }),
    });

    assert.doesNotMatch(runtime.document.app.innerHTML, /<button\b/i, mode.id);
    assert.ok(runtime.document.querySelector('#joystick'));
    assert.ok(runtime.document.querySelector('#game-canvas'));
  }
});

test('a disconnected browser automatically reconnects with its original credentials', async () => {
  const runtime = createRuntime();
  const original = await connectHost(runtime);
  original.close();
  assert.match(runtime.document.querySelector('#connection-notice').textContent, /Reconnecting/);
  runtime.runTimer(450);

  const replacement = runtime.sockets.at(-1);
  assert.notEqual(replacement, original);
  assert.equal(new URL(replacement.url).searchParams.get('token'), runtime.client.session.sessionToken);
  replacement.receive({ type: 'state', room: roomFor(runtime) });
  await Promise.resolve();
  assert.equal(runtime.client.session.reconnectAttempts, 0);
  assert.equal(runtime.document.querySelector('#connection-notice'), null);
});

test('leaving a room cannot close a newly created replacement connection', async () => {
  const runtime = createRuntime();
  const original = await connectHost(runtime);
  runtime.client.leaveRoom();

  const reconnecting = runtime.client.connectToRoom('TEST', 'Micah');
  const replacement = runtime.sockets.at(-1);
  replacement.receive({ type: 'state', room: roomFor(runtime) });
  await reconnecting;

  runtime.runTimer(80);
  assert.equal(original.readyState, runtime.WebSocket.CLOSED);
  assert.equal(replacement.readyState, runtime.WebSocket.OPEN);
  assert.equal(runtime.client.session.ws, replacement);
});

test('refreshing a page restores its saved room without exposing the session token', async () => {
  const token = crypto.randomUUID();
  const runtime = createRuntime({
    search: '?room=TEST',
    saved: {
      'blaze-copters-player-id': crypto.randomUUID(),
      'blaze-copters-session-token': token,
      'blaze-copters-active-room': 'TEST',
      'blaze-copters-player-name': 'Micah',
    },
  });
  const socket = runtime.sockets[0];
  assert.ok(socket);
  assert.equal(new URL(socket.url).searchParams.get('token'), token);
  socket.receive({ type: 'state', room: roomFor(runtime) });
  await Promise.resolve();
  assert.equal(runtime.client.session.room.roomCode, 'TEST');
  assert.doesNotMatch(runtime.document.app.innerHTML, new RegExp(token));
});

test('a player reconnecting at round end receives a usable result screen', async () => {
  const runtime = createRuntime();
  const socket = await connectHost(runtime, { phase: 'roundEnd', hasSnapshot: true });
  assert.equal(runtime.client.session.view, 'round-end');
  assert.match(runtime.document.app.innerHTML, /Round 1 Complete/);

  socket.receive({
    type: 'matchSnapshot',
    restore: true,
    snapshot: {
      version: 2,
      round: 1,
      mode: 'classic',
      level: 'starter',
      timeLeft: 0,
      complete: true,
      extinguished: 7,
      spreadElapsedMs: 0,
      map: { waterRadius: .1, helipadRadius: .05 },
      fires: [],
      burned: [],
      helicopters: [],
    },
  });
  assert.match(runtime.document.app.innerHTML, /<strong>7<\/strong>/);
});

test('convoy results show team distance and offer replay, mission selection, and the main menu', async () => {
  const runtime = createRuntime();
  const mode = 'convoy-protection';
  const level = defaultLevelForMode(mode);
  const socket = await connectHost(runtime, { mode, level });
  socket.receive({ type: 'state', room: roomFor(runtime, { mode, level, phase: 'playing' }) });
  runtime.client.session.sim.state.distanceMeters = 3218.688;
  runtime.client.session.sim.state.highestDifficulty = 4;
  runtime.client.session.sim.finish('lost', 'The convoy could not continue.');
  socket.receive({
    type: 'state',
    room: roomFor(runtime, {
      mode,
      level,
      phase: 'roundEnd',
      selectedUpgrade: 'tank',
      upgrades: { tank: 1, speed: 0, power: 0 },
    }),
  });

  assert.match(runtime.document.app.innerHTML, /2\.00 mi/);
  assert.match(runtime.document.app.innerHTML, /convoy distance/);
  assert.ok(runtime.document.querySelector('#lobby-button'));
  assert.ok(runtime.document.querySelector('#round-game-modes'));
  assert.ok(runtime.document.querySelector('#leave-round'));
  assert.equal(runtime.document.querySelector('#lobby-button').disabled, false);
});

test('a host can return directly from round results to the shared mission menu', async () => {
  const runtime = createRuntime();
  const mode = 'protect-town';
  const level = defaultLevelForMode(mode);
  const socket = await connectHost(runtime, { mode, level });
  socket.receive({ type: 'state', room: roomFor(runtime, { mode, level, phase: 'playing' }) });
  runtime.client.session.sim.finish('won', 'The town was saved.');
  socket.receive({
    type: 'state',
    room: roomFor(runtime, {
      mode,
      level,
      phase: 'roundEnd',
      selectedUpgrade: 'speed',
      upgrades: { tank: 0, speed: 1, power: 0 },
    }),
  });

  await runtime.document.querySelector('#round-game-modes').trigger('click');
  assert.deepEqual(socket.sent.at(-1), { type: 'returnLobby' });
  socket.receive({ type: 'state', room: roomFor(runtime, { mode, level, round: 2 }) });
  assert.equal(runtime.client.session.view, 'mode-select');
  assert.equal(runtime.document.modeButtons.length, 5);
});
