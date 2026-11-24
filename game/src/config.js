// Every tuning constant and colour in one place: the city's measurements, the camera, the feel of
// walking and driving, traffic and crowd sizes, and the golden-hour palette of Port Azura.
// Distances are world pixels, speeds are pixels per second, times are seconds.

/** The fixed simulation step. */
export const STEP = 1 / 60;
/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
export const MAX_FRAME = 0.25;

export const WORLD = { width: 3840, height: 2560 };

/**
 * The road grid: vertical avenues and horizontal streets every `spacing` pixels, centred at
 * firstCenter + k * spacing. Each road carries one lane each way (right-hand traffic) plus a
 * parking strip along each curb.
 */
export const ROAD = {
  spacing: 416,
  width: 96,
  firstCenter: 208,
  columns: 8, // vertical avenues
  rows: 6, // horizontal streets
  laneOffset: 18, // lane centre from road centre
  parkOffset: 38, // parked-car centre from road centre
  sidewalk: 16, // sidewalk ring around each block
  crosswalk: 16,
};

/** The coast: beach sand east of sandX, open water east of waterX, the docks south of docksY, the quay edge at quayY. */
export const SHORE = { sandX: 3328, waterX: 3648, docksY: 2336, quayY: 2480 };

/** Palm Park fills these grid blocks (north-centre). */
export const PARK_BLOCKS = [
  { col: 3, row: 0 },
  { col: 4, row: 0 },
];
/** The Repaint & Repair garage sits in this block (west). */
export const GARAGE_BLOCK = { col: 0, row: 2 };

/** The static ground is drawn once into square chunks of this many world pixels and reused. */
export const CHUNK = 512;
export const CHUNK_CACHE = 36;

export const VIEW = {
  worldHeight: 860, // world pixels visible top to bottom at zoom 1
  footZoom: 1.2,
  driveZoom: 1,
  fastZoom: 0.78, // at top speed the camera pulls back to here
  titleZoom: 0.82,
  maxDpr: 1.5,
};

export const CAMERA = {
  follow: 4.2, // how quickly the camera closes on its target (per second, exponential)
  lookDrive: 0.5, // seconds of velocity the camera leads by when driving
  lookMax: 260,
  lookMouse: 0.18, // fraction of the mouse's offset from screen centre the camera leans toward on foot
  zoomRate: 1.4,
  orbitRadius: 520,
  orbitSpeed: 0.045, // radians per second on the title screen
  orbitCenter: { x: 1880, y: 1180 },
};

/** Sun low in the west-north-west: shadows fall to the south-east, longer for taller buildings. */
export const LIGHT = { shadowX: 0.84, shadowY: 0.54, shadowPerFloor: 6.5 };

export const PLAYER = {
  radius: 7,
  walk: 92,
  sprint: 170,
  accel: 900,
  enterRange: 40, // how far from a car's side the player can climb in
};

/** Physics shared by every car; per-model values below scale it. */
export const CAR = {
  roll: 40, // rolling resistance with no throttle
  drag: 0.32, // speed-proportional drag
  handbrakeDecel: 220,
  steerResponse: 7, // how fast the wheel turns toward the input
  yawResponse: 10,
  gripConvert: 0.35, // share of the lateral speed grip turns into forward speed (keeps cornering lively)
  skidLateral: 75, // sideways speed above which the tyres skid
  impactDamage: 150, // impact speed above which collisions dent the car
  restitution: 0.25,
  wallFriction: 0.9,
  offroadDrag: 0.9, // extra drag on grass and sand
  offroadGrip: 0.6,
  maxDamage: 100,
  playerCrashScale: 0.6, // share of crash damage the player's own car takes
};

export const CAR_MODELS = {
  compact: { name: 'Pipit', length: 36, width: 18, top: 330, accel: 300, brake: 560, turn: 2.9, grip: 11, gripDrift: 1.8, mass: 0.9, fragility: 0.22, colors: ['#e8b04a', '#7fc8c2', '#e7745d', '#c9d6df', '#9d7fd0'] },
  sedan: { name: 'Corsa Vista', length: 42, width: 19, top: 380, accel: 330, brake: 600, turn: 2.6, grip: 11, gripDrift: 1.6, mass: 1.1, fragility: 0.18, colors: ['#3e6e9e', '#b8423d', '#f0ead8', '#2f3a40', '#6f9a6a', '#c98a5a'] },
  taxi: { name: 'Azura Cab', length: 42, width: 19, top: 370, accel: 320, brake: 600, turn: 2.6, grip: 11, gripDrift: 1.6, mass: 1.1, fragility: 0.18, colors: ['#f2c230'] },
  van: { name: 'Pelican Van', length: 50, width: 22, top: 290, accel: 230, brake: 480, turn: 2.1, grip: 10, gripDrift: 1.4, mass: 1.6, fragility: 0.12, colors: ['#f2efe6', '#8aa7b8', '#d9a066', '#6b8f71'] },
  sports: { name: 'Marlin GT', length: 42, width: 19, top: 520, accel: 470, brake: 720, turn: 2.8, grip: 12, gripDrift: 1.9, mass: 0.95, fragility: 0.24, colors: ['#e2434b', '#ff8a3d', '#2fb5a8', '#f4f1e8', '#1d2731'] },
  // Never in ordinary traffic (not in MODEL_WEIGHTS): police.js spawns these, with a per-car copy of the spec tuned to the wanted level.
  police: { name: 'Azura PD Cruiser', length: 42, width: 19, top: 400, accel: 380, brake: 680, turn: 2.75, grip: 12, gripDrift: 1.7, mass: 1.25, fragility: 0.1, colors: ['#f4f1e8'] },
};
/** How often each model shows up in traffic and at the curb. */
export const MODEL_WEIGHTS = [
  ['compact', 3],
  ['sedan', 4],
  ['taxi', 1.5],
  ['van', 1.5],
  ['sports', 0.8],
];

export const TRAFFIC = {
  count: 24, // AI cars kept near the camera
  cruise: 150,
  turnSpeed: 72,
  spawnMargin: 140, // spawn just outside the view...
  spawnBand: 560, // ...but no further out than this
  despawnMargin: 900,
  followGap: 40, // bumper gap they stop at
  stuckPatience: 2.5,
  maxAbandoned: 12, // cars the player left behind that are kept around
  parkedChance: 0.32,
};

export const PEDS = {
  count: 48,
  radius: 5,
  walkMin: 26,
  walkMax: 44,
  flee: 125,
  fleeTime: 2.6,
  dangerRadius: 120,
  dangerSpeed: 210, // ordinary traffic (~150) does not scare anyone; a speeding car does
  spawnMargin: 80,
  spawnBand: 480,
  despawnMargin: 700,
};

export const EFFECTS = { maxSkids: 900, skidLife: 14, maxSmoke: 220 };

/** The wanted system and the police (police.js). */
export const POLICE = {
  maxStars: 5,
  carsByStars: [0, 1, 2, 3, 4, 6],
  topBoost: 0.06, // each star adds this share to a cruiser's top speed and acceleration
  fiveStarBoost: 0.08, // and five stars a little more on top
  spawnMin: 120, // spawn this far outside the view at least...
  spawnMax: 650, // ...and no further than this
  spawnEvery: 1.4, // seconds between new cruisers while short of the count
  sight: 560, // a cruiser sees the player this far, if no building is in the way (more per star)
  sightPerStar: 40,
  layLow: 7, // seconds unseen before a star drops (plus layLowPerStar per star held)
  layLowPerStar: 1.2,
  bustRange: 62, // a cruiser this close (centre to centre) to a stopped player fills the BUSTED meter
  bustTime: 2.5,
  bustDrain: 1.4, // how much faster the meter drains than it fills
  bustStillSpeed: 26, // a car slower than this counts as stopped
  ramRange: 260, // inside this, with a clear line, a cruiser drives straight at the player
  gunfireThrottle: 8, // seconds between +1 stars for shooting in public
  witnessRange: 200, // pedestrians this close (with a clear line) see a car being stolen
  policeWitnessRange: 380,
  bustFine: 250,
  station: { x: 1097, y: 1097 }, // the police station corner (sidewalk at the Midtown crossing), where the busted respawn
};

/** On-foot gunplay (combat.js). */
export const WEAPON = {
  name: 'Pistol',
  magazine: 12,
  rate: 6, // shots per second while the button is held
  reload: 1.1,
  range: 520,
  spread: 0.035, // radians either side
  carDamage: 6.5,
  muzzle: 9, // the muzzle sits this far in front of Jett
  publicRange: 360, // a shot with a pedestrian or cruiser this close is "in public"
};

/** Car fires, explosions and what they do to whoever is near. */
export const BLAST = {
  fireAt: 82, // car damage at which the engine catches fire...
  burnRate: 7, // ...and keeps burning this much damage per second until it blows
  radius: 120,
  carDamage: 55, // at the centre, falling off to nothing at the radius
  playerDamage: 70,
  push: 320,
  shake: 9,
};

/** Jett's health. */
export const HEALTH = {
  max: 100,
  crashThreshold: 230, // impact speed above which a crash at the wheel hurts
  crashScale: 0.07,
  runOverSpeed: 110, // a car moving at least this fast hurts someone on foot
  runOverScale: 0.09,
  regenDelay: 4, // seconds after the last hurt before health creeps back (only while wanted is 0)
  regenRate: 3, // per second
  wastedFine: 200,
  hospital: { x: 2344, y: 680 }, // the hospital corner (sidewalk), where the wasted respawn
};

/** The Repaint & Repair respray: drive onto the apron, stop, pay, and the car is fixed and the heat is gone. */
export const RESPRAY = { cost: 150, stopSpeed: 30 };

/**
 * Named places the story and the courier jobs use. Road points are on the asphalt of the grid
 * (centres at 208 + 416k), marina points on the open yard and sand at the south-east corner.
 */
export const PLACES = {
  marinaCafe: { x: 3250, y: 2405, name: 'Marina Café' },
  plaza: { x: 1664, y: 642, name: 'Palm Park plaza' },
  beachHotel: { x: 3138, y: 880, name: 'Beach Hotel' },
  docks: { x: 1880, y: 2300, name: 'Harbor Docks' },
  warehouse: { x: 2620, y: 2300, name: 'the old warehouse' },
  downtown: { x: 1872, y: 1474, name: 'Downtown' },
  marina: { x: 3440, y: 2420, name: 'the marina' },
  ferryPier: { x: 3605, y: 2448, name: 'the ferry pier' },
};

/** Courier jobs: reward = base + perPixel * distance; time = distance / pace + slack. */
export const JOBS = { base: 60, perPixel: 0.11, pace: 210, slack: 14, minDistance: 900, radius: 42 };

export const SAVE_KEY = 'neon-harbor-nights-save-v1';

/** The golden-hour palette: warm asphalt, cream markings, pastel rooftops, teal water, pale sand. */
export const COLORS = {
  background: '#2a1d24',
  asphalt: '#625853',
  asphaltDark: '#574e4a',
  asphaltPatch: '#6b615b',
  marking: '#f4e7c6',
  centerLine: '#f2cf6b',
  curb: '#e2d4ba',
  sidewalk: '#cdbda3',
  sidewalkJoint: 'rgba(120,100,80,0.18)',
  lot: '#d9c7a7',
  alley: '#b9a78d',
  parking: '#6a605a',
  grass: '#96b766',
  grassDark: '#86a85a',
  path: '#e7d6b0',
  sand: '#f0dcaa',
  sandWet: '#d9c48f',
  water: '#3cb1b3',
  waterDeep: '#2a8e9e',
  foam: 'rgba(255,250,235,0.85)',
  boardwalk: '#c99e6e',
  boardwalkLine: 'rgba(110,70,40,0.25)',
  yard: '#b3aa9c',
  yardLine: 'rgba(255,240,200,0.55)',
  quay: '#8f877b',
  shadow: 'rgba(72,38,92,0.30)',
  entityShadow: 'rgba(60,30,70,0.32)',
  roofs: ['#f4b6a6', '#f7d59c', '#b9dcc9', '#a9cfe6', '#d8b9e6', '#f2a7bb', '#f6e7c8', '#c4e3a5', '#f9c98f', '#e8d0b0'],
  roofTrim: 'rgba(255,255,255,0.35)',
  roofEdge: 'rgba(80,50,60,0.35)',
  neon: ['#ff4fa3', '#3ff0ff', '#ffd23f', '#a879ff', '#59ff8a', '#ff7b3f'],
  containers: ['#c8553d', '#2f6690', '#3a7d7c', '#e0a526', '#5b8c51', '#b54f73', '#d9774a'],
  crane: '#e8a33d',
  craneDark: '#9c6a25',
  warehouse: ['#b9c3c8', '#c9b9a0', '#a7b8a8'],
  palmTrunk: '#9a7650',
  palmLeaf: '#4f9a5a',
  palmLeafLight: '#78bf6a',
  lamp: '#3b3a3f',
  lampGlow: 'rgba(255,220,150,0.9)',
  skin: ['#f1c7a3', '#d9a07a', '#b97a52', '#8a5536', '#5e3a24', '#f5d6bd'],
  hair: ['#2b1d16', '#4a2f1d', '#7a4b26', '#c99a52', '#e7d2a1', '#1b1b1f', '#8e3b2b'],
  shirts: ['#ff6f61', '#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#f78c6b', '#9b5de5', '#f15bb5', '#fee440', '#00bbf9', '#ffffff', '#83c5be'],
  pants: ['#2e3a59', '#44403c', '#6b5b4e', '#d6c7a1', '#1f2937', '#5c6b73'],
  playerJacket: '#22b5a5',
  playerCap: '#ff7a3d',
  vignette: 'rgba(70,24,40,0.55)',
  warmGlaze: 'rgba(255,170,90,0.07)',
  ui: '#fff4dc',
  uiDim: 'rgba(255,244,220,0.72)',
  uiPink: '#ff4fa3',
  uiCyan: '#3ff0ff',
  uiGold: '#ffd23f',
  panel: 'rgba(30,16,32,0.72)',
  uiRed: '#ff4a5a',
  uiGreen: '#59ff8a',
  police: '#f4f1e8',
  policeDark: '#1d2731',
  sirenRed: '#ff2d3d',
  sirenBlue: '#2d7bff',
  rival: '#ff2fd0',
  beacon: '#ffd23f',
  wreck: '#3a3234',
  minimapRoad: '#8a7f76',
  minimapBlock: '#d9c7a7',
  minimapBuilding: '#b59a86',
  minimapWater: '#3cb1b3',
  minimapSand: '#f0dcaa',
  minimapPark: '#96b766',
  minimapYard: '#a49c90',
};

export const NEON_WORDS = ['BAR', 'TACOS', 'MOTEL', 'LIVE', '24H', 'DINER', 'CLUB', 'SURF', 'PAWN', 'NOODLE', 'HOTEL', 'GYM', 'SODA', 'RADIO', 'DANCE', 'PIZZA'];
export const DISTRICT_NAMES = {
  bay: 'Azura Bay',
  beach: 'Sunstrip Beach',
  docks: 'Harbor Docks',
  park: 'Palm Park',
  west: 'Westside',
  midtown: 'Midtown',
  downtown: 'Downtown',
  heights: 'Coral Heights',
};
