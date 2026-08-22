export const DEFAULT_MODE_ID = 'classic';
export const DEFAULT_LEVEL_ID = 'starter';

export const GAME_LEVELS = Object.freeze({
  starter: Object.freeze({
    id: 'starter',
    label: 'Starter Training Grounds',
  }),
});

export const GAME_MODES = Object.freeze({
  classic: Object.freeze({
    id: 'classic',
    label: 'Classic Co-op',
    description: 'Work together to control the wildfire before time runs out.',
    levels: Object.freeze([DEFAULT_LEVEL_ID]),
  }),
});

export function isValidMode(modeId) {
  return Object.hasOwn(GAME_MODES, String(modeId ?? ''));
}

export function levelsForMode(modeId) {
  const mode = GAME_MODES[String(modeId ?? '')];
  return mode ? mode.levels.map((levelId) => GAME_LEVELS[levelId]).filter(Boolean) : [];
}

export function defaultLevelForMode(modeId) {
  return levelsForMode(modeId)[0]?.id ?? DEFAULT_LEVEL_ID;
}

export function isValidLevel(modeId, levelId) {
  return levelsForMode(modeId).some((level) => level.id === String(levelId ?? ''));
}
