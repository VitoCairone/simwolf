#!/usr/bin/env node
// A long run of the sim in plain Node, nothing drawn (no browser, no animat.js), logging
// births, deaths, wolves and numbers to a JSON-lines file, and letting you look into the
// sim while it runs (--socket). See tools/README.md.
//
//   node tools/ecorun.js [--hours 30] [--seed 1] [--out eco.jsonl] [--start '{"wolves":4}'] [--socket eco.sock]

const fs = require("fs"), path = require("path"), net = require("net"), repl = require("repl");

const args = { hours: 30, seed: 1, out: "eco.jsonl", start: null, socket: null };
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, "");
  if (!(k in args)) { process.stderr.write(`unknown option ${process.argv[i]}\n`); process.exit(1); }
  args[k] = process.argv[i + 1];
}
if (args.start) global.simStart = JSON.parse(args.start);

// the same run for the same seed
let s = +args.seed * 7919 + 13;
Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const say = process.stdout.write.bind(process.stdout);
console.log = console.info = console.warn = () => {}; // (the sim's own chatter)

const ROOT = path.join(__dirname, "..");
global.hydrology = require(ROOT + "/hydrology.js");
const sim = require(ROOT + "/sim.js"); global.sim = sim;
const senses = require(ROOT + "/senses.js"); global.senses = senses;
const mind = require(ROOT + "/mind.js"); global.mind = mind;
sim.init(); senses.attach(sim); mind.attach(sim, senses);
const S = sim.internals, ticksPerMin = Math.round(60 / sim.tempo), endMin = Math.round(+args.hours * 60), t0 = Date.now();

const out = fs.openSync(args.out, "w");
const w = o => fs.writeSync(out, JSON.stringify(o) + "\n");

const live = () => sim.allCritters.filter(a => sim.isLiveCritter(a));
const deer = () => live().filter(a => a.species === "deer");
const wolves = () => live().filter(a => a.species === "wolf");
const stageOf = a => ["mate", "hunt", "wean", "walk"].find(st => sim.can(a, st)) || "newborn";
const meatKg = c => c.carcass ? Object.values(c.carcass.pieces).reduce((t, p) =>
  t + Object.entries(p).reduce((u, [k, v]) => u + (k.endsWith("Kg") ? v : 0), 0), 0) : 0;
const r2 = x => +(+x).toFixed(2);

const known = new Set(sim.allCritters.map(a => a.uid)), dead = new Set(), corpseMeat = new Map();
let min = 0;

// One game minute's logging.
function log() {
  for (const a of sim.allCritters) if (!known.has(a.uid)) {
    known.add(a.uid);
    w({ t: "birth", min, sp: a.species, gen: a.generation, uid: a.uid, mother: a.parentUids[0] });
  }
  for (const k of sim.allCorpses) if (!dead.has(k.uid)) {
    dead.add(k.uid);
    if (k.morsel) continue; // (a leg torn off, not a death)
    const mother = S.critterByUid.get(k.parentUids[0]);
    w({ t: "death", min, sp: k.species, gen: k.generation, uid: k.uid, of: k.diedOf, stage: stageOf(k),
      ageMin: r2(((k.deathTime ?? 0) - k.birthTime) / 60), food: r2(k.food), water: r2(k.water),
      mode: mind.stateOf(k)?.mode, at: [Math.round(k.gx), Math.round(k.gy)],
      mother: k.parentUids[0], motherAlive: !!mother && sim.isLiveCritter(mother) });
  }
  // carcasses rotted away, and the meat left on them
  const now = new Set();
  for (const k of sim.allCorpses) if (k.species === "deer") { now.add(k.uid); corpseMeat.set(k.uid, [meatKg(k), k.morsel]); }
  for (const [uid, [kg, morsel]] of corpseMeat) if (!now.has(uid)) {
    w({ t: "gone", min, uid, leftKg: r2(kg), leg: !!morsel }); corpseMeat.delete(uid);
  }
  if (min % 2 === 0) for (const a of wolves()) {
    w({ t: "wolf", min, uid: a.uid, gen: a.generation, stage: stageOf(a), male: a.isMale, mate: a.mateUid,
      pregnant: !!a.pregnancy, food: r2(a.food), mode: mind.stateOf(a)?.mode, carrying: !!a.carrying,
      at: [Math.round(a.gx), Math.round(a.gy)] });
  }
  if (min % 10 === 0) {
    const by = {};
    for (const a of live()) { const k = `${a.species} g${a.generation} ${stageOf(a)}`; by[k] = (by[k] || 0) + 1; }
    const ws = wolves(), ds = deer(), avg = (xs, f) => r2(xs.reduce((t, a) => t + f(a), 0) / Math.max(1, xs.length));
    const wallS = Math.round((Date.now() - t0) / 1000);
    w({ t: "pop", min, wolves: ws.length, deer: ds.length, by,
      pregnant: { wolf: ws.filter(a => a.pregnancy).length, deer: ds.filter(a => a.pregnancy).length },
      food: { wolf: avg(ws, a => a.food), deer: avg(ds, a => a.food) }, wallS });
    say(`game ${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}  wolves ${ws.length}  deer ${ds.length}` +
      `  newest gen: wolf ${Math.max(0, ...ws.map(a => a.generation))}, deer ${Math.max(0, ...ds.map(a => a.generation))}` +
      `  (${min ? (wallS / min).toFixed(0) : "-"} s per game minute)\n`);
  }
}

// Looking in while it runs: a Node prompt over a Unix socket, with the sim at hand.
let server = null;
if (args.socket) {
  if (fs.existsSync(args.socket)) {
    if (!fs.statSync(args.socket).isSocket()) { process.stderr.write(`${args.socket} is not a socket\n`); process.exit(1); }
    fs.unlinkSync(args.socket); // (one left by a run that ended)
  }
  server = net.createServer(sock => {
    const r = repl.start({ prompt: "sim> ", input: sock, output: sock, terminal: false, useGlobal: false });
    Object.assign(r.context, { sim, S, mind, senses, live, deer, wolves, stageOf, gameMin: () => min });
    r.on("exit", () => sock.end());
    sock.on("error", () => {});
  }).listen(args.socket);
}

function finish() {
  w({ t: "end", min, wallS: Math.round((Date.now() - t0) / 1000) });
  fs.closeSync(out);
  if (server) { server.close(); try { fs.unlinkSync(args.socket); } catch {} }
  process.exit(0);
}
process.on("SIGINT", finish);

// A game minute at a time, letting the prompt in between.
function step() {
  for (let n = 0; n < ticksPerMin; n++) S.tick();
  min++;
  log();
  if (min >= endMin) finish(); else setImmediate(step);
}
log();
setImmediate(step);
