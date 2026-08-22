import { HELICOPTER_COLORS } from './config.js';
import { DEFAULT_LEVEL_ID, DEFAULT_MODE_ID, defaultLevelForMode, isValidLevel, isValidMode } from './modes.js';

export function createRoom({
  roomCode,
  hostId,
  hostName = 'Host',
  difficulty = 'normal',
  mode = DEFAULT_MODE_ID,
  level = DEFAULT_LEVEL_ID,
}) {
  const selectedMode = isValidMode(mode) ? mode : DEFAULT_MODE_ID;
  const selectedLevel = isValidLevel(selectedMode, level) ? level : defaultLevelForMode(selectedMode);

  return {
    roomCode,
    phase: 'lobby',
    hostId,
    difficulty,
    mode: selectedMode,
    level: selectedLevel,
    round: 1,
    roundEndsAt: null,
    players: [{ id: hostId, name: hostName, colorId: null, connected: true, isHost: true }],
    upgrades: { tank: 0, speed: 0, power: 0 },
    selectedUpgrade: null,
  };
}

export function addPlayer(room, { id, name }) {
  const existing = room.players.find((player) => player.id === id);
  if (existing) {
    existing.connected = true;
    if (name) existing.name = name;
    return room;
  }

  if (room.players.filter((player) => player.connected !== false).length >= 6) {
    throw new Error('Room is full');
  }

  room.players.push({ id, name: name || `Player ${room.players.length + 1}`, colorId: null, connected: true, isHost: false });
  return room;
}

export function chooseColor(room, playerId, colorId) {
  if (!HELICOPTER_COLORS.some((color) => color.id === colorId)) throw new Error('Unknown color');
  const taken = room.players.some((player) => (
    player.id !== playerId && player.connected !== false && player.colorId === colorId
  ));
  if (taken) throw new Error('Color already taken');
  const player = room.players.find((item) => item.id === playerId);
  if (!player) throw new Error('Player not found');
  player.colorId = colorId;
  return room;
}

export function canStart(room, playerId) {
  const activePlayers = room.players.filter((player) => player.connected !== false);
  return room.hostId === playerId && activePlayers.length >= 1 && activePlayers.every((player) => player.colorId);
}
