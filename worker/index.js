import { DurableObject } from "cloudflare:workers";
import { DIFFICULTIES } from "../src/game/config.js";
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
} from "../src/game/modes.js";
import { scaleForPlayers } from "../src/game/scaling.js";

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const COLOR_IDS = new Set(["red", "blue", "yellow", "green", "purple", "orange"]);
const DIFFICULTY_IDS = new Set(Object.keys(DIFFICULTIES));
const UPGRADE_IDS = new Set(["tank", "speed", "power"]);
const MAX_PLAYERS = 6;
const MAX_SYNCED_FIRES = 128;
const MAX_SYNCED_BURNED_AREAS = 160;
const MAX_SYNCED_WARNINGS = 16;
const MAX_SYNCED_BUILDINGS = 16;
const MAX_SYNCED_UNITS = 20;
const MAX_SYNCED_CONVOY_VEHICLES = 8;
const MAX_SYNCED_CHUNKS = 8;
const MAX_MESSAGE_LENGTH = 96 * 1024;
const SNAPSHOT_PERSIST_INTERVAL_MS = 1000;
const HOST_STALL_TIMEOUT_MS = 6000;
const DISCONNECTED_PLAYER_GRACE_MS = 60 * 1000;
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
const ACTIVE_ROOM_TTL_MS = 12 * 60 * 60 * 1000;

function makeRoomCode() {
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function cleanName(value) {
  const name = String(value ?? "").trim().slice(0, 18);
  return name || "Player";
}

function cleanPlayerId(value) {
  const id = String(value ?? "").trim();
  return id && id.length <= 96 ? id : null;
}

function cleanSessionToken(value) {
  const token = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{24,128}$/.test(token) ? token : null;
}

function connectedPlayers(room) {
  return room.players.filter((player) => player.connected !== false);
}

function ensureConnectedHost(room) {
  const previousHostId = room.hostId;
  const currentHost = room.players.find((player) => player.id === room.hostId && player.connected !== false);
  const nextHost = currentHost ?? connectedPlayers(room)[0] ?? null;
  room.hostId = nextHost?.id ?? null;
  if (room.hostId !== previousHostId) room.hostAssignedAt = Date.now();
  for (const player of room.players) player.isHost = player.id === room.hostId;
}

function pruneDisconnectedPlayers(room, now = Date.now()) {
  if (room.phase !== "lobby") return;

  room.players = room.players.filter((player) => (
    player.connected !== false
    || player.id === room.hostId
    || !player.disconnectedAt
    || now - player.disconnectedAt < DISCONNECTED_PLAYER_GRACE_MS
  ));
}

function publicRoom(room) {
  const {
    lastSnapshot,
    snapshotSavedAt,
    ...safeRoom
  } = room;

  return {
    ...safeRoom,
    hasSnapshot: Boolean(lastSnapshot),
    players: room.players.map((player) => {
      const {
        sessionToken,
        connectionId,
        disconnectedAt,
        ...safePlayer
      } = player;
      return safePlayer;
    }),
  };
}

function previewRoom(room) {
  return {
    roomCode: room.roomCode,
    phase: room.phase,
    mode: room.mode,
    level: room.level,
    connectedPlayers: connectedPlayers(room).length,
    joinable: room.phase === "lobby" && connectedPlayers(room).length < MAX_PLAYERS,
  };
}

function clampNumber(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function cleanSnapshotId(value, fallback) {
  const id = String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return id || fallback;
}

function sanitizeModeState(rawState, room) {
  const source = rawState && typeof rawState === "object" ? rawState : {};
  const mode = GAME_MODES[room.mode] ?? GAME_MODES[DEFAULT_MODE_ID];
  const status = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

  const warnings = room.mode === "spot-fire" || room.mode === "convoy-protection"
    ? (Array.isArray(source.warnings) ? source.warnings : [])
        .slice(0, MAX_SYNCED_WARNINGS)
        .map((warning, index) => ({
          id: cleanSnapshotId(warning?.id, `warning-${index + 1}`),
          x: clampNumber(warning?.x, 0, 1, .5),
          y: clampNumber(warning?.y, 0, 1, .5),
          timeLeft: clampNumber(warning?.timeLeft, 0, 30, 0),
          duration: clampNumber(warning?.duration, .1, 30, 2.4),
          kind: status(warning?.kind, ["ember", "spot", "route"], "spot"),
        }))
    : [];

  const buildings = room.mode === "protect-town"
    ? (Array.isArray(source.buildings) ? source.buildings : [])
        .slice(0, Math.min(MAX_SYNCED_BUILDINGS, GAME_LEVELS[room.level]?.map.buildings.length || MAX_SYNCED_BUILDINGS))
        .map((building, index) => ({
          id: cleanSnapshotId(building?.id, `building-${index + 1}`),
          x: clampNumber(building?.x, 0, 1, .75),
          y: clampNumber(building?.y, 0, 1, .4),
          hp: clampNumber(building?.hp, 0, 100, 100),
          maxHp: 100,
          status: status(building?.status, ["safe", "threatened", "burning", "destroyed"], "safe"),
        }))
    : [];

  const units = room.mode === "evacuation"
    ? (Array.isArray(source.units) ? source.units : [])
        .slice(0, MAX_SYNCED_UNITS)
        .map((unit, index) => ({
          id: cleanSnapshotId(unit?.id, `vehicle-${index + 1}`),
          kind: status(unit?.kind, ["car", "bus"], "car"),
          x: clampNumber(unit?.x, 0, 1, .1),
          y: clampNumber(unit?.y, 0, 1, .5),
          progress: clampNumber(unit?.progress, 0, 1, 0),
          hp: clampNumber(unit?.hp, 0, 100, 100),
          maxHp: 100,
          status: status(unit?.status, ["moving", "blocked"], "moving"),
        }))
    : [];

  const convoyVehicles = room.mode === "convoy-protection"
    ? (Array.isArray(source.convoyVehicles) ? source.convoyVehicles : [])
        .slice(0, MAX_SYNCED_CONVOY_VEHICLES)
        .map((vehicle, index) => ({
          id: cleanSnapshotId(vehicle?.id, `convoy-${index + 1}`),
          kind: status(vehicle?.kind, ["engine", "tanker", "utility", "command"], "utility"),
          label: String(vehicle?.label ?? "CREW").replace(/[^A-Z ]/g, "").slice(0, 12),
          x: clampNumber(vehicle?.x, 0, 1, .25),
          y: clampNumber(vehicle?.y, 0, 1, .52),
          hp: clampNumber(vehicle?.hp, 0, 100, 100),
          maxHp: 100,
          status: status(vehicle?.status, ["moving", "blocked"], "moving"),
        }))
    : [];

  const chunks = room.mode === "convoy-protection"
    ? (Array.isArray(source.chunks) ? source.chunks : [])
        .slice(0, Math.min(MAX_SYNCED_CHUNKS, mode.rules.maximumChunks || MAX_SYNCED_CHUNKS))
        .map((chunk) => ({
          index: Math.floor(clampNumber(chunk?.index, 0, 1000000, 0)),
          x: clampNumber(chunk?.x, -3, 4, 0),
          width: clampNumber(chunk?.width, .15, 1.5, .64),
          variant: Math.floor(clampNumber(chunk?.variant, 0, 10, 0)),
          activated: Boolean(chunk?.activated),
        }))
    : [];

  return {
    elapsed: clampNumber(source.elapsed, 0, 43200, 0),
    danger: clampNumber(source.danger, 0, 100, 0),
    dangerSeconds: clampNumber(source.dangerSeconds, 0, 600, 0),
    difficultyTier: Math.floor(clampNumber(source.difficultyTier, 1, 10000, 1)),
    highestDifficulty: Math.floor(clampNumber(source.highestDifficulty, 1, 10000, 1)),
    teamWaterDropped: clampNumber(source.teamWaterDropped, 0, 1000000000, 0),
    outcome: status(source.outcome, ["active", "won", "lost"], "active"),
    reason: String(source.reason || "").slice(0, 160),
    objectivePhase: status(source.objectivePhase, ["active", "containment"], "active"),
    objectiveSeconds: clampNumber(source.objectiveSeconds, 0, 1200, mode.rules.controlSeconds || 0),
    warningCooldown: clampNumber(source.warningCooldown, 0, 300, 0),
    warnings,
    buildings,
    buildingsLost: Math.floor(clampNumber(source.buildingsLost, 0, MAX_SYNCED_BUILDINGS, 0)),
    units,
    evacuated: Math.floor(clampNumber(source.evacuated, 0, 1000, 0)),
    unitsLost: Math.floor(clampNumber(source.unitsLost, 0, 1000, 0)),
    unitsRequired: Math.floor(clampNumber(source.unitsRequired, 0, 1000, mode.rules.baseVehiclesRequired || 0)),
    vehicleCooldown: clampNumber(source.vehicleCooldown, 0, 120, 0),
    routeBlocked: Boolean(source.routeBlocked),
    blockedSeconds: clampNumber(source.blockedSeconds, 0, 1200, 0),
    distanceMeters: clampNumber(source.distanceMeters, 0, 1000000000, 0),
    convoyIntegrity: clampNumber(source.convoyIntegrity, 0, 100, 100),
    convoyVehicles,
    chunks,
    nextChunkIndex: Math.floor(clampNumber(source.nextChunkIndex, 0, 1000000, 0)),
    nextEventId: Math.floor(clampNumber(source.nextEventId, 1, 1000000, 1)),
  };
}

function sanitizeSnapshot(rawSnapshot, room) {
  if (!rawSnapshot || Number(rawSnapshot.round) !== room.round) return null;
  if (rawSnapshot.mode !== room.mode || rawSnapshot.level !== room.level) return null;

  const activeIds = new Set(connectedPlayers(room).map((player) => player.id));
  const difficulty = DIFFICULTIES[room.difficulty] ?? DIFFICULTIES.normal;
  const fireLimit = Math.min(
    MAX_SYNCED_FIRES,
    fireLimitForMode(room.mode, scaleForPlayers(MAX_PLAYERS, difficulty).maxFires),
  );
  const maxHealth = maximumFireHealth(room.mode);
  const fires = Array.isArray(rawSnapshot.fires)
    ? rawSnapshot.fires.slice(0, fireLimit).map((fire) => {
        const safeFire = {
          x: clampNumber(fire?.x, 0, 1, .5),
          y: clampNumber(fire?.y, 0, 1, .5),
          hp: clampNumber(fire?.hp, 0, maxHealth, Math.min(100, maxHealth)),
          radius: clampNumber(fire?.radius, .005, .12, .03),
        };
        if (room.mode !== DEFAULT_MODE_ID) {
          safeFire.kind = ["wildfire", "main", "spot", "ember", "route"].includes(fire?.kind)
            ? fire.kind
            : "wildfire";
        }
        return safeFire;
      })
    : [];

  const burned = Array.isArray(rawSnapshot.burned)
    ? rawSnapshot.burned.slice(0, MAX_SYNCED_BURNED_AREAS).map((patch) => ({
        x: clampNumber(patch?.x, 0, 1, .5),
        y: clampNumber(patch?.y, 0, 1, .5),
        age: clampNumber(patch?.age, 0, 16, 0),
        radius: clampNumber(patch?.radius, .005, .15, .03),
      }))
    : [];

  const helicopters = Array.isArray(rawSnapshot.helicopters)
    ? rawSnapshot.helicopters
        .slice(0, MAX_PLAYERS)
        .filter((heli) => activeIds.has(String(heli?.id ?? "")))
        .map((heli) => ({
          id: String(heli.id),
          x: clampNumber(heli.x, 0, 1, .31),
          y: clampNumber(heli.y, 0, 1, .24),
          vx: clampNumber(heli.vx, -1, 1, 0),
          vy: clampNumber(heli.vy, -1, 1, 0),
          water: clampNumber(heli.water, 0, 1000, 100),
          capacity: clampNumber(heli.capacity, 1, 1000, 100),
          refillProgress: clampNumber(heli.refillProgress, 0, 100, 0),
        }))
    : [];

  const durationSeconds = roundDurationForMode(room.mode, room.level, difficulty.roundSeconds);
  const deadlineTimeLeft = room.roundEndsAt
    ? Math.max(0, (room.roundEndsAt - Date.now()) / 1000)
    : durationSeconds;
  const submittedTimeLeft = clampNumber(rawSnapshot.timeLeft, 0, durationSeconds ?? 43200, 0);

  return {
    version: SNAPSHOT_VERSION,
    round: room.round,
    mode: room.mode,
    level: room.level,
    timeLeft: deadlineTimeLeft === null
      ? submittedTimeLeft
      : Math.min(submittedTimeLeft, deadlineTimeLeft),
    complete: Boolean(rawSnapshot.complete) || (deadlineTimeLeft !== null && deadlineTimeLeft <= 0),
    extinguished: Math.floor(clampNumber(rawSnapshot.extinguished, 0, 10000, 0)),
    spreadElapsedMs: clampNumber(rawSnapshot.spreadElapsedMs, 0, 60000, 0),
    map: {
      waterRadius: clampNumber(rawSnapshot.map?.waterRadius, .025, .35, .1),
      helipadRadius: clampNumber(rawSnapshot.map?.helipadRadius, .015, .2, .05),
    },
    fires,
    burned,
    helicopters,
    modeState: sanitizeModeState(rawSnapshot.modeState, room),
  };
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.latestSnapshot = null;
  }

  async getRoom() {
    return (await this.ctx.storage.get("room")) ?? null;
  }

  async saveRoom(room) {
    await this.ctx.storage.put("room", room);
  }

  async scheduleRoomAlarm(room, refreshExpiration = false) {
    const now = Date.now();
    if (refreshExpiration || !room.expiresAt) {
      room.expiresAt = now + (connectedPlayers(room).length ? ACTIVE_ROOM_TTL_MS : EMPTY_ROOM_TTL_MS);
    }

    let alarmAt = room.expiresAt;
    if (room.phase === "playing") {
      if (room.roundEndsAt) alarmAt = Math.min(alarmAt, room.roundEndsAt);
      if (connectedPlayers(room).length > 1) {
        const lastHostActivity = Math.max(room.hostAssignedAt || 0, room.snapshotSavedAt || 0);
        alarmAt = Math.min(alarmAt, lastHostActivity + HOST_STALL_TIMEOUT_MS);
      }
    }
    await this.ctx.storage.setAlarm(alarmAt);
  }

  currentSnapshot(room) {
    const cached = this.latestSnapshot;
    if (cached?.round === room.round && cached.mode === room.mode && cached.level === room.level) {
      return cached;
    }

    const stored = room.lastSnapshot;
    return stored?.round === room.round && stored.mode === room.mode && stored.level === room.level
      ? stored
      : null;
  }

  broadcast(payload) {
    const message = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // Ignore sockets that closed between enumeration and send.
      }
    }
  }

  async broadcastRoom(room, { reschedule = false, refreshExpiration = false } = {}) {
    if (reschedule) await this.scheduleRoomAlarm(room, refreshExpiration);
    await this.saveRoom(room);
    this.broadcast({ type: "state", room: publicRoom(room) });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname.endsWith("/init")) {
      const existing = await this.getRoom();
      if (existing) return Response.json({ ok: false, error: "Room already exists" }, { status: 409 });

      const payload = await request.json().catch(() => ({}));
      const hostId = cleanPlayerId(payload.hostId);
      const sessionToken = cleanSessionToken(payload.sessionToken);
      const mode = payload.mode == null ? DEFAULT_MODE_ID : String(payload.mode);
      const level = payload.level == null ? defaultLevelForMode(mode) : String(payload.level);
      if (!hostId || !sessionToken) {
        return Response.json({ ok: false, error: "Missing valid host credentials" }, { status: 400 });
      }
      if (!isValidMode(mode) || !isValidLevel(mode, level)) {
        return Response.json({ ok: false, error: "Invalid game mode or level" }, { status: 400 });
      }

      const room = {
        roomCode: String(payload.code ?? "").toUpperCase(),
        createdAt: Date.now(),
        expiresAt: null,
        phase: "lobby",
        hostId,
        hostAssignedAt: Date.now(),
        difficulty: "normal",
        mode,
        level,
        round: 1,
        roundEndsAt: null,
        upgrades: { tank: 0, speed: 0, power: 0 },
        selectedUpgrade: null,
        lastSnapshot: null,
        snapshotSavedAt: 0,
        players: [{
          id: hostId,
          name: cleanName(payload.hostName),
          colorId: null,
          connected: false,
          disconnectedAt: null,
          connectionId: null,
          sessionToken,
          isHost: true,
        }],
      };
      await this.scheduleRoomAlarm(room, true);
      await this.saveRoom(room);
      return Response.json({ ok: true, room: publicRoom(room) });
    }

    if (request.method === "GET" && url.pathname.endsWith("/state")) {
      const room = await this.getRoom();
      if (!room) return Response.json({ ok: false, error: "Room not found" }, { status: 404 });
      return Response.json({ ok: true, room: previewRoom(room) });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const room = await this.getRoom();
      if (!room) return new Response("Room not found", { status: 404 });

      const playerId = cleanPlayerId(url.searchParams.get("playerId"));
      const sessionToken = cleanSessionToken(url.searchParams.get("token"));
      const playerName = cleanName(url.searchParams.get("name"));
      if (!playerId || !sessionToken) return new Response("Invalid player credentials", { status: 400 });

      pruneDisconnectedPlayers(room);
      let player = room.players.find((item) => item.id === playerId);
      if (player) {
        if (player.sessionToken !== sessionToken) return new Response("Player session is not authorized", { status: 403 });
        if (player.connected === false && connectedPlayers(room).length >= MAX_PLAYERS) {
          return new Response("Room is full", { status: 409 });
        }
      } else {
        if (room.phase !== "lobby") return new Response("Mission already in progress", { status: 409 });
        if (connectedPlayers(room).length >= MAX_PLAYERS) return new Response("Room is full", { status: 409 });
        player = {
          id: playerId,
          name: playerName,
          colorId: null,
          connected: false,
          disconnectedAt: null,
          connectionId: null,
          sessionToken,
          isHost: false,
        };
        room.players.push(player);
      }

      const previousSockets = this.ctx.getWebSockets().filter((socket) => (
        socket.deserializeAttachment?.()?.playerId === playerId
      ));
      const connectionId = crypto.randomUUID();
      player.name = playerName;
      player.connected = true;
      player.disconnectedAt = null;
      player.connectionId = connectionId;

      const conflictingColor = player.colorId && room.players.some((item) => (
        item.id !== playerId && item.connected !== false && item.colorId === player.colorId
      ));
      if (conflictingColor) player.colorId = null;

      room.upgrades ??= { tank: 0, speed: 0, power: 0 };
      room.selectedUpgrade ??= null;
      ensureConnectedHost(room);

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ playerId, connectionId });
      await this.broadcastRoom(room, { reschedule: true, refreshExpiration: true });

      const snapshot = this.currentSnapshot(room);
      if ((room.phase === "playing" || room.phase === "roundEnd") && snapshot) {
        server.send(JSON.stringify({ type: "matchSnapshot", snapshot, restore: true }));
      }

      for (const previous of previousSockets) {
        try {
          previous.close(4001, "Replaced by a newer connection");
        } catch {
          // Older connections may have closed while the replacement connected.
        }
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(socket, rawMessage) {
    if (typeof rawMessage !== "string" || rawMessage.length > MAX_MESSAGE_LENGTH) return;

    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid message" }));
      return;
    }

    const attachment = socket.deserializeAttachment?.() ?? null;
    const playerId = attachment?.playerId;
    if (!playerId || !attachment.connectionId) return;

    const room = await this.getRoom();
    if (!room) return;
    const player = room.players.find((item) => item.id === playerId);
    if (!player || player.connected === false || player.connectionId !== attachment.connectionId) return;

    if (message.type === "input") {
      if (room.phase !== "playing") return;
      const x = Math.max(-1, Math.min(1, Number(message.x) || 0));
      const y = Math.max(-1, Math.min(1, Number(message.y) || 0));
      this.broadcast({ type: "input", playerId, x, y });
      return;
    }

    if (message.type === "matchSnapshot") {
      if (room.phase !== "playing" || room.hostId !== playerId) return;
      const snapshot = sanitizeSnapshot(message.snapshot, room);
      if (!snapshot) return;

      const now = Date.now();
      this.latestSnapshot = snapshot;
      if (!room.lastSnapshot || now - (room.snapshotSavedAt || 0) >= SNAPSHOT_PERSIST_INTERVAL_MS || snapshot.complete) {
        room.lastSnapshot = snapshot;
        room.snapshotSavedAt = now;
        await this.saveRoom(room);
      }

      this.broadcast({ type: "matchSnapshot", snapshot });

      if (snapshot.complete) {
        room.phase = "roundEnd";
        room.roundEndsAt = null;
        await this.broadcastRoom(room, { reschedule: true });
      }
      return;
    }

    if (message.type === "setColor") {
      if (room.phase !== "lobby") return;
      const colorId = String(message.colorId ?? "");
      if (!COLOR_IDS.has(colorId)) return;
      const now = Date.now();
      const taken = room.players.some((item) => (
        item.id !== playerId
        && item.colorId === colorId
        && (item.connected !== false || now - (item.disconnectedAt || 0) < DISCONNECTED_PLAYER_GRACE_MS)
      ));
      if (taken) {
        socket.send(JSON.stringify({ type: "error", message: "That helicopter color is already taken." }));
        return;
      }
      player.colorId = colorId;
      await this.broadcastRoom(room);
      return;
    }

    if (message.type === "setDifficulty") {
      if (!player.isHost || room.phase !== "lobby") return;
      const difficulty = String(message.difficulty ?? "");
      if (!DIFFICULTY_IDS.has(difficulty)) return;
      room.difficulty = difficulty;
      await this.broadcastRoom(room);
      return;
    }

    if (message.type === "setMode") {
      if (!player.isHost || room.phase !== "lobby") return;
      const mode = String(message.mode ?? "");
      if (!isValidMode(mode)) return;
      room.mode = mode;
      room.level = defaultLevelForMode(mode);
      await this.broadcastRoom(room);
      return;
    }

    if (message.type === "setLevel") {
      if (!player.isHost || room.phase !== "lobby") return;
      const level = String(message.level ?? "");
      if (!isValidLevel(room.mode, level)) return;
      room.level = level;
      await this.broadcastRoom(room);
      return;
    }

    if (message.type === "start") {
      if (!player.isHost || room.phase !== "lobby") return;
      const active = connectedPlayers(room);
      if (!active.length || active.some((item) => !item.colorId)) {
        socket.send(JSON.stringify({ type: "error", message: "Every connected player must choose a helicopter color first." }));
        return;
      }
      if (!isValidMode(room.mode) || !isValidLevel(room.mode, room.level)) return;

      room.players = active;
      ensureConnectedHost(room);
      room.upgrades ??= { tank: 0, speed: 0, power: 0 };
      room.selectedUpgrade = null;
      room.lastSnapshot = null;
      room.snapshotSavedAt = 0;
      room.hostAssignedAt = Date.now();
      this.latestSnapshot = null;
      room.phase = "playing";
      const seconds = roundDurationForMode(
        room.mode,
        room.level,
        DIFFICULTIES[room.difficulty].roundSeconds,
      );
      room.roundEndsAt = seconds === null ? null : Date.now() + seconds * 1000;
      await this.broadcastRoom(room, { reschedule: true });
      return;
    }

    if (message.type === "chooseUpgrade") {
      if (!player.isHost || room.phase !== "roundEnd" || room.selectedUpgrade) return;
      const upgradeId = String(message.upgradeId ?? "");
      if (!UPGRADE_IDS.has(upgradeId)) return;
      room.upgrades ??= { tank: 0, speed: 0, power: 0 };
      room.upgrades[upgradeId] = Math.max(0, Number(room.upgrades[upgradeId]) || 0) + 1;
      room.selectedUpgrade = upgradeId;
      await this.broadcastRoom(room);
      return;
    }

    if (message.type === "returnLobby") {
      if (!player.isHost || room.phase !== "roundEnd" || !room.selectedUpgrade) return;
      const requestedLevel = message.level == null ? room.level : String(message.level);
      if (!isValidLevel(room.mode, requestedLevel)) return;
      room.phase = "lobby";
      room.round += 1;
      room.level = requestedLevel;
      room.roundEndsAt = null;
      room.selectedUpgrade = null;
      room.lastSnapshot = null;
      room.snapshotSavedAt = 0;
      this.latestSnapshot = null;
      await this.broadcastRoom(room, { reschedule: true });
      return;
    }

    if (message.type === "leave") {
      room.players = room.players.filter((item) => item.id !== playerId);
      ensureConnectedHost(room);
      await this.broadcastRoom(room, { reschedule: true, refreshExpiration: true });
    }
  }

  async webSocketClose(socket) {
    const attachment = socket.deserializeAttachment?.() ?? null;
    const playerId = attachment?.playerId;
    if (!playerId || !attachment.connectionId) return;

    const room = await this.getRoom();
    if (!room) return;
    const player = room.players.find((item) => item.id === playerId);
    if (!player || player.connectionId !== attachment.connectionId || player.connected === false) return;

    player.connected = false;
    player.disconnectedAt = Date.now();
    player.connectionId = null;
    ensureConnectedHost(room);
    await this.broadcastRoom(room, { reschedule: true, refreshExpiration: true });
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }

  async alarm() {
    const room = await this.getRoom();
    if (!room) return;

    const now = Date.now();
    if (room.phase === "playing" && room.roundEndsAt && now >= room.roundEndsAt) {
      const latest = this.currentSnapshot(room);
      if (latest) {
        const completed = {
          ...latest,
          timeLeft: 0,
          complete: true,
          modeState: {
            ...latest.modeState,
            outcome: room.mode === DEFAULT_MODE_ID ? "won" : "lost",
            reason: room.mode === DEFAULT_MODE_ID
              ? "The team completed the training round."
              : "The mission ran out of time.",
          },
        };
        room.lastSnapshot = completed;
        room.snapshotSavedAt = now;
        this.latestSnapshot = completed;
        this.broadcast({ type: "matchSnapshot", snapshot: completed });
      }

      room.phase = "roundEnd";
      room.roundEndsAt = null;
      await this.broadcastRoom(room, { reschedule: true });
      return;
    }

    if (room.phase === "playing" && connectedPlayers(room).length > 1) {
      const lastHostActivity = Math.max(room.hostAssignedAt || 0, room.snapshotSavedAt || 0);
      if (now - lastHostActivity >= HOST_STALL_TIMEOUT_MS) {
        const replacement = connectedPlayers(room).find((player) => player.id !== room.hostId);
        if (replacement) {
          room.hostId = replacement.id;
          room.hostAssignedAt = now;
          for (const player of room.players) player.isHost = player.id === room.hostId;
          await this.broadcastRoom(room, { reschedule: true });
          return;
        }
      }
    }

    if (room.expiresAt && now < room.expiresAt) {
      await this.scheduleRoomAlarm(room);
      await this.saveRoom(room);
      return;
    }

    if (connectedPlayers(room).length) {
      await this.broadcastRoom(room, { reschedule: true, refreshExpiration: true });
      return;
    }

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(1000, "Room expired");
      } catch {
        // Expired sockets do not need additional cleanup.
      }
    }

    this.latestSnapshot = null;
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "blaze-copters" });
    }

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const payload = await request.json().catch(() => ({}));
      const hostId = cleanPlayerId(payload.hostId);
      const sessionToken = cleanSessionToken(payload.sessionToken);
      const mode = payload.mode == null ? DEFAULT_MODE_ID : String(payload.mode);
      const level = payload.level == null ? defaultLevelForMode(mode) : String(payload.level);
      if (!hostId || !sessionToken) {
        return Response.json({ ok: false, error: "Missing valid host credentials" }, { status: 400 });
      }
      if (!isValidMode(mode) || !isValidLevel(mode, level)) {
        return Response.json({ ok: false, error: "Invalid game mode or level" }, { status: 400 });
      }

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = makeRoomCode();
        const id = env.GAME_ROOMS.idFromName(code);
        const room = env.GAME_ROOMS.get(id);
        const result = await room.fetch(new Request(`${url.origin}/api/rooms/${code}/init`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code,
            hostId,
            hostName: payload.hostName,
            sessionToken,
            mode,
            level,
          }),
        }));
        if (result.status === 201 || result.ok) return Response.json({ code }, { status: 201 });
        if (result.status !== 409) return result;
      }

      return Response.json({ ok: false, error: "Could not allocate room code" }, { status: 503 });
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{4})\/(state|ws)$/i);
    if (roomMatch) {
      const code = roomMatch[1].toUpperCase();
      const action = roomMatch[2].toLowerCase();
      const id = env.GAME_ROOMS.idFromName(code);
      const room = env.GAME_ROOMS.get(id);

      if (action === "state") {
        return room.fetch(new Request(`${url.origin}/api/rooms/${code}/state`, request));
      }

      return room.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};
