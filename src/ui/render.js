export function drawSimulation(ctx, sim) {
  const { width, height } = sim;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = '#79b85a';
  ctx.fillRect(0, 0, width, height);

  // Dirt roads
  ctx.strokeStyle = '#b58b58';
  ctx.lineWidth = 28;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(width * .05, height * .52);
  ctx.bezierCurveTo(width * .28, height * .42, width * .54, height * .7, width * .95, height * .58);
  ctx.stroke();

  // Water refill pond
  ctx.fillStyle = '#53a8dc';
  ctx.beginPath();
  ctx.arc(sim.water.x, sim.water.y, sim.water.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.55)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Cabins
  for (const cabin of sim.cabins) {
    ctx.fillStyle = '#c89d63';
    ctx.fillRect(cabin.x - 22, cabin.y - 18, 44, 36);
    ctx.fillStyle = '#7e4b35';
    ctx.beginPath();
    ctx.moveTo(cabin.x - 28, cabin.y - 18);
    ctx.lineTo(cabin.x, cabin.y - 39);
    ctx.lineTo(cabin.x + 28, cabin.y - 18);
    ctx.closePath();
    ctx.fill();
  }

  // Trees
  for (const tree of sim.trees) {
    ctx.fillStyle = '#2e6b3d';
    ctx.beginPath();
    ctx.arc(tree.x, tree.y, 13, 0, Math.PI * 2);
    ctx.fill();
  }

  // Burned / recovering patches
  for (const patch of sim.burned) {
    const progress = patch.age / 16;
    ctx.globalAlpha = Math.max(.15, 1 - progress * .8);
    ctx.fillStyle = progress < .45 ? '#3a2f27' : '#7f8c50';
    ctx.beginPath();
    ctx.arc(patch.x, patch.y, patch.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Fires
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

  // Helicopters - temporary simple vector art until sprite sheets are designed.
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
