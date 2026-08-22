export const HELICOPTER_COLORS = [
  { id: 'red', label: 'Red', value: '#e53935' },
  { id: 'blue', label: 'Blue', value: '#1e88e5' },
  { id: 'yellow', label: 'Yellow', value: '#fdd835' },
  { id: 'green', label: 'Green', value: '#43a047' },
  { id: 'purple', label: 'Purple', value: '#8e5bd9' },
  { id: 'orange', label: 'Orange', value: '#fb8c00' },
];

export const DEFAULT_HELICOPTER_TYPE = 'firehawk';

export const HELICOPTER_TYPES = Object.freeze([
  { id: 'chinook', label: 'Chinook', description: 'Twin-rotor heavy lifter', previewColor: '#e53935' },
  { id: 'kamov', label: 'Kamov', description: 'Bucket and stacked rotors', previewColor: '#1e88e5' },
  { id: 'skycrane', label: 'Skycrane', description: 'Long-boom air tanker', previewColor: '#fb8c00' },
  { id: 'firehawk', label: 'Firehawk', description: 'Sleek rescue helicopter', previewColor: '#e53935' },
].map((type) => Object.freeze(type)));

export function isValidHelicopterType(typeId) {
  return HELICOPTER_TYPES.some((type) => type.id === typeId);
}

export function normalizeHelicopterType(typeId) {
  return isValidHelicopterType(typeId) ? typeId : DEFAULT_HELICOPTER_TYPE;
}

export const DIFFICULTIES = {
  easy: { label: 'Easy', spreadMs: 4200, initialFires: 3, maxFires: 14, roundSeconds: 150 },
  normal: { label: 'Normal', spreadMs: 3000, initialFires: 4, maxFires: 20, roundSeconds: 150 },
  wildfire: { label: 'Wildfire', spreadMs: 2100, initialFires: 6, maxFires: 28, roundSeconds: 150 },
};

export const UPGRADES = [
  { id: 'tank', label: 'More Water', description: '+20% water capacity' },
  { id: 'speed', label: 'Faster Copter', description: '+8% flight speed' },
  { id: 'power', label: 'Stronger Water', description: '+15% fire suppression' },
];
