'use strict';
// Steady clock for the sequencer. Workers aren't throttled like timers in background tabs.
let id = null;
onmessage = e => {
  if (e.data === 'start') {
    if (id === null) id = setInterval(() => postMessage('tick'), 25);
  } else if (e.data === 'stop') {
    clearInterval(id);
    id = null;
  }
};
