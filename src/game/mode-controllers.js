import { GAME_MODES } from './modes.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createModeState(modeId, playerCount = 1) {
  const rules = GAME_MODES[modeId]?.rules || {};
  const count = clamp(Number(playerCount) || 1, 1, 6);
  return {
    elapsed: 0,
    danger: 0,
    dangerSeconds: 0,
    difficultyTier: 1,
    highestDifficulty: 1,
    teamWaterDropped: 0,
    outcome: 'active',
    reason: '',
    objectivePhase: 'active',
    objectiveSeconds: Number(rules.controlSeconds) || 0,
    warningCooldown: modeId === 'spot-fire' ? 11 : 18,
    warnings: [],
    buildings: [],
    buildingsLost: 0,
    units: [],
    evacuated: 0,
    unitsLost: 0,
    unitsRequired: rules.baseVehiclesRequired
      ? rules.baseVehiclesRequired + Math.floor((count - 1) * .55)
      : 0,
    vehicleCooldown: 1.2,
    routeBlocked: false,
    blockedSeconds: 0,
    distanceMeters: 0,
    convoyIntegrity: 100,
    convoyVehicles: [],
    chunks: [],
    nextChunkIndex: 0,
    nextEventId: 1,
  };
}

function nextId(sim, prefix) {
  const id = `${prefix}-${sim.state.nextEventId}`;
  sim.state.nextEventId += 1;
  return id;
}

function spawnNear(sim, centerX, centerY, spreadX, spreadY, options = {}) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const x = (centerX + (Math.random() - .5) * spreadX) * sim.width;
    const y = (centerY + (Math.random() - .5) * spreadY) * sim.height;
    if (sim.spawnFire(x, y, options)) return true;
  }
  return false;
}

function spawnStarterFires(sim, centerX, centerY, spreadX, spreadY, count, options = {}) {
  for (let index = 0; index < count; index += 1) {
    spawnNear(sim, centerX, centerY, spreadX, spreadY, options);
  }
}

function updateTier(sim, basis) {
  const tier = Math.max(1, Math.floor(basis) + 1);
  sim.state.difficultyTier = tier;
  sim.state.highestDifficulty = Math.max(sim.state.highestDifficulty, tier);
}

function updateDanger(sim, dt, graceSeconds = 6) {
  const threshold = Math.max(7, Math.ceil(sim.scaling.maxFires * .72));
  const target = clamp((sim.fires.length / threshold) * 100, 0, 100);
  const smoothing = Math.min(1, dt * 1.35);
  sim.state.danger += (target - sim.state.danger) * smoothing;

  if (target >= 100) sim.state.dangerSeconds += dt;
  else sim.state.dangerSeconds = Math.max(0, sim.state.dangerSeconds - dt * 1.4);

  if (sim.state.dangerSeconds >= graceSeconds) {
    sim.state.danger = 100;
    sim.finish('lost', 'The wildfire overwhelmed the map.');
  }
}

function spreadFromFire(sim, source, biasAngle = null, options = {}) {
  if (!source) return sim.spawnFire(undefined, undefined, options);

  const angle = biasAngle === null
    ? Math.random() * Math.PI * 2
    : biasAngle + (Math.random() - .5) * 1.3;
  const range = 50 + Math.random() * 78;
  return sim.spawnFire(
    source.x + Math.cos(angle) * range,
    source.y + Math.sin(angle) * range,
    { ...options, spreading: true },
  );
}

function spreadRandomFire(sim, options = {}) {
  if (!sim.fires.length) return sim.spawnFire(undefined, undefined, options);
  const source = sim.fires[Math.floor(Math.random() * sim.fires.length)];
  return spreadFromFire(sim, source, null, options);
}

function warningAt(sim, x, y, seconds = 2.4, kind = 'ember') {
  sim.state.warnings.push({
    id: nextId(sim, 'warning'),
    x: clamp(x, 28, sim.width - 28),
    y: clamp(y, 28, sim.height - 28),
    timeLeft: seconds,
    duration: seconds,
    kind,
  });
}

function updateWarnings(sim, dt) {
  const remaining = [];
  for (const warning of sim.state.warnings) {
    warning.timeLeft -= dt;
    if (warning.timeLeft <= 0) {
      const health = Math.min(sim.maximumFireHealth, 92 + sim.state.difficultyTier * 5);
      sim.spawnFire(warning.x, warning.y, { hp: health, kind: warning.kind });
    } else {
      remaining.push(warning);
    }
  }
  sim.state.warnings = remaining;
}

function pointOnRoute(points, progress) {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };

  let length = 0;
  const lengths = [];
  for (let index = 1; index < points.length; index += 1) {
    const segment = distance(points[index - 1], points[index]);
    lengths.push(segment);
    length += segment;
  }

  let remaining = clamp(progress, 0, 1) * length;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const ratio = lengths[index] ? remaining / lengths[index] : 0;
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
      };
    }
    remaining -= lengths[index];
  }

  return { ...points.at(-1) };
}

function nearestPointOnRoute(points, point) {
  if (!points.length) return null;
  if (points.length === 1) return { ...points[0] };

  let nearest = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const progress = lengthSquared
      ? clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1)
      : 0;
    const candidate = { x: start.x + dx * progress, y: start.y + dy * progress };
    const candidateDistance = distance(point, candidate);

    if (candidateDistance < nearestDistance) {
      nearest = candidate;
      nearestDistance = candidateDistance;
    }
  }

  return nearest;
}

function roadsidePosition(sim, point) {
  const side = Math.random() < .5 ? -1 : 1;
  const clearance = sim.objectiveIgnitionClearance() + 18;
  const extra = Math.random() * Math.max(24, Math.min(92, sim.height * .14));
  return {
    x: point.x + (Math.random() - .5) * Math.min(96, sim.width * .11),
    y: point.y + side * (clearance + extra),
  };
}

function spawnRoadsideFire(sim, point, options = {}) {
  if (!point) return false;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const position = roadsidePosition(sim, point);
    if (sim.spawnFire(position.x, position.y, options)) return true;
  }

  return false;
}

function initializeBuildings(sim) {
  sim.state.buildings = sim.levelConfig.map.buildings.map((point, index) => ({
    id: `building-${index + 1}`,
    x: point.x * sim.width,
    y: point.y * sim.height,
    hp: 100,
    maxHp: 100,
    status: 'safe',
  }));
}

function updateBuildings(sim, dt) {
  for (const building of sim.state.buildings) {
    if (building.hp <= 0) {
      building.hp = 0;
      building.status = 'destroyed';
      continue;
    }

    const nearby = sim.fires.filter((fire) => distance(fire, building) < fire.radius + 55);
    const burning = nearby.filter((fire) => distance(fire, building) < fire.radius + 24);
    if (burning.length) {
      building.hp = Math.max(0, building.hp - (8 + Math.min(3, burning.length) * 5) * dt);
      building.status = building.hp <= 0 ? 'destroyed' : 'burning';
    } else {
      building.status = nearby.length ? 'threatened' : 'safe';
    }
  }

  sim.state.buildingsLost = sim.state.buildings.filter((building) => building.hp <= 0).length;
  if (sim.state.buildingsLost >= sim.modeConfig.rules.maximumBuildingsLost) {
    sim.finish('lost', 'Too many buildings were lost.');
  }
}

function createEvacuationUnit(sim) {
  const point = pointOnRoute(sim.route, 0);
  sim.state.units.push({
    id: nextId(sim, 'vehicle'),
    kind: sim.state.nextEventId % 3 === 0 ? 'bus' : 'car',
    x: point.x,
    y: point.y,
    progress: 0,
    hp: 100,
    maxHp: 100,
    status: 'moving',
  });
}

function updateEvacuationUnits(sim, dt) {
  const state = sim.state;
  const remaining = [];
  let blocked = false;

  for (const unit of state.units) {
    const ahead = pointOnRoute(sim.route, Math.min(1, unit.progress + .045));
    const blocking = sim.fires.filter((fire) => distance(fire, ahead) < fire.radius + 36);
    const dangerous = sim.fires.filter((fire) => distance(fire, unit) < fire.radius + 20);

    if (blocking.length) {
      blocked = true;
      unit.status = 'blocked';
    } else {
      unit.status = 'moving';
      unit.progress = Math.min(1, unit.progress + dt * .037);
      Object.assign(unit, pointOnRoute(sim.route, unit.progress));
    }

    if (dangerous.length) unit.hp = Math.max(0, unit.hp - dt * (12 + dangerous.length * 5));
    if (unit.hp <= 0) {
      state.unitsLost += 1;
    } else if (unit.progress >= 1) {
      state.evacuated += 1;
    } else {
      remaining.push(unit);
    }
  }

  state.units = remaining;
  state.routeBlocked = blocked;
  state.blockedSeconds = blocked
    ? state.blockedSeconds + dt
    : Math.max(0, state.blockedSeconds - dt * 2);

  if (state.unitsLost >= sim.modeConfig.rules.maximumVehiclesLost) {
    sim.finish('lost', 'Too many evacuation vehicles were lost.');
  } else if (state.blockedSeconds >= sim.modeConfig.rules.maximumBlockedSeconds) {
    sim.finish('lost', 'The evacuation route stayed blocked too long.');
  } else if (state.evacuated >= state.unitsRequired) {
    sim.finish('won', 'Everyone reached the safe area.');
  }
}

function convoyChunkWidth(sim) {
  return Math.max(180, sim.width * .64);
}

function addConvoyChunk(sim, x) {
  const index = sim.state.nextChunkIndex;
  sim.state.nextChunkIndex += 1;
  sim.state.chunks.push({
    index,
    x,
    width: convoyChunkWidth(sim),
    variant: Math.abs((index * 73 + 19) % 4),
    activated: x < sim.width * .48,
  });
}

function fillConvoyChunks(sim) {
  const chunks = sim.state.chunks;
  const width = convoyChunkWidth(sim);

  if (!chunks.length) addConvoyChunk(sim, -width * .7);
  while (chunks.length < sim.modeConfig.rules.maximumChunks) {
    const tail = chunks.at(-1);
    if (tail.x + tail.width >= sim.width * 2.15) break;
    addConvoyChunk(sim, tail.x + tail.width);
  }
}

function activateConvoyChunks(sim) {
  for (const chunk of sim.state.chunks) {
    if (chunk.activated || chunk.x > sim.width * .98) continue;
    chunk.activated = true;

    const tier = sim.state.difficultyTier;
    const extra = Math.random() < Math.min(.7, (tier - 1) * .12 + sim.teamPressure * .08) ? 1 : 0;
    const count = Math.min(4, 1 + Math.floor(tier / 4) + extra);

    for (let index = 0; index < count; index += 1) {
      const x = clamp(chunk.x + chunk.width * (.22 + Math.random() * .62), sim.width * .52, sim.width * .94);
      const point = { x, y: sim.route[0]?.y ?? sim.height * .52 };
      spawnRoadsideFire(sim, point, {
        hp: Math.min(sim.maximumFireHealth, 92 + Math.min(42, tier * 4)),
        kind: 'route',
      });
    }
  }
}

function initializeConvoy(sim) {
  const roadY = sim.route[0]?.y ?? sim.height * .52;
  const vehicles = [
    { kind: 'engine', label: 'ENGINE', x: .37 },
    { kind: 'tanker', label: 'WATER', x: .29 },
    { kind: 'utility', label: 'CREW', x: .21 },
    { kind: 'command', label: 'COMMAND', x: .13 },
  ];

  sim.state.convoyVehicles = vehicles.map((vehicle, index) => ({
    id: `convoy-${index + 1}`,
    ...vehicle,
    x: vehicle.x * sim.width,
    y: roadY,
    hp: 100,
    maxHp: 100,
    status: 'moving',
  }));
  fillConvoyChunks(sim);
  activateConvoyChunks(sim);
}

function updateConvoy(sim, dt) {
  const state = sim.state;
  const lead = state.convoyVehicles[0];
  if (!lead) return;

  const blocking = sim.fires.filter((fire) => (
    fire.x > lead.x - 12
    && fire.x < lead.x + Math.max(115, sim.width * .20)
    && Math.abs(fire.y - lead.y) < fire.radius + 34
  ));

  state.routeBlocked = blocking.length > 0;
  state.blockedSeconds = state.routeBlocked
    ? state.blockedSeconds + dt
    : Math.max(0, state.blockedSeconds - dt * 2);

  const speed = state.routeBlocked ? 0 : Math.min(96, 57 + state.difficultyTier * 2.5);
  const travel = speed * dt;

  if (travel > 0) {
    for (const chunk of state.chunks) chunk.x -= travel;
    for (const fire of sim.fires) fire.x -= travel;
    for (const patch of sim.burned) patch.x -= travel;
    for (const warning of state.warnings) warning.x -= travel;
    state.distanceMeters += (travel / Math.max(1, sim.width)) * 860;
  }

  for (const vehicle of state.convoyVehicles) {
    const touching = sim.fires.filter((fire) => distance(fire, vehicle) < fire.radius + 24);
    vehicle.status = state.routeBlocked ? 'blocked' : 'moving';
    if (touching.length) {
      const damage = (8 + touching.length * 4) * dt;
      vehicle.hp = Math.max(0, vehicle.hp - damage);
      state.convoyIntegrity = Math.max(0, state.convoyIntegrity - damage * .28);
    }
  }

  if (state.blockedSeconds > 9) {
    state.convoyIntegrity = Math.max(0, state.convoyIntegrity - dt * (1.8 + blocking.length * .7));
  }

  state.chunks = state.chunks.filter((chunk) => chunk.x + chunk.width > -sim.width * .45);
  sim.fires = sim.fires.filter((fire) => fire.x > -fire.radius);
  sim.burned = sim.burned.filter((patch) => patch.x > -patch.radius);
  state.warnings = state.warnings.filter((warning) => warning.x > -30);
  fillConvoyChunks(sim);
  activateConvoyChunks(sim);

  if (state.convoyIntegrity <= 0) {
    sim.finish('lost', 'The convoy could not continue.');
  } else if (state.convoyVehicles.find((vehicle) => vehicle.kind === 'command')?.hp <= 0) {
    sim.finish('lost', 'The command vehicle was destroyed.');
  }
}

const classicController = {
  initialize(sim, authoritative) {
    if (!authoritative) return;
    spawnStarterFires(sim, .58, .52, .76, .70, sim.scaling.initialFires);
  },
  update() {},
  spread(sim) {
    spreadRandomFire(sim);
  },
  spreadInterval(sim) {
    return sim.scaling.spreadMs;
  },
};

const survivalController = {
  initialize(sim, authoritative) {
    if (!authoritative) return;
    spawnStarterFires(sim, .62, .50, .64, .62, Math.max(2, sim.scaling.initialFires - 1));
  },
  update(sim, dt) {
    updateTier(sim, sim.state.elapsed / 38);
    updateDanger(sim, dt, sim.modeConfig.rules.dangerGraceSeconds);
  },
  spread(sim) {
    const health = Math.min(sim.maximumFireHealth, 94 + Math.min(46, sim.state.difficultyTier * 4));
    spreadRandomFire(sim, { hp: health });
    if (sim.state.difficultyTier > 3 && Math.random() < Math.min(.35, sim.state.difficultyTier * .035)) {
      spawnNear(sim, .66, .50, .65, .72, { hp: health });
    }
  },
  spreadInterval(sim) {
    const pressure = 1 + Math.min(.8, (sim.state.difficultyTier - 1) * .075);
    return Math.max(950, sim.scaling.spreadMs / pressure);
  },
};

const townController = {
  initialize(sim, authoritative) {
    initializeBuildings(sim);
    if (!authoritative) return;
    spawnStarterFires(sim, .46, .47, .26, .54, sim.scaling.initialFires + 1);
  },
  update(sim, dt) {
    updateTier(sim, sim.state.elapsed / 75);
    updateBuildings(sim, dt);
    if (!sim.complete && sim.state.elapsed > 1 && sim.fires.length === 0 && sim.extinguished > 0) {
      sim.finish('won', 'The wildfire was contained and the town was saved.');
    }
  },
  spread(sim) {
    if (!sim.fires.length) return;
    const source = sim.fires[Math.floor(Math.random() * sim.fires.length)];
    const target = sim.state.buildings
      .filter((building) => building.hp > 0)
      .sort((left, right) => distance(left, source) - distance(right, source))[0];
    if (!target) return;
    const direction = Math.atan2(target.y - source.y, target.x - source.x);
    spreadFromFire(sim, source, direction, { hp: Math.min(sim.maximumFireHealth, 96 + sim.state.difficultyTier * 5) });
  },
  spreadInterval(sim) {
    return Math.max(1600, sim.scaling.spreadMs * .95);
  },
};

const spotController = {
  initialize(sim, authoritative) {
    if (!authoritative) return;
    spawnStarterFires(sim, .61, .51, .22, .25, sim.scaling.initialFires + 1, { kind: 'main' });
  },
  update(sim, dt) {
    const state = sim.state;
    updateTier(sim, state.elapsed / 52);
    updateDanger(sim, dt, 7);
    updateWarnings(sim, dt);

    state.objectiveSeconds = Math.max(0, sim.modeConfig.rules.controlSeconds - state.elapsed);
    if (state.objectiveSeconds <= 0) state.objectivePhase = 'containment';

    if (state.objectivePhase === 'active') {
      state.warningCooldown -= dt;
      if (state.warningCooldown <= 0) {
        const x = (.36 + Math.random() * .57) * sim.width;
        const y = (.12 + Math.random() * .76) * sim.height;
        warningAt(sim, x, y, sim.modeConfig.rules.warningSeconds, 'spot');
        if (state.difficultyTier >= 4 && Math.random() < .28) {
          warningAt(sim, (.30 + Math.random() * .61) * sim.width, (.14 + Math.random() * .70) * sim.height, 3, 'spot');
        }
        state.warningCooldown = Math.max(5.5, 14 - state.difficultyTier * .75 - sim.teamPressure * .45);
      }
    } else if (sim.fires.length === 0 && state.warnings.length === 0) {
      sim.finish('won', 'The ember storm passed and every fire was extinguished.');
    }
  },
  spread(sim) {
    if (sim.state.objectivePhase === 'containment') return;
    spreadRandomFire(sim, { hp: Math.min(sim.maximumFireHealth, 92 + sim.state.difficultyTier * 5) });
  },
  spreadInterval(sim) {
    return Math.max(1500, sim.scaling.spreadMs * 1.05 - sim.state.difficultyTier * 80);
  },
};

const evacuationController = {
  initialize(sim, authoritative) {
    if (!authoritative) return;

    const count = Math.max(2, sim.scaling.initialFires - 1);
    for (let index = 0; index < count; index += 1) {
      const point = pointOnRoute(sim.route, .24 + Math.random() * .60);
      spawnRoadsideFire(sim, point, { kind: 'wildfire' });
    }
  },
  update(sim, dt) {
    const state = sim.state;
    updateTier(sim, state.elapsed / 70);

    const committed = state.evacuated + state.unitsLost + state.units.length;
    state.vehicleCooldown -= dt;
    if (state.vehicleCooldown <= 0 && committed < state.unitsRequired + sim.modeConfig.rules.maximumVehiclesLost) {
      createEvacuationUnit(sim);
      state.vehicleCooldown = Math.max(5.5, 8.8 - Math.min(1.5, sim.teamPressure * .55));
    }

    updateEvacuationUnits(sim, dt);
  },
  spread(sim) {
    if (!sim.route.length) {
      spreadRandomFire(sim, { hp: 100, kind: 'route' });
      return;
    }

    if (!sim.fires.length) {
      const point = pointOnRoute(sim.route, .22 + Math.random() * .62);
      spawnRoadsideFire(sim, point, { hp: 100, kind: 'route' });
      return;
    }

    const source = sim.fires[Math.floor(Math.random() * sim.fires.length)];
    const road = nearestPointOnRoute(sim.route, source);
    const nearestUnit = sim.state.units
      .filter((unit) => unit.hp > 0)
      .sort((left, right) => distance(left, source) - distance(right, source))[0];
    const target = nearestUnit && distance(source, road) < source.radius + 24
      ? nearestUnit
      : road;
    const direction = Math.atan2(target.y - source.y, target.x - source.x);
    spreadFromFire(sim, source, direction, { hp: 100, kind: 'route' });
  },
  spreadInterval(sim) {
    return Math.max(1800, sim.scaling.spreadMs * 1.12);
  },
};

const convoyController = {
  initialize(sim, authoritative) {
    if (authoritative) initializeConvoy(sim);
  },
  update(sim, dt) {
    const state = sim.state;
    updateTier(sim, state.distanceMeters / 1250);
    updateWarnings(sim, dt);
    updateConvoy(sim, dt);

    if (state.difficultyTier >= 3) {
      state.warningCooldown -= dt;
      if (state.warningCooldown <= 0) {
        const roadPoint = {
          x: sim.width * (.66 + Math.random() * .26),
          y: sim.route[0]?.y ?? sim.height * .52,
        };
        const warning = roadsidePosition(sim, roadPoint);
        warningAt(sim, warning.x, warning.y, 2.1, 'spot');
        state.warningCooldown = Math.max(8, 20 - state.difficultyTier);
      }
    }
  },
  spread(sim) {
    if (!sim.fires.length) return;
    const source = sim.fires[Math.floor(Math.random() * sim.fires.length)];
    const lead = sim.state.convoyVehicles[0];
    if (!lead) return;

    const target = {
      x: Math.max(lead.x + 38, source.x - Math.max(78, sim.width * .12)),
      y: lead.y,
    };
    const direction = Math.atan2(target.y - source.y, target.x - source.x);
    spreadFromFire(sim, source, direction, {
      hp: Math.min(sim.maximumFireHealth, 90 + sim.state.difficultyTier * 4),
      kind: 'route',
    });
  },
  spreadInterval(sim) {
    return Math.max(1500, sim.scaling.spreadMs * 1.25 - sim.state.difficultyTier * 95);
  },
};

export const MODE_CONTROLLERS = Object.freeze({
  classic: classicController,
  'wildfire-survival': survivalController,
  'protect-town': townController,
  'spot-fire': spotController,
  evacuation: evacuationController,
  'convoy-protection': convoyController,
});

export function controllerForMode(modeId) {
  return MODE_CONTROLLERS[modeId] || classicController;
}
