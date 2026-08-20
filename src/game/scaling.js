export function scaleForPlayers(playerCount, difficulty) {
  const count = Math.max(1, Math.min(6, Number(playerCount) || 1));
  const base = difficulty;
  return {
    initialFires: Math.round(base.initialFires + (count - 1) * 1.15),
    maxFires: Math.round(base.maxFires + (count - 1) * 3),
    spreadMs: Math.max(1300, Math.round(base.spreadMs * (1 - (count - 1) * 0.035))),
  };
}
