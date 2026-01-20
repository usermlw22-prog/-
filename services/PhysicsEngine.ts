
import { Entity, EntityType, Particle, Vector, Difficulty } from '../types';
import { GRAVITY, FRICTION, COLORS, PARTICLE_COLORS, AI_OBSTACLE_LIFETIME } from '../constants';

export class PhysicsEngine {
  // Vector Math Helpers (Kept for external usage, but manually inlined in hot loops)
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
  
  static clearChunks() {
    this.generatedChunks.clear();
  }

  static pruneChunks(playerPos: Vector, chunkSize: number, renderDist: number) {
    const pCx = Math.floor(playerPos.x / chunkSize);
    const pCy = Math.floor(playerPos.y / chunkSize);
    const range = Math.ceil(renderDist / chunkSize) + 2; // Keep chunks within render distance + buffer

    for (const key of this.generatedChunks) {
      const [cx, cy] = key.split(',').map(Number);
      if (Math.abs(cx - pCx) > range || Math.abs(cy - pCy) > range) {
        this.generatedChunks.delete(key);
      }
    }
  }
  
  // Goal Position Configuration
  static GOAL_POS = { x: 0, y: -10000 }; // Center of chunk 0, -13 approx (1000m distance)

  static spawnAiObstacle(playerPos: Vector, playerVel: Vector, difficulty: Difficulty): Entity[] {
    // 1. Calculate direction to goal
    const dx = this.GOAL_POS.x - playerPos.x;
    const dy = this.GOAL_POS.y - playerPos.y;
    const distToGoal = Math.sqrt(dx * dx + dy * dy);
    
    // Don't spawn if too close to goal
    if (distToGoal < 400) return [];

    const dirX = dx / distToGoal;
    const dirY = dy / distToGoal;

    // --- Distance Calculation (X = 0.5v) ---
    const speed = Math.sqrt(playerVel.x * playerVel.x + playerVel.y * playerVel.y);
    const speedPxPerSec = speed * 60;
    const formulaDist = speedPxPerSec * 0.5;
    
    const spawnDist = Math.max(350, formulaDist);

    const normalWidth = 150 + Math.random() * 100;
    const normalThickness = 60;
    const targetArea = normalWidth * normalThickness;
    
    const entities: Entity[] = [];

    if (difficulty === Difficulty.HARD) {
        // Hard Mode: 3 Independent blocks
        const perpX = -dirY;
        const perpY = dirX;
        
        const shapes: {w: number, h: number}[] = [];
        let totalShapeArea = 0;
        
        for (let i = 0; i < 3; i++) {
             const aspect = 3.0 + Math.random() * 5.0; 
             const weight = 0.8 + Math.random() * 0.4; 
             const h = Math.sqrt(weight / aspect); 
             const w = h * aspect; 
             shapes.push({w, h});
             totalShapeArea += w * h;
        }

        const scale = Math.sqrt(targetArea / totalShapeArea);
        const angleRad = Math.atan2(dirY, dirX);
        const baseRotationDeg = (angleRad * 180 / Math.PI) + 90;

        for (let i = 0; i < 3; i++) {
             const finalW = shapes[i].w * scale;
             const finalH = shapes[i].h * scale;

             const forwardDist = 400 + Math.random() * 60; 
             const spreadRange = 200; 
             const lateralOffset = (Math.random() - 0.5) * 2 * spreadRange;

             const anchorX = playerPos.x + dirX * forwardDist;
             const anchorY = playerPos.y + dirY * forwardDist;
             
             const posX = anchorX + perpX * lateralOffset;
             const posY = anchorY + perpY * lateralOffset;

             const rotationJitter = (Math.random() - 0.5) * 90;
             const rotation = baseRotationDeg + rotationJitter;

             entities.push({
                id: `ai_${Date.now()}_${i}_${Math.random()}`,
                type: EntityType.WALL,
                pos: { x: posX, y: posY },
                vel: { x: 0, y: 0 },
                radius: 0,
                width: finalW,
                height: finalH,
                rotation: rotation,
                color: COLORS.aiWall,
                mass: Infinity,
                restitution: 1.3,
                static: true,
                isAiGenerated: true,
                expiresAt: Date.now() + AI_OBSTACLE_LIFETIME
             });
        }
    } else {
        // Normal Mode
        const finalDist = spawnDist + (Math.random() * 100 - 50); 
        const centerX = playerPos.x + dirX * finalDist;
        const centerY = playerPos.y + dirY * finalDist;

        const angleRad = Math.atan2(dirY, dirX);
        const baseRotationRad = angleRad + Math.PI / 2;
        const randomTilt = (Math.random() - 0.5) * 0.5; 
        const rotation = (baseRotationRad + randomTilt) * (180 / Math.PI);

        entities.push({
            id: `ai_${Date.now()}_${Math.random()}`,
            type: EntityType.WALL,
            pos: { x: centerX, y: centerY },
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

  static generateChunk(chunkX: number, chunkY: number, chunkSize: number, difficulty: Difficulty = Difficulty.NORMAL): Entity[] {
    const key = `${chunkX},${chunkY}`;
    if (this.generatedChunks.has(key)) return [];
    this.generatedChunks.add(key);

    const entities: Entity[] = [];
    const baseX = chunkX * chunkSize;
    const baseY = chunkY * chunkSize;

    if (chunkX === 0 && chunkY === -13) {
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
          persistent: true 
       });
       
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
            persistent: true
          });
       });
    }

    const seed = Math.abs(Math.sin(chunkX * 12.9898 + chunkY * 78.233) * 43758.5453);
    
    let minCount = 2;
    if (difficulty === Difficulty.HARD) {
        minCount = 3;
    }

    const count = Math.floor((seed % 1) * 5) + minCount; 

    for (let i = 0; i < count; i++) {
      const subSeed = Math.abs(Math.sin(i * 12.9898 + seed) * 43758.5453);
      const typeVal = subSeed % 1;
      
      const posX = baseX + (subSeed * 1000) % chunkSize;
      const posY = baseY + ((subSeed * 10000) % chunkSize);

      if (Math.abs(posX) < 300 && Math.abs(posY) < 300) continue;
      // Inline distance check
      const dGx = posX - this.GOAL_POS.x;
      const dGy = posY - this.GOAL_POS.y;
      if (Math.sqrt(dGx * dGx + dGy * dGy) < 300) continue;

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

    // --- OPTIMIZATION: Inline vector math to avoid GC pressure ---

    // Apply gravity
    player.vel.y += GRAVITY * dt;
    
    // Friction
    const frictionFactor = Math.pow(FRICTION, dt);
    player.vel.x *= frictionFactor;
    player.vel.y *= frictionFactor;

    // Predict next position
    // const nextPos = this.vecAdd(player.pos, this.vecMult(player.vel, dt));
    let nextX = player.pos.x + player.vel.x * dt;
    let nextY = player.pos.y + player.vel.y * dt;

    // Resolve Collisions
    for (const entity of entities) {
      if (entity.type === EntityType.BEAM) continue; 

      if (entity.type === EntityType.GOAL) {
          // dist = sqrt((x1-x2)^2 + (y1-y2)^2)
          const dx = nextX - entity.pos.x;
          const dy = nextY - entity.pos.y;
          // Avoid sqrt if checking < radius (check squared)
          if ((dx*dx + dy*dy) < (entity.radius * entity.radius)) {
              won = true;
          }
          continue;
      }

      if (entity.type === EntityType.ORB) {
         const dx = nextX - entity.pos.x;
         const dy = nextY - entity.pos.y;
         const minDist = player.radius + entity.radius;
         if ((dx*dx + dy*dy) < (minDist * minDist)) {
            collected.push(entity.id);
         }
         continue;
      }

      if (entity.type === EntityType.BUMPER) {
        const dx = nextX - entity.pos.x;
        const dy = nextY - entity.pos.y;
        const distSq = dx*dx + dy*dy;
        const minDist = player.radius + entity.radius;

        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          
          // Normal: dx/dist, dy/dist
          const nx = dx / dist;
          const ny = dy / dist;

          const penetration = minDist - dist;
          nextX += nx * penetration;
          nextY += ny * penetration;

          // Relative Velocity: (p.vx - e.vx)
          const rvx = player.vel.x - entity.vel.x;
          const rvy = player.vel.y - entity.vel.y;

          // Velocity along normal: dot product
          const velAlongNormal = rvx * nx + rvy * ny;

          if (velAlongNormal < 0) {
             const j = -(1 + entity.restitution) * velAlongNormal;
             // Impulse: normal * j
             player.vel.x += nx * j;
             player.vel.y += ny * j;
             collisions.push({ entity, force: j });
          }
        }
      } else if (entity.type === EntityType.WALL || entity.type === EntityType.ACCELERATOR) {
        const rad = -entity.rotation * (Math.PI / 180);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const dx = nextX - entity.pos.x;
        const dy = nextY - entity.pos.y;

        // Local coordinates
        const localX = cos * dx - sin * dy;
        const localY = sin * dx + cos * dy;

        const halfW = entity.width! / 2;
        const halfH = entity.height! / 2;
        const closestX = Math.max(-halfW, Math.min(localX, halfW));
        const closestY = Math.max(-halfH, Math.min(localY, halfH));

        const distX = localX - closestX;
        const distY = localY - closestY;
        const distanceSquared = distX * distX + distY * distY;

        if (distanceSquared < player.radius * player.radius) {
          const dist = Math.sqrt(distanceSquared);
          
          let lnx = 0, lny = 0;
          if (dist === 0) {
              lny = -1;
          } else {
             lnx = distX / dist;
             lny = distY / dist;
          }

          // Transform normal back to world
          // Rotation matrix transpose (inverse for rotation)
          // For negative rad: cos(-t) = cos(t), sin(-t) = -sin(t)
          // Actually, we use the same rotation as transforming Point -> Local?
          // No, we need Local Vector -> World Vector. We rotated World -> Local by -angle.
          // So we rotate Local -> World by +angle (which is -rad since rad is -rotation).
          // Wait, previous code used:
          // x: cos(-rad)*lx - sin(-rad)*ly
          // y: sin(-rad)*lx + cos(-rad)*ly
          // Let's stick to that math to ensure consistency with original behavior.
          
          const cosRev = Math.cos(-rad);
          const sinRev = Math.sin(-rad);
          
          const wnx = cosRev * lnx - sinRev * lny;
          const wny = sinRev * lnx + cosRev * lny;

          const penetration = player.radius - dist;
          nextX += wnx * penetration;
          nextY += wny * penetration;

          const velAlongNormal = player.vel.x * wnx + player.vel.y * wny;
          
          if (velAlongNormal < 0) {
             let restitution = entity.restitution;
             if (entity.type === EntityType.ACCELERATOR) restitution = 2.5; 
             
             const j = -(1 + restitution) * velAlongNormal;
             player.vel.x += wnx * j;
             player.vel.y += wny * j;
             collisions.push({ entity, force: j });
          }
        }
      }
    }

    player.pos.x = nextX;
    player.pos.y = nextY;

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
