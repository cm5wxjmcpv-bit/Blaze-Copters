# Blaze Copters

Blaze Copters is a cooperative browser firefighting game for one to six players. Phones, tablets, and computers can join the same four-character room and fight the same fires.

## Current game

- Classic Co-op on the Starter Training Grounds map.
- One to six players, with a different helicopter color for each player.
- Touch joystick on mobile; arrow keys or WASD on a computer.
- Automatic water drops over fires and automatic refills over the lake.
- Fire spread and difficulty scale with the number of connected players.
- Shared fires, fire health, helicopters, water levels, map dimensions, and round timers.
- Three shared upgrades between rounds: more water, faster helicopter, or stronger water.
- Automatic reconnection and recovery of an in-progress round.

## Multiplayer architecture

Cloudflare Workers serves the static game and routes room requests to a Durable Object. Each room owns its players, authenticated player sessions, host, selected mode, selected level, difficulty, upgrades, round deadlines, and a recent recoverable match snapshot.

The current room host runs the lightweight gameplay simulation. The Durable Object validates and rebroadcasts match snapshots, enforces room permissions and the round deadline, restores reconnecting players, automatically replaces a disconnected or stalled host, and expires abandoned rooms.

Game modes and their available levels are registered in `src/game/modes.js`. Both the browser client and the Cloudflare Worker use that registry, so new modes must be added there before they can be selected or synchronized.

## Local development

Install the development dependency, build the static assets, and start the local Cloudflare Worker:

```bash
npm install
npm run build
npm run dev
```

Wrangler runs both the browser game and its room/WebSocket endpoints locally. A static-only HTTP server cannot provide multiplayer room APIs.

Run the regression suite with:

```bash
npm test
```

Build and deploy with:

```bash
npm run build
npm run deploy
```
