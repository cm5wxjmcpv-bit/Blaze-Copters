const app = document.querySelector('#app');
let lastElement = null;
let lastLevel = '';

function paintWaterHud() {
  const hud = document.querySelector('#water-hud');
  if (!hud) {
    lastElement = null;
    lastLevel = '';
    return;
  }

  const match = hud.textContent.match(/(\d+)%/);
  if (!match) return;

  const percent = Math.max(0, Math.min(100, Number(match[1])));
  const level = percent >= 80 ? 'high' : percent >= 40 ? 'mid' : 'low';

  if (hud === lastElement && level === lastLevel) return;
  lastElement = hud;
  lastLevel = level;

  if (level === 'high') {
    hud.style.background = 'rgba(38, 150, 67, .94)';
    hud.style.color = '#fff';
    hud.style.borderColor = 'rgba(108, 255, 137, .55)';
  } else if (level === 'mid') {
    hud.style.background = 'rgba(242, 183, 5, .96)';
    hud.style.color = '#182016';
    hud.style.borderColor = 'rgba(255, 235, 128, .7)';
  } else {
    hud.style.background = 'rgba(187, 40, 34, .94)';
    hud.style.color = '#fff';
    hud.style.borderColor = 'rgba(255, 126, 119, .62)';
  }
}

if (app) {
  new MutationObserver(paintWaterHud).observe(app, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  paintWaterHud();
}
