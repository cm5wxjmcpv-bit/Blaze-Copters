# Blaze Copters

Blaze Copters is a cooperative browser firefighting game for one to six players. Phones, tablets, and computers can join the same four-character room and fight the same fires.

## Cooperative game modes

- **Wildfire Survival**: an endless escalating wildfire; the team score is survival time.
- **Protect the Town**: contain the fire before three of Pine Ridge's seven buildings are destroyed.
- **Spot Fire**: survive an ember storm, respond to visible ignition warnings, and extinguish the remaining fires.
- **Evacuation**: keep Cedar Creek Road open while automatic cars and buses travel to safety.
- **Convoy Protection**: escort four vehicles through an endless scrolling, chunk-streamed wildfire map; the team score is distance.

Each mission currently has one starter map. Classic Co-op remains available internally for compatibility with existing rooms, but new rooms begin with the five-mode mission picker.

## Shared gameplay

- One to six players, with a different helicopter color for each player.
- Four expressive animated helicopter choices: Chinook, Kamov, Skycrane, and Firehawk.
- Helicopter selection is cosmetic only; every aircraft has identical speed, water capacity, and fire suppression.
- Touch joystick on mobile; arrow keys or WASD on a computer.
- Automatic water drops over fires and automatic refills over the lake.
- Fire spread and difficulty scale with the number of connected players.
- Shared fires, fire health, helicopters, water levels, map dimensions, mission objectives, moving vehicles, and round timers.
- Three shared upgrades between rounds: more water, faster helicopter, or stronger water.
- Automatic reconnection and recovery of an in-progress round.
- Responsive mission-specific HUDs and team results; no competitive individual winners or action buttons.

## Mode and multiplayer architecture

Cloudflare Workers serves the static game and routes room requests to a Durable Object. Each room owns its players, authenticated player sessions, host, selected mode, selected level, difficulty, upgrades, round deadlines, and a recent recoverable match snapshot.

The current room host runs the lightweight shared gameplay simulation. Guest browsers never create their own fires, random events, evacuation traffic, or convoy terrain. The Durable Object validates and rebroadcasts versioned snapshots containing fires, fire health, objectives, building conditions, ember warnings, evacuation vehicles, convoy vehicles, integrity, distance, and active terrain chunks. It enforces room permissions, timed-mission deadlines, reconnect recovery, stalled-host replacement, and abandoned-room cleanup. Endless missions intentionally have no round deadline.

Game modes, map layouts, mission rules, and available levels are registered in `src/game/modes.js`. Mode-specific rule controllers live in `src/game/mode-controllers.js`, while `src/game/simulation.js` retains the single shared movement, water, fire, scoring, snapshot, and upgrade engine. Both the browser and the Cloudflare Worker use the same registry. Add new levels to a mode's level list; the result screen will offer the next level when one exists.

The four selectable helicopter characters use lightweight animated vector artwork with expressive eyes, spinning rotors, hovering movement, swaying buckets, and visible water drops. Houses, cars, buses, convoy trucks, ember warnings, and scrolling scenery remain lightweight canvas/vector artwork.

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

The regression suite covers the legacy mode, all five mission controllers, screen resizing, phone controls, keyboard controls, mode-specific objectives and endings, multiple synchronized clients, reconnect recovery, host replacement, snapshot sanitization, and bounded convoy chunk cleanup.

Build and deploy with:

```bash
npm run build
npm run deploy
```
