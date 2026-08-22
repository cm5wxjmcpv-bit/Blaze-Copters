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
  resizeHandler: null,
  lastSnapshotSent: 0,
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const requestedRoomCode = () => (new URLSearchParams(location.search).get('room') || '')
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .slice(0, 4);

function roomUpgrades(room = session.room) {
  return {
    tank: Math.max(0, Number(room?.upgrades?.tank) || 0),
    speed: Math.max(0, Number(room?.upgrades?.speed) || 0),
    power: Math.max(0, Number(room?.upgrades?.power) || 0),
  };
}

function isMatchHost() {
  return Boolean(session.room && session.room.hostId === session.playerId);
}

function cleanupGameView() {
  if (session.resizeHandler) {
    window.removeEventListener('resize', session.resizeHandler);
    session.resizeHandler = null;
  }
  window.onkeydown = null;
  window.onkeyup = null;
  session.input.x = 0;
  session.input.y = 0;
  session.lastSnapshotSent = 0;
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

    if (session.view === 'round-end' && session.sim?.complete) return;

    if (session.view !== 'game') {
      gameScreen();
    } else {
      session.sim?.syncPlayers(activePlayers);
    }
    return;
  }

  if (room.phase === 'roundEnd') {
    endRoundScreen();
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

      if (message.type === 'matchSnapshot') {
        if (!isMatchHost()) session.sim?.applySnapshot(message.snapshot);
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

function leaveRoom() {
  session.intentionalLeave = true;
  sendRoomMessage('leave');
  setTimeout(() => session.ws?.close(), 80);
  session.room = null;
  session.sim = null;
  setRoomQuery('');
  homeScreen();
}

function homeScreen(message = '') {
  cleanupGameView();
  session.view = 'home';
  session.sim = null;
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
        <div id="home-status" class="notice small">${escapeHtml(message || 'Create a room, then join from another phone, tablet, or computer with the 4-character code.')}</div>
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
  session.sim = null;
  const room = session.room;
  if (!room) return homeScreen();

  const activePlayers = room.players.filter((player) => player.connected !== false);
  const me = activePlayers.find((player) => player.id === session.playerId);
  if (!me) return;

  const takenColors = new Set(
    activePlayers
      .filter((player) => player.id !== me.id)
      .map((player) => player.colorId)
      .filter(Boolean),
  );
  const joinUrl = `${location.origin}${location.pathname}?room=${room.roomCode}`;
  const canStart = me.isHost && activePlayers.length >= 1 && activePlayers.every((player) => player.colorId);
  const upgrades = roomUpgrades(room);

  app.innerHTML = `
    <section class="screen">
      <div class="card stack">
        <div class="badge">${me.isHost ? 'HOST' : 'PLAYER'}</div>
        <div class="room-code">${escapeHtml(room.roomCode)}</div>
        <div class="join-url">${escapeHtml(joinUrl)}</div>
        <div class="notice small">Shared multiplayer match connected. Fires, water, helicopter positions, and the round timer are synchronized for the room.</div>

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

        ${room.round > 1 ? `<div class="notice small">Team upgrades — Water ${upgrades.tank} · Speed ${upgrades.speed} · Effectiveness ${upgrades.power}</div>` : ''}
        ${me.isHost ? `<button id="start-game" ${canStart ? '' : 'disabled'}>Start Mission</button>` : '<div class="notice">Waiting for host to start…</div>'}
        <button class="secondary" id="leave-game">Leave</button>
      </div>
    </section>`;

  document.querySelectorAll('[data-color]').forEach((button) => {
    button.addEventListener('click', () => sendRoomMessage('setColor', { colorId: button.dataset.color }));
  });
  document.querySelector('#difficulty')?.addEventListener('change', (event) => {
    sendRoomMessage('setDifficulty', { difficulty: event.target.value });
  });
  document.querySelector('#start-game')?.addEventListener('click', () => sendRoomMessage('start'));
  document.querySelector('#leave-game').addEventListener('click', leaveRoom);
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
  session.sim = new BlazeSimulation({
    width: rect.width,
    height: rect.height,
    players: activePlayers,
    difficulty: room.difficulty,
    round: room.round,
    upgrades: roomUpgrades(room),
    spawnInitialFires: isMatchHost(),
  });
  session.resizeHandler = resize;
  session.lastSnapshotSent = 0;
  window.addEventListener('resize', resize, { passive: true });

  const setInput = (x, y) => {
    session.input.x = x;
    session.input.y = y;
    session.sim?.setInput(session.playerId, x, y);
    sendRoomMessage('input', { x, y });
  };

  attachJoystick(
    document.querySelector('#joystick'),
    document.querySelector('#joystick-knob'),
    setInput,
  );

  const keys = new Set();
  const refreshKeyboard = () => {
    const x = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0)
      - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
    const y = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0)
      - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
    setInput(x, y);
  };
  window.onkeydown = (event) => {
    keys.add(event.code);
    refreshKeyboard();
  };
  window.onkeyup = (event) => {
    keys.delete(event.code);
    refreshKeyboard();
  };

  const sendSnapshot = (now) => {
    if (!isMatchHost() || !session.sim) return;
    sendRoomMessage('matchSnapshot', { snapshot: session.sim.createSnapshot(now) });
    session.lastSnapshotSent = now;
  };

  const loop = (now) => {
    if (!session.sim || session.view !== 'game') return;

    if (isMatchHost()) {
      session.sim.tick(now);
      if (now - session.lastSnapshotSent >= 70 || session.sim.complete) sendSnapshot(now);
    }

    drawSimulation(ctx, session.sim);

    const mine = session.sim.helicopters.find((helicopter) => helicopter.id === session.playerId);
    const fireHud = document.querySelector('#fire-hud');
    const waterHud = document.querySelector('#water-hud');
    const timeHud = document.querySelector('#time-hud');
    if (!fireHud || !waterHud || !timeHud) return;

    fireHud.textContent = `Fires ${session.sim.fires.length}`;
    if (mine) paintWaterHud(waterHud, (mine.water / mine.capacity) * 100);

    const seconds = Math.max(0, Math.ceil(session.sim.timeLeft));
    timeHud.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

    if (session.sim.complete) {
      endRoundScreen();
      return;
    }

    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function endRoundScreen() {
  cleanupGameView();
  session.view = 'round-end';

  const room = session.room;
  const sim = session.sim;
  if (!room || !sim) return;

  const me = room.players.find((player) => player.id === session.playerId);
  const choices = sim.upgradeChoices();
  const upgrades = roomUpgrades(room);
  const selectedChoice = choices.find((choice) => choice.id === room.selectedUpgrade);
  const serverReady = room.phase === 'roundEnd';

  const choiceButtons = choices.map((choice) => {
    const disabled = !me?.isHost || !serverReady || Boolean(room.selectedUpgrade);
    const selected = room.selectedUpgrade === choice.id;
    return `<button class="grow upgrade-choice" data-upgrade="${choice.id}" ${disabled ? 'disabled' : ''}>
      ${selected ? '✓ ' : ''}${escapeHtml(choice.label)}<br>
      <span style="font-weight:500">${escapeHtml(choice.description)}</span><br>
      <span class="small">Level ${upgrades[choice.id] || 0}${selected ? '' : ` → ${(upgrades[choice.id] || 0) + 1}`}</span>
    </button>`;
  }).join('');

  let statusText = 'Syncing round results…';
  if (serverReady && selectedChoice) statusText = `Team upgrade selected: ${selectedChoice.label}`;
  else if (serverReady && me?.isHost) statusText = 'Choose one team upgrade to continue.';
  else if (serverReady) statusText = 'Waiting for the host to choose the team upgrade.';

  app.innerHTML = `
    <section class="screen">
      <div class="card stack">
        <h2 style="margin:0">Round ${room.round} Complete</h2>
        <div class="row">
          <div class="notice grow"><strong>${sim.extinguished}</strong><br><span class="small">fires extinguished</span></div>
          <div class="notice grow"><strong>${sim.fires.length}</strong><br><span class="small">fires still burning</span></div>
        </div>
        <h3 style="margin-bottom:0">Team Upgrade</h3>
        <div class="notice small">${escapeHtml(statusText)}</div>
        <div class="row">${choiceButtons}</div>
        ${me?.isHost
          ? `<button class="secondary" id="lobby-button" ${room.selectedUpgrade ? '' : 'disabled'}>Continue</button>`
          : '<button class="secondary" id="leave-round">Leave Room</button>'}
      </div>
    </section>`;

  if (me?.isHost && serverReady && !room.selectedUpgrade) {
    document.querySelectorAll('.upgrade-choice').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.upgrade-choice').forEach((choiceButton) => {
          choiceButton.disabled = true;
        });
        sendRoomMessage('chooseUpgrade', { upgradeId: button.dataset.upgrade });
      });
    });
  }

  document.querySelector('#lobby-button')?.addEventListener('click', () => {
    sendRoomMessage('returnLobby');
  });
  document.querySelector('#leave-round')?.addEventListener('click', leaveRoom);
}

homeScreen();
