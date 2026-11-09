// Browsers block audio until the user clicks something, so call unlockAlarm() from a button first.
let ctx = null;
let timer = null;

export function unlockAlarm() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx.state === 'running';
}

function beep() {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.setValueAtTime(660, ctx.currentTime + 0.2);
  gain.gain.value = 0.15;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
}

export function startAlarm() {
  if (!ctx || ctx.state !== 'running' || timer) return;
  beep();
  timer = setInterval(beep, 900);
}
export function stopAlarm() {
  clearInterval(timer);
  timer = null;
}
