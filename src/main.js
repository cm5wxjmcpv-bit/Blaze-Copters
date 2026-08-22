import { DEFAULT_HELICOPTER_TYPE, DIFFICULTIES, HELICOPTER_COLORS, HELICOPTER_TYPES } from './game/config.js';
import { GAME_MODES, defaultLevelForMode, levelsForMode, nextLevelForMode, playableModes } from './game/modes.js';
import { BlazeSimulation } from './game/simulation.js';
import { attachJoystick } from './ui/joystick.js';
import { helicopterPreviewMarkup } from './ui/helicopters.js';
import { drawSimulation } from './ui/render.js';

const app = document.querySelector('#app');
const PLAYER_ID_KEY = 'blaze-copters-player-id';
const SESSION_TOKEN_KEY = 'blaze-copters-session-token';
const ACTIVE_ROOM_KEY = 'blaze-copters-active-room';
const PLAYER_NAME_KEY = 'blaze-copters-player-name';
const MAX_RECONNECT_ATTEMPTS = 6;
const storedPlayerId = sessionStorage.getItem(PLAYER_ID_KEY);
const playerId = storedPlayerId || crypto.randomUUID();
const sessionToken = sessionStorage.getItem(SESSION_TOKEN_KEY) || crypto.randomUUID();
sessionStorage.setItem(PLAYER_ID_KEY, playerId);
sessionStorage.setItem(SESSION_TOKEN_KEY, sessionToken);

const session = {
  playerId,
  sessionToken,
  playerName: sessionStorage.getItem(PLAYER_NAME_KEY) || '',
  room: null,
  ws: null,
  sim: null,
  view: 'home',
  intentionalLeave: false,
  input: { x: 0, y: 0 },
  resizeHandler: null,
  lastSnapshotSent: 0,
  connectionGeneration: 0,
  reconnectAttempts: 0,
  reconnectTimer: null,
  modeMenuAfterLobby: false,
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

function isRoomConnected() {
  return session.ws?.readyState === WebSocket.OPEN;
}

function clearReconnectTimer() {
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }
}

function showConnectionNotice(message) {
  let notice = document.querySelector('#connection-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'connection-notice';
    notice.className = 'connection-notice';
    notice.setAttribute('role', 'status');
    document.body.append(notice);
  }
  notice.textContent = message;
}

function hideConnectionNotice() {
  document.querySelector('#connection-notice')?.remove();
}

function clearSavedRoom() {
  sessionStorage.removeItem(ACTIVE_ROOM_KEY);
  clearReconnectTimer();
  session.reconnectAttempts = 0;
  hideConnectionNotice();
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
  if (!isRoomConnected()) return false;
  session.ws.send(JSON.stringify({ type, ...payload }));
  return true;
}

async function roomPreview(code) {
  const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/state`, { cache: 'no-store' });
  if (!response.ok) return null;
  const data = await response.json();
  return data.room || null;
}

async function createOnlineRoom(name, mode = null) {
  const selection = mode ? { mode, level: defaultLevelForMode(mode) } : {};
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hostId: session.playerId,
      hostName: name,
      sessionToken: session.sessionToken,
      ...selection,
    }),
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

    const requiresNewSimulation = session.sim && (
      session.sim.round !== room.round
      || session.sim.mode !== room.mode
      || session.sim.level !== room.level
    );

    if (session.view !== 'game' || requiresNewSimulation) {
      gameScreen();
    } else {
      session.sim?.syncPlayers(activePlayers);
      if (session.sim) session.sim.roundEndsAt = room.roundEndsAt || null;
    }
    return;
  }

  if (room.phase === 'roundEnd') {
    if (!session.sim) {
      session.sim = new BlazeSimulation({
        width: Math.max(1, window.innerWidth),
        height: Math.max(1, window.innerHeight),
        players: room.players.filter((player) => player.connected !== false),
        difficulty: room.difficulty,
        round: room.round,
        mode: room.mode,
        level: room.level,
        upgrades: roomUpgrades(room),
        spawnInitialFires: false,
      });
      session.sim.complete = true;
    }
    endRoundScreen();
    return;
  }

  if (room.phase === 'lobby') {
    if (session.modeMenuAfterLobby && room.hostId === session.playerId) {
      session.modeMenuAfterLobby = false;
      modeSelectionScreen({ name: session.playerName, existingRoom: true });
    } else {
      lobbyScreen();
    }
  }
}

function scheduleReconnect(code, name) {
  if (session.intentionalLeave || session.reconnectTimer || !code) return;

  if (session.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    cleanupGameView();
    session.room = null;
    session.sim = null;
    clearSavedRoom();
    setRoomQuery('');
    homeScreen('Connection to the room was lost. Please create or join again.');
    return;
  }

  session.reconnectAttempts += 1;
  const attempt = session.reconnectAttempts;
  const delay = Math.min(5000, 450 * (2 ** (attempt - 1)));
  showConnectionNotice(`Reconnecting… ${attempt}/${MAX_RECONNECT_ATTEMPTS}`);

  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null;
    connectToRoom(code, name, { reconnect: true }).catch(() => {
      if (!session.intentionalLeave) scheduleReconnect(code, name);
    });
  }, delay);
}

function connectToRoom(code, name, { reconnect = false } = {}) {
  return new Promise((resolve, reject) => {
    const generation = ++session.connectionGeneration;
    const previous = session.ws;
    if (previous) {
      session.ws = null;
      previous.close();
    }

    session.intentionalLeave = false;
    session.playerName = name;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({ playerId: session.playerId, name, token: session.sessionToken });
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
        if (generation !== session.connectionGeneration) return;
        applyRoomState(message.room);
        sessionStorage.setItem(ACTIVE_ROOM_KEY, code);
        sessionStorage.setItem(PLAYER_NAME_KEY, name);
        session.reconnectAttempts = 0;
        clearReconnectTimer();
        hideConnectionNotice();
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
        if (!isMatchHost() || message.restore) {
          const applied = session.sim?.applySnapshot(message.snapshot);
          if (applied && session.view === 'round-end') endRoundScreen();
        }
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
      if (generation !== session.connectionGeneration) return;
      if (session.ws === ws) session.ws = null;
      if (!settled) {
        settled = true;
        reject(new Error('Could not connect to that room.'));
      }
      if (!session.intentionalLeave && session.room && session.view !== 'home') {
        scheduleReconnect(code, name);
      } else if (reconnect && !session.intentionalLeave && session.room) {
        scheduleReconnect(code, name);
      }
    });
  });
}

function leaveRoom() {
  session.intentionalLeave = true;
  clearReconnectTimer();
  const socket = session.ws;
  sendRoomMessage('leave');
  session.connectionGeneration += 1;
  session.ws = null;
  setTimeout(() => socket?.close(), 80);
  session.room = null;
  session.sim = null;
  session.modeMenuAfterLobby = false;
  clearSavedRoom();
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
          <input id="player-name" maxlength="18" placeholder="Player 1" value="${escapeHtml(session.playerName || 'Player 1')}" />
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

  createButton.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Player 1';
    session.playerName = name;
    modeSelectionScreen({ name });
  });

  joinButton.addEventListener('click', async () => {
    const name = nameInput.value.trim() || 'Player 1';
    const code = codeInput.value.toUpperCase();
    joinButton.disabled = true;
    createButton.disabled = true;
    status.textContent = `Looking for room ${code}…`;
    try {
      const preview = await roomPreview(code);
      if (!preview) throw new Error(`Room ${code} was not found.`);
      if (!preview.joinable && sessionStorage.getItem(ACTIVE_ROOM_KEY) !== code) {
        throw new Error(preview.phase === 'lobby' ? 'That room is full.' : 'Mission already in progress. Join between rounds.');
      }
      setRoomQuery(code);
      await connectToRoom(code, name);
    } catch (error) {
      joinButton.disabled = false;
      createButton.disabled = false;
      status.textContent = error.message || 'Could not join room.';
    }
  });
}

function modeSelectionScreen({ name = session.playerName || 'Player 1', existingRoom = false } = {}) {
  cleanupGameView();
  session.view = 'mode-select';
  const choices = playableModes();

  app.innerHTML = `
    <section class="screen mode-screen">
      <div class="card mode-card stack">
        <div>
          <h1 class="mode-title">Choose a Game Mode</h1>
          <p class="subtitle">Same simple helicopter controls. Five different team missions.</p>
        </div>
        <div class="mode-grid">
          ${choices.map((mode) => `
            <article class="mission-card ${existingRoom && session.room?.mode === mode.id ? 'selected-mission' : ''}">
              <div class="mission-heading">
                <h2>${escapeHtml(mode.label)}</h2>
                <span class="mission-tag">${mode.endless ? 'ENDLESS' : 'MISSION'}</span>
              </div>
              <p>${escapeHtml(mode.description)}</p>
              <button id="play-mode-${mode.id}" data-mode="${mode.id}">Play</button>
            </article>
          `).join('')}
        </div>
        <div id="mode-status" class="notice small">${existingRoom
          ? 'The host picks the next mission for everyone in the room.'
          : 'Choose a mission, then invite your team with the room code.'}</div>
        <button class="secondary" id="mode-back">${existingRoom ? 'Back to Lobby' : 'Main Menu'}</button>
      </div>
    </section>`;

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', async () => {
      const mode = button.dataset.mode;
      if (!GAME_MODES[mode]?.selectable) return;

      if (existingRoom) {
        sendRoomMessage('setMode', { mode });
        return;
      }

      document.querySelectorAll('[data-mode]').forEach((choice) => { choice.disabled = true; });
      const status = document.querySelector('#mode-status');
      if (status) status.textContent = `Creating ${GAME_MODES[mode].label} room…`;

      try {
        const code = await createOnlineRoom(name, mode);
        setRoomQuery(code);
        await connectToRoom(code, name);
      } catch (error) {
        document.querySelectorAll('[data-mode]').forEach((choice) => { choice.disabled = false; });
        if (status) status.textContent = error.message || 'Could not create room.';
      }
    });
  });

  document.querySelector('#mode-back')?.addEventListener('click', () => {
    if (existingRoom) lobbyScreen();
    else homeScreen();
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
  const availableModes = playableModes();
  if (GAME_MODES[room.mode] && !GAME_MODES[room.mode].selectable) {
    availableModes.unshift(GAME_MODES[room.mode]);
  }
  const availableLevels = levelsForMode(room.mode);
  const selectedHelicopter = HELICOPTER_TYPES.some((type) => type.id === me.helicopterType)
    ? me.helicopterType
    : DEFAULT_HELICOPTER_TYPE;
  const selectedColor = HELICOPTER_COLORS.find((color) => color.id === me.colorId)?.value || null;

  app.innerHTML = `
    <section class="screen">
      <div class="card stack">
        <div class="badge">${me.isHost ? 'HOST' : 'PLAYER'}</div>
        <div class="room-code">${escapeHtml(room.roomCode)}</div>
        <div class="join-url">${escapeHtml(joinUrl)}</div>
        <div class="notice small">Shared multiplayer match connected. Fires, water, helicopter positions, and the round timer are synchronized for the room.</div>
        <div class="notice small">${escapeHtml(GAME_MODES[room.mode]?.description || '')}</div>

        <div class="settings-grid">
          <label>Game mode
            <select id="game-mode" ${me.isHost && availableModes.length > 1 ? '' : 'disabled'}>
              ${availableModes.map((mode) => `<option value="${mode.id}" ${room.mode === mode.id ? 'selected' : ''}>${escapeHtml(mode.label)}</option>`).join('')}
            </select>
          </label>
          <label>Difficulty
            <select id="difficulty" ${me.isHost ? '' : 'disabled'}>
              ${Object.entries(DIFFICULTIES).map(([id, value]) => `<option value="${id}" ${room.difficulty === id ? 'selected' : ''}>${escapeHtml(value.label)}</option>`).join('')}
            </select>
          </label>
        </div>

        <label>Level
          <select id="game-level" ${me.isHost && availableLevels.length > 1 ? '' : 'disabled'}>
            ${availableLevels.map((level) => `<option value="${level.id}" ${room.level === level.id ? 'selected' : ''}>${escapeHtml(level.label)}</option>`).join('')}
          </select>
        </label>

        <div>
          <strong>Choose your helicopter</strong>
          <div class="helicopter-options" style="margin-top:10px">
            ${HELICOPTER_TYPES.map((type) => `
              <button id="helicopter-${type.id}" data-helicopter="${type.id}" class="helicopter-choice ${selectedHelicopter === type.id ? 'selected-helicopter' : ''}"
                aria-label="${escapeHtml(type.label)}: ${escapeHtml(type.description)}" aria-pressed="${selectedHelicopter === type.id}">
                ${helicopterPreviewMarkup(type.id, selectedColor || type.previewColor)}
                <span class="helicopter-name">${escapeHtml(type.label)}</span>
              </button>
            `).join('')}
          </div>
          <p class="appearance-note">Every helicopter flies and fights fire the same.</p>
        </div>

        <div>
          <strong>Choose your color</strong>
          <div class="colors" style="margin-top:10px">
            ${HELICOPTER_COLORS.map((color) => `<button aria-label="${escapeHtml(color.label)}" data-color="${color.id}" class="color-button ${me.colorId === color.id ? 'selected' : ''} ${takenColors.has(color.id) ? 'taken' : ''}" style="background:${color.value}" ${takenColors.has(color.id) ? 'disabled' : ''}></button>`).join('')}
          </div>
        </div>

        <div>
          <strong>Players (${activePlayers.length}/6)</strong>
          <div class="players" style="margin-top:10px">
            ${activePlayers.map((player) => {
              const color = HELICOPTER_COLORS.find((item) => item.id === player.colorId);
              const helicopter = HELICOPTER_TYPES.find((type) => type.id === player.helicopterType)
                || HELICOPTER_TYPES.find((type) => type.id === DEFAULT_HELICOPTER_TYPE);
              return `<div class="player-chip"><span class="swatch" style="background:${color?.value || 'transparent'};border:1px solid rgba(255,255,255,.3)"></span><span class="player-details"><span>${escapeHtml(player.name)}${player.isHost ? ' ★' : ''}</span><span class="player-helicopter">${escapeHtml(helicopter.label)}</span></span></div>`;
            }).join('')}
          </div>
        </div>

        ${room.round > 1 ? `<div class="notice small">Team upgrades — Water ${upgrades.tank} · Speed ${upgrades.speed} · Effectiveness ${upgrades.power}</div>` : ''}
        ${me.isHost ? `<button id="start-game" ${canStart ? '' : 'disabled'}>Start Mission</button>` : '<div class="notice">Waiting for host to start…</div>'}
        ${me.isHost ? '<button class="secondary" id="choose-game-mode">Game Modes</button>' : ''}
        <button class="secondary" id="leave-game">Leave</button>
      </div>
    </section>`;

  document.querySelectorAll('[data-color]').forEach((button) => {
    button.addEventListener('click', () => sendRoomMessage('setColor', { colorId: button.dataset.color }));
  });
  document.querySelectorAll('[data-helicopter]').forEach((button) => {
    button.addEventListener('click', () => sendRoomMessage('setHelicopter', {
      helicopterType: button.dataset.helicopter,
    }));
  });
  document.querySelector('#difficulty')?.addEventListener('change', (event) => {
    sendRoomMessage('setDifficulty', { difficulty: event.target.value });
  });
  document.querySelector('#game-mode')?.addEventListener('change', (event) => {
    sendRoomMessage('setMode', { mode: event.target.value });
  });
  document.querySelector('#game-level')?.addEventListener('change', (event) => {
    sendRoomMessage('setLevel', { level: event.target.value });
  });
  document.querySelector('#start-game')?.addEventListener('click', () => sendRoomMessage('start'));
  document.querySelector('#choose-game-mode')?.addEventListener('click', () => {
    modeSelectionScreen({ name: session.playerName, existingRoom: true });
  });
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

function formatClock(value) {
  const seconds = Math.max(0, Math.ceil(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateMissionHud(sim, room) {
  const roundHud = document.querySelector('#round-hud');
  const fireHud = document.querySelector('#fire-hud');
  const objectiveHud = document.querySelector('#objective-hud');
  const timeHud = document.querySelector('#time-hud');
  if (!roundHud || !fireHud || !objectiveHud || !timeHud) return false;

  const state = sim.state;
  if (sim.mode === 'wildfire-survival') {
    roundHud.textContent = `Time ${formatClock(state.elapsed)}`;
    fireHud.textContent = `Fires ${sim.fires.length}`;
    objectiveHud.textContent = `Danger ${Math.round(state.danger)}%`;
    timeHud.textContent = `Level ${state.difficultyTier}`;
  } else if (sim.mode === 'protect-town') {
    const saved = state.buildings.length - state.buildingsLost;
    roundHud.textContent = `Town ${saved}/${state.buildings.length}`;
    fireHud.textContent = `Fires ${sim.fires.length}`;
    objectiveHud.textContent = `${state.buildings.filter((building) => building.status === 'burning').length} burning`;
    timeHud.textContent = formatClock(sim.timeLeft);
  } else if (sim.mode === 'spot-fire') {
    roundHud.textContent = state.objectivePhase === 'containment' ? 'Contain fires' : 'Ember watch';
    fireHud.textContent = `Fires ${sim.fires.length}`;
    objectiveHud.textContent = state.objectivePhase === 'containment'
      ? `Danger ${Math.round(state.danger)}%`
      : `Embers ${state.warnings.length}`;
    timeHud.textContent = formatClock(state.objectivePhase === 'containment' ? sim.timeLeft : state.objectiveSeconds);
  } else if (sim.mode === 'evacuation') {
    roundHud.textContent = `Evac ${state.evacuated}/${state.unitsRequired}`;
    fireHud.textContent = state.routeBlocked ? 'Route blocked' : 'Route open';
    objectiveHud.textContent = `${Math.max(0, state.unitsRequired - state.evacuated)} remaining`;
    timeHud.textContent = formatClock(sim.timeLeft);
  } else if (sim.mode === 'convoy-protection') {
    roundHud.textContent = `Distance ${(state.distanceMeters / 1609.344).toFixed(2)} mi`;
    fireHud.textContent = `Convoy ${Math.round(state.convoyIntegrity)}%`;
    objectiveHud.textContent = state.routeBlocked ? 'Route blocked' : `Fires ${sim.fires.length}`;
    timeHud.textContent = `Level ${state.difficultyTier}`;
  } else {
    roundHud.textContent = `Round ${room.round}`;
    fireHud.textContent = `Fires ${sim.fires.length}`;
    objectiveHud.textContent = `${sim.extinguished} out`;
    timeHud.textContent = formatClock(sim.timeLeft);
  }

  return true;
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
          <div class="hud-pill" id="objective-hud">Ready</div>
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
    mode: room.mode,
    level: room.level,
    roundEndsAt: room.roundEndsAt,
    upgrades: roomUpgrades(room),
    spawnInitialFires: isMatchHost() && !room.hasSnapshot,
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
    if (sendRoomMessage('matchSnapshot', { snapshot: session.sim.createSnapshot(now) })) {
      session.lastSnapshotSent = now;
    }
  };

  const loop = (now) => {
    if (!session.sim || session.view !== 'game') return;

    if (isMatchHost() && isRoomConnected()) {
      session.sim.tick(now);
      if (now - session.lastSnapshotSent >= 70 || session.sim.complete) sendSnapshot(now);
    } else if (session.room?.roundEndsAt) {
      session.sim.timeLeft = Math.max(0, (session.room.roundEndsAt - Date.now()) / 1000);
    }

    drawSimulation(ctx, session.sim);

    const mine = session.sim.helicopters.find((helicopter) => helicopter.id === session.playerId);
    const waterHud = document.querySelector('#water-hud');
    if (!waterHud || !updateMissionHud(session.sim, session.room)) return;

    if (mine) paintWaterHud(waterHud, (mine.water / mine.capacity) * 100);

    if (session.sim.complete) {
      endRoundScreen();
      return;
    }

    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function roundResultCards(sim) {
  const state = sim.state;
  if (sim.mode === 'wildfire-survival') {
    return [
      { value: formatClock(state.elapsed), label: 'survival time' },
      { value: sim.extinguished, label: 'fires extinguished' },
      { value: Math.round(state.teamWaterDropped), label: 'team water dropped' },
      { value: state.highestDifficulty, label: 'highest difficulty' },
    ];
  }
  if (sim.mode === 'protect-town') {
    return [
      { value: `${state.buildings.length - state.buildingsLost}/${state.buildings.length}`, label: 'buildings saved' },
      { value: formatClock(state.elapsed), label: 'mission time' },
      { value: sim.extinguished, label: 'fires extinguished' },
    ];
  }
  if (sim.mode === 'spot-fire') {
    return [
      { value: sim.extinguished, label: 'fires extinguished' },
      { value: formatClock(state.elapsed), label: 'mission time' },
    ];
  }
  if (sim.mode === 'evacuation') {
    return [
      { value: `${state.evacuated}/${state.unitsRequired}`, label: 'vehicles evacuated' },
      { value: state.unitsLost, label: 'vehicles lost' },
      { value: formatClock(state.elapsed), label: 'mission time' },
    ];
  }
  if (sim.mode === 'convoy-protection') {
    return [
      { value: `${(state.distanceMeters / 1609.344).toFixed(2)} mi`, label: 'convoy distance' },
      { value: sim.extinguished, label: 'fires extinguished' },
      { value: state.highestDifficulty, label: 'highest difficulty' },
    ];
  }
  return [
    { value: sim.extinguished, label: 'fires extinguished' },
    { value: sim.fires.length, label: 'fires still burning' },
  ];
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
  const nextLevel = nextLevelForMode(room.mode, room.level);
  const serverReady = room.phase === 'roundEnd';
  const canContinue = serverReady && Boolean(room.selectedUpgrade);
  const resultTitle = sim.mode === 'classic'
    ? `Round ${room.round} Complete`
    : sim.state.outcome === 'won'
      ? 'Mission Complete'
      : GAME_MODES[sim.mode]?.endless
        ? 'Run Complete'
        : 'Mission Ended';
  const resultCards = roundResultCards(sim)
    .map((card) => `<div class="notice grow"><strong>${escapeHtml(card.value)}</strong><br><span class="small">${escapeHtml(card.label)}</span></div>`)
    .join('');

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
        <h2 style="margin:0">${escapeHtml(resultTitle)}</h2>
        <div class="small">${escapeHtml(GAME_MODES[sim.mode]?.label || 'Classic Co-op')}</div>
        ${sim.state.reason ? `<div class="notice">${escapeHtml(sim.state.reason)}</div>` : ''}
        <div class="row">${resultCards}</div>
        <h3 style="margin-bottom:0">Team Upgrade</h3>
        <div class="notice small">${escapeHtml(statusText)}</div>
        <div class="row">${choiceButtons}</div>
        ${me?.isHost ? `
          <button id="lobby-button" ${canContinue ? '' : 'disabled'}>Play Again</button>
          ${nextLevel && sim.state.outcome === 'won'
            ? `<button class="secondary" id="next-level" ${canContinue ? '' : 'disabled'}>Next Level</button>`
            : ''}
          <button class="secondary" id="round-game-modes" ${canContinue ? '' : 'disabled'}>Game Modes</button>
        ` : ''}
        <button class="secondary" id="leave-round">Main Menu</button>
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
  document.querySelector('#next-level')?.addEventListener('click', () => {
    if (nextLevel) sendRoomMessage('returnLobby', { level: nextLevel.id });
  });
  document.querySelector('#round-game-modes')?.addEventListener('click', () => {
    session.modeMenuAfterLobby = true;
    if (!sendRoomMessage('returnLobby')) session.modeMenuAfterLobby = false;
  });
  document.querySelector('#leave-round')?.addEventListener('click', leaveRoom);
}

homeScreen();

const savedRoom = sessionStorage.getItem(ACTIVE_ROOM_KEY);
const savedName = sessionStorage.getItem(PLAYER_NAME_KEY);
if (savedRoom && savedName && requestedRoomCode() === savedRoom) {
  const status = document.querySelector('#home-status');
  if (status) status.textContent = 'Restoring your game…';
  connectToRoom(savedRoom, savedName, { reconnect: true }).catch(() => {
    clearSavedRoom();
    homeScreen('Your previous room could not be restored. Please create or join again.');
  });
}
