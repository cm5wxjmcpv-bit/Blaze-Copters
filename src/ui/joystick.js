export function attachJoystick(zone, knob, onInput) {
  let activePointer = null;
  const max = 38;

  function update(clientX, clientY) {
    const rect = zone.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    const scale = Math.min(1, max / len);
    const px = dx * scale;
    const py = dy * scale;
    knob.style.transform = `translate(${px}px, ${py}px)`;
    onInput(px / max, py / max);
  }

  zone.addEventListener('pointerdown', (event) => {
    activePointer = event.pointerId;
    zone.setPointerCapture(activePointer);
    update(event.clientX, event.clientY);
  });
  zone.addEventListener('pointermove', (event) => {
    if (event.pointerId === activePointer) update(event.clientX, event.clientY);
  });
  const release = (event) => {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    knob.style.transform = 'translate(0,0)';
    onInput(0, 0);
  };
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
}
