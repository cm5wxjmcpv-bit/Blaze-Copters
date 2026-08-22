export const DEFAULT_MODE_ID = 'classic';
export const DEFAULT_LEVEL_ID = 'starter';
export const SNAPSHOT_VERSION = 3;

function lockLevel(level) {
  const map = {
    ...level.map,
    water: Object.freeze({ ...level.map.water }),
    station: Object.freeze({ ...level.map.station }),
    helipad: Object.freeze({ ...level.map.helipad }),
    road: Object.freeze((level.map.road || []).map((point) => Object.freeze({ ...point }))),
    buildings: Object.freeze((level.map.buildings || []).map((point) => Object.freeze({ ...point }))),
  };
  return Object.freeze({ ...level, map: Object.freeze(map) });
}

const trainingMap = {
  water: { x: .14, y: .68, radius: .09 },
  station: { x: .22, y: .24 },
  helipad: { x: .31, y: .24, radius: .04 },
};

export const GAME_LEVELS = Object.freeze({
  starter: lockLevel({
    id: 'starter',
    label: 'Starter Training Grounds',
    map: trainingMap,
  }),
  'survival-grounds': lockLevel({
    id: 'survival-grounds',
    label: 'Open Pine Country',
    map: trainingMap,
  }),
  'pine-ridge-town': lockLevel({
    id: 'pine-ridge-town',
    label: 'Pine Ridge',
    durationSeconds: 300,
    map: {
      water: { x: .16, y: .77, radius: .10 },
      station: { x: .18, y: .19 },
      helipad: { x: .28, y: .23, radius: .045 },
      buildings: [
        { x: .72, y: .19 }, { x: .84, y: .19 },
        { x: .69, y: .34 }, { x: .81, y: .34 },
        { x: .73, y: .51 }, { x: .85, y: .50 },
        { x: .77, y: .67 },
      ],
    },
  }),
  'ember-valley': lockLevel({
    id: 'ember-valley',
    label: 'Ember Valley',
    durationSeconds: 240,
    map: {
      water: { x: .16, y: .72, radius: .10 },
      station: { x: .20, y: .22 },
      helipad: { x: .30, y: .24, radius: .045 },
    },
  }),
  'cedar-creek-road': lockLevel({
    id: 'cedar-creek-road',
    label: 'Cedar Creek Road',
    durationSeconds: 300,
    map: {
      water: { x: .16, y: .78, radius: .10 },
      station: { x: .14, y: .19 },
      helipad: { x: .25, y: .24, radius: .045 },
      road: [
        { x: .06, y: .46 }, { x: .24, y: .46 },
        { x: .43, y: .55 }, { x: .65, y: .50 },
        { x: .85, y: .59 }, { x: .97, y: .57 },
      ],
    },
  }),
  'endless-fire-road': lockLevel({
    id: 'endless-fire-road',
    label: 'Endless Fire Road',
    map: {
      water: { x: .24, y: .70, radius: .075 },
      station: { x: .12, y: .19 },
      helipad: { x: .30, y: .24, radius: .04 },
      road: [{ x: 0, y: .52 }, { x: 1, y: .52 }],
    },
  }),
});

function lockMode(mode) {
  return Object.freeze({
    ...mode,
    levels: Object.freeze([...mode.levels]),
    rules: Object.freeze({ ...mode.rules }),
  });
}

export const GAME_MODES = Object.freeze({
  classic: lockMode({
    id: 'classic',
    label: 'Classic Co-op',
    description: 'Work together to control the wildfire before time runs out.',
    levels: [DEFAULT_LEVEL_ID],
    selectable: false,
    endless: false,
    rules: { fireBudgetMultiplier: 1, maximumFireHealth: 100 },
  }),
  'wildfire-survival': lockMode({
    id: 'wildfire-survival',
    label: 'Wildfire Survival',
    description: 'Keep the growing wildfire under control for as long as you can.',
    levels: ['survival-grounds'],
    selectable: true,
    endless: true,
    rules: {
      fireBudgetMultiplier: 1.45,
      maximumFireHealth: 165,
      dangerLimit: 100,
      dangerGraceSeconds: 8,
    },
  }),
  'protect-town': lockMode({
    id: 'protect-town',
    label: 'Protect the Town',
    description: 'Stop the wildfire before it destroys the buildings in Pine Ridge.',
    levels: ['pine-ridge-town'],
    selectable: true,
    endless: false,
    rules: {
      fireBudgetMultiplier: 1.1,
      maximumFireHealth: 145,
      maximumBuildingsLost: 3,
    },
  }),
  'spot-fire': lockMode({
    id: 'spot-fire',
    label: 'Spot Fire',
    description: 'Watch for falling embers and contain new fires across the map.',
    levels: ['ember-valley'],
    selectable: true,
    endless: false,
    rules: {
      fireBudgetMultiplier: 1.3,
      maximumFireHealth: 160,
      dangerLimit: 100,
      controlSeconds: 180,
      warningSeconds: 2.4,
    },
  }),
  evacuation: lockMode({
    id: 'evacuation',
    label: 'Evacuation',
    description: 'Keep the evacuation road open while families drive to safety.',
    levels: ['cedar-creek-road'],
    selectable: true,
    endless: false,
    rules: {
      fireBudgetMultiplier: 1.15,
      maximumFireHealth: 145,
      baseVehiclesRequired: 7,
      maximumVehiclesLost: 3,
      maximumBlockedSeconds: 42,
    },
  }),
  'convoy-protection': lockMode({
    id: 'convoy-protection',
    label: 'Convoy Protection',
    description: 'Escort a moving fire convoy as far as possible through wildfire country.',
    levels: ['endless-fire-road'],
    selectable: true,
    endless: true,
    rules: {
      fireBudgetMultiplier: 1.4,
      maximumFireHealth: 175,
      maximumChunks: 7,
      convoyVehicleCount: 4,
    },
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

export function playableModes() {
  return Object.values(GAME_MODES).filter((mode) => mode.selectable);
}

export function nextLevelForMode(modeId, levelId) {
  const levels = levelsForMode(modeId);
  const index = levels.findIndex((level) => level.id === levelId);
  return index < 0 ? null : levels[index + 1] ?? null;
}

export function roundDurationForMode(modeId, levelId, fallbackSeconds = 150) {
  const mode = GAME_MODES[modeId];
  if (!mode || mode.endless) return null;
  return GAME_LEVELS[levelId]?.durationSeconds ?? fallbackSeconds;
}

export function fireLimitForMode(modeId, baseLimit) {
  const multiplier = GAME_MODES[modeId]?.rules.fireBudgetMultiplier ?? 1;
  return Math.min(96, Math.max(1, Math.ceil(Math.max(1, Number(baseLimit) || 1) * multiplier)));
}

export function maximumFireHealth(modeId) {
  return GAME_MODES[modeId]?.rules.maximumFireHealth ?? 100;
}
