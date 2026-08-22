import { DurableObject } from "cloudflare:workers";

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const COLOR_IDS = new Set(["red", "blue", "yellow", "green", "purple", "orange"]);
const DIFFICULTY_IDS = new Set(["easy", "normal", "wildfire"]);
const UPGRADE_IDS = new Set(["tank", "speed", "power"]);

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

function connectedPlayers(room) {
  return room.players.filter((player) => player.connected !== false);
}

function ensureConnectedHost(room) {
  const currentHost = room.players.find((player) => player.id === room.hostId && player.connected !== false);
  const nextHost = currentHost ?? connectedPlayers(room)[0] ?? null;
  room.hostId = nextHost?.id ?? null;
  for (const player of room.players) player.isHost = player.id === room.hostId;
}

function clampNumber(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function sanitizeSnapshot(rawSnapshot, room) {
  if (!rawSnapshot || Number(rawSnapshot.round) !== room.round) return null;

  const activeIds = new Set(connectedPlayers(room).map((player) => player.id));
  const fires = Array.isArray(rawSnapshot.fires)
    ? rawSnapshot.fires.slice(0, 40).map((fire) => ({
        x: clampNumber(fire?.x, 0, 1, .5),
        y: clampNumber(fire?.y, 0, 1, .5),
        hp: clampNumber(fire?.hp, 0, 100, 100),
        radius: clampNumber(fire?.radius, .005, .12, .03),
      }))
    : [];

  const burned = Array.isArray(rawSnapshot.burned)
    ? rawSnapshot.burned.slice(0, 80).map((patch) => ({
        x: clampNumber(patch?.x, 0, 1, .5),
        y: clampNumber(patch?.y, 0, 1, .5),
        age: clampNumber(patch?.age, 0, 16, 0),
        radius: clampNumber(patch?.radius, .005, .15, .03),
      }))
    : [];

  const helicopters = Array.isArray(rawSnapshot.helicopters)
    ? rawSnapshot.helicopters
        .slice(0, 6)
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

  return {
    version: 1,
    round: room.round,
    timeLeft: clampNumber(rawSnapshot.timeLeft, 0, 600, 0),
    complete: Boolean(rawSnapshot.complete),
    extinguished: Math.floor(clampNumber(rawSnapshot.extinguished, 0, 10000, 0)),
    spreadElapsedMs: clampNumber(rawSnapshot.spreadElapsedMs, 0, 60000, 0),
    fires,
    burned,
    helicopters,
  };
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async getRoom() {
    return (await this.ctx.storage.get("room")) ?? null;
  }

  async saveRoom(room) {
    await this.ctx.storage.put("room", room);
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

  async broadcastRoom(room) {
    await this.saveRoom(room);
    this.broadcast({ type: "state", room });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname.endsWith("/init")) {
      const existing = await this.getRoom();
      if (existing) return Response.json({ ok: false, error: "Room already exists" }, { status: 409 });

      const payload = await request.json().catch(() => ({}));
      const hostId = String(payload.hostId ?? "");
      if (!hostId) return Response.json({ ok: false, error: "Missing host" }, { status: 400 });

      const room = {
        roomCode: String(payload.code ?? "").toUpperCase(),
        createdAt: Date.now(),
        phase: "lobby",
        hostId,
        difficulty: "normal",
        round: 1,
        upgrades: { tank: 0, speed: 0, power: 0 },
        selectedUpgrade: null,
        players: [{
          id: hostId,
          name: cleanName(payload.hostName),
          colorId: null,
          connected: false,
          isHost: true,
        }],
      };
      await this.saveRoom(room);
      return Response.json({ ok: true, room });
    }

    if (request.method === "GET" && url.pathname.endsWith("/state")) {
      const room = await this.getRoom();
      if (!room) return Response.json({ ok: false, error: "Room not found" }, { status: 404 });
      return Response.json({ ok: true, room });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const room = await this.getRoom();
      if (!room) return new Response("Room not found", { status: 404 });

      const playerId = String(url.searchParams.get("playerId") ?? "");
      const playerName = cleanName(url.searchParams.get("name"));
      if (!playerId) return new Response("Missing player id", { status: 400 });

      let player = room.players.find((item) => item.id === playerId);
      if (!player) {
        if (connectedPlayers(room).length >= 6) return new Response("Room is full", { status: 409 });
        player = {
          id: playerId,
          name: playerName,
          colorId: null,
          connected: true,
          isHost: false,
        };
        room.players.push(player);
      } else {
        player.name = playerName;
        player.connected = true;
      }

      room.upgrades ??= { tank: 0, speed: 0, power: 0 };
      room.selectedUpgrade ??= null;
      ensureConnectedHost(room);

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ playerId });
      await this.broadcastRoom(room);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(socket, rawMessage) {
    if (typeof rawMessage !== "string") return;

    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid message" }));
      return;
    }

    const attachment = socket.deserializeAttachment?.() ?? null;
    const playerId = attachment?.playerId;
    if (!playerId) return;

    const room = await this.getRoom();
    if (!room) return;
    const player = room.players.find((item) => item.id === playerId);
    if (!player) return;

    if (message.type === "input") {
      const x = Math.max(-1, Math.min(1, Number(message.x) || 0));
      const y = Math.max(-1, Math.min(1, Number(message.y) || 0));
      this.broadcast({ type: "input", playerId, x, y });
      return;
    }

    if (message.type === "matchSnapshot") {
      if (room.phase !== "playing" || room.hostId !== playerId) return;
      const snapshot = sanitizeSnapshot(message.snapshot, room);
      if (!snapshot) return;

      this.broadcast({ type: "matchSnapshot", snapshot });

      if (snapshot.complete) {
        room.phase = "roundEnd";
        await this.broadcastRoom(room);
      }
      return;
    }

    if (message.type === "setColor") {
      const colorId = String(message.colorId ?? "");
      if (!COLOR_IDS.has(colorId)) return;
      const taken = room.players.some((item) => item.id !== playerId && item.connected !== false && item.colorId === colorId);
      if (taken) {
        socket.send(JSON.stringify({ type: "error", message: "That helicopter color is already taken." }));
        return;
      }
      player.colorId = colorId;
      await this.broadcastRoom(room);
      return;
    }

    if (message.type === "setDifficulty") {
      if (!player.isHost) return;
      const difficulty = String(message.difficulty ?? "");
      if (!DIFFICULTY_IDS.has(difficulty)) return;
      room.difficulty = difficulty;
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
      room.players = active;
      ensureConnectedHost(room);
      room.upgrades ??= { tank: 0, speed: 0, power: 0 };
      room.selectedUpgrade = null;
      room.phase = "playing";
      await this.broadcastRoom(room);
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
      room.phase = "lobby";
      room.round += 1;
      room.selectedUpgrade = null;
      await this.broadcastRoom(room);
      return;
    }

    if (message.type === "leave") {
      room.players = room.players.filter((item) => item.id !== playerId);
      ensureConnectedHost(room);
      await this.broadcastRoom(room);
    }
  }

  async webSocketClose(socket) {
    const attachment = socket.deserializeAttachment?.() ?? null;
    const playerId = attachment?.playerId;
    if (!playerId) return;

    const room = await this.getRoom();
    if (!room) return;
    const player = room.players.find((item) => item.id === playerId);
    if (!player) return;

    player.connected = false;
    player.colorId = null;
    ensureConnectedHost(room);
    await this.broadcastRoom(room);
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
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
      const hostId = String(payload.hostId ?? "");
      if (!hostId) return Response.json({ ok: false, error: "Missing host" }, { status: 400 });

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = makeRoomCode();
        const id = env.GAME_ROOMS.idFromName(code);
        const room = env.GAME_ROOMS.get(id);
        const result = await room.fetch(new Request(`${url.origin}/api/rooms/${code}/init`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, hostId, hostName: payload.hostName }),
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
