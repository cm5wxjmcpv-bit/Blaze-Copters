export const HELICOPTER_COLORS = [
  { id: 'red', label: 'Red', value: '#e53935' },
  { id: 'blue', label: 'Blue', value: '#1e88e5' },
  { id: 'yellow', label: 'Yellow', value: '#fdd835' },
  { id: 'green', label: 'Green', value: '#43a047' },
  { id: 'purple', label: 'Purple', value: '#8e5bd9' },
  { id: 'orange', label: 'Orange', value: '#fb8c00' },
];

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
