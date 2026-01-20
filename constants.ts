
export const GRAVITY = 0.15;
export const FRICTION = 0.99;
export const PLAYER_RADIUS = 12;
export const TILE_SIZE = 100; // Size of the grid for procedural generation
export const CHUNK_SIZE = 8; // Tiles per chunk (800x800 pixels)

export const AI_SPAWN_INTERVAL = 1500; // ms
export const AI_OBSTACLE_LIFETIME = 4000; // ms
export const GAME_DURATION = 300000; // 5 minutes in ms

export const SHIELD_DURATION = 500; // 0.5 seconds
export const SHIELD_COOLDOWN = 5000; // 5 seconds

// Zone Radii (1 meter approx 10 units based on UI scale)
export const ZONE_DEVIL_RADIUS = 3000; // 300m
export const ZONE_RESTRICTED_RADIUS = 1000; // 100m

export const COLORS = {
  background: '#0f172a',
  player: '#38bdf8', // Sky 400
  wall: '#334155',   // Slate 700
  bumper: '#f472b6', // Pink 400
  orb: '#fbbf24',    // Amber 400
  accelerator: '#4ade80', // Green 400
  goal: '#e879f9',    // Fuchsia 400
  aiWall: '#ef4444',  // Red 500
  trail: 'rgba(56, 189, 248, 0.2)',
  shield: '#22d3ee',  // Cyan 400
};

export const PARTICLE_COLORS = [
  '#f472b6', '#c084fc', '#38bdf8', '#fbbf24', '#e879f9'
];
