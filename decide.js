// function pickRandom(arr) {
//   return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : arr;
// }

// TODO: better draw distinction between PRIORITY and MODE,
// and/or pick better words for these concerns

// how does e.g. HUNGER break down properly into actions:
  // eat food
  // track food
  // find food

const freeModes = ['explore', 'social', 'fight', 'court', 'patrol'];
const forcePriots = ['thirst', 'hunger', 'tired', 'threat', 'isolated', 'lost'];

function sumArr(arr) {
  return arr.reduce((acc, x) => acc + x, 0);
}

function decideForcePriotMode(lvl) {
  const priots = forcePriots.filter(p => {
    return a.forceModeRats[p] >= a.decWts[`${lvl}_${p}_rat`];
  });

  return priots.length ? pickFromModes(priots, lvl) : null;
}

function pickFromModes(modes, lvl = "fre") {
  if (!modes || !modes.length)
      return alert("falsy or empty list to pickFromModes");

  if (modes.length === 1) return modes[0];

  const tot = sumArr(modes.map(m => a.decWts[`${lvl}_${m}_wt`]));
  const drawn = Math.random() * tot;
  let run = 0;
  for (var i = 0; i < modes.length; i++) {
    run += a.decWts[`${lvl}_${modes[i]}_wt`];
    if (run >= drawn) return modes[i];
  }
}

function canPickMode(a, m) {
  return canPickModeFnDict[m](a);
}

decideMode(a) {
  let rv = decideForcePriotMode('max');
  if (rv) return rv;
  rv = decideForcePriotMode('mid');
  if (rv) return rv;
  const modes = freeModes.concat(forcePriots);
  return pickFromModes(modes);
}