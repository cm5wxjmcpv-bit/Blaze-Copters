import { normalizeHelicopterType } from '../game/config.js';

const DARK = '#203147';
const WINDOW = '#244a68';
const WHITE = '#fffaf0';
const WATER = '#7edbff';

function blend(hex, target, amount) {
  const source = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'e53935';
  const goal = target.slice(1);
  const channel = (offset) => {
    const value = Number.parseInt(source.slice(offset, offset + 2), 16);
    const destination = Number.parseInt(goal.slice(offset, offset + 2), 16);
    return Math.round(value + (destination - value) * amount).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const corner = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + corner, y);
  ctx.lineTo(x + width - corner, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + corner);
  ctx.lineTo(x + width, y + height - corner);
  ctx.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
  ctx.lineTo(x + corner, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - corner);
  ctx.lineTo(x, y + corner);
  ctx.quadraticCurveTo(x, y, x + corner, y);
  ctx.closePath();
}

function fillRounded(ctx, x, y, width, height, radius, color) {
  ctx.fillStyle = color;
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fill();
}

function hashSeed(value) {
  let result = 0;
  for (const character of String(value || 'helicopter')) {
    result = ((result * 31) + character.charCodeAt(0)) % 1009;
  }
  return result / 67;
}

function drawWheel(ctx, x, y, radius = 3.2) {
  ctx.fillStyle = DARK;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#cdd8df';
  ctx.beginPath();
  ctx.arc(x, y, radius * .39, 0, Math.PI * 2);
  ctx.fill();
}

function drawEyes(ctx, x, y, heli, now, seed) {
  ctx.fillStyle = WINDOW;
  ctx.beginPath();
  ctx.ellipse(x, y, 13, 8.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const blink = ((now + seed * 183) % 3600) < 125;
  const eyeHeight = blink ? .65 : 5.1;
  const lookX = Math.max(-1.2, Math.min(1.2, Number(heli.vx) || 0));
  const lookY = Math.max(-1, Math.min(1, Number(heli.vy) || 0));

  for (const offset of [-4.7, 3.6]) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x + offset, y - 1, 3.3, eyeHeight, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!blink) {
      ctx.fillStyle = '#20344a';
      ctx.beginPath();
      ctx.arc(x + offset - 1.05 + lookX, y - .5 + lookY, 1.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + offset - 1.4 + lookX, y - 1.1 + lookY, .48, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = '#233547';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x - 8, y + 8, 4.5, .08, 1.08);
  ctx.stroke();
}

function drawRotor(ctx, x, y, radius, now, seed, direction = 1) {
  const angle = now * .020 * direction + seed;

  ctx.save();
  ctx.globalAlpha = .16;
  ctx.strokeStyle = '#eff9ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y, radius + 2, radius * .23, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  for (let index = 0; index < 2; index += 1) {
    const current = angle + index * Math.PI / 2;
    const dx = Math.cos(current) * radius;
    const dy = Math.sin(current) * radius * .24;
    ctx.strokeStyle = index === 0 ? '#253343' : '#39485a';
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }

  ctx.fillStyle = DARK;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawTailRotor(ctx, x, y, now, seed) {
  const angle = now * .035 + seed;
  ctx.strokeStyle = DARK;
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  for (let index = 0; index < 2; index += 1) {
    const current = angle + index * Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(current) * 6, y - Math.sin(current) * 6);
    ctx.lineTo(x + Math.cos(current) * 6, y + Math.sin(current) * 6);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffcf5c';
  ctx.beginPath();
  ctx.arc(x, y, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawTank(ctx, x, y, width, color) {
  fillRounded(ctx, x, y, width, 9, 4.5, blend(color, '#182a31', .22));
  fillRounded(ctx, x + 2, y + 1, width - 4, 3.3, 1.6, blend(color, '#ffffff', .24));
}

function drawChinook(ctx, heli, now, seed, color) {
  const accent = blend(color, '#182a31', .23);
  fillRounded(ctx, -32, -10, 65, 25, 12, color);
  fillRounded(ctx, -28, -9, 55, 11, 7, WHITE);
  fillRounded(ctx, 19, -18, 12, 11, 4, color);
  fillRounded(ctx, -20, -18, 11, 11, 4, color);

  ctx.fillStyle = '#ffd35b';
  ctx.fillRect(-4, 1, 31, 2);
  for (const x of [2, 12, 22]) fillRounded(ctx, x, -6, 5, 6, 2, WINDOW);

  drawTank(ctx, -16, 12, 35, accent);
  drawWheel(ctx, -20, 17);
  drawWheel(ctx, 22, 17);
  drawEyes(ctx, -20, 1, heli, now, seed);

  ctx.strokeStyle = DARK;
  ctx.lineWidth = 2.3;
  for (const x of [-15, 25]) {
    ctx.beginPath();
    ctx.moveTo(x, -16);
    ctx.lineTo(x, -22);
    ctx.stroke();
  }
  drawRotor(ctx, -15, -22, 22, now, seed, 1);
  drawRotor(ctx, 25, -22, 20, now, seed + .9, -1);
}

function drawKamov(ctx, heli, now, seed, color) {
  const pale = blend(color, '#ffffff', .80);
  const sway = Math.sin(now / 310 + seed) * 5;

  ctx.strokeStyle = DARK;
  ctx.lineWidth = 1.15;
  for (const attach of [-3, 3]) {
    ctx.beginPath();
    ctx.moveTo(attach, 12);
    ctx.lineTo(sway, 26);
    ctx.stroke();
  }
  fillRounded(ctx, sway - 7, 25, 14, 12, 5, '#f3533e');
  ctx.fillStyle = '#ffd35b';
  ctx.fillRect(sway - 6, 27, 12, 2);

  fillRounded(ctx, -30, -9, 51, 25, 13, pale);
  fillRounded(ctx, -3, 3, 25, 12, 6, color);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(12, -2);
  ctx.lineTo(44, -7);
  ctx.lineTo(43, 7);
  ctx.lineTo(12, 8);
  ctx.closePath();
  ctx.fill();
  fillRounded(ctx, 41, -10, 6, 19, 2, color);
  fillRounded(ctx, -1, -7, 7, 7, 2, WINDOW);
  fillRounded(ctx, 9, -6, 6, 6, 2, WINDOW);
  drawWheel(ctx, -18, 17);
  drawWheel(ctx, 12, 17);
  drawEyes(ctx, -19, 1, heli, now, seed);

  ctx.strokeStyle = DARK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-3, -9);
  ctx.lineTo(-3, -28);
  ctx.stroke();
  drawRotor(ctx, -3, -25, 35, now, seed, 1);
  drawRotor(ctx, -3, -17, 31, now, seed + .7, -1);
}

function drawSkycrane(ctx, heli, now, seed, color) {
  const deep = blend(color, '#6a290c', .25);
  ctx.strokeStyle = deep;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-8, -8);
  ctx.lineTo(45, -9);
  ctx.lineTo(43, 0);
  ctx.lineTo(-8, 0);
  ctx.closePath();
  ctx.stroke();
  for (let x = -3; x < 40; x += 9) {
    ctx.beginPath();
    ctx.moveTo(x, -8);
    ctx.lineTo(x + 8, 0);
    ctx.stroke();
  }

  fillRounded(ctx, -32, -9, 30, 24, 11, color);
  fillRounded(ctx, -28, -8, 18, 8, 5, WHITE);
  drawEyes(ctx, -22, 2, heli, now, seed);

  ctx.strokeStyle = deep;
  ctx.lineWidth = 2;
  for (const x of [-11, 20]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - 4, 24);
    ctx.stroke();
    drawWheel(ctx, x - 4, 25, 2.9);
  }
  drawTank(ctx, -9, 11, 34, '#f25d3f');

  ctx.fillStyle = deep;
  ctx.beginPath();
  ctx.moveTo(43, -10);
  ctx.lineTo(50, -19);
  ctx.lineTo(49, 0);
  ctx.closePath();
  ctx.fill();
  drawTailRotor(ctx, 48, -14, now, seed);

  ctx.strokeStyle = DARK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-3, -7);
  ctx.lineTo(-3, -18);
  ctx.stroke();
  drawRotor(ctx, -3, -20, 38, now, seed, 1);
}

function drawFirehawk(ctx, heli, now, seed, color) {
  const accent = blend(color, '#172c3a', .25);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(8, -5);
  ctx.lineTo(44, -12);
  ctx.lineTo(48, -7);
  ctx.lineTo(44, 0);
  ctx.lineTo(10, 7);
  ctx.closePath();
  ctx.fill();
  fillRounded(ctx, -33, -11, 60, 27, 13, color);
  fillRounded(ctx, -26, 3, 52, 11, 5, WHITE);
  fillRounded(ctx, 0, -8, 8, 8, 2, WINDOW);
  fillRounded(ctx, 12, -7, 7, 8, 2, WINDOW);
  ctx.fillStyle = '#ffd35b';
  ctx.fillRect(-5, 2, 34, 2);
  drawTank(ctx, -13, 13, 37, '#e8edf1');
  drawWheel(ctx, -19, 18);
  drawWheel(ctx, 20, 18);
  drawEyes(ctx, -20, 0, heli, now, seed);

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(42, -9);
  ctx.lineTo(49, -22);
  ctx.lineTo(51, -8);
  ctx.lineTo(44, 1);
  ctx.closePath();
  ctx.fill();
  drawTailRotor(ctx, 48, -17, now, seed);

  ctx.strokeStyle = DARK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-1, -10);
  ctx.lineTo(-1, -20);
  ctx.stroke();
  drawRotor(ctx, -1, -21, 39, now, seed, 1);
}

function drawWaterDrop(ctx, x, y, now, seed) {
  for (let index = 0; index < 7; index += 1) {
    const progress = ((now / 380) + seed + index * .23) % 1;
    const spread = (index - 3) * 1.35;
    const dropY = y + progress * 19;
    ctx.globalAlpha = .86 - progress * .58;
    ctx.strokeStyle = index % 2 === 0 ? WATER : '#c8f4ff';
    ctx.lineWidth = 2.4 - progress;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + spread * progress, dropY);
    ctx.lineTo(x + spread * progress * 1.2, dropY + 3.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function drawAnimatedHelicopter(ctx, heli, now = performance.now(), options = {}) {
  const type = normalizeHelicopterType(heli.helicopterType);
  const color = /^#[0-9a-f]{6}$/i.test(heli.color || '') ? heli.color : '#e53935';
  const seed = hashSeed(heli.id);
  const scale = Math.max(.65, Math.min(1.15, Number(options.scale) || 1));
  const bob = Math.sin(now / 280 + seed) * 1.65;
  const facing = Number(heli.vx) > .12 ? -1 : 1;

  ctx.save();
  ctx.globalAlpha = .17;
  ctx.fillStyle = '#172b26';
  ctx.beginPath();
  ctx.ellipse(heli.x + 3, heli.y + 28 * scale, 28 * scale, 6 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(heli.x, heli.y + bob);
  ctx.scale(facing * scale, scale);
  ctx.rotate((Number(heli.vx) || 0) * facing * .09);

  if (options.dropping) {
    const sourceY = type === 'kamov' ? 34 : 20;
    drawWaterDrop(ctx, type === 'kamov' ? Math.sin(now / 310 + seed) * 5 : 1, sourceY, now, seed);
  }

  if (type === 'chinook') drawChinook(ctx, heli, now, seed, color);
  else if (type === 'kamov') drawKamov(ctx, heli, now, seed, color);
  else if (type === 'skycrane') drawSkycrane(ctx, heli, now, seed, color);
  else drawFirehawk(ctx, heli, now, seed, color);

  ctx.restore();
  return type === 'kamov' ? 43 * scale : 34 * scale;
}

function previewEyes(x, y) {
  return `<ellipse cx="${x}" cy="${y}" rx="13" ry="8.5" fill="${WINDOW}"/>
    <ellipse cx="${x - 4.5}" cy="${y - 1}" rx="3.1" ry="5" fill="#fff"/>
    <ellipse cx="${x + 3.5}" cy="${y - 1}" rx="3.1" ry="5" fill="#fff"/>
    <circle cx="${x - 5.5}" cy="${y - .5}" r="1.35" fill="${DARK}"/>
    <circle cx="${x + 2.5}" cy="${y - .5}" r="1.35" fill="${DARK}"/>
    <path d="M ${x - 12} ${y + 8} q 4 4 8 0" fill="none" stroke="${DARK}" stroke-width="1.3" stroke-linecap="round"/>`;
}

function previewRotor(x, y, radius, reverse = false) {
  return `<g class="preview-rotor${reverse ? ' preview-rotor-reverse' : ''}">
    <ellipse cx="${x}" cy="${y}" rx="${radius + 2}" ry="5" fill="none" stroke="#e9f7ff" stroke-opacity=".38" stroke-width="1.5"/>
    <path d="M ${x - radius} ${y} H ${x + radius}" stroke="${DARK}" stroke-width="3.4" stroke-linecap="round"/>
    <circle cx="${x}" cy="${y}" r="3" fill="${DARK}"/>
  </g>`;
}

export function helicopterPreviewMarkup(helicopterType, playerColor = null) {
  const type = normalizeHelicopterType(helicopterType);
  const fallback = type === 'kamov' ? '#1e88e5' : type === 'skycrane' ? '#fb8c00' : '#e53935';
  const color = /^#[0-9a-f]{6}$/i.test(playerColor || '') ? playerColor : fallback;
  const dark = blend(color, '#172c3a', .25);
  let artwork;

  if (type === 'chinook') {
    artwork = `<rect x="-34" y="-10" width="68" height="27" rx="13" fill="${color}"/>
      <rect x="-29" y="-9" width="56" height="12" rx="7" fill="${WHITE}"/>
      <rect x="-21" y="-18" width="12" height="11" rx="4" fill="${color}"/>
      <rect x="20" y="-18" width="12" height="11" rx="4" fill="${color}"/>
      <path d="M -4 4 H 27" stroke="#ffd35b" stroke-width="2"/>
      <rect x="-13" y="13" width="34" height="9" rx="4.5" fill="${dark}"/>
      <circle cx="-21" cy="18" r="3" fill="${DARK}"/><circle cx="24" cy="18" r="3" fill="${DARK}"/>
      ${previewEyes(-21, 1)}${previewRotor(-15, -21, 21)}${previewRotor(26, -21, 20, true)}`;
  } else if (type === 'kamov') {
    artwork = `<g class="preview-bucket"><path d="M -3 11 L 0 25 L 3 11" fill="none" stroke="${DARK}" stroke-width="1"/>
      <rect x="-7" y="24" width="14" height="12" rx="5" fill="#f3533e"/>
      <path d="M -6 27 H 6" stroke="#ffd35b" stroke-width="2"/></g>
      <path d="M 10 -2 L 44 -7 L 44 7 L 10 8 Z" fill="${color}"/>
      <rect x="41" y="-10" width="6" height="19" rx="2" fill="${color}"/>
      <rect x="-31" y="-9" width="52" height="25" rx="13" fill="${blend(color, '#ffffff', .8)}"/>
      <rect x="-2" y="4" width="23" height="11" rx="5" fill="${color}"/>
      <rect x="0" y="-6" width="6" height="6" rx="2" fill="${WINDOW}"/>
      ${previewEyes(-20, 1)}<path d="M -3 -9 V -27" stroke="${DARK}" stroke-width="3"/>
      ${previewRotor(-3, -25, 34)}${previewRotor(-3, -16, 30, true)}`;
  } else if (type === 'skycrane') {
    artwork = `<path d="M -9 -8 L 45 -9 L 43 0 L -9 0 Z M 0 -8 L 8 0 M 10 -8 L 18 0 M 20 -8 L 28 0 M 30 -8 L 38 0"
        fill="none" stroke="${dark}" stroke-width="2"/>
      <rect x="-34" y="-9" width="31" height="24" rx="11" fill="${color}"/>
      <path d="M -12 0 L -16 24 M 20 0 L 16 24" stroke="${dark}" stroke-width="2"/>
      <rect x="-10" y="11" width="35" height="9" rx="4.5" fill="#f25d3f"/>
      <circle cx="-16" cy="25" r="3" fill="${DARK}"/><circle cx="16" cy="25" r="3" fill="${DARK}"/>
      <path d="M 43 -9 L 49 -19 L 49 0 Z" fill="${dark}"/>
      ${previewEyes(-23, 2)}${previewRotor(-3, -19, 37)}
      <g class="preview-tail-rotor"><path d="M 48 -20 V -8 M 42 -14 H 54" stroke="${DARK}" stroke-width="2"/></g>`;
  } else {
    artwork = `<path d="M 8 -5 L 44 -12 L 49 -7 L 44 0 L 9 7 Z" fill="${color}"/>
      <rect x="-34" y="-11" width="61" height="27" rx="13" fill="${color}"/>
      <rect x="-25" y="4" width="50" height="10" rx="5" fill="${WHITE}"/>
      <path d="M -4 3 H 27" stroke="#ffd35b" stroke-width="2"/>
      <rect x="1" y="-7" width="8" height="8" rx="2" fill="${WINDOW}"/>
      <rect x="13" y="-6" width="7" height="7" rx="2" fill="${WINDOW}"/>
      <rect x="-12" y="13" width="35" height="9" rx="4.5" fill="#e8edf1"/>
      <circle cx="-19" cy="18" r="3" fill="${DARK}"/><circle cx="20" cy="18" r="3" fill="${DARK}"/>
      <path d="M 42 -9 L 49 -22 L 51 -8 L 44 1 Z" fill="${dark}"/>
      ${previewEyes(-21, 0)}${previewRotor(-1, -21, 38)}
      <g class="preview-tail-rotor"><path d="M 48 -23 V -11 M 42 -17 H 54" stroke="${DARK}" stroke-width="2"/></g>`;
  }

  return `<svg class="helicopter-art helicopter-art-${type}" viewBox="-60 -38 120 84" aria-hidden="true" focusable="false">
    <ellipse cx="2" cy="31" rx="33" ry="5" fill="#112820" opacity=".13"/>
    ${artwork}
  </svg>`;
}
