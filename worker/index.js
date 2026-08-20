import { DurableObject } from "cloudflare:workers";

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeRoomCode() {
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "POST" && url.pathname.endsWith("/init")) {
      const payload = await request.json().catch(() => ({}));
      await this.ctx.storage.put("room", {
        code: payload.code ?? null,
        createdAt: Date.now(),
        players: []
      });
      return Response.json({ ok: true });
    }

    if (request.method === "GET" && url.pathname.endsWith("/state")) {
      const room = (await this.ctx.storage.get("room")) ?? null;
      return Response.json({ room });
    }

    return new Response("Not found", { status: 404 });
  }

  webSocketMessage(_socket, message) {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // Ignore sockets that closed between enumeration and send.
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "blaze-copters" });
    }

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const code = makeRoomCode();
      const id = env.GAME_ROOMS.idFromName(code);
      const room = env.GAME_ROOMS.get(id);
      await room.fetch(new Request(`${url.origin}/api/rooms/${code}/init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code })
      }));
      return Response.json({ code }, { status: 201 });
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{4})\/(state|ws)$/);
    if (roomMatch) {
      const [, code, action] = roomMatch;
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
