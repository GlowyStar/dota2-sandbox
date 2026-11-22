// Seeded RNG (sfc32) + pseudo-random distribution (PRD) constants.

export class Rng {
  constructor(seed = 1) { this.seed(seed); }
  seed(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    // splitmix-style scramble into four words
    const next = () => { s = (s + 0x9e3779b9) | 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b); z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35); return (z ^ (z >>> 16)) >>> 0; };
    this.a = next(); this.b = next(); this.c = next(); this.d = 1;
    for (let i = 0; i < 12; i++) this.u32();
  }
  u32() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }
  next() { return this.u32() / 4294967296; }          // [0,1)
  range(lo, hi) { return lo + (hi - lo) * this.next(); }
  int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); } // inclusive
  chance(p) { return this.next() < p; }
}

// PRD: probability on the N-th attempt since the last success is C*N. Solve C for a nominal chance p.
function prdAverage(c) {
  let pOnN = 0; let pByN = 0; let sum = 0;
  const maxFails = Math.ceil(1 / c);
  for (let n = 1; n <= maxFails; n++) {
    pOnN = Math.min(1, n * c) * (1 - pByN);
    pByN += pOnN;
    sum += n * pOnN;
  }
  return 1 / sum;
}
function solvePrdC(p) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let hi = p; let lo = 0; let mid = 0; let last = 1;
  for (let i = 0; i < 60; i++) {
    mid = (hi + lo) / 2;
    const avg = prdAverage(mid);
    if (Math.abs(avg - last) <= 1e-12) break;
    if (avg > p) hi = mid; else lo = mid;
    last = avg;
  }
  return mid;
}
const PRD_MEMO = new Map();

export function prdC(chancePct) {
  if (chancePct <= 0) return 0;
  if (chancePct >= 100) return 1;
  const key = Math.round(chancePct * 100); // 0.01% resolution
  let c = PRD_MEMO.get(key);
  if (c === undefined) {
    const p = key / 10000;
    c = p < 0.005 ? p * p * 0.8 : solvePrdC(p); // tiny chances: closed-form approximation keeps startup instant
    PRD_MEMO.set(key, c);
  }
  return c;
}
