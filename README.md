# Blaze Copters

Blaze Copters is a simple cross-platform cooperative firefighting mini game for 1-6 players in a web browser.

## Current prototype goals

- Host creates a room and receives a 4-character room code.
- Up to six players join from phones, tablets, or computers.
- Every player chooses one unique helicopter color.
- Host chooses difficulty and starts the match.
- Mobile: one touch joystick only.
- Desktop: arrow keys or WASD.
- Water drops automatically while flying over fire.
- Refill automatically by hovering over water for a refill timer.
- Fire spreads over time and scales with player count.
- Burned ground recovers toward green after a delay.
- Between rounds the team votes between two upgrades.
- Story co-op and versus mode are planned after the core multiplayer loop is stable.

## Architecture plan

### Phase 1 — GitHub / local prototype

Static HTML, CSS, Canvas, and JavaScript. The current build uses temporary vector shapes so gameplay can be tuned before sprite art is created.

### Phase 2 — Cloudflare multiplayer

Planned Cloudflare stack:

- Workers Static Assets: serves the web game.
- Worker API: room creation/join endpoints.
- One Durable Object per active game room.
- WebSockets: real-time player input and authoritative room state.
- Host remains the room owner, but the Durable Object runs the match so a host phone is not the server.

The client code will send **input changes**, not a continuous flood of position messages. The server will own fire spread, water hits, timers, votes, player colors, and round state.

## Run locally

From the repository folder:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Current status

The local single-device prototype includes:

- Main menu
- Create-game flow
- 4-character room code
- Unique helicopter color selection
- Difficulty selection
- Host-only Start button
- Canvas game map
- Keyboard movement
- Touch joystick
- Automatic water drop
- Timed automatic refill
- Fire spread
- Player-count difficulty scaling
- Burned-ground recovery
- End-of-round upgrade choices

Online join, QR rendering, shared multiplayer state, reconnects, and real voting will be connected when the Cloudflare phase begins.
