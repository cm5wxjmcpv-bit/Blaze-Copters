export function attachJoystick(zone, knob, onInput) {
  let activePointer = null;
  const deadZone = 0.12;

  function maxTravel() {
    return Math.max(1, (zone.clientWidth - knob.clientWidth) / 2 - 8);
  }

  function setKnob(x, y) {
    knob.style.setProperty('--joy-x', `${x}px`);
    knob.style.setProperty('--joy-y', `${y}px`);
  }

  function emitInput(x, y) {
    const magnitude = Math.hypot(x, y);
    if (magnitude <= deadZone) {
      onInput(0, 0);
      return;
    }

    const adjustedMagnitude = Math.min(1, (magnitude - deadZone) / (1 - deadZone));
    const scale = adjustedMagnitude / magnitude;
    onInput(x * scale, y * scale);
  }

  function update(clientX, clientY) {
    const rect = zone.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy);
    const travel = maxTravel();
    const clamp = distance > travel ? travel / distance : 1;
    const px = dx * clamp;
    const py = dy * clamp;

    setKnob(px, py);
    emitInput(px / travel, py / travel);
  }

  function reset() {
    activePointer = null;
    setKnob(0, 0);
    onInput(0, 0);
  }

  zone.addEventListener('pointerdown', (event) => {
    if (activePointer !== null || event.button > 0) return;
    event.preventDefault();
    activePointer = event.pointerId;
    try {
      zone.setPointerCapture(activePointer);
    } catch {
      // Pointer capture can fail if the browser has already cancelled the touch.
    }
    update(event.clientX, event.clientY);
  });

  zone.addEventListener('pointermove', (event) => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    update(event.clientX, event.clientY);
  });

  const release = (event) => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    reset();
  };

  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
  zone.addEventListener('lostpointercapture', (event) => {
    if (event.pointerId === activePointer) reset();
  });
  zone.addEventListener('contextmenu', (event) => event.preventDefault());
}
