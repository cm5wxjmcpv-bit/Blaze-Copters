import { HELICOPTER_COLORS } from './config.js';

export function createRoom({ roomCode, hostId, hostName = 'Host', difficulty = 'normal' }) {
  return {
    roomCode,
    phase: 'lobby',
    hostId,
    difficulty,
    round: 1,
    players: [{ id: hostId, name: hostName, colorId: null, connected: true, isHost: true }],
    upgradeVote: null,
  };
}

export function addPlayer(room, { id, name }) {
  if (room.players.length >= 6) throw new Error('Room is full');
  if (room.players.some((player) => player.id === id)) return room;
  room.players.push({ id, name: name || `Player ${room.players.length + 1}`, colorId: null, connected: true, isHost: false });
  return room;
}

export function chooseColor(room, playerId, colorId) {
  if (!HELICOPTER_COLORS.some((color) => color.id === colorId)) throw new Error('Unknown color');
  const taken = room.players.some((player) => player.id !== playerId && player.colorId === colorId);
  if (taken) throw new Error('Color already taken');
  const player = room.players.find((item) => item.id === playerId);
  if (!player) throw new Error('Player not found');
  player.colorId = colorId;
  return room;
}

export function canStart(room, playerId) {
  return room.hostId === playerId && room.players.length >= 1 && room.players.every((player) => player.colorId);
}
