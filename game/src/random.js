// A small seeded random number generator (mulberry32) with the helpers the world builder and the
// simulation use. The same seed always gives the same city and the same traffic, which is what
// makes ?seed=N and the screenshot scenes repeatable. Nothing in the game calls Math.random.

/** A generator for `seed`: call .next() for a float in [0, 1), or use the helpers. */
export function createRandom(seed) {
  let a = seed | 0;
  function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    /** A float in [min, max). */
    range(min, max) {
      return min + (max - min) * next();
    },
    /** An integer in [min, max] (both ends included). */
    int(min, max) {
      return min + Math.floor((max - min + 1) * next());
    },
    /** One element of a non-empty array. */
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    /** True with probability `p`. */
    chance(p) {
      return next() < p;
    },
    /** A new generator whose stream depends on this one's seed and `salt`, without disturbing this stream. */
    fork(salt) {
      return createRandom(hashNumbers(seed, salt));
    },
  };
}

/** Mixes integers into one 32-bit seed (for per-building or per-system streams). */
export function hashNumbers(...values) {
  let h = 0x811c9dc5;
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), 0x01000193);
    h ^= h >>> 13;
  }
  return h >>> 0;
}
