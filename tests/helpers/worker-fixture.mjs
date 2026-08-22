import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_HELICOPTER_TYPE, DIFFICULTIES, HELICOPTER_TYPES } from '../../src/game/config.js';
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
} from '../../src/game/modes.js';
import { scaleForPlayers } from '../../src/game/scaling.js';

export class FakeResponse {
  constructor(body = null, options = {}) {
    this.body = body;
    this.status = options.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.webSocket = options.webSocket;
    this.headers = new Headers(options.headers);
  }

  static json(value, options = {}) {
    return new FakeResponse(JSON.stringify(value), options);
  }

  async json() {
    return JSON.parse(this.body);
  }
}

export class FakeSocket {
  constructor() {
    this.sent = [];
    this.attachment = null;
    this.closed = false;
    this.closeCode = null;
  }

  send(value) {
    if (this.closed) throw new Error('Socket is closed');
    this.sent.push(JSON.parse(value));
  }

  close(code = 1000) {
    this.closed = true;
    this.closeCode = code;
  }

  serializeAttachment(value) {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment() {
    return this.attachment;
  }
}

class FakeWebSocketPair {
  constructor() {
    this[0] = new FakeSocket();
    this[1] = new FakeSocket();
  }
}

class FakeDurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}

const workerSource = await readFile(new URL('../../worker/index.js', import.meta.url), 'utf8');
const runnableWorkerSource = workerSource
  .replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];\s*/gm, '')
  .replace('export class GameRoom', 'class GameRoom')
  .replace('export default {', 'const worker = {');
const loadWorker = new Function(
  'DurableObject',
  'WebSocketPair',
  'Response',
  'DEFAULT_HELICOPTER_TYPE',
  'DIFFICULTIES',
  'HELICOPTER_TYPES',
  'DEFAULT_LEVEL_ID',
  'DEFAULT_MODE_ID',
  'GAME_LEVELS',
  'GAME_MODES',
  'SNAPSHOT_VERSION',
  'defaultLevelForMode',
  'fireLimitForMode',
  'isValidLevel',
  'isValidMode',
  'maximumFireHealth',
  'roundDurationForMode',
  'scaleForPlayers',
  `${runnableWorkerSource}\nreturn { GameRoom, worker, sanitizeSnapshot };`,
);

export const { GameRoom, worker, sanitizeSnapshot } = loadWorker(
  FakeDurableObject,
  FakeWebSocketPair,
  FakeResponse,
  DEFAULT_HELICOPTER_TYPE,
  DIFFICULTIES,
  HELICOPTER_TYPES,
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
  scaleForPlayers,
);

export function tokenFor(id) {
  return `session_${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}`.padEnd(36, 'x');
}

export function createContext() {
  const values = new Map();
  const sockets = [];
  const alarms = [];

  return {
    storage: {
      async get(key) {
        return values.has(key) ? structuredClone(values.get(key)) : undefined;
      },
      async put(key, value) {
        values.set(key, structuredClone(value));
      },
      async deleteAll() {
        values.clear();
      },
      async setAlarm(value) {
        alarms.push(value);
      },
    },
    acceptWebSocket(socket) {
      sockets.push(socket);
    },
    getWebSockets() {
      return sockets.filter((socket) => !socket.closed);
    },
    sockets,
    alarms,
  };
}

export async function createFixture({ guests = 1, start = false, mode = DEFAULT_MODE_ID, level = defaultLevelForMode(mode) } = {}) {
  const ctx = createContext();
  const game = new GameRoom(ctx, {});
  const init = new Request('https://example.test/api/rooms/TEST/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'TEST',
      hostId: 'host-id',
      hostName: 'Host',
      sessionToken: tokenFor('host-id'),
      mode,
      level,
    }),
  });
  assert.equal((await game.fetch(init)).status, 200);

  async function connect(id, name = id, { token = tokenFor(id) } = {}) {
    const url = new URL('https://example.test/api/rooms/TEST/ws');
    url.searchParams.set('playerId', id);
    url.searchParams.set('name', name);
    url.searchParams.set('token', token);
    const before = ctx.sockets.length;
    const response = await game.fetch(new Request(url, { headers: { Upgrade: 'websocket' } }));
    return {
      response,
      socket: ctx.sockets.length > before ? ctx.sockets.at(-1) : null,
    };
  }

  const host = (await connect('host-id', 'Host')).socket;
  await game.webSocketMessage(host, JSON.stringify({ type: 'setColor', colorId: 'red' }));

  const guestSockets = [];
  const colors = ['blue', 'yellow', 'green', 'purple', 'orange'];
  for (let index = 0; index < guests; index += 1) {
    const guest = (await connect(`guest-${index}`, `Guest ${index + 1}`)).socket;
    await game.webSocketMessage(guest, JSON.stringify({ type: 'setColor', colorId: colors[index] }));
    guestSockets.push(guest);
  }

  if (start) await game.webSocketMessage(host, JSON.stringify({ type: 'start' }));
  return { ctx, game, host, guests: guestSockets, connect };
}

export function makeSnapshot(room, overrides = {}) {
  return {
    version: SNAPSHOT_VERSION,
    round: room.round,
    mode: room.mode,
    level: room.level,
    timeLeft: 120,
    complete: false,
    extinguished: 0,
    spreadElapsedMs: 0,
    map: { waterRadius: .1, helipadRadius: .05 },
    fires: [],
    burned: [],
    helicopters: room.players
      .filter((player) => player.connected !== false)
      .map((player) => ({ id: player.id, x: .4, y: .5, vx: 0, vy: 0, water: 100, capacity: 100 })),
    ...overrides,
  };
}
