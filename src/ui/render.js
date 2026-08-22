import { drawAnimatedHelicopter } from './helicopters.js';

function drawRoad(ctx, points, width) {
  ctx.strokeStyle = '#9a744d';
  ctx.lineWidth = width + 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  ctx.strokeStyle = '#c59a64';
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawHouse(ctx, x, y, scale = 1) {
  const w = 34 * scale;
  const h = 27 * scale;
  ctx.fillStyle = '#d9b27b';
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = '#70452f';
  ctx.beginPath();
  ctx.moveTo(x - w * .62, y - h / 2);
  ctx.lineTo(x, y - h * 1.05);
  ctx.lineTo(x + w * .62, y - h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5a3929';
  ctx.fillRect(x - 4 * scale, y + 1 * scale, 8 * scale, 12 * scale);
}

function drawTent(ctx, x, y, scale = 1) {
  ctx.fillStyle = '#e3a34e';
  ctx.beginPath();
  ctx.moveTo(x - 14 * scale, y + 9 * scale);
  ctx.lineTo(x, y - 12 * scale);
  ctx.lineTo(x + 14 * scale, y + 9 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#825726';
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  ctx.beginPath();
  ctx.moveTo(x, y - 12 * scale);
  ctx.lineTo(x, y + 9 * scale);
  ctx.stroke();
}

function drawTree(ctx, x, y, scale = 1) {
  ctx.fillStyle = '#6a4529';
  ctx.fillRect(x - 2 * scale, y + 5 * scale, 4 * scale, 9 * scale);
  ctx.fillStyle = '#2e6b3d';
  ctx.beginPath();
  ctx.arc(x, y, 11 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3e7f49';
  ctx.beginPath();
  ctx.arc(x - 4 * scale, y - 4 * scale, 6 * scale, 0, Math.PI * 2);
  ctx.fill();
}

function drawFireStation(ctx, station, scale) {
  const w = 54 * scale;
  const h = 35 * scale;
  ctx.fillStyle = '#e9e0ce';
  ctx.fillRect(station.x - w / 2, station.y - h / 2, w, h);
  ctx.fillStyle = '#b44a3d';
  ctx.fillRect(station.x - w / 2, station.y - h / 2, w, 8 * scale);
  ctx.fillStyle = '#8b342e';
  ctx.fillRect(station.x - 17 * scale, station.y - 4 * scale, 14 * scale, 17 * scale);
  ctx.fillRect(station.x + 3 * scale, station.y - 4 * scale, 14 * scale, 17 * scale);
  ctx.fillStyle = '#4f2f28';
  ctx.font = `bold ${Math.max(8, 9 * scale)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.fillText('FIRE', station.x, station.y - h * .72);
}

function drawBuilding(ctx, building, scale) {
  if (building.status === 'destroyed') {
    ctx.fillStyle = '#55463e';
    ctx.fillRect(building.x - 17 * scale, building.y - 9 * scale, 34 * scale, 18 * scale);
    ctx.fillStyle = '#81746a';
    ctx.fillRect(building.x - 12 * scale, building.y - 14 * scale, 9 * scale, 7 * scale);
    return;
  }

  drawHouse(ctx, building.x, building.y, scale);
  if (building.status === 'threatened' || building.status === 'burning') {
    ctx.strokeStyle = building.status === 'burning' ? '#ff5545' : '#ffd052';
    ctx.lineWidth = 3;
    ctx.strokeRect(building.x - 23 * scale, building.y - 24 * scale, 46 * scale, 44 * scale);
  }

  if (building.hp < building.maxHp) {
    const ratio = Math.max(0, building.hp / Math.max(1, building.maxHp));
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(building.x - 18 * scale, building.y + 17 * scale, 36 * scale, 4 * scale);
    ctx.fillStyle = ratio > .45 ? '#62d867' : '#ff684f';
    ctx.fillRect(building.x - 18 * scale, building.y + 17 * scale, 36 * scale * ratio, 4 * scale);
  }
}

function drawVehicle(ctx, vehicle, scale = 1, convoy = false) {
  const bodyWidth = (vehicle.kind === 'bus' || convoy ? 41 : 31) * scale;
  const bodyHeight = (convoy ? 20 : 16) * scale;
  const colors = {
    car: '#edf0ec',
    bus: '#f6c348',
    engine: '#d84636',
    tanker: '#478fc1',
    utility: '#efb84c',
    command: '#e4e8dd',
  };

  ctx.fillStyle = 'rgba(0,0,0,.16)';
  ctx.fillRect(vehicle.x - bodyWidth / 2 + 3, vehicle.y - bodyHeight / 2 + 4, bodyWidth, bodyHeight);
  ctx.fillStyle = colors[vehicle.kind] || '#e9e9e4';
  ctx.fillRect(vehicle.x - bodyWidth / 2, vehicle.y - bodyHeight / 2, bodyWidth, bodyHeight);
  ctx.fillStyle = '#355268';
  ctx.fillRect(vehicle.x + bodyWidth * .11, vehicle.y - bodyHeight * .34, bodyWidth * .22, bodyHeight * .68);
  ctx.fillStyle = '#272c2a';
  for (const x of [-.34, .30]) {
    ctx.fillRect(vehicle.x + bodyWidth * x, vehicle.y - bodyHeight * .59, bodyWidth * .13, bodyHeight * .16);
    ctx.fillRect(vehicle.x + bodyWidth * x, vehicle.y + bodyHeight * .43, bodyWidth * .13, bodyHeight * .16);
  }

  if (convoy) {
    ctx.fillStyle = '#17201b';
    ctx.font = `800 ${Math.max(7, 7 * scale)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(vehicle.label || '', vehicle.x - bodyWidth * .11, vehicle.y + 3 * scale);
  }

  if (vehicle.status === 'blocked') {
    ctx.fillStyle = '#ff5f47';
    ctx.font = `900 ${Math.max(11, 13 * scale)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText('!', vehicle.x, vehicle.y - bodyHeight);
  }

  if (vehicle.hp < vehicle.maxHp) {
    const ratio = Math.max(0, vehicle.hp / Math.max(1, vehicle.maxHp));
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(vehicle.x - bodyWidth / 2, vehicle.y + bodyHeight * .72, bodyWidth, 4);
    ctx.fillStyle = ratio > .45 ? '#61dc70' : '#ff614d';
    ctx.fillRect(vehicle.x - bodyWidth / 2, vehicle.y + bodyHeight * .72, bodyWidth * ratio, 4);
  }
}

function drawWarning(ctx, warning) {
  const remaining = Math.max(0, warning.timeLeft / Math.max(.1, warning.duration));
  const pulse = .65 + Math.sin(performance.now() / 125) * .2;
  ctx.strokeStyle = `rgba(255, 106, 59, ${pulse})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(warning.x, warning.y, 17 + remaining * 13, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff0b0';
  ctx.font = '900 12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('!', warning.x, warning.y + 4);
}

function chunkNoise(index, slot) {
  const value = Math.sin((index + 1) * 89.31 + slot * 43.17) * 19473.127;
  return value - Math.floor(value);
}

function drawConvoyLandscape(ctx, sim, scale) {
  const roadY = sim.route[0]?.y ?? sim.height * .52;
  const colors = ['#77b95d', '#72af59', '#83bd66', '#6fae56'];

  for (const chunk of sim.state.chunks) {
    ctx.fillStyle = colors[chunk.variant % colors.length];
    ctx.fillRect(chunk.x, 0, chunk.width + 1, sim.height);

    for (let index = 0; index < 10; index += 1) {
      const x = chunk.x + (index + .45 + chunkNoise(chunk.index, index) * .28) * chunk.width / 10;
      const upper = chunkNoise(chunk.index, index + 30) > .5;
      const y = upper
        ? sim.height * (.13 + chunkNoise(chunk.index, index + 10) * .22)
        : sim.height * (.69 + chunkNoise(chunk.index, index + 20) * .21);
      drawTree(ctx, x, y, scale * (.78 + chunkNoise(chunk.index, index + 40) * .45));
    }

    ctx.fillStyle = 'rgba(251, 242, 175, .11)';
    ctx.beginPath();
    ctx.ellipse(chunk.x + chunk.width * .45, roadY - sim.height * .17, chunk.width * .2, sim.height * .08, -.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawSimulation(ctx, sim) {
  const { width, height } = sim;
  const minSide = Math.min(width, height);
  const detailScale = Math.max(.72, Math.min(1.12, minSide / 520));
  const isConvoy = sim.mode === 'convoy-protection';
  ctx.clearRect(0, 0, width, height);

  // Grass base and open fields.
  ctx.fillStyle = '#77b95d';
  ctx.fillRect(0, 0, width, height);
  if (isConvoy) drawConvoyLandscape(ctx, sim, detailScale);
  ctx.fillStyle = 'rgba(221, 231, 126, .12)';
  ctx.beginPath();
  ctx.ellipse(width * .47, height * .46, width * .20, height * .22, -.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(width * .64, height * .57, width * .14, height * .12, .3, 0, Math.PI * 2);
  ctx.fill();

  if (sim.route.length >= 2) {
    drawRoad(ctx, sim.route, (isConvoy ? 28 : 22) * detailScale);
  } else {
    drawRoad(ctx, [
      { x: width * .03, y: height * .34 },
      { x: sim.fireStation.x, y: sim.fireStation.y + 24 * detailScale },
      { x: width * .46, y: height * .38 },
      { x: width * .68, y: height * .31 },
      { x: width * .96, y: height * .34 },
    ], 17 * detailScale);
    drawRoad(ctx, [
      { x: width * .49, y: height * .38 },
      { x: width * .57, y: height * .55 },
      { x: width * .70, y: height * .68 },
      { x: width * .91, y: height * .78 },
    ], 12 * detailScale);
  }

  if (sim.mode === 'evacuation' && sim.route.length) {
    const start = sim.route[0];
    const end = sim.route.at(-1);
    ctx.fillStyle = '#fff5cf';
    ctx.font = `800 ${Math.max(9, 10 * detailScale)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText('EVAC', start.x + 14 * detailScale, start.y - 23 * detailScale);
    ctx.fillStyle = '#d8ffc8';
    ctx.fillText('SAFE', end.x - 14 * detailScale, end.y - 23 * detailScale);
  }

  // Lake / refill source. The drawn edge matches the actual refill radius.
  ctx.fillStyle = '#d4bd7c';
  ctx.beginPath();
  ctx.arc(sim.water.x, sim.water.y, sim.water.radius + 6 * detailScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4fa5d5';
  ctx.beginPath();
  ctx.arc(sim.water.x, sim.water.y, sim.water.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.55)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.78)';
  ctx.font = `bold ${Math.max(9, 10 * detailScale)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.fillText('REFILL', sim.water.x, sim.water.y + 4);

  if (!isConvoy) {
    drawFireStation(ctx, sim.fireStation, detailScale);
    ctx.fillStyle = 'rgba(230, 230, 220, .92)';
    ctx.beginPath();
    ctx.arc(sim.helipad.x, sim.helipad.y, sim.helipad.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(70, 70, 65, .72)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#5d5d59';
    ctx.font = `900 ${Math.max(18, sim.helipad.radius * 1.15)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', sim.helipad.x, sim.helipad.y + 1);
    ctx.textBaseline = 'alphabetic';
  }

  // Small town in the upper-right.
  if (!isConvoy) {
    ctx.fillStyle = 'rgba(238, 222, 170, .18)';
    ctx.beginPath();
    ctx.ellipse(width * .80, height * .29, width * .15, height * .15, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const cabin of sim.cabins) drawHouse(ctx, cabin.x, cabin.y, detailScale);
    for (const building of sim.state.buildings) drawBuilding(ctx, building, detailScale);
  }

  // Campground in the lower-right.
  if (!isConvoy) {
    ctx.fillStyle = 'rgba(222, 198, 120, .18)';
    ctx.beginPath();
    ctx.ellipse(width * .78, height * .73, width * .16, height * .12, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const tent of sim.campground) drawTent(ctx, tent.x, tent.y, detailScale);
    ctx.fillStyle = '#5b3c25';
    ctx.beginPath();
    ctx.arc(width * .77, height * .70, 5 * detailScale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Forest clusters frame the open flying space instead of covering the whole board.
  if (!isConvoy) {
    for (const tree of sim.trees) drawTree(ctx, tree.x, tree.y, detailScale);
  }

  // Burned / recovering patches.
  for (const patch of sim.burned) {
    const progress = patch.age / 16;
    ctx.globalAlpha = Math.max(.15, 1 - progress * .8);
    ctx.fillStyle = progress < .45 ? '#3a2f27' : '#7f8c50';
    ctx.beginPath();
    ctx.arc(patch.x, patch.y, patch.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Fires.
  for (const fire of sim.fires) {
    const flicker = 1 + Math.sin(performance.now() / 90 + fire.x) * .1;
    ctx.fillStyle = '#f44336';
    ctx.beginPath();
    ctx.arc(fire.x, fire.y, fire.radius * flicker, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffca28';
    ctx.beginPath();
    ctx.arc(fire.x, fire.y - 4, fire.radius * .58 * flicker, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const warning of sim.state.warnings) drawWarning(ctx, warning);
  for (const unit of sim.state.units) drawVehicle(ctx, unit, detailScale);
  for (const vehicle of sim.state.convoyVehicles) drawVehicle(ctx, vehicle, detailScale, true);

  const helicopterScale = Math.max(.76, Math.min(1.05, minSide / 560));
  const animationTime = performance.now();

  // Animated, color-matched helicopter characters share identical gameplay rules.
  for (const heli of sim.helicopters) {
    const dropping = heli.water > 0
      && Math.hypot(heli.x - sim.water.x, heli.y - sim.water.y) >= sim.water.radius
      && sim.fires.some((fire) => Math.hypot(heli.x - fire.x, heli.y - fire.y) <= 30 + fire.radius);
    const lowerEdge = drawAnimatedHelicopter(ctx, heli, animationTime, {
      scale: helicopterScale,
      dropping,
    });

    const pct = Math.max(0, Math.min(1, heli.water / heli.capacity));
    const waterColor = pct >= .8 ? '#35c759' : pct >= .4 ? '#ffd43b' : '#ff453a';
    const barY = heli.y + lowerEdge + 4;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(heli.x - 20, barY, 40, 5);
    ctx.fillStyle = waterColor;
    ctx.fillRect(heli.x - 20, barY, 40 * pct, 5);

    if (heli.refillProgress > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`REFILL ${Math.round(heli.refillProgress)}%`, heli.x, heli.y - 37);
    }
  }
}
