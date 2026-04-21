/** Shared reactive clock for relative-time displays.
 *  Ticks every 60 s so "28m ago" labels stay fresh. */
let now = $state(Date.now());
let refCount = 0;
let timer;

function start() {
  if (!timer) {
    timer = setInterval(() => { now = Date.now(); }, 60_000);
  }
}

function stop() {
  clearInterval(timer);
  timer = undefined;
}

export function useClock() {
  refCount++;
  start();

  $effect(() => {
    return () => {
      refCount--;
      if (refCount <= 0) { refCount = 0; stop(); }
    };
  });

  return { get now() { return now; } };
}
