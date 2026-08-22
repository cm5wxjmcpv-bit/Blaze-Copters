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

export function drawSimulation(ctx, sim) {
  const { width, height } = sim;
  const minSide = Math.min(width, height);
  const detailScale = Math.max(.72, Math.min(1.12, minSide / 520));
  ctx.clearRect(0, 0, width, height);

  // Grass base and open fields.
  ctx.fillStyle = '#77b95d';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(221, 231, 126, .12)';
  ctx.beginPath();
  ctx.ellipse(width * .47, height * .46, width * .20, height * .22, -.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(width * .64, height * .57, width * .14, height * .12, .3, 0, Math.PI * 2);
  ctx.fill();

  // Main road links the station, town and campground without using extra screens.
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

  // Fire station and helicopter starting pad.
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

  // Small town in the upper-right.
  ctx.fillStyle = 'rgba(238, 222, 170, .18)';
  ctx.beginPath();
  ctx.ellipse(width * .80, height * .29, width * .15, height * .15, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const cabin of sim.cabins) drawHouse(ctx, cabin.x, cabin.y, detailScale);

  // Campground in the lower-right.
  ctx.fillStyle = 'rgba(222, 198, 120, .18)';
  ctx.beginPath();
  ctx.ellipse(width * .78, height * .73, width * .16, height * .12, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const tent of sim.campground) drawTent(ctx, tent.x, tent.y, detailScale);
  ctx.fillStyle = '#5b3c25';
  ctx.beginPath();
  ctx.arc(width * .77, height * .70, 5 * detailScale, 0, Math.PI * 2);
  ctx.fill();

  // Forest clusters frame the open flying space instead of covering the whole board.
  for (const tree of sim.trees) drawTree(ctx, tree.x, tree.y, detailScale);

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

  // Helicopters - temporary vector art until sprite sheets are designed.
  for (const heli of sim.helicopters) {
    ctx.save();
    ctx.translate(heli.x, heli.y);
    ctx.fillStyle = heli.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(16, -3, 24, 6);
    ctx.strokeStyle = '#1f2523';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-27, -18); ctx.lineTo(27, 18);
    ctx.moveTo(-27, 18); ctx.lineTo(27, -18);
    ctx.stroke();
    ctx.restore();

    const pct = Math.max(0, Math.min(1, heli.water / heli.capacity));
    const waterColor = pct >= .8 ? '#35c759' : pct >= .4 ? '#ffd43b' : '#ff453a';
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(heli.x - 20, heli.y + 20, 40, 5);
    ctx.fillStyle = waterColor;
    ctx.fillRect(heli.x - 20, heli.y + 20, 40 * pct, 5);

    if (heli.refillProgress > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`REFILL ${Math.round(heli.refillProgress)}%`, heli.x, heli.y - 27);
    }
  }
}
