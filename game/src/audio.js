// Every sound in the game, synthesised with WebAudio: no files. The context starts on the first
// key press or click (browsers insist on a gesture) and M mutes everything. Continuous voices: the
// engine (a sawtooth and filtered noise whose pitch follows the car's speed, only while driving),
// the two-tone police siren (louder the nearer the closest cruiser), and a quiet synthwave loop
// (a slow Am–F–C–G pad over a soft bass pulse). One-shots: gunshot, reload clicks, dry fire,
// collision thuds, explosions, pickup chime, the success jingle, the fail sting, UI clicks, phone
// blips, the respray hiss and a small startled blip when people scatter.

const MUSIC_TEMPO = 84; // beats per minute
const CHORD_BEATS = 8; // two bars per chord
// Am – F – C – G, as MIDI note numbers (pad voicing; the bass plays the first note two octaves down).
const CHORDS = [
  [57, 60, 64, 69],
  [53, 57, 60, 65],
  [48, 55, 60, 64],
  [55, 59, 62, 67],
];

const midiToHz = (note) => 440 * Math.pow(2, (note - 69) / 12);
const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

export function createAudio() {
  let ctx = null;
  let master = null;
  let sfx = null;
  let music = null;
  let noise = null;
  let engine = null;
  let siren = null;
  let muted = false;
  let nextChordTime = 0;
  let chordIndex = 0;
  let sirenTone = 0;
  const throttles = new Map(); // sound name -> earliest time it may play again

  /** Creates the context and the always-on voices. Safe to call on every gesture; only the first does anything. */
  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    ctx = new AudioContextClass();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);
    // A gentle limiter so a pile-up of explosions does not clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 6;
    limiter.connect(master);
    sfx = ctx.createGain();
    sfx.gain.value = 0.9;
    sfx.connect(limiter);
    music = ctx.createGain();
    music.gain.value = 0.22;
    music.connect(limiter);

    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    // A fixed pseudo-random sequence (the game never calls Math.random).
    let seed = 22695477;
    for (let k = 0; k < data.length; k += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) | 0;
      data[k] = ((seed >>> 8) & 0xffff) / 32768 - 1;
    }

    engine = buildEngine();
    siren = buildSiren();
    nextChordTime = ctx.currentTime + 0.3;
  }

  function noiseSource(loop = false) {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = loop;
    return source;
  }

  function buildEngine() {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 50;
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = 25;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 3;
    const rumble = noiseSource(true);
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'bandpass';
    rumbleFilter.frequency.value = 180;
    rumbleFilter.Q.value = 1.2;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.35;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter);
    sub.connect(filter);
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(filter);
    filter.connect(gain).connect(sfx);
    osc.start();
    sub.start();
    rumble.start();
    return { osc, sub, filter, gain };
  }

  function buildSiren() {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 700;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(sfx);
    osc.start();
    return { osc, gain };
  }

  /** A short enveloped tone: type, start/end frequency, length, peak gain, start delay. */
  function tone(type, from, to, length, peak, delay = 0, destination = sfx) {
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.01, length * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(destination);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  /** A burst of filtered noise: filter type, cutoff (start and end), length, peak gain, start delay. */
  function burst(filterType, from, to, length, peak, delay = 0) {
    const t = ctx.currentTime + delay;
    const source = noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(from, t);
    if (to !== from) filter.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    source.connect(filter).connect(gain).connect(sfx);
    source.start(t, (t * 7.3) % 1.5);
    source.stop(t + length + 0.05);
  }

  /** True (and arms the throttle) when `name` has not played in the last `gap` seconds. */
  function allowed(name, gap) {
    const now = ctx.currentTime;
    if ((throttles.get(name) ?? 0) > now) return false;
    throttles.set(name, now + gap);
    return true;
  }

  const SOUNDS = {
    shot() {
      burst('highpass', 1800, 600, 0.14, 0.55);
      tone('sine', 160, 45, 0.12, 0.5);
    },
    reload() {
      tone('square', 1500, 1300, 0.03, 0.12);
      tone('square', 900, 800, 0.04, 0.1, 0.12);
    },
    reloaded() {
      tone('square', 1100, 1600, 0.04, 0.14);
    },
    dryfire() {
      tone('square', 2200, 2000, 0.02, 0.08);
    },
    impact(strength = 150) {
      if (!allowed('impact', 0.08)) return;
      const loud = clamp((strength - 80) / 300, 0.08, 0.8);
      burst('lowpass', 700, 120, 0.22, loud);
      tone('sine', 90, 40, 0.18, loud * 0.8);
    },
    explosion() {
      burst('lowpass', 1600, 60, 1.6, 1);
      tone('sine', 70, 28, 1.1, 0.9);
      burst('bandpass', 400, 200, 0.6, 0.4, 0.05);
    },
    pickup() {
      tone('sine', 880, 880, 0.12, 0.25);
      tone('sine', 1320, 1320, 0.2, 0.22, 0.09);
    },
    success() {
      [72, 76, 79, 84].forEach((note, k) => tone('triangle', midiToHz(note), midiToHz(note), 0.22, 0.25, k * 0.09));
      burst('highpass', 5000, 3000, 0.25, 0.25, 0.38); // the till drawer
      tone('sine', 2637, 2637, 0.35, 0.18, 0.4);
    },
    fail() {
      [67, 63, 58].forEach((note, k) => tone('sawtooth', midiToHz(note), midiToHz(note) * 0.98, 0.32, 0.16, k * 0.22));
    },
    ui() {
      tone('sine', 1200, 1000, 0.04, 0.12);
    },
    message() {
      tone('sine', 1568, 1568, 0.07, 0.12);
      tone('sine', 2093, 2093, 0.09, 0.12, 0.09);
    },
    respray() {
      burst('highpass', 3000, 6000, 0.9, 0.25);
    },
    scream() {
      if (!allowed('scream', 2.2)) return;
      tone('sine', 900, 1400, 0.12, 0.05);
      tone('sine', 1400, 750, 0.18, 0.04, 0.12);
    },
    busted() {
      SOUNDS.fail();
      tone('square', 650, 650, 0.25, 0.08, 0.1);
      tone('square', 900, 900, 0.25, 0.08, 0.38);
    },
  };

  /** Plays the named one-shot (see SOUNDS). */
  function play(name, value) {
    if (!ctx || muted) return;
    const sound = SOUNDS[name];
    if (sound) sound(value);
  }

  /** Schedules the music a little ahead of time: a pad chord and its bass pulse every two bars. */
  function scheduleMusic() {
    const beat = 60 / MUSIC_TEMPO;
    while (nextChordTime < ctx.currentTime + 0.6) {
      const chord = CHORDS[chordIndex % CHORDS.length];
      const length = CHORD_BEATS * beat;
      const t = nextChordTime;
      const pad = ctx.createBiquadFilter();
      pad.type = 'lowpass';
      pad.frequency.value = 900;
      const padGain = ctx.createGain();
      padGain.gain.setValueAtTime(0.0001, t);
      padGain.gain.exponentialRampToValueAtTime(0.09, t + 0.8);
      padGain.gain.setValueAtTime(0.09, t + length - 0.6);
      padGain.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.4);
      pad.connect(padGain).connect(music);
      for (const note of chord) {
        for (const detune of [-7, 7]) {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = midiToHz(note);
          osc.detune.value = detune;
          osc.connect(pad);
          osc.start(t);
          osc.stop(t + length + 0.5);
        }
      }
      // Soft bass on the eighth notes, root two octaves down, every other one a little quieter.
      const root = midiToHz(chord[0] - 24);
      for (let k = 0; k < CHORD_BEATS * 2; k += 1) {
        const start = t + k * beat * 0.5;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = root;
        const gain = ctx.createGain();
        const peak = k % 2 === 0 ? 0.35 : 0.2;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + beat * 0.45);
        osc.connect(gain).connect(music);
        osc.start(start);
        osc.stop(start + beat * 0.5);
      }
      nextChordTime += length;
      chordIndex += 1;
    }
  }

  /**
   * Once a frame: engine and siren follow the world, the music keeps going. `active` is false on
   * menus and the frozen screens (the engine and siren fall quiet there; the music plays on).
   */
  function update(world, dt, active) {
    if (!ctx) return;
    const now = ctx.currentTime;
    scheduleMusic();
    const player = world.player;
    const driving = active && world.mode === 'play' && player.mode === 'car';
    if (driving) {
      const car = player.car;
      const fraction = clamp(Math.abs(car.speed) / car.spec.top, 0, 1.2);
      const throttle = Math.abs(car.controls.throttle);
      engine.osc.frequency.setTargetAtTime(48 + fraction * 150, now, 0.08);
      engine.sub.frequency.setTargetAtTime(24 + fraction * 75, now, 0.08);
      engine.filter.frequency.setTargetAtTime(320 + fraction * 900 + throttle * 300, now, 0.1);
      engine.gain.gain.setTargetAtTime(0.05 + throttle * 0.05 + fraction * 0.04, now, 0.1);
    } else engine.gain.gain.setTargetAtTime(0, now, 0.15);

    const police = world.police;
    const near = active && world.mode === 'play' && police.cars.length ? clamp(1 - police.nearest / 1100, 0, 1) : 0;
    sirenTone += dt;
    siren.osc.frequency.setTargetAtTime(Math.floor(sirenTone / 0.45) % 2 === 0 ? 660 : 880, now, 0.02);
    siren.gain.gain.setTargetAtTime(near * near * 0.07, now, 0.1);

  }

  return {
    unlock,
    play,
    update,
    get muted() {
      return muted;
    },
    /** M: silence everything (or bring it back). */
    toggleMute() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.05);
      return muted;
    },
  };
}
