import { DIFFICULTIES, HELICOPTER_COLORS } from './game/config.js';
import { createRoom, chooseColor, canStart } from './game/room-state.js';
import { BlazeSimulation } from './game/simulation.js';
import { attachJoystick } from './ui/joystick.js';
import { drawSimulation } from './ui/render.js';

const app = document.querySelector('#app');
const session = {
  playerId: crypto.randomUUID(),
  room: null,
  sim: null,
  input: { x: 0, y: 0 },
};

const makeRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

function homeScreen() {
  app.innerHTML = `
    <section class="screen">
      <div class="card stack">
        <div>
          <h1 class="title">Blaze Copters</h1>
          <p class="subtitle">Co-op wildfire helicopter mini game</p>
        </div>
        <label>Player name
          <input id="player-name" maxlength="18" placeholder="Player 1" value="Player 1" />
        </label>
        <button id="create-game">Create Game</button>
        <div class="row">
          <input class="grow" id="join-code" maxlength="4" placeholder="ROOM CODE" autocomplete="off" />
          <button class="secondary" id="join-game" disabled>Join Game</button>
        </div>
        <div class="notice small">Online room joining will turn on after the Cloudflare server is connected. The local host flow is active now so we can build and test the game first.</div>
      </div>
    </section>`;

  document.querySelector('#create-game').addEventListener('click', () => {
    const name = document.querySelector('#player-name').value.trim() || 'Player 1';
    session.room = createRoom({ roomCode: makeRoomCode(), hostId: session.playerId, hostName: name });
    lobbyScreen();
  });
}

function lobbyScreen() {
  const room = session.room;
  const me = room.players.find((p) => p.id === session.playerId);
  const takenColors = new Set(room.players.filter((p) => p.id !== me.id).map((p) => p.colorId));
  const joinUrl = `${location.origin}${location.pathname}?room=${room.roomCode}`;

  app.innerHTML = `
    <section class="screen">
      <div class="card stack">
        <div class="badge">${me.isHost ? 'HOST' : 'PLAYER'}</div>
        <div class="room-code">${room.roomCode}</div>
        <div class="join-url">${joinUrl}</div>
        <div class="notice small">QR code will be generated from this join link after the online hostname is deployed.</div>

        <label>Difficulty
          <select id="difficulty" ${me.isHost ? '' : 'disabled'}>
            ${Object.entries(DIFFICULTIES).map(([id, value]) => `<option value="${id}" ${room.difficulty === id ? 'selected' : ''}>${value.label}</option>`).join('')}
          </select>
        </label>

        <div>
          <strong>Choose your helicopter</strong>
          <div class="colors" style="margin-top:10px">
            ${HELICOPTER_COLORS.map((color) => `<button aria-label="${color.label}" data-color="${color.id}" class="color-button ${me.colorId === color.id ? 'selected' : ''} ${takenColors.has(color.id) ? 'taken' : ''}" style="background:${color.value}" ${takenColors.has(color.id) ? 'disabled' : ''}></button>`).join('')}
          </div>
        </div>

        <div>
          <strong>Players (${room.players.length}/6)</strong>
          <div class="players" style="margin-top:10px">
            ${room.players.map((player) => {
              const color = HELICOPTER_COLORS.find((c) => c.id === player.colorId);
              return `<div class="player-chip"><span class="swatch" style="background:${color?.value || 'transparent'};border:1px solid rgba(255,255,255,.3)"></span><span>${player.name}${player.isHost ? ' ★' : ''}</span></div>`;
            }).join('')}
          </div>
        </div>

        ${me.isHost ? `<button id="start-game" ${canStart(room, me.id) ? '' : 'disabled'}>Start Mission</button>` : `<div class="notice">Waiting for host to start…</div>`}
        <button class="secondary" id="leave-game">Leave</button>
      </div>
    </section>`;

  document.querySelectorAll('[data-color]').forEach((button) => {
    button.addEventListener('click', () => {
      chooseColor(room, session.playerId, button.dataset.color);
      lobbyScreen();
    });
  });

  document.querySelector('#difficulty')?.addEventListener('change', (event) => {
    room.difficulty = event.target.value;
  });

  document.querySelector('#start-game')?.addEventListener('click', () => {
    room.phase = 'playing';
    gameScreen();
  });

  document.querySelector('#leave-game').addEventListener('click', () => {
    session.room = null;
    homeScreen();
  });
}

function gameScreen() {
  const room = session.room;
  app.innerHTML = `
    <section class="game-screen">
      <canvas id="game-canvas"></canvas>
      <div class="hud">
        <div class="hud-group">
          <div class="hud-pill" id="round-hud">Round ${room.round}</div>
          <div class="hud-pill" id="fire-hud">Fires 0</div>
        </div>
        <div class="hud-group">
          <div class="hud-pill" id="water-hud">Water 100%</div>
          <div class="hud-pill" id="time-hud">2:30</div>
        </div>
      </div>
      <div class="joystick-zone" id="joystick"><div class="joystick-knob" id="joystick-knob"></div></div>
    </section>`;

  const canvas = document.querySelector('#game-canvas');
  const ctx = canvas.getContext('2d');

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (session.sim) session.sim.resize(rect.width, rect.height);
  };
  resize();

  const rect = canvas.getBoundingClientRect();
  session.sim = new BlazeSimulation({ width: rect.width, height: rect.height, players: room.players, difficulty: room.difficulty, round: room.round });
  window.addEventListener('resize', resize, { passive: true });

  const setInput = (x, y) => {
    session.input.x = x; session.input.y = y;
    session.sim?.setInput(session.playerId, x, y);
  };

  attachJoystick(document.querySelector('#joystick'), document.querySelector('#joystick-knob'), setInput);

  const keys = new Set();
  const refreshKeyboard = () => {
    const x = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
    const y = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
    setInput(x, y);
  };
  window.onkeydown = (event) => { keys.add(event.code); refreshKeyboard(); };
  window.onkeyup = (event) => { keys.delete(event.code); refreshKeyboard(); };

  const loop = (now) => {
    if (!session.sim) return;
    session.sim.tick(now);
    drawSimulation(ctx, session.sim);
    const mine = session.sim.helicopters.find((h) => h.id === session.playerId);
    document.querySelector('#fire-hud').textContent = `Fires ${session.sim.fires.length}`;
    document.querySelector('#water-hud').textContent = `Water ${Math.round((mine.water / mine.capacity) * 100)}%`;
    const seconds = Math.ceil(session.sim.timeLeft);
    document.querySelector('#time-hud').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

    if (session.sim.complete) {
      endRoundScreen();
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function endRoundScreen() {
  const sim = session.sim;
  const choices = sim.upgradeChoices();
  app.innerHTML = `
    <section class="screen">
      <div class="card stack">
        <h2 style="margin:0">Round ${session.room.round} Complete</h2>
        <div class="row">
          <div class="notice grow"><strong>${sim.extinguished}</strong><br><span class="small">fires extinguished</span></div>
          <div class="notice grow"><strong>${sim.fires.length}</strong><br><span class="small">fires still burning</span></div>
        </div>
        <h3 style="margin-bottom:0">Team Upgrade Vote</h3>
        <p class="small">Two choices per round. Online mode will collect one vote from every connected player.</p>
        <div class="row">
          ${choices.map((choice) => `<button class="grow upgrade-choice" data-upgrade="${choice.id}">${choice.label}<br><span style="font-weight:500">${choice.description}</span></button>`).join('')}
        </div>
        <button class="secondary" id="lobby-button">Return to Lobby</button>
      </div>
    </section>`;

  document.querySelectorAll('.upgrade-choice').forEach((button) => {
    button.addEventListener('click', () => {
      session.room.round += 1;
      gameScreen();
    }, { once: true });
  });
  document.querySelector('#lobby-button').addEventListener('click', lobbyScreen);
}

homeScreen();
