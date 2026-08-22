import { DIFFICULTIES, HELICOPTER_COLORS } from './game/config.js';
import { BlazeSimulation } from './game/simulation.js';
import { attachJoystick } from './ui/joystick.js';
import { drawSimulation } from './ui/render.js';

const app = document.querySelector('#app');
const storedPlayerId = sessionStorage.getItem('blaze-copters-player-id');
const playerId = storedPlayerId || crypto.randomUUID();
sessionStorage.setItem('blaze-copters-player-id', playerId);

const session = {
  playerId,
  room: null,
  ws: null,
  sim: null,
  view: 'home',
  intentionalLeave: false,
  input: { x: 0, y: 0 },
  upgrades: { tank: 0, speed: 0, power: 0 },
  resizeHandler: null,
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const requestedRoomCode = () => (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

function cleanupGameView() {
  if (session.resizeHandler) {
    window.removeEventListener('resize', session.resizeHandler);
    session.resizeHandler = null;
  }
  window.onkeydown = null;
  window.onkeyup = null;
  session.input.x = 0;
  session.input.y = 0;
}

function resetMissionProgress() {
  session.upgrades = { tank: 0, speed: 0, power: 0 };
}

function setRoomQuery(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState({}, '', url);
}

function sendRoomMessage(type, payload = {}) {
  if (session.ws?.readyState !== WebSocket.OPEN) return false;
  session.ws.send(JSON.stringify({ type, ...payload }));
  return true;
}

async function roomExists(code) {
  const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/state`, { cache: 'no-store' });
  return response.ok;
}

async function createOnlineRoom(name) {
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hostId: session.playerId, hostName: name }),
  });
  if (!response.ok) throw new Error('Could not create a room.');
  const data = await response.json();
  return data.code;
}

function applyRoomState(room) {
  session.room = room;
  if (!room) return;

  if (room.phase === 'playing') {
    const activePlayers = room.players.filter((player) => player.connected !== false);
    if (session.view !== 'game') gameScreen();
    else session.sim?.syncPlayers(activePlayers);
    return;
  }

  if (room.phase === 'lobby') lobbyScreen();
}

function connectToRoom(code, name) {
  return new Promise((resolve, reject) => {
    if (session.ws) {
      session.intentionalLeave = true;
      session.ws.close();
      session.ws = null;
    }

    session.intentionalLeave = false;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({ playerId: session.playerId, name });
    const ws = new WebSocket(`${protocol}//${location.host}/api/rooms/${code}/ws?${params}`);
    session.ws = ws;
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Room connection timed out.'));
        ws.close();
      }
    }, 8000);

    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'state') {
        applyRoomState(message.room);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve();
        }
        return;
      }

      if (message.type === 'input') {
        session.sim?.setInput(message.playerId, message.x, message.y);
        return;
      }

      if (message.type === 'error') window.alert(message.message || 'Room error');
    });

    ws.addEventListener('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error('Could not connect to that room.'));
      }
    });

    ws.addEventListener('close', () => {
      clearTimeout(timeout);
      if (session.ws === ws) session.ws = null;
      if (!settled) {
        settled = true;
        reject(new Error('Could not connect to that room.'));
      }
      if (!session.intentionalLeave && session.view !== 'home') {
        cleanupGameView();
        session.room = null;
        session.sim = null;
        setRoomQuery('');
        homeScreen('Connection to the room was lost. You can create or join again.');
      }
    });
  });
}

function homeScreen(message = '') {
  cleanupGameView();
  session.view = 'home';
  session.sim = null;
  resetMissionProgress();
  const prefillCode = requestedRoomCode();

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
          <input class="grow" id="join-code" maxlength="4" placeholder="ROOM CODE" autocomplete="off" value="${escapeHtml(prefillCode)}" />
          <button class="secondary" id="join-game" ${prefillCode.length === 4 ? '' : 'disabled'}>Join Game</button>
        </div>
        <div id="home-status" class="notice small">${escapeHtml(message || 'Online rooms are live. Create a room here, then join it from another phone, tablet, or computer with the 4-character code.')}</div>
      </div>
    </section>`;

  const nameInput = document.querySelector('#player-name');
  const codeInput = document.querySelector('#join-code');
  const joinButton = document.querySelector('#join-game');
  const createButton = document.querySelector('#create-game');
  const status = document.querySelector('#home-status');

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    joinButton.disabled = codeInput.value.length !== 4;
  });

  createButton.addEventListener('click', async () => {
    const name = nameInput.value.trim() || 'Player 1';
    resetMissionProgress();
    createButton.disabled = true;
    joinButton.disabled = true;
    status.textContent = 'Creating online room…';
    try {
      const code = await createOnlineRoom(name);
      setRoomQuery(code);
      await connectToRoom(code, name);
    } catch (error) {
      createButton.disabled = false;
      joinButton.disabled = codeInput.value.length !== 4;
      status.textContent = error.message || 'Could not create room.';
    }
  });

  joinButton.addEventListener('click', async () => {
    const name = nameInput.value.trim() || 'Player 1';
    const code = codeInput.value.toUpperCase();
    resetMissionProgress();
    joinButton.disabled = true;
    createButton.disabled = true;
    status.textContent = `Looking for room ${code}…`;
    try {
      if (!(await roomExists(code))) throw new Error(`Room ${code} was not found.`);
      setRoomQuery(code);
      await connectToRoom(code, name);
    } catch (error) {
      joinButton.disabled = false;
      createButton.disabled = false;
      status.textContent = error.message || 'Could not join room.';
    }
  });
}

function lobbyScreen() {
  cleanupGameView();
  session.view = 'lobby';
  const room = session.room;
  if (!room) return homeScreen();

  const activePlayers = room.players.filter((player) => player.connected !== false);
  const me = activePlayers.find((player) => player.id === session.playerId);
  if (!me) return;

  const takenColors = new Set(activePlayers.filter((player) => player.id !== me.id).map((player) => player.colorId).filter(Boolean));
  const joinUrl = `${location.origin}${location.pathname}?room=${room.roomCode}`;
  const canStart = me.isHost && activePlayers.length >= 1 && activePlayers.every((player) => player.colorId);

  app.innerHTML = `
    <section class="screen">
      <div class="card stack">
        <div class="badge">${me.isHost ? 'HOST' : 'PLAYER'}</div>
        <div class="room-code">${escapeHtml(room.roomCode)}</div>
        <div class="join-url">${escapeHtml(joinUrl)}</div>
        <div class="notice small">Online lobby connected. Share the room code or link. Up to 6 players can join.</div>

        <label>Difficulty
          <select id="difficulty" ${me.isHost ? '' : 'disabled'}>
            ${Object.entries(DIFFICULTIES).map(([id, value]) => `<option value="${id}" ${room.difficulty === id ? 'selected' : ''}>${escapeHtml(value.label)}</option>`).join('')}
          </select>
        </label>

        <div>
          <strong>Choose your helicopter</strong>
          <div class="colors" style="margin-top:10px">
            ${HELICOPTER_COLORS.map((color) => `<button aria-label="${escapeHtml(color.label)}" data-color="${color.id}" class="color-button ${me.colorId === color.id ? 'selected' : ''} ${takenColors.has(color.id) ? 'taken' : ''}" style="background:${color.value}" ${takenColors.has(color.id) ? 'disabled' : ''}></button>`).join('')}
          </div>
        </div>

        <div>
          <strong>Players (${activePlayers.length}/6)</strong>
          <div class="players" style="margin-top:10px">
            ${activePlayers.map((player) => {
              const color = HELICOPTER_COLORS.find((item) => item.id === player.colorId);
              return `<div class="player-chip"><span class="swatch" style="background:${color?.value || 'transparent'};border:1px solid rgba(255,255,255,.3)"></span><span>${escapeHtml(player.name)}${player.isHost ? ' ★' : ''}</span></div>`;
            }).join('')}
          </div>
        </div>

        ${me.isHost ? `<button id="start-game" ${canStart ? '' : 'disabled'}>Start Mission</button>` : `<div class="notice">Waiting for host to start…</div>`}
        <div class="notice small">Core gameplay is being tuned locally first. Shared fire/game-state synchronization will be connected after the local game loop is solid.</div>
        <button class="secondary" id="leave-game">Leave</button>
      </div>
    </section>`;

  document.querySelectorAll('[data-color]').forEach((button) => button.addEventListener('click', () => sendRoomMessage('setColor', { colorId: button.dataset.color })));
  document.querySelector('#difficulty')?.addEventListener('change', (event) => sendRoomMessage('setDifficulty', { difficulty: event.target.value }));
  document.querySelector('#start-game')?.addEventListener('click', () => sendRoomMessage('start'));

  document.querySelector('#leave-game').addEventListener('click', () => {
    session.intentionalLeave = true;
    sendRoomMessage('leave');
    setTimeout(() => session.ws?.close(), 80);
    session.room = null;
    session.sim = null;
    setRoomQuery('');
    homeScreen();
  });
}

function paintWaterHud(hud, percent) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  hud.textContent = `Water ${safePercent}%`;
  const level = safePercent >= 80 ? 'high' : safePercent >= 40 ? 'mid' : 'low';
  if (hud.dataset.level === level) return;
  hud.dataset.level = level;

  if (level === 'high') {
    hud.style.background = 'rgba(38, 150, 67, .94)';
    hud.style.color = '#fff';
    hud.style.borderColor = 'rgba(108, 255, 137, .55)';
  } else if (level === 'mid') {
    hud.style.background = 'rgba(242, 183, 5, .96)';
    hud.style.color = '#182016';
    hud.style.borderColor = 'rgba(255, 235, 128, .7)';
  } else {
    hud.style.background = 'rgba(187, 40, 34, .94)';
    hud.style.color = '#fff';
    hud.style.borderColor = 'rgba(255, 126, 119, .62)';
  }
}

function gameScreen() {
  cleanupGameView();
  session.view = 'game';
  const room = session.room;
  const activePlayers = room.players.filter((player) => player.connected !== false);

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
    if (!canvas.isConnected) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (session.sim) session.sim.resize(rect.width, rect.height);
  };
  resize();

  const rect = canvas.getBoundingClientRect();
  session.sim = new BlazeSimulation({ width: rect.width, height: rect.height, players: activePlayers, difficulty: room.difficulty, round: room.round, upgrades: session.upgrades });
  session.resizeHandler = resize;
  window.addEventListener('resize', resize, { passive: true });

  const setInput = (x, y) => {
    session.input.x = x;
    session.input.y = y;
    session.sim?.setInput(session.playerId, x, y);
    sendRoomMessage('input', { x, y });
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
    if (!session.sim || session.view !== 'game') return;
    session.sim.tick(now);
    drawSimulation(ctx, session.sim);
    const mine = session.sim.helicopters.find((helicopter) => helicopter.id === session.playerId);
    const fireHud = document.querySelector('#fire-hud');
    const waterHud = document.querySelector('#water-hud');
    const timeHud = document.querySelector('#time-hud');
    if (!fireHud || !waterHud || !timeHud) return;

    fireHud.textContent = `Fires ${session.sim.fires.length}`;
    if (mine) paintWaterHud(waterHud, (mine.water / mine.capacity) * 100);
    const seconds = Math.ceil(session.sim.timeLeft);
    timeHud.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

    if (session.sim.complete) return endRoundScreen();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function endRoundScreen() {
  cleanupGameView();
  session.view = 'round-end';
  const sim = session.sim;
  const choices = sim.upgradeChoices();
  const me = session.room.players.find((player) => player.id === session.playerId);

  app.innerHTML = `
    <section class="screen">
      <div class="card stack">
        <h2 style="margin:0">Round ${session.room.round} Complete</h2>
        <div class="row">
          <div class="notice grow"><strong>${sim.extinguished}</strong><br><span class="small">fires extinguished</span></div>
          <div class="notice grow"><strong>${sim.fires.length}</strong><br><span class="small">fires still burning</span></div>
        </div>
        <h3 style="margin-bottom:0">Choose One Upgrade</h3>
        <div class="row">
          ${choices.map((choice) => `<button class="grow upgrade-choice" data-upgrade="${choice.id}">${escapeHtml(choice.label)}<br><span style="font-weight:500">${escapeHtml(choice.description)}</span><br><span class="small">Level ${session.upgrades[choice.id] || 0} → ${(session.upgrades[choice.id] || 0) + 1}</span></button>`).join('')}
        </div>
        ${me?.isHost ? '<button class="secondary" id="lobby-button" disabled>Continue</button>' : '<button class="secondary" id="leave-round">Leave Room</button>'}
      </div>
    </section>`;

  let selected = false;
  document.querySelectorAll('.upgrade-choice').forEach((button) => {
    button.addEventListener('click', () => {
      if (selected) return;
      const id = button.dataset.upgrade;
      if (!(id in session.upgrades)) return;
      selected = true;
      session.upgrades[id] += 1;
      document.querySelectorAll('.upgrade-choice').forEach((choiceButton) => { choiceButton.disabled = true; });
      button.textContent = 'Selected';
      const lobbyButton = document.querySelector('#lobby-button');
      if (lobbyButton) lobbyButton.disabled = false;
    });
  });

  document.querySelector('#lobby-button')?.addEventListener('click', () => sendRoomMessage('returnLobby'));

  document.querySelector('#leave-round')?.addEventListener('click', () => {
    session.intentionalLeave = true;
    sendRoomMessage('leave');
    setTimeout(() => session.ws?.close(), 80);
    session.room = null;
    session.sim = null;
    setRoomQuery('');
    homeScreen();
  });
}

homeScreen();
