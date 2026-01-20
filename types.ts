
export interface Vector {
  x: number;
  y: number;
}

export enum EntityType {
  PLAYER = 'PLAYER',
  WALL = 'WALL',
  BUMPER = 'BUMPER',
  ORB = 'ORB', // Collectible
  ACCELERATOR = 'ACCELERATOR',
  GOAL = 'GOAL',
  BEAM = 'BEAM', // Replaces PROJECTILE
}

export enum Difficulty {
  NORMAL = 'NORMAL',
  HARD = 'HARD'
}

export interface Entity {
  id: string;
  type: EntityType;
  pos: Vector;
  vel: Vector;
  radius: number;
  width?: number; // For rectangles
  height?: number; // For rectangles
  rotation: number;
  color: string;
  mass: number;
  restitution: number; // Bounciness 0-1+
  static: boolean;
  health?: number;
  maxHealth?: number;
  // AI Specific
  isAiGenerated?: boolean;
  expiresAt?: number;
  isHit?: boolean; // Visual state for being hit
  // Beam Specific
  beamEnd?: Vector;
  activationTime?: number; // Time when beam becomes lethal
  hasFired?: boolean; // Track if beam fire sound played
  // Cleanup protection
  persistent?: boolean;
}

export interface Particle {
  id: string;
  pos: Vector;
  vel: Vector;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface GameState {
  player: Entity;
  entities: Entity[];
  particles: Particle[];
  score: number;
  combo: number;
  lastHitTime: number;
  paused: boolean;
  pauseStartTime?: number; // Add pauseStartTime
  won: boolean;
  lost: boolean; // Add lost state
  startTime: number; // Add start time
  lastAiSpawnTime: number;
  difficulty: Difficulty;
  // Shield State
  shieldActive: boolean;
  shieldExpiresAt: number;
  shieldCooldownEndsAt: number;
  shieldBlockTime: number;
  // Ability State
  braking: boolean;
  brakeEndTime: number;
}
