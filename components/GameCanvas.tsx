import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, Entity, EntityType, GameState, Particle, Vector, Difficulty } from '../types';
import { PhysicsEngine } from '../services/PhysicsEngine';
import { AudioEngine } from '../services/AudioEngine';
import { COLORS, PLAYER_RADIUS, PARTICLE_COLORS, AI_SPAWN_INTERVAL, GAME_DURATION, ZONE_DEVIL_RADIUS, ZONE_RESTRICTED_RADIUS, SHIELD_DURATION, SHIELD_COOLDOWN } from '../constants';

const CHUNK_RENDER_DISTANCE = 1500; // Pixels
const SPAWN_DISTANCE = 800; // Grid unit for generating map
const PHYSICS_SUBSTEPS = 4; // Number of physics steps per frame for stability

export const GameCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0); // Track frames for throttling expensive ops
  
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [hintVisible, setHintVisible] = useState(true);
  const [distanceToGoal, setDistanceToGoal] = useState(0);
  const [won, setWon] = useState(false);
  const [lost, setLost] = useState(false);
  const [isPaused, setIsPaused] = useState(false); // UI State for pause
  const [timeStr, setTimeStr] = useState("5:00");
  const [finalTime, setFinalTime] = useState(0); // Store time taken
  const [difficulty, setDifficultyState] = useState(Difficulty.NORMAL);
  const [zoneAlert, setZoneAlert] = useState<{msg: string, color: string} | null>(null);
  const [shieldCooldownRatio, setShieldCooldownRatio] = useState(0); // 0 to 1
  const [brakingActive, setBrakingActive] = useState(false); // UI State
  
  const lastSecond = useRef<number>(Math.floor(GAME_DURATION / 1000));
  const lastDistUpdate = useRef<number>(0); // Throttle distance UI updates
  
  // Zone tracking refs to trigger alerts only on entry
  const inDevilZoneRef = useRef(false);
  const inRestrictedZoneRef = useRef(false);

  // Input State
  const dragStart = useRef<Vector | null>(null);
  const mousePos = useRef<Vector>({ x: 0, y: 0 });
  const isDragging = useRef(false);

  // Mutable Game State
  const state = useRef<GameState>({
    player: {
      id: 'player',
      type: EntityType.PLAYER,
      pos: { x: 0, y: -200 },
      vel: { x: 0, y: 0 },
      radius: PLAYER_RADIUS,
      rotation: 0,
      color: COLORS.player,
      mass: 1,
      restitution: 0.7,
      static: false,
    },
    entities: [],
    particles: [],
    score: 0,
    combo: 1,
    lastHitTime: 0,
    paused: false,
    won: false,
    lost: false,
    startTime: Date.now(),
    lastAiSpawnTime: 0,
    difficulty: Difficulty.NORMAL,
    shieldActive: false,
    shieldExpiresAt: 0,
    shieldCooldownEndsAt: 0,
    shieldBlockTime: 0,
    braking: false,
    brakeEndTime: 0,
  });

  const camera = useRef<Camera>({ x: 0, y: -200, zoom: 1 });
  const screenShake = useRef(0);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const activateShield = useCallback(() => {
    const s = state.current;
    const now = Date.now();
    if (s.shieldCooldownEndsAt > now || s.paused || s.won || s.lost) return;

    s.shieldActive = true;
    s.shieldExpiresAt = now + SHIELD_DURATION;
    s.shieldCooldownEndsAt = now + SHIELD_COOLDOWN;
    AudioEngine.playShieldActivate();
  }, []);

  const activateBrake = useCallback(() => {
    const s = state.current;
    if (s.braking || s.paused || s.won || s.lost) return;
    
    s.braking = true;
    s.brakeEndTime = Date.now() + 1000;
    setBrakingActive(true);
    // Initial gas burst sound could go here
    if (typeof navigator.vibrate === 'function') navigator.vibrate([20, 20, 20]);
  }, []);

  const togglePause = useCallback(() => {
    const s = state.current;
    if (s.won || s.lost) return;

    if (s.paused) {
        // Resume
        const now = Date.now();
        const diff = now - (s.pauseStartTime || now);
        
        // Adjust timers so time doesn't jump
        s.startTime += diff;
        s.lastAiSpawnTime += diff;
        s.shieldExpiresAt += diff;
        s.shieldCooldownEndsAt += diff;
        s.shieldBlockTime += diff;
        s.brakeEndTime += diff;
        
        s.entities.forEach(e => {
            if (e.expiresAt) e.expiresAt += diff;
            if (e.activationTime) e.activationTime += diff;
        });

        s.pauseStartTime = undefined;
        s.paused = false;
        setIsPaused(false);
        AudioEngine.resume();
    } else {
        // Pause
        s.paused = true;
        s.pauseStartTime = Date.now();
        setIsPaused(true);
        // Cancel drag if active
        isDragging.current = false;
        dragStart.current = null;
    }
  }, []);

  const initializeWorld = useCallback(() => {
    PhysicsEngine.clearChunks(); // Force clear generation history
    const initialEntities: Entity[] = [];
    const currentDiff = state.current.difficulty;

    // Expanded initial generation radius from 1 to 2 to cover more screen area
    for (let x = -2; x <= 2; x++) {
      for (let y = -2; y <= 2; y++) {
         initialEntities.push(...PhysicsEngine.generateChunk(x, y, SPAWN_DISTANCE, currentDiff));
      }
    }
    
    // Add floor
    initialEntities.push({
        id: 'floor',
        type: EntityType.WALL,
        pos: { x: 0, y: 500 },
        vel: {x:0, y:0},
        radius: 0,
        width: 6000, 
        height: 100,
        rotation: 0,
        color: COLORS.wall,
        mass: Infinity,
        restitution: 0.5,
        static: true,
        persistent: true
    });

    state.current.entities = initialEntities;
  }, []);

  const resetGame = () => {
      state.current.player.vel = {x:0, y:0};
      state.current.player.pos = {x:0, y:-200};
      state.current.won = false;
      state.current.lost = false;
      state.current.paused = false;
      state.current.pauseStartTime = undefined;
      state.current.score = 0;
      state.current.shieldActive = false;
      state.current.shieldExpiresAt = 0;
      state.current.shieldCooldownEndsAt = 0;
      state.current.shieldBlockTime = 0;
      state.current.braking = false;
      state.current.brakeEndTime = 0;
      
      // Full world reset
      state.current.lastAiSpawnTime = 0;
      state.current.startTime = Date.now();
      initializeWorld(); // Regenerate world
      
      setWon(false);
      setLost(false);
      setIsPaused(false);
      setFinalTime(0);
      setScore(0);
      setTimeStr("5:00");
      setZoneAlert(null);
      setShieldCooldownRatio(0);
      setBrakingActive(false);
      inDevilZoneRef.current = false;
      inRestrictedZoneRef.current = false;
      lastSecond.current = Math.floor(GAME_DURATION / 1000);
      
      // If we want to force the hint to show again
      setHintVisible(true);
      
      camera.current = {x:0, y:-200, zoom:1};
  };

  const toggleDifficulty = () => {
    const newDiff = state.current.difficulty === Difficulty.NORMAL ? Difficulty.HARD : Difficulty.NORMAL;
    state.current.difficulty = newDiff;
    setDifficultyState(newDiff);
    
    // Reset triggers so alerts show again if switching modes
    inDevilZoneRef.current = false;
    inRestrictedZoneRef.current = false;
    setZoneAlert(null);
  };

  // Keyboard Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        const key = e.key.toLowerCase();
        if (key === 'p') {
            togglePause();
        }
        if (key === 'o') {
            activateShield();
        }
        if (key === 'i') {
            activateBrake();
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePause, activateShield, activateBrake]);

  // Initialize Map
  useEffect(() => {
    initializeWorld();
    AudioEngine.init();
  }, [initializeWorld]);

  // --- Input Handlers ---
  const handleInputStart = (x: number, y: number) => {
    if (state.current.won || state.current.lost || state.current.paused) return;
    isDragging.current = true;
    dragStart.current = { x, y };
    mousePos.current = { x, y };
    
    // Start timer on first interaction
    if (hintVisible) {
        setHintVisible(false);
    }
    
    AudioEngine.resume();
  };

  const handleInputMove = (x: number, y: number) => {
    if (state.current.paused) return;
    mousePos.current = { x, y };
  };

  const handleInputEnd = (x: number, y: number) => {
    if (state.current.paused) return;
    if (isDragging.current && dragStart.current) {
      const dx = dragStart.current.x - x;
      const dy = dragStart.current.y - y;
      
      // Increased power by 10% (0.15 -> 0.165, 25 -> 27.5)
      const power = 0.165; 
      const maxImpulse = 27.5;
      const impulseX = Math.min(Math.max(dx * power, -maxImpulse), maxImpulse);
      const impulseY = Math.min(Math.max(dy * power, -maxImpulse), maxImpulse);

      if (Math.abs(impulseX) > 1 || Math.abs(impulseY) > 1) {
        state.current.player.vel.x += impulseX;
        state.current.player.vel.y += impulseY;
        screenShake.current = 5;
        AudioEngine.playLaunch();
        if (typeof navigator.vibrate === 'function') navigator.vibrate(50);
      }
    }
    isDragging.current = false;
    dragStart.current = null;
  };

  const handleMouseDown = (e: React.MouseEvent) => handleInputStart(e.clientX, e.clientY);
  const handleMouseMove = (e: React.MouseEvent) => handleInputMove(e.clientX, e.clientY);
  const handleMouseUp = (e: React.MouseEvent) => handleInputEnd(e.clientX, e.clientY);
  const handleTouchStart = (e: React.TouchEvent) => { e.preventDefault(); handleInputStart(e.touches[0].clientX, e.touches[0].clientY); };
  const handleTouchMove = (e: React.TouchEvent) => { e.preventDefault(); handleInputMove(e.touches[0].clientX, e.touches[0].clientY); };
  const handleTouchEnd = (e: React.TouchEvent) => { e.preventDefault(); if (e.changedTouches.length > 0) handleInputEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY); else isDragging.current = false; };

  const update = useCallback(() => {
    const s = state.current;
    
    if (s.paused || s.won || s.lost) return;

    frameCountRef.current++;
    const now = Date.now();

    // Shield Logic
    if (s.shieldActive && now > s.shieldExpiresAt) {
        s.shieldActive = false;
    }
    // Shield Cooldown UI
    if (s.shieldCooldownEndsAt > now) {
        setShieldCooldownRatio((s.shieldCooldownEndsAt - now) / SHIELD_COOLDOWN);
    } else {
        setShieldCooldownRatio(0);
    }

    // Braking Ability Logic (Gas Spray)
    if (s.braking) {
        if (now > s.brakeEndTime) {
            s.braking = false;
            setBrakingActive(false);
            s.player.vel = { x: 0, y: 0 }; // Final stop
        } else {
            // Apply heavy damping
            s.player.vel.x *= 0.92; 
            s.player.vel.y *= 0.92;
            
            // Visual Gas Spray
            for (let i = 0; i < 2; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * 3 + 2;
                s.particles.push({
                    id: `gas_${now}_${i}`,
                    pos: { x: s.player.pos.x, y: s.player.pos.y },
                    vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
                    life: 0.6,
                    maxLife: 0.6,
                    color: '#e2e8f0', // Slate 200 (White smoke)
                    size: Math.random() * 4 + 2
                });
            }
        }
    }

    // Ball Trail Logic
    const speed = Math.hypot(s.player.vel.x, s.player.vel.y);
    if (speed > 5) {
        // Double Helix / Circular Orbit Trail Effect
        const dirX = s.player.vel.x / speed;
        const dirY = s.player.vel.y / speed;
        const perpX = -dirY;
        const perpY = dirX;
        
        // Spawn 2 particles per frame for the double strand effect
        for(let i=0; i<2; i++) {
            const t = now * 0.02 + (i * Math.PI); // Time based phase, PI offset for opposite side
            
            // Narrower radius: player.radius * 0.6 for tight spiral
            const offset = Math.sin(t) * (s.player.radius * 0.6); 
            
            // Depth effect (simulated 3D size modulation)
            const depth = Math.cos(t);
            const size = 1.5 + (depth + 1) * 1.2; // Slightly smaller base size
            
            // Calculate spawn position relative to ball
            const spawnX = s.player.pos.x + perpX * offset;
            const spawnY = s.player.pos.y + perpY * offset;

            s.particles.push({
                id: `trail_${now}_${i}`,
                pos: { x: spawnX, y: spawnY },
                vel: { x: 0, y: 0 }, // Stationary in world space to form a trail behind
                life: 0.4,
                maxLife: 0.4,
                // Pure white, increased base opacity for better visibility (0.5 to 0.9)
                color: `rgba(255, 255, 255, ${0.5 + (depth + 1) * 0.2})`, 
                size: size
            });
        }
    }

    // Time Logic
    if (hintVisible) {
        // If hint is visible, we haven't really started, so reset start time to now
        s.startTime = now;
    } else {
        // Game has started
        const elapsed = now - s.startTime;
        const remaining = Math.max(0, GAME_DURATION - elapsed);
        
        if (remaining === 0 && !s.lost) {
            s.lost = true;
            setLost(true);
            setFinalTime(GAME_DURATION);
            AudioEngine.playLose();
        }

        // Update timer string (only if second changed)
        const seconds = Math.floor(remaining / 1000);
        if (seconds !== lastSecond.current) {
            lastSecond.current = seconds;
            const m = Math.floor(seconds / 60);
            const sec = seconds % 60;
            setTimeStr(`${m}:${sec.toString().padStart(2, '0')}`);
        }
    }

    // Calc distance raw (physics units)
    const distRaw = PhysicsEngine.dist(s.player.pos, PhysicsEngine.GOAL_POS);
    // Throttle UI update for distance (Performance Optimization)
    if (now - lastDistUpdate.current > 100) { // Update every 100ms
        setDistanceToGoal(Math.floor(distRaw / 10));
        lastDistUpdate.current = now;
    }

    // --- Hard Mode Zones Logic ---
    let currentSpawnInterval = AI_SPAWN_INTERVAL;
    
    if (s.difficulty === Difficulty.HARD) {
        // 1. Devil Zone Check (Outer Layer)
        if (distRaw < ZONE_DEVIL_RADIUS) {
            // Speed becomes 150% of normal -> Interval / 1.5
            currentSpawnInterval = AI_SPAWN_INTERVAL / 1.5;
            
            if (!inDevilZoneRef.current) {
                inDevilZoneRef.current = true;
                setZoneAlert({ msg: "⚠️ ENTERING DEVIL ZONE - HIGH ALERT ⚠️", color: "text-yellow-400" });
                // Auto hide alert after 3s
                setTimeout(() => setZoneAlert(prev => prev?.color === "text-yellow-400" ? null : prev), 3000);
            }
        } else {
            inDevilZoneRef.current = false;
        }

        // 2. Restricted Zone Check (Inner Layer - Overrides Interval)
        if (distRaw < ZONE_RESTRICTED_RADIUS) {
            // Speed becomes 125% of normal -> Interval / 1.25
            currentSpawnInterval = AI_SPAWN_INTERVAL / 1.25;
            
            // Constant screen shake increased drastically (16)
            screenShake.current = Math.max(screenShake.current, 16);

            if (!inRestrictedZoneRef.current) {
                inRestrictedZoneRef.current = true;
                setZoneAlert({ msg: "🚫 RESTRICTED ZONE - CRITICAL INSTABILITY 🚫", color: "text-red-500" });
                if (typeof navigator.vibrate === 'function') navigator.vibrate([100, 50, 100]);
            }
        } else {
            // If we just left the restricted zone, maybe clear the red alert?
            if (inRestrictedZoneRef.current) {
                 inRestrictedZoneRef.current = false;
                 setZoneAlert(prev => prev?.color === "text-red-500" ? null : prev);
            }
        }
    }

    // AI Spawning Loop
    if (!hintVisible && now - s.lastAiSpawnTime > currentSpawnInterval) {
        // Pass player velocity to AI spawn to calculate lookahead distance X = 0.5v
        const aiEntities = PhysicsEngine.spawnAiObstacle(s.player.pos, s.player.vel, s.difficulty);
        if (aiEntities.length > 0) {
            s.entities.push(...aiEntities);
            s.lastAiSpawnTime = now;
            AudioEngine.playAiSpawn();
            // Spawn particles for each entity
            aiEntities.forEach(e => {
                 s.particles.push(...PhysicsEngine.createExplosion(e.pos, 5, e.color));
            });
        }
    }

    // Cleanup Expired AI Entities (Throttle to run every 60 frames ~ 1 sec)
    if (frameCountRef.current % 60 === 0) {
        s.entities = s.entities.filter(e => {
            if (e.expiresAt && e.expiresAt < now) {
                // Don't spawn explosion here to save performance on mass expiration
                return false;
            }
            return true;
        });

        // Prune distant chunk keys to allow regeneration if visited again (solves "disappearing world" bug)
        PhysicsEngine.pruneChunks(s.player.pos, SPAWN_DISTANCE, CHUNK_RENDER_DISTANCE * 2);

        // Limit total entity count to avoid memory leaks
        if (s.entities.length > 400) {
           s.entities = s.entities.filter(e => 
               e.persistent || 
               e.isAiGenerated || 
               e.type === EntityType.BEAM ||
               PhysicsEngine.dist(s.player.pos, e.pos) < CHUNK_RENDER_DISTANCE * 2
           );
        }
    }

    // 1. Procedural Generation
    const chunkX = Math.floor(s.player.pos.x / SPAWN_DISTANCE);
    const chunkY = Math.floor(s.player.pos.y / SPAWN_DISTANCE);
    
    // Expanded dynamic generation to match start (radius 2)
    // Throttle generation slightly? No, seamless world needs this check
    for (let x = chunkX - 2; x <= chunkX + 2; x++) {
      for (let y = chunkY - 2; y <= chunkY + 2; y++) {
        const newEnts = PhysicsEngine.generateChunk(x, y, SPAWN_DISTANCE, s.difficulty);
        if (newEnts.length > 0) s.entities.push(...newEnts);
      }
    }

    // 2. Physics Sub-stepping
    const subDt = 1.0 / PHYSICS_SUBSTEPS;
    const accumulatedCollisions: { entity: Entity, force: number }[] = [];
    const accumulatedCollected: string[] = [];

    for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
        const result = PhysicsEngine.updatePhysics(s.player, s.entities, subDt);
        s.player = result.player;
        
        if (result.won) {
             s.won = true;
             setWon(true);
             setFinalTime(Date.now() - s.startTime);
             AudioEngine.playWin();
             s.particles.push(...PhysicsEngine.createExplosion(s.player.pos, 50, COLORS.goal));
             if (typeof navigator.vibrate === 'function') navigator.vibrate([100, 50, 100, 50, 200]);
             return;
        }

        if (result.collected.length > 0) accumulatedCollected.push(...result.collected);
        if (result.collisions.length > 0) accumulatedCollisions.push(...result.collisions);
    }

    // --- Special Entity Updates (Beams) ---
    const activeEntities: Entity[] = [];
    
    s.entities.forEach(e => {
        if (e.type === EntityType.BEAM) {
            if (e.expiresAt && e.expiresAt < now) {
                // Expired
                return;
            }
            
            // Check Collision if active
            const isActive = e.activationTime && now >= e.activationTime;
            
            // TRACKING LOGIC (Hard Mode Only)
            // While not active (warmup), aim at player
            if (!isActive && s.difficulty === Difficulty.HARD) {
                const angle = Math.atan2(s.player.pos.y - e.pos.y, s.player.pos.x - e.pos.x);
                const length = 3000;
                e.beamEnd = {
                    x: e.pos.x + Math.cos(angle) * length,
                    y: e.pos.y + Math.sin(angle) * length
                };
            }

            if (isActive) {
                // Fire sound trigger
                if (!e.hasFired) {
                    AudioEngine.playBeamFire();
                    e.hasFired = true;
                }

                // Lethal Phase
                const start = e.pos;
                const end = e.beamEnd || e.pos;
                const dist = PhysicsEngine.distToSegment(s.player.pos, start, end);
                
                // Beam width approx 10px visual, so radius 5. Player Radius 12.
                if (dist < s.player.radius + 5) {
                    if (s.shieldActive) {
                        // SHIELD BLOCK
                        s.shieldBlockTime = now; // Trigger visual shine
                        
                        AudioEngine.playShieldBlock();
                        if (typeof navigator.vibrate === 'function') navigator.vibrate(50);
                        
                        // Visual effect
                        if (Math.random() > 0.5) {
                           s.particles.push(...PhysicsEngine.createExplosion(s.player.pos, 5, COLORS.shield));
                        }

                        // REVERTED LOGIC: Direct force application (50% of base)
                        const dir = PhysicsEngine.vecNorm(PhysicsEngine.vecSub(s.player.pos, e.pos));
                        s.player.vel = PhysicsEngine.vecAdd(s.player.vel, PhysicsEngine.vecMult(dir, 5));

                    } else {
                        // DEATH
                        s.lost = true;
                        setLost(true);
                        setFinalTime(Date.now() - s.startTime);
                        AudioEngine.playLose();
                        s.particles.push(...PhysicsEngine.createExplosion(s.player.pos, 50, '#ef4444'));
                        if (typeof navigator.vibrate === 'function') navigator.vibrate([500]);
                    }
                }
            }
            activeEntities.push(e);
        } else {
            activeEntities.push(e);
        }
    });
    s.entities = activeEntities;

    // 3. Handle Events (Collisions / Collections)
    const uniqueCollected = [...new Set(accumulatedCollected)];
    if (uniqueCollected.length > 0) {
       s.entities = s.entities.filter(e => !uniqueCollected.includes(e.id));
       setScore(prev => prev + (500 * s.combo * uniqueCollected.length));
       s.particles.push(...PhysicsEngine.createExplosion(s.player.pos, 15, COLORS.orb));
       AudioEngine.playCollect();
       if (typeof navigator.vibrate === 'function') navigator.vibrate([10, 30, 10]);
    }

    accumulatedCollisions.forEach(col => {
      const intensity = Math.min(col.force * 0.5, 20);
      if (intensity > 2) screenShake.current += intensity * 0.5;

      s.particles.push(...PhysicsEngine.createExplosion(col.entity.pos, Math.floor(intensity) + 3, col.entity.color));

      // AI Block Hit Logic
      if (col.entity.isAiGenerated && !col.entity.isHit) {
          col.entity.isHit = true;
          col.entity.color = '#FFFFFF'; // Turn white
          s.particles.push(...PhysicsEngine.createExplosion(col.entity.pos, 20, '#FFFFFF'));
          
          // HARD MODE: Retaliation Beam
          if (s.difficulty === Difficulty.HARD) {
              const now = Date.now();
              const angle = Math.atan2(s.player.pos.y - col.entity.pos.y, s.player.pos.x - col.entity.pos.x);
              const length = 3000; // Infinite visual
              const beamEnd = {
                  x: col.entity.pos.x + Math.cos(angle) * length,
                  y: col.entity.pos.y + Math.sin(angle) * length
              };

              s.entities.push({
                  id: `beam_${now}_${Math.random()}`,
                  type: EntityType.BEAM,
                  pos: { ...col.entity.pos },
                  beamEnd: beamEnd,
                  vel: { x: 0, y: 0 },
                  radius: 0,
                  rotation: angle,
                  color: '#FFFFFF',
                  mass: 0,
                  restitution: 0,
                  static: true,
                  persistent: false,
                  activationTime: now + 500, // 500ms warning for tracking
                  expiresAt: now + 1100, // Lasts 1.1s total (600ms lethal)
                  hasFired: false
              });
              // Charge sound simulation
              AudioEngine.playBeamCharge();
          }
      }

      const now = Date.now();
      if (now - s.lastHitTime < 1500) s.combo += 1; else s.combo = 1;
      s.lastHitTime = now;
      setScore(prev => prev + (10 * Math.floor(col.force) * s.combo));
      setCombo(s.combo);

      if (col.force > 2 || col.entity.type === EntityType.BUMPER || col.entity.type === EntityType.ACCELERATOR) {
           if (col.entity.type === EntityType.BUMPER) {
             AudioEngine.playBumperHit(s.combo);
             if (typeof navigator.vibrate === 'function') navigator.vibrate(20);
           } else if (col.entity.type === EntityType.ACCELERATOR) {
             AudioEngine.playCollect();
             if (typeof navigator.vibrate === 'function') navigator.vibrate(30);
           } else {
              AudioEngine.playWallHit(col.force);
              if (typeof navigator.vibrate === 'function') navigator.vibrate(5);
           }
      }
    });

    // 4. Particles
    s.particles.forEach(p => {
      p.pos.x += p.vel.x;
      p.pos.y += p.vel.y;
      p.life -= 0.02;
    });
    s.particles = s.particles.filter(p => p.life > 0);

    // 5. Camera
    const targetX = s.player.pos.x;
    const targetY = s.player.pos.y;
    camera.current.x += (targetX - camera.current.x) * 0.1;
    camera.current.y += (targetY - camera.current.y) * 0.1;

    // 6. Shake Decay
    if (screenShake.current > 0) screenShake.current *= 0.9;
    if (screenShake.current < 0.5) screenShake.current = 0;

  }, [hintVisible]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle High DPI
    const dpr = window.devicePixelRatio || 1;
    // We already set width/height with DPR in resize, so we need to ensure we don't double scale
    // However, usually we set canvas.width = logicalWidth * dpr, and then ctx.scale(dpr, dpr).
    // But since we clearRect every frame, we need to handle the transform.
    // Reset transform to identity then apply DPR scale
    ctx.resetTransform();
    ctx.scale(dpr, dpr);

    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const cx = width / 2;
    const cy = height / 2;
    const cam = camera.current;
    const shakeX = (Math.random() - 0.5) * screenShake.current;
    const shakeY = (Math.random() - 0.5) * screenShake.current;

    // Clear
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.save();
    ctx.translate(cx - cam.x * 0.5 + shakeX * 0.5, cy - cam.y * 0.5 + shakeY * 0.5);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    const gridSize = 200;
    const startX = Math.floor((cam.x - width) / gridSize) * gridSize;
    const endX = Math.floor((cam.x + width) / gridSize) * gridSize;
    const startY = Math.floor((cam.y - height) / gridSize) * gridSize;
    const endY = Math.floor((cam.y + height) / gridSize) * gridSize;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridSize) {
       for (let y = startY; y <= endY; y += gridSize) {
           ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y);
           ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10);
       }
    }
    ctx.stroke();
    
    // Draw Zones (Optional visualization)
    if (difficulty === Difficulty.HARD) {
        // Devil Zone
        ctx.beginPath();
        ctx.arc(PhysicsEngine.GOAL_POS.x, PhysicsEngine.GOAL_POS.y, ZONE_DEVIL_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.1)'; // Yellow faint
        ctx.lineWidth = 4;
        ctx.setLineDash([20, 20]);
        ctx.stroke();

        // Restricted Zone
        ctx.beginPath();
        ctx.arc(PhysicsEngine.GOAL_POS.x, PhysicsEngine.GOAL_POS.y, ZONE_RESTRICTED_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.1)'; // Red faint
        ctx.fill();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
        ctx.setLineDash([]);
        ctx.stroke();
    }
    
    ctx.restore();

    // Camera
    ctx.save();
    ctx.translate(cx - cam.x + shakeX, cy - cam.y + shakeY);
    ctx.scale(cam.zoom, cam.zoom);

    // Slingshot
    if (isDragging.current && dragStart.current) {
        const dx = dragStart.current.x - mousePos.current.x;
        const dy = dragStart.current.y - mousePos.current.y;
        ctx.beginPath();
        ctx.moveTo(state.current.player.pos.x, state.current.player.pos.y);
        ctx.lineTo(state.current.player.pos.x + dx, state.current.player.pos.y + dy);
        ctx.strokeStyle = 'white';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Entities
    state.current.entities.forEach(entity => {
      // Don't draw beam here if we want layering, but let's just handle it in loop
      if (Math.abs(entity.pos.x - cam.x) > width + 2000 && Math.abs(entity.pos.y - cam.y) > height + 2000) return;
      
      ctx.save();

      if (entity.type === EntityType.BEAM) {
         // Draw Retaliation Beam
         const now = Date.now();
         const isActive = entity.activationTime && now >= entity.activationTime;
         const beamEnd = entity.beamEnd || entity.pos;
         
         if (isActive) {
             // Lethal Beam
             // Calculate fade out based on expiration
             const timeLeft = (entity.expiresAt || 0) - now;
             const opacity = Math.min(1, timeLeft / 300); // Fade out last 300ms

             // Core
             ctx.beginPath();
             ctx.moveTo(entity.pos.x, entity.pos.y);
             ctx.lineTo(beamEnd.x, beamEnd.y);
             ctx.lineWidth = 15;
             ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
             ctx.shadowBlur = 30;
             ctx.shadowColor = '#FFFFFF';
             ctx.stroke();
             
             // Inner Core
             ctx.lineWidth = 6;
             ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
             ctx.stroke();
         } else {
             // Warmup (Charging)
             ctx.beginPath();
             ctx.moveTo(entity.pos.x, entity.pos.y);
             ctx.lineTo(beamEnd.x, beamEnd.y);
             ctx.lineWidth = 2;
             ctx.strokeStyle = `rgba(239, 68, 68, 0.8)`; // Red warning line
             ctx.setLineDash([10, 10]);
             ctx.stroke();
         }

         ctx.restore();
         return;
      }

      ctx.translate(entity.pos.x, entity.pos.y);
      ctx.rotate((entity.rotation * Math.PI) / 180);
      ctx.fillStyle = entity.color;

      // PERFORMANCE OPTIMIZATION: Only use shadows for Hit State, Goal, or Bumpers/Accelerators
      // General AI walls/obstacles are too numerous for shadowBlur
      if (entity.isHit) {
          ctx.shadowBlur = 50;
          ctx.shadowColor = '#ffffff';
      } else if (entity.type === EntityType.BUMPER || entity.type === EntityType.ACCELERATOR || entity.type === EntityType.GOAL) {
        // Special entities get shadows
        ctx.shadowBlur = 15;
        ctx.shadowColor = entity.color;
      }
      // Note: AI walls intentionally have no shadow to save huge GPU overhead
      
      if (entity.type === EntityType.GOAL) {
         const time = Date.now() * 0.002;
         const scale = 1 + Math.sin(time) * 0.1;
         ctx.scale(scale, scale);
         ctx.beginPath();
         ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
         ctx.fill();
         ctx.fillStyle = '#fff';
         ctx.globalAlpha = 0.5;
         ctx.beginPath();
         ctx.arc(0, 0, entity.radius * 0.5, 0, Math.PI * 2);
         ctx.fill();
      } else if (entity.width && entity.height) {
        // AI glitch and shimmer effect
        if (entity.isAiGenerated) {
             const time = Date.now();
             // Jitter
             if (Math.random() > 0.95 && !entity.isHit) ctx.translate((Math.random()-0.5)*4, (Math.random()-0.5)*2);
             
             // Pulse Opacity
             if (entity.isHit) {
                 ctx.fillStyle = '#FFFFFF';

                 // Added Sparkle Effect
                 if (Math.random() > 0.3) {
                     ctx.save();
                     // Random sparkle position relative to center, slightly larger than box
                     const sx = (Math.random() - 0.5) * (entity.width + 10);
                     const sy = (Math.random() - 0.5) * (entity.height + 10);
                     ctx.translate(sx, sy);
                     ctx.rotate(Math.random() * Math.PI);
                     ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#fcd34d'; // White or Amber-300
                     ctx.globalAlpha = Math.random();
                     const size = Math.random() * 4 + 1;
                     ctx.fillRect(-size/2, -size/2, size, size);
                     ctx.restore();
                 }
             } else {
                 ctx.globalAlpha = 0.9 + Math.sin(time * 0.01) * 0.1;
             }
             
             ctx.fillRect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);

             // Shimmer Overlay (only if not hit)
             if (!entity.isHit) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);
                ctx.clip();
                
                // Moving scanline
                const scanY = (time * 0.15) % (entity.height + 60) - 30;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.fillRect(-entity.width/2, -entity.height/2 + scanY, entity.width, 10);
                
                // Random static interference (Reduced frequency for performance)
                if (Math.random() > 0.95) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                    const h = Math.random() * 4 + 1;
                    const y = (Math.random() - 0.5) * entity.height;
                    ctx.fillRect(-entity.width/2, y, entity.width, h);
                }
                ctx.restore();
             }
        } else {
             ctx.fillRect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);
        }
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    // Player
    const p = state.current.player;
    ctx.save();
    ctx.translate(p.pos.x, p.pos.y);
    
    // Check for blue shine (Block Effect)
    const isBlockingShine = state.current.shieldBlockTime && (Date.now() - state.current.shieldBlockTime < 1000);
    
    ctx.fillStyle = isBlockingShine ? '#67e8f9' : p.color; // Flash lighter cyan
    ctx.shadowBlur = isBlockingShine ? 50 : 20;
    ctx.shadowColor = isBlockingShine ? '#22d3ee' : p.color; // Intense Cyan 400

    ctx.beginPath();
    ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, p.radius * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Shield Visuals
    if (state.current.shieldActive) {
        ctx.save();
        ctx.translate(p.pos.x, p.pos.y);
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 8, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.shield;
        ctx.lineWidth = 3;
        ctx.shadowColor = COLORS.shield;
        ctx.shadowBlur = 15;
        ctx.stroke();
        
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = COLORS.shield;
        ctx.fill();
        ctx.restore();
    }

    // Particles (Optimized)
    // Use additive blending for "glow" without expensive shadowBlur
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    state.current.particles.forEach(part => {
      // Avoid repetitive ctx.save/restore inside loop if possible, 
      // but alpha changes per particle, so we keep local save for safety but rely on lighter blend for fx
      ctx.save();
      ctx.globalAlpha = part.life;
      ctx.fillStyle = part.color;
      ctx.translate(part.pos.x, part.pos.y);
      ctx.beginPath();
      ctx.arc(0, 0, part.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();

    ctx.restore();

  }, [difficulty]);

  useEffect(() => {
    const loop = () => {
      update();
      draw();
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [update, draw]);

  useEffect(() => {
    const resize = () => { 
        if (canvasRef.current) { 
            const dpr = window.devicePixelRatio || 1;
            canvasRef.current.width = window.innerWidth * dpr; 
            canvasRef.current.height = window.innerHeight * dpr; 
            canvasRef.current.style.width = `${window.innerWidth}px`;
            canvasRef.current.style.height = `${window.innerHeight}px`;
        } 
    };
    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  }, []);

  const angleToGoal = Math.atan2(PhysicsEngine.GOAL_POS.y - state.current.player.pos.y, PhysicsEngine.GOAL_POS.x - state.current.player.pos.x) * (180 / Math.PI);
  
  const isTimeLow = lastSecond.current < 30;

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="block cursor-crosshair touch-none"
      />
      
      {/* Zone Alert Overlay */}
      {zoneAlert && !won && !lost && !isPaused && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 z-40 w-full text-center pointer-events-none animate-bounce">
              <div className={`text-2xl font-black uppercase tracking-widest bg-black/50 backdrop-blur px-6 py-2 rounded-full inline-block border-2 ${zoneAlert.color === 'text-red-500' ? 'border-red-500' : 'border-yellow-400'} ${zoneAlert.color}`}>
                  {zoneAlert.msg}
              </div>
          </div>
      )}

      {/* Timer Overlay */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 pointer-events-none">
        <div className={`text-4xl font-mono font-black tracking-widest px-4 py-1 rounded-lg transition-colors ${isTimeLow ? 'text-red-500 animate-pulse bg-red-950/30' : 'text-slate-200 bg-slate-800/50'}`}>
             {timeStr}
        </div>
      </div>

      {/* UI Overlay */}
      <div className="absolute top-6 left-6 pointer-events-none">
        <h1 className="text-4xl font-black text-white tracking-tighter drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">
          {score.toLocaleString()}
        </h1>
        {combo > 1 && (
          <div className="text-2xl font-bold text-pink-400 mt-1 animate-pulse">
            {combo}x COMBO!
          </div>
        )}
        {!hintVisible && !won && !lost && !isPaused && (
            <div className="mt-2 text-red-500 font-mono text-sm animate-pulse tracking-widest uppercase">
                ⚠ AI DEFENSE SYSTEM ACTIVE
            </div>
        )}
      </div>

      <div className="absolute top-6 right-6 flex flex-col items-end gap-2 pointer-events-auto">
        <div className="flex items-center gap-2">
            <div className="relative group">
                <button 
                onClick={activateShield}
                disabled={shieldCooldownRatio > 0}
                className={`w-12 h-12 rounded-full border-2 flex items-center justify-center font-black text-lg transition-all
                    ${shieldCooldownRatio > 0 
                        ? 'border-slate-700 bg-slate-800 text-slate-500' 
                        : 'border-cyan-400 bg-cyan-900/50 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.5)] hover:bg-cyan-800'}`}
                >
                    O
                </button>
                {shieldCooldownRatio > 0 && (
                    <svg className="absolute top-0 left-0 w-12 h-12 -rotate-90 pointer-events-none">
                        <circle cx="24" cy="24" r="11" fill="none" stroke="#334155" strokeWidth="22" />
                        <circle 
                            cx="24" cy="24" r="11" fill="none" stroke="#0f172a" strokeWidth="22" 
                            strokeDasharray={69}
                            strokeDashoffset={69 * (1 - shieldCooldownRatio)}
                            className="transition-all duration-100 ease-linear"
                        />
                    </svg>
                )}
                 <div className="absolute top-full mt-1 right-0 text-[10px] text-slate-400 whitespace-nowrap opacity-0 group-hover:opacity-100 transition">
                    SHIELD (0.5s)
                </div>
            </div>

            {/* Brake Button (I) Visual */}
            <div className="relative group">
                <button 
                onClick={activateBrake}
                disabled={brakingActive}
                className={`w-12 h-12 rounded-full border-2 flex items-center justify-center font-black text-lg transition-all
                    ${brakingActive 
                        ? 'border-slate-700 bg-slate-800 text-slate-500' 
                        : 'border-white bg-white/10 text-white shadow-[0_0_15px_rgba(255,255,255,0.3)] hover:bg-white/20'}`}
                >
                    I
                </button>
                 <div className="absolute top-full mt-1 right-0 text-[10px] text-slate-400 whitespace-nowrap opacity-0 group-hover:opacity-100 transition">
                    AIR BRAKE
                </div>
            </div>

            <button 
               onClick={toggleDifficulty}
               className={`px-3 py-2 text-xs font-bold rounded-lg border border-slate-700 transition ${difficulty === Difficulty.HARD ? 'bg-red-900 text-red-200 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {difficulty === Difficulty.HARD ? 'MODE: HARD' : 'MODE: NORMAL'}
            </button>
             <button 
               onClick={togglePause}
               className="px-3 py-2 text-xs font-bold bg-slate-800 text-slate-300 rounded-lg border border-slate-700 hover:bg-slate-700 transition"
            >
              {isPaused ? 'RESUME (P)' : 'PAUSE (P)'}
            </button>
            <div className="text-white font-bold text-lg bg-slate-800/80 px-4 py-2 rounded-full border border-slate-700 flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-fuchsia-400 animate-pulse" />
                Goal: {distanceToGoal}m
                <div style={{ transform: `rotate(${angleToGoal + 90}deg)` }} className="text-xl">
                ⬆
                </div>
            </div>
        </div>
        <button 
           onClick={resetGame}
           className="px-4 py-2 bg-slate-800 text-white rounded-lg border border-slate-700 hover:bg-slate-700 transition"
        >
          Reset Pos
        </button>
      </div>

      {/* PAUSE OVERLAY */}
      {isPaused && !won && !lost && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
             <div className="text-center">
                 <h2 className="text-6xl font-black text-white mb-6 tracking-[0.2em] drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]">PAUSED</h2>
                 <button 
                    onClick={togglePause}
                    className="px-8 py-3 bg-white/10 hover:bg-white/20 border border-white/50 text-white font-bold rounded-xl text-xl transition backdrop-blur-md"
                  >
                      RESUME GAME
                  </button>
             </div>
          </div>
      )}

      {won && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50 animate-in fade-in duration-500">
              <div className="bg-slate-800 p-8 rounded-2xl border-2 border-fuchsia-500 text-center shadow-[0_0_50px_rgba(232,121,249,0.5)]">
                  <h2 className="text-6xl font-black text-white mb-2 tracking-tighter">VICTORY!</h2>
                  <p className="text-xl text-fuchsia-300 mb-2">Final Score: {score.toLocaleString()}</p>
                  <p className="text-lg text-slate-400 mb-6 font-mono">Time: {formatTime(finalTime)}</p>
                  <button 
                    onClick={resetGame}
                    className="px-8 py-3 bg-fuchsia-500 hover:bg-fuchsia-600 text-white font-bold rounded-xl text-lg transition transform hover:scale-105"
                  >
                      Play Again
                  </button>
              </div>
          </div>
      )}

      {lost && (
          <div className="absolute inset-0 bg-red-950/80 flex items-center justify-center z-50 animate-in fade-in duration-500">
              <div className="bg-slate-900 p-8 rounded-2xl border-2 border-red-500 text-center shadow-[0_0_50px_rgba(239,68,68,0.5)]">
                  <h2 className="text-6xl font-black text-red-500 mb-2 tracking-tighter">GAME OVER</h2>
                  <p className="text-xl text-slate-300 mb-2">
                      {difficulty === Difficulty.HARD && state.current.entities.some(e => e.type === EntityType.BEAM && PhysicsEngine.distToSegment(state.current.player.pos, e.pos, e.beamEnd || e.pos) < 20) 
                          ? "Eliminated by High Energy Beam" 
                          : "Time Limit Exceeded"}
                  </p>
                  <p className="text-lg text-slate-400 mb-2">Score: {score.toLocaleString()}</p>
                  <p className="text-lg text-slate-400 mb-6 font-mono">Time Taken: {formatTime(finalTime)}</p>
                  <button 
                    onClick={resetGame}
                    className="px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-lg transition transform hover:scale-105"
                  >
                      Try Again
                  </button>
              </div>
          </div>
      )}

      {hintVisible && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 text-white/50 text-center pointer-events-none animate-bounce">
          <p className="text-lg">Drag & Release to Launch</p>
          <div className="w-6 h-6 border-l-2 border-b-2 border-white/50 rotate-[-45deg] mx-auto mt-2"></div>
        </div>
      )}
      
      <div className="absolute bottom-6 left-6 text-slate-500 text-sm pointer-events-none">
        <p>Neon Zen Bounce • Reach the Goal</p>
      </div>
    </div>
  );
};