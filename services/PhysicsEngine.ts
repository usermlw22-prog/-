import { Entity, EntityType, Particle, Vector, Difficulty } from '../types';
import { GRAVITY, FRICTION, COLORS, PARTICLE_COLORS, AI_OBSTACLE_LIFETIME } from '../constants';

export class PhysicsEngine {
  // Vector Math Helpers
  static vecAdd(v1: Vector, v2: Vector): Vector { return { x: v1.x + v2.x, y: v1.y + v2.y }; }
  static vecSub(v1: Vector, v2: Vector): Vector { return { x: v1.x - v2.x, y: v1.y - v2.y }; }
  static vecMult(v: Vector, s: number): Vector { return { x: v.x * s, y: v.y * s }; }
  static vecDot(v1: Vector, v2: Vector): number { return v1.x * v2.x + v1.y * v2.y; }
  static vecMag(v: Vector): number { return Math.sqrt(v.x * v.x + v.y * v.y); }
  static vecNorm(v: Vector): Vector {
    const mag = this.vecMag(v);
    return mag === 0 ? { x: 0, y: 0 } : { x: v.x / mag, y: v.y / mag };
  }
  static dist(v1: Vector, v2: Vector): number { return this.vecMag(this.vecSub(v1, v2)); }

  // Distance from point p to line segment v-w
  static distToSegment(p: Vector, v: Vector, w: Vector): number {
    const l2 = Math.pow(this.dist(v, w), 2);
    if (l2 === 0) return this.dist(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projection = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
    return this.dist(p, projection);
  }

  // Procedural Generation State
  static generatedChunks: Set<string> = new Set();
  
  // Goal Position Configuration
  static GOAL_POS = { x: 0, y: -10000 }; // Center of chunk 0, -13 approx (1000m distance)

  static spawnAiObstacle(playerPos: Vector, playerVel: Vector, difficulty: Difficulty): Entity[] {
    // 1. Calculate direction to goal
    const toGoal = this.vecSub(this.GOAL_POS, playerPos);
    const distToGoal = this.vecMag(toGoal);
    
    // Don't spawn if too close to goal (would be annoying/glitchy)
    if (distToGoal < 400) return [];

    const dir = this.vecNorm(toGoal);

    // --- Distance Calculation (X = 0.5v) ---
    // Velocity is pixels/frame. 
    // We convert to pixels/second approx by * 60 for the formula to produce meaningful game distances.
    // Formula: Spawn Distance = 0.5 * Velocity(px/s)
    const speedPxPerSec = this.vecMag(playerVel) * 60;
    const formulaDist = speedPxPerSec * 0.5;
    
    // Apply a minimum safety floor (e.g. 350px) so it doesn't spawn on top of player at low speeds
    // But primarily respect the 0.5v scaling at operational speeds.
    const spawnDist = Math.max(350, formulaDist);

    // 2. Base Parameters for Generation
    // We calculate the "Target Area" based on what a Normal mode wall would be.
    // This ensures conservation of mass/area while allowing shape flexibility.
    const normalWidth = 150 + Math.random() * 100;
    const normalThickness = 60;
    const targetArea = normalWidth * normalThickness;
    
    const entities: Entity[] = [];

    if (difficulty === Difficulty.HARD) {
        // Hard Mode: 3 Independent blocks optimized for BLOCKING
        // Strategy: Maximize width perpendicular to player path
        const numBlocks = 3;
        const perpDir = { x: -dir.y, y: dir.x };
        
        // A. Generate Random Proportions - FORCE WIDE SHAPES
        const shapes: {w: number, h: number}[] = [];
        let totalShapeArea = 0;
        
        for (let i = 0; i < numBlocks; i++) {
             // Aspect ratio (w/h) from 3.0 to 8.0 (Very wide barriers)
             // This maximizes the projection on the perpendicular axis
             const aspect = 3.0 + Math.random() * 5.0; 
             
             // Balanced weights so no block is too small
             const weight = 0.8 + Math.random() * 0.4; 
             
             const h = Math.sqrt(weight / aspect); 
             const w = h * aspect; 
             
             shapes.push({w, h});
             totalShapeArea += w * h;
        }

        // B. Global Scale
        const scale = Math.sqrt(targetArea / totalShapeArea);

        // Base Rotation: Perpendicular to the path to maximize blocking area
        const angleRad = Math.atan2(dir.y, dir.x);
        const baseRotationDeg = (angleRad * 180 / Math.PI) + 90;

        for (let i = 0; i < numBlocks; i++) {
             const finalW = shapes[i].w * scale;
             const finalH = shapes[i].h * scale;

             // C. Positioning
             // Tight forward grouping to form a single "wall" layer
             const forwardDist = 400 + Math.random() * 60; 
             
             // Lateral Spread: Wide enough to cover the screen width mostly
             // Spread range 200 means +/- 200 lateral offset (400 total width range)
             const spreadRange = 200; 
             const lateralOffset = (Math.random() - 0.5) * 2 * spreadRange;

             const anchorPos = this.vecAdd(playerPos, this.vecMult(dir, forwardDist));
             const pos = this.vecAdd(anchorPos, this.vecMult(perpDir, lateralOffset));

             // D. Rotation
             // Constrained rotation: Roughly perpendicular +/- 45 degrees
             // This prevents them from turning sideways and becoming thin pillars
             const rotationJitter = (Math.random() - 0.5) * 90;
             const rotation = baseRotationDeg + rotationJitter;

             entities.push({
                id: `ai_${Date.now()}_${i}_${Math.random()}`,
                type: EntityType.WALL,
                pos: pos,
                vel: { x: 0, y: 0 },
                radius: 0,
                width: finalW,
                height: finalH,
                rotation: rotation,
                color: COLORS.aiWall,
                mass: Infinity,
                restitution: 1.3, // Extra bounce for chaos
                static: true,
                isAiGenerated: true,
                expiresAt: Date.now() + AI_OBSTACLE_LIFETIME
             });
        }
    } else {
        // Normal Mode: Single massive block directly ahead
        const finalDist = spawnDist + (Math.random() * 100 - 50); 
        const centerPos = this.vecAdd(playerPos, this.vecMult(dir, finalDist));

        // Predictable alignment (perpendicular to path)
        const angleRad = Math.atan2(dir.y, dir.x);
        const baseRotationRad = angleRad + Math.PI / 2;
        const randomTilt = (Math.random() - 0.5) * 0.5; 
        const rotation = (baseRotationRad + randomTilt) * (180 / Math.PI);

        entities.push({
            id: `ai_${Date.now()}_${Math.random()}`,
            type: EntityType.WALL,
            pos: centerPos,
            vel: { x: 0, y: 0 },
            radius: 0,
            width: normalWidth,
            height: normalThickness,
            rotation: rotation,
            color: COLORS.aiWall,
            mass: Infinity,
            restitution: 1.2, 
            static: true,
            isAiGenerated: true,
            expiresAt: Date.now() + AI_OBSTACLE_LIFETIME
        });
    }

    return entities;
  }

  static generateChunk(chunkX: number, chunkY: number, chunkSize: number): Entity[] {
    const key = `${chunkX},${chunkY}`;
    if (this.generatedChunks.has(key)) return [];
    this.generatedChunks.add(key);

    const entities: Entity[] = [];
    const baseX = chunkX * chunkSize;
    const baseY = chunkY * chunkSize;

    // Special Case: Goal Chunk (0, -13) -> centered around y=-10000
    // Generate goal entities, but DO NOT return early so we still get terrain
    if (chunkX === 0 && chunkY === -13) {
       // Clear area for goal
       entities.push({
          id: 'FINAL_GOAL',
          type: EntityType.GOAL,
          pos: { ...this.GOAL_POS },
          vel: { x: 0, y: 0 },
          radius: 80,
          rotation: 0,
          color: COLORS.goal,
          mass: Infinity,
          restitution: 0,
          static: true,
          persistent: true // Never delete
       });
       
       // Decorative pillars around goal
       [-150, 150].forEach((offset, i) => {
          entities.push({
            id: `goal_pillar_${i}`,
            type: EntityType.WALL,
            pos: { x: this.GOAL_POS.x + offset, y: this.GOAL_POS.y + 100 },
            vel: { x: 0, y: 0 },
            radius: 0,
            width: 40,
            height: 200,
            rotation: 0,
            color: COLORS.wall,
            mass: Infinity,
            restitution: 0.5,
            static: true,
            persistent: true // Never delete
          });
       });
    }

    // Standard Procedural Generation
    const seed = Math.abs(Math.sin(chunkX * 12.9898 + chunkY * 78.233) * 43758.5453);
    // Reverted base count from +3 back to +2
    const count = Math.floor((seed % 1) * 5) + 2; 

    for (let i = 0; i < count; i++) {
      const subSeed = Math.abs(Math.sin(i * 12.9898 + seed) * 43758.5453);
      const typeVal = subSeed % 1;
      
      const posX = baseX + (subSeed * 1000) % chunkSize;
      const posY = baseY + ((subSeed * 10000) % chunkSize);

      // Don't spawn too close to 0,0 (start) or goal
      if (Math.abs(posX) < 300 && Math.abs(posY) < 300) continue;
      if (this.dist({x: posX, y: posY}, this.GOAL_POS) < 300) continue;

      let type = EntityType.WALL;
      let width = 50 + (subSeed * 100) % 150;
      let height = 20;
      let color = COLORS.wall;
      let restitution = 0.8;
      let radius = 0;

      if (typeVal > 0.8) {
        type = EntityType.BUMPER;
        radius = 20 + (subSeed * 100) % 20;
        width = 0; height = 0;
        color = COLORS.bumper;
        restitution = 1.8;
      } else if (typeVal > 0.6) {
        type = EntityType.ORB;
        radius = 15;
        width = 0; height = 0;
        color = COLORS.orb;
        restitution = 0;
      } else if (typeVal > 0.5) {
        type = EntityType.ACCELERATOR;
        width = 80;
        height = 80;
        color = COLORS.accelerator;
        restitution = 1.0;
      }

      entities.push({
        id: `ent_${chunkX}_${chunkY}_${i}`,
        type,
        pos: { x: posX, y: posY },
        vel: { x: 0, y: 0 },
        radius,
        width,
        height,
        rotation: (subSeed * 360) % 360,
        color,
        mass: type === EntityType.WALL ? Infinity : 10,
        restitution,
        static: true,
      });
    }

    return entities;
  }

  static updatePhysics(
    player: Entity, 
    entities: Entity[], 
    dt: number
  ): { 
    player: Entity, 
    collisions: { entity: Entity, force: number }[],
    collected: string[],
    won: boolean
  } {
    const collisions: { entity: Entity, force: number }[] = [];
    const collected: string[] = [];
    let won = false;

    // Apply gravity
    player.vel.y += GRAVITY * dt;
    
    // Scale friction correctly with dt
    player.vel = this.vecMult(player.vel, Math.pow(FRICTION, dt));

    // Predict next position
    const nextPos = this.vecAdd(player.pos, this.vecMult(player.vel, dt));

    // Resolve Collisions
    for (const entity of entities) {
      // Beams are handled outside in GameCanvas update for specific logic
      if (entity.type === EntityType.BEAM) continue; 

      if (entity.type === EntityType.GOAL) {
          const dist = this.dist(nextPos, entity.pos);
          if (dist < entity.radius) { // Simple overlap check
              won = true;
          }
          continue;
      }

      if (entity.type === EntityType.ORB) {
         const dist = this.dist(nextPos, entity.pos);
         if (dist < player.radius + entity.radius) {
            collected.push(entity.id);
         }
         continue;
      }

      if (entity.type === EntityType.BUMPER) {
        const dist = this.dist(nextPos, entity.pos);
        const minDist = player.radius + entity.radius;

        if (dist < minDist) {
          const normal = this.vecNorm(this.vecSub(nextPos, entity.pos));
          const penetration = minDist - dist;
          nextPos.x += normal.x * penetration;
          nextPos.y += normal.y * penetration;

          const relVel = this.vecSub(player.vel, entity.vel);
          const velAlongNormal = this.vecDot(relVel, normal);

          if (velAlongNormal < 0) {
             const j = -(1 + entity.restitution) * velAlongNormal;
             const impulse = this.vecMult(normal, j);
             player.vel = this.vecAdd(player.vel, impulse);
             collisions.push({ entity, force: j });
          }
        }
      } else if (entity.type === EntityType.WALL || entity.type === EntityType.ACCELERATOR) {
        const rad = -entity.rotation * (Math.PI / 180);
        const localX = Math.cos(rad) * (nextPos.x - entity.pos.x) - Math.sin(rad) * (nextPos.y - entity.pos.y);
        const localY = Math.sin(rad) * (nextPos.x - entity.pos.x) + Math.cos(rad) * (nextPos.y - entity.pos.y);

        const closestX = Math.max(-entity.width! / 2, Math.min(localX, entity.width! / 2));
        const closestY = Math.max(-entity.height! / 2, Math.min(localY, entity.height! / 2));

        const distX = localX - closestX;
        const distY = localY - closestY;
        const distanceSquared = distX * distX + distY * distY;

        if (distanceSquared < player.radius * player.radius) {
          const dist = Math.sqrt(distanceSquared);
          
          let localNormal = { x: 0, y: 0 };
          if (dist === 0) {
              localNormal = { x: 0, y: -1 };
          } else {
             localNormal = { x: distX / dist, y: distY / dist };
          }

          const worldNormal = {
            x: Math.cos(-rad) * localNormal.x - Math.sin(-rad) * localNormal.y,
            y: Math.sin(-rad) * localNormal.x + Math.cos(-rad) * localNormal.y,
          };

          const penetration = player.radius - dist;
          nextPos.x += worldNormal.x * penetration;
          nextPos.y += worldNormal.y * penetration;

          const velAlongNormal = this.vecDot(player.vel, worldNormal);
          if (velAlongNormal < 0) {
             let restitution = entity.restitution;
             if (entity.type === EntityType.ACCELERATOR) restitution = 2.5; 
             
             const j = -(1 + restitution) * velAlongNormal;
             const impulse = this.vecMult(worldNormal, j);
             player.vel = this.vecAdd(player.vel, impulse);
             collisions.push({ entity, force: j });
          }
        }
      }
    }

    player.pos = nextPos;
    return { player, collisions, collected, won };
  }

  static createExplosion(pos: Vector, count: number, color: string): Particle[] {
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 5 + 2;
      particles.push({
        id: Math.random().toString(36),
        pos: { ...pos },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        life: 1.0,
        maxLife: 1.0,
        color: color,
        size: Math.random() * 3 + 2,
      });
    }
    return particles;
  }
}