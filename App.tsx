
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  GRID_WIDTH, 
  GRID_HEIGHT, 
  CANVAS_WIDTH, 
  CANVAS_HEIGHT, 
  CELL_SIZE,
  COLORS,
  INITIAL_TIME,
  CAPTURE_THRESHOLD,
  SNAKE_LENGTH,
  SNAKE_SEGMENT_DISTANCE
} from './constants';
import { CellState, Direction, Position, Snake, GameState } from './types';

type GameMode = 'classic' | 'snake';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
}

interface ExtendedGameState extends GameState {
  isLevelComplete: boolean;
  exitPos: Position | null;
  mode: GameMode;
  isStarted: boolean;
}

class RetroAudio {
  private ctx: AudioContext | null = null;
  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }
  playCapture() {
    this.init();
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, this.ctx!.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, this.ctx!.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.ctx!.destination);
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.1);
  }
  playDeath() {
    this.init();
    const osc = this.ctx!.createOscillator();
    const gain = this.ctx!.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, this.ctx!.currentTime);
    osc.frequency.linearRampToValueAtTime(50, this.ctx!.currentTime + 0.5);
    gain.gain.setValueAtTime(0.1, this.ctx!.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx!.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(this.ctx!.destination);
    osc.start();
    osc.stop(this.ctx!.currentTime + 0.5);
  }
  playExplosion() {
    this.init();
    const bufferSize = this.ctx!.sampleRate * 0.3;
    const buffer = this.ctx!.createBuffer(1, bufferSize, this.ctx!.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const source = this.ctx!.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx!.createGain();
    gain.gain.setValueAtTime(0.1, this.ctx!.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx!.currentTime + 0.3);
    source.connect(gain);
    gain.connect(this.ctx!.destination);
    source.start();
  }
}

const audio = new RetroAudio();

const HeartIcon: React.FC<{ filled: boolean }> = ({ filled }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" className="inline-block mx-0.5">
    <path d="M2,9 L2,13 L4,13 L4,15 L6,15 L6,17 L8,17 L8,19 L10,19 L10,21 L14,21 L14,19 L16,19 L16,17 L18,17 L18,15 L20,15 L20,13 L22,13 L22,9 L20,9 L20,7 L18,7 L18,5 L14,5 L14,7 L12,7 L10,7 L10,5 L6,5 L6,7 L4,7 L4,9 L2,9 Z" fill={filled ? "#ff0000" : "#808080"} />
    {filled && <rect x="6" y="7" width="2" height="2" fill="#ff8080" />}
  </svg>
);

const App: React.FC = () => {
  const [gameState, setGameState] = useState<ExtendedGameState>({
    score: 0, level: 1, lives: 3, timeLeft: INITIAL_TIME,
    percentageCaptured: 0, isGameOver: false, isPaused: false,
    isLevelComplete: false, exitPos: null, mode: 'classic', isStarted: false
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<number[][]>([]);
  const playerPosRef = useRef<Position>({ x: 0, y: 0 });
  const playerDirRef = useRef<Direction>(Direction.NONE);
  const nextDirRef = useRef<Direction>(Direction.NONE);
  const snakesRef = useRef<Snake[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const lastTimeRef = useRef<number>(0);
  const timerRef = useRef<number>(INITIAL_TIME);
  const frameIdRef = useRef<number>(0);
  const isTrailingRef = useRef<boolean>(false);
  const trailStartPosRef = useRef<Position | null>(null);
  
  // CPU Bug states
  const cpuStepsInActive = useRef<number>(0);
  const cpuDecisionCooldown = useRef<number>(0);

  const initGrid = useCallback(() => {
    const grid: number[][] = [];
    const BORDER_SIZE = 3; 
    for (let y = 0; y < GRID_HEIGHT; y++) {
      grid[y] = [];
      for (let x = 0; x < GRID_WIDTH; x++) {
        const isBorder = x < BORDER_SIZE || x >= GRID_WIDTH - BORDER_SIZE || y < BORDER_SIZE || y >= GRID_HEIGHT - BORDER_SIZE;
        grid[y][x] = isBorder ? CellState.SAFE : CellState.ACTIVE;
      }
    }
    gridRef.current = grid;
  }, []);

  const initPlayer = useCallback(() => {
    playerPosRef.current = { x: Math.floor(GRID_WIDTH / 2), y: 1 };
    playerDirRef.current = Direction.NONE;
    nextDirRef.current = Direction.NONE;
    isTrailingRef.current = false;
    trailStartPosRef.current = null;
    cpuStepsInActive.current = 0;
    cpuDecisionCooldown.current = 0;
  }, []);

  const initSnakes = useCallback((level: number, mode: GameMode) => {
    const numSnakes = mode === 'snake' ? 1 : 1 + Math.floor((level - 1) / 3);
    const snakes: Snake[] = [];
    const historySize = SNAKE_LENGTH * SNAKE_SEGMENT_DISTANCE;
    for (let i = 0; i < numSnakes; i++) {
      const startPos = { x: Math.floor(GRID_WIDTH / 2), y: Math.floor(GRID_HEIGHT / 2) };
      const path: Position[] = [];
      for (let j = 0; j < historySize; j++) path.push({ ...startPos });
      
      let baseVelocity = 0.15;
      if (mode === 'snake') {
        baseVelocity *= 1.15; // Yılan modunda yılan %15 daha hızlı
      }
      const currentVelocity = baseVelocity * Math.pow(1.05, level - 1);
      
      snakes.push({
        path,
        direction: Direction.NONE,
        velocity: currentVelocity
      });
    }
    snakesRef.current = snakes;
  }, []);

  const resetTrailOnly = useCallback(() => {
    const grid = gridRef.current;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (grid[y][x] === CellState.TRAIL) grid[y][x] = CellState.ACTIVE;
      }
    }
    isTrailingRef.current = false;
    trailStartPosRef.current = null;
    cpuStepsInActive.current = 0;
  }, []);

  const explodeSnakes = useCallback(() => {
    audio.playExplosion();
    const particles: Particle[] = [];
    snakesRef.current.forEach(snake => {
      for (let i = 0; i < SNAKE_LENGTH; i++) {
        const p = snake.path[i * SNAKE_SEGMENT_DISTANCE];
        if (!p) continue;
        const color = i === 0 ? COLORS.SNAKE_HEAD : COLORS.SNAKE;
        for (let j = 0; j < 8; j++) {
          particles.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, color, life: 1.0 });
        }
      }
    });
    particlesRef.current = [...particlesRef.current, ...particles];
    snakesRef.current = []; 
  }, []);

  const explodeBug = useCallback(() => {
    audio.playExplosion();
    const particles: Particle[] = [];
    const p = playerPosRef.current;
    const color = COLORS.PLAYER;
    for (let j = 0; j < 30; j++) {
      particles.push({ 
        x: p.x, 
        y: p.y, 
        vx: (Math.random() - 0.5) * 0.8, 
        vy: (Math.random() - 0.5) * 0.8, 
        color, 
        life: 1.0 
      });
    }
    particlesRef.current = [...particlesRef.current, ...particles];
    playerPosRef.current = { x: -100, y: -100 }; // Move bug off screen
  }, []);

  const calculateCapturedPercentage = useCallback(() => {
    let safeCount = 0;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (gridRef.current[y][x] === CellState.SAFE) safeCount++;
      }
    }
    return Math.floor((safeCount / (GRID_WIDTH * GRID_HEIGHT)) * 100);
  }, []);

  const captureArea = useCallback((mode: GameMode) => {
    audio.playCapture();
    const grid = gridRef.current;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) if (grid[y][x] === CellState.TRAIL) grid[y][x] = CellState.SAFE;
    }
    const visited = Array.from({ length: GRID_HEIGHT }, () => new Array(GRID_WIDTH).fill(false));
    const activeBlocks: Position[][] = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (grid[y][x] === CellState.ACTIVE && !visited[y][x]) {
          const block: Position[] = [];
          const queue: Position[] = [{ x, y }];
          visited[y][x] = true;
          while (queue.length > 0) {
            const curr = queue.shift()!;
            block.push(curr);
            [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}].forEach(d => {
              const nx = curr.x + d.x, ny = curr.y + d.y;
              if (nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT && grid[ny][nx] === CellState.ACTIVE && !visited[ny][nx]) {
                visited[ny][nx] = true;
                queue.push({x: nx, y: ny});
              }
            });
          }
          activeBlocks.push(block);
        }
      }
    }
    let totalCaptured = 0;
    activeBlocks.forEach(block => {
      const hasSnake = block.some(cell => 
        snakesRef.current.some(s => {
          const head = s.path[0];
          return Math.floor(head.x) === cell.x && Math.floor(head.y) === cell.y;
        })
      );
      if (!hasSnake) {
        block.forEach(c => { grid[c.y][c.x] = CellState.SAFE; totalCaptured++; });
      }
    });
    const perc = calculateCapturedPercentage();
    setGameState(prev => ({ ...prev, score: prev.score + Math.floor(totalCaptured / 10), percentageCaptured: perc }));
    if (perc >= CAPTURE_THRESHOLD && mode === 'classic') {
      levelUp();
    }
    isTrailingRef.current = false;
    trailStartPosRef.current = null;
    cpuStepsInActive.current = 0;
  }, [calculateCapturedPercentage]);

  const levelUp = useCallback(() => {
    // Determine what explodes based on mode
    setGameState(prev => {
      if (prev.mode === 'snake') {
        explodeBug();
      } else {
        explodeSnakes();
      }
      return { ...prev, isLevelComplete: true };
    });

    setTimeout(() => {
      setGameState(prev => {
        const nextLevel = prev.level + 1;
        initGrid();
        initPlayer();
        initSnakes(nextLevel, prev.mode);
        timerRef.current = INITIAL_TIME;
        return { ...prev, level: nextLevel, timeLeft: INITIAL_TIME, percentageCaptured: 0, isLevelComplete: false };
      });
      particlesRef.current = [];
    }, 3000);
  }, [initGrid, initPlayer, initSnakes, explodeSnakes, explodeBug]);

  const handleDeath = useCallback(() => {
    audio.playDeath();
    setGameState(prev => ({ ...prev, lives: Math.max(0, prev.lives - 1), isGameOver: prev.lives <= 1 }));
    resetTrailOnly();
    initPlayer();
  }, [initPlayer, resetTrailOnly]);

  const startGame = useCallback((mode: GameMode) => {
    initGrid();
    initPlayer();
    initSnakes(1, mode);
    setGameState({
      score: 0, level: 1, lives: 3, timeLeft: INITIAL_TIME,
      percentageCaptured: 0, isGameOver: false, isPaused: false,
      isLevelComplete: false, exitPos: null, mode, isStarted: true
    });
    particlesRef.current = [];
    timerRef.current = INITIAL_TIME;
    lastTimeRef.current = 0;
  }, [initGrid, initPlayer, initSnakes]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState.isLevelComplete || !gameState.isStarted) return;
      let dir = Direction.NONE;
      switch (e.key) {
        case 'ArrowUp': case 'w': dir = Direction.UP; break;
        case 'ArrowDown': case 's': dir = Direction.DOWN; break;
        case 'ArrowLeft': case 'a': dir = Direction.LEFT; break;
        case 'ArrowRight': case 'd': dir = Direction.RIGHT; break;
        case ' ': dir = Direction.NONE; break; 
        case 'p': setGameState(p => ({ ...p, isPaused: !p.isPaused })); break;
      }
      if (dir !== Direction.NONE) nextDirRef.current = dir;
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState.isLevelComplete, gameState.isStarted]);

  const getNextDirBFS = (head: Position, target: Position, grid: number[][], allowSafe: boolean = false) => {
    const startX = Math.floor(head.x), startY = Math.floor(head.y);
    const targetX = Math.floor(target.x), targetY = Math.floor(target.y);
    if (startX === targetX && startY === targetY) return null;
    const queue: [number, number, Direction][] = [
      [startX, startY - 1, Direction.UP], [startX, startY + 1, Direction.DOWN],
      [startX - 1, startY, Direction.LEFT], [startX + 1, startY, Direction.RIGHT]
    ];
    const visited = new Set<string>();
    visited.add(`${startX},${startY}`);
    while (queue.length > 0) {
      const [x, y, initialDir] = queue.shift()!;
      if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) continue;
      if (!allowSafe && grid[y][x] === CellState.SAFE) continue;
      if (x === targetX && y === targetY) return initialDir;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push([x, y - 1, initialDir], [x, y + 1, initialDir], [x - 1, y, initialDir], [x + 1, y, initialDir]);
    }
    return null;
  };

  const loop = useCallback((time: number) => {
    if (gameState.isGameOver || gameState.isPaused || !gameState.isStarted) { 
      frameIdRef.current = requestAnimationFrame(loop); 
      return; 
    }
    if (!lastTimeRef.current) lastTimeRef.current = time;
    const delta = time - lastTimeRef.current;
    lastTimeRef.current = time;
    particlesRef.current = particlesRef.current.map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, life: p.life - 0.01 })).filter(p => p.life > 0);
    
    if (!gameState.isLevelComplete) {
      timerRef.current -= delta / 1000;
      if (timerRef.current <= 0) { timerRef.current = INITIAL_TIME; handleDeath(); }
      setGameState(prev => ({ ...prev, timeLeft: Math.max(0, Math.floor(timerRef.current)) }));
    }
    const grid = gridRef.current;

    // --- BUG LOGIC (PLAYER OR CPU) ---
    if (!gameState.isLevelComplete) {
      const moveSpeed = 0.16;
      if (gameState.mode === 'classic') {
        if (nextDirRef.current !== Direction.NONE) playerDirRef.current = nextDirRef.current;
      } else {
        // CPU BUG AI
        cpuDecisionCooldown.current -= delta;
        const snakeHead = snakesRef.current[0].path[0];
        const distToSnake = Math.sqrt(Math.pow(playerPosRef.current.x - snakeHead.x, 2) + Math.pow(playerPosRef.current.y - snakeHead.y, 2));
        const inSafe = grid[Math.floor(playerPosRef.current.y)][Math.floor(playerPosRef.current.x)] === CellState.SAFE;

        if (cpuDecisionCooldown.current <= 0) {
          cpuDecisionCooldown.current = 100 + Math.random() * 200; 

          if (inSafe) {
            if (distToSnake > 20) {
              const options = [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT];
              const validOptions = options.filter(d => {
                let nx = playerPosRef.current.x, ny = playerPosRef.current.y;
                if (d === Direction.UP) ny -= 2; else if (d === Direction.DOWN) ny += 2;
                else if (d === Direction.LEFT) nx -= 2; else if (d === Direction.RIGHT) nx += 2;
                return nx >= 0 && nx < GRID_WIDTH && ny >= 0 && ny < GRID_HEIGHT;
              });
              playerDirRef.current = validOptions[Math.floor(Math.random() * validOptions.length)] || Direction.NONE;
            } else {
              const dx = playerPosRef.current.x - snakeHead.x;
              const dy = playerPosRef.current.y - snakeHead.y;
              playerDirRef.current = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Direction.RIGHT : Direction.LEFT) : (dy > 0 ? Direction.DOWN : Direction.UP);
            }
          } else {
            cpuStepsInActive.current++;
            if (distToSnake < 15 || cpuStepsInActive.current > 60) {
              const dx = playerPosRef.current.x - snakeHead.x;
              const dy = playerPosRef.current.y - snakeHead.y;
              if (Math.random() < 0.3) {
                const options = [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT];
                playerDirRef.current = options[Math.floor(Math.random() * options.length)];
              } else {
                playerDirRef.current = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Direction.RIGHT : Direction.LEFT) : (dy > 0 ? Direction.DOWN : Direction.UP);
              }
            } else {
              if (Math.random() < 0.2) {
                 const options = [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT];
                 playerDirRef.current = options[Math.floor(Math.random() * options.length)];
              }
            }
          }
        }
      }

      let newX = playerPosRef.current.x, newY = playerPosRef.current.y;
      if (playerDirRef.current === Direction.UP) newY -= moveSpeed;
      else if (playerDirRef.current === Direction.DOWN) newY += moveSpeed;
      else if (playerDirRef.current === Direction.LEFT) newX -= moveSpeed;
      else if (playerDirRef.current === Direction.RIGHT) newX += moveSpeed;
      
      newX = Math.max(0, Math.min(GRID_WIDTH - 1, newX));
      newY = Math.max(0, Math.min(GRID_HEIGHT - 1, newY));
      const gx = Math.floor(newX), gy = Math.floor(newY);
      const prevGx = Math.floor(playerPosRef.current.x), prevGy = Math.floor(playerPosRef.current.y);

      if (grid[prevGy][prevGx] === CellState.SAFE && grid[gy][gx] === CellState.ACTIVE) {
        isTrailingRef.current = true;
        trailStartPosRef.current = { x: prevGx, y: prevGy };
        grid[gy][gx] = CellState.TRAIL;
        cpuStepsInActive.current = 0;
      } else if (isTrailingRef.current && grid[gy][gx] === CellState.ACTIVE) {
        grid[gy][gx] = CellState.TRAIL;
      } else if (isTrailingRef.current && grid[gy][gx] === CellState.SAFE) {
        captureArea(gameState.mode);
        if (gameState.mode === 'classic') { playerDirRef.current = Direction.NONE; nextDirRef.current = Direction.NONE; }
      }
      playerPosRef.current = { x: newX, y: newY };
    }

    // --- SNAKE LOGIC (PLAYER OR AI) ---
    snakesRef.current.forEach((snake, idx) => {
      const head = snake.path[0];
      const dirs = [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT];
      const validDirs = dirs.filter(d => {
        if (snake.direction === Direction.UP && d === Direction.DOWN) return false;
        if (snake.direction === Direction.DOWN && d === Direction.UP) return false;
        if (snake.direction === Direction.LEFT && d === Direction.RIGHT) return false;
        if (snake.direction === Direction.RIGHT && d === Direction.LEFT) return false;
        return true;
      });

      if (gameState.mode === 'snake' && idx === 0) {
        if (nextDirRef.current !== Direction.NONE) snake.direction = nextDirRef.current;
      } else {
        let changedDirection = false;
        if (isTrailingRef.current && Math.random() < 0.70) {
          if (Math.random() < 0.05) {
            const targetDir = getNextDirBFS(head, playerPosRef.current, grid);
            if (targetDir && validDirs.includes(targetDir)) { snake.direction = targetDir; changedDirection = true; }
          }
        }
        if (!changedDirection) {
          const baseChance = 0.05 + (gameState.level * 0.01);
          if (Math.random() < baseChance) snake.direction = validDirs[Math.floor(Math.random() * validDirs.length)];
        }
      }

      let sdx = 0, sdy = 0;
      if (snake.direction === Direction.UP) sdy = -snake.velocity;
      else if (snake.direction === Direction.DOWN) sdy = snake.velocity;
      else if (snake.direction === Direction.LEFT) sdx = -snake.velocity;
      else if (snake.direction === Direction.RIGHT) sdx = snake.velocity;
      
      let nextX = head.x + sdx, nextY = head.y + sdy;
      const fnx = Math.floor(nextX), fny = Math.floor(nextY);
      
      if (fnx < 0 || fnx >= GRID_WIDTH || fny < 0 || fny >= GRID_HEIGHT || grid[fny][fnx] === CellState.SAFE) {
        if (gameState.mode === 'snake' && idx === 0) { 
           snake.direction = dirs[Math.floor(Math.random() * 4)];
        }
        else snake.direction = dirs[Math.floor(Math.random() * dirs.length)];
      } else {
        snake.path = [{ x: nextX, y: nextY }, ...snake.path.slice(0, snake.path.length - 1)];
      }

      const currentHead = snake.path[0];
      const dToPlayer = Math.sqrt(Math.pow(currentHead.x - playerPosRef.current.x, 2) + Math.pow(currentHead.y - playerPosRef.current.y, 2));
      if (dToPlayer < 1.0) {
        if (gameState.mode === 'snake') {
           levelUp();
        } else {
           handleDeath();
        }
      }
      const hx = Math.floor(currentHead.x), hy = Math.floor(currentHead.y);
      if (grid[hy] && grid[hy][hx] === CellState.TRAIL) resetTrailOnly();
    });

    // DRAWING
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          const c = grid[y][x];
          if (c === CellState.SAFE) { ctx.fillStyle = COLORS.SAFE; ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE); }
          else if (c === CellState.ACTIVE) { ctx.fillStyle = COLORS.ACTIVE; ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE); }
          else if (c === CellState.TRAIL) { ctx.fillStyle = COLORS.TRAIL; const tp = CELL_SIZE * 0.45; ctx.fillRect(x * CELL_SIZE + tp, y * CELL_SIZE + tp, CELL_SIZE - tp * 2, CELL_SIZE - tp * 2); }
        }
      }
      particlesRef.current.forEach(p => { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x * CELL_SIZE, p.y * CELL_SIZE, CELL_SIZE * 0.6, CELL_SIZE * 0.6); });
      ctx.globalAlpha = 1.0;
      snakesRef.current.forEach(s => {
        for (let i = 0; i < SNAKE_LENGTH; i++) {
          const p = s.path[i * SNAKE_SEGMENT_DISTANCE];
          if (!p) continue;
          ctx.fillStyle = i === 0 ? COLORS.SNAKE_HEAD : COLORS.SNAKE;
          ctx.fillRect(p.x * CELL_SIZE, p.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          ctx.strokeStyle = '#000'; ctx.lineWidth = 0.5; ctx.strokeRect(p.x * CELL_SIZE, p.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      });
      // Draw Player/Bug
      const px = playerPosRef.current.x * CELL_SIZE, py = playerPosRef.current.y * CELL_SIZE, ps = CELL_SIZE;
      if (px > -10) { // Only draw if on screen
        ctx.fillStyle = COLORS.PLAYER; ctx.fillRect(px + ps*0.1, py + ps*0.2, ps*0.8, ps*0.6); ctx.fillRect(px + ps*0.3, py + ps*0.1, ps*0.4, ps*0.2);
        ctx.strokeStyle = COLORS.PLAYER; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(px, py + ps*0.3); ctx.lineTo(px + ps*0.2, py + ps*0.4); ctx.moveTo(px, py + ps*0.5); ctx.lineTo(px + ps*0.2, py + ps*0.5); ctx.moveTo(px, py + ps*0.7); ctx.lineTo(px + ps*0.2, py + ps*0.6);
        ctx.moveTo(px + ps, py + ps*0.3); ctx.lineTo(px + ps*0.8, py + ps*0.4); ctx.moveTo(px + ps, py + ps*0.5); ctx.lineTo(px + ps*0.8, py + ps*0.5); ctx.moveTo(px + ps, py + ps*0.7); ctx.lineTo(px + ps*0.8, py + ps*0.6);
        ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillRect(px + ps*0.35, py + ps*0.15, ps*0.1, ps*0.1); ctx.fillRect(px + ps*0.55, py + ps*0.15, ps*0.1, ps*0.1);
      }
    }
    frameIdRef.current = requestAnimationFrame(loop);
  }, [gameState.isGameOver, gameState.isPaused, gameState.isLevelComplete, gameState.isStarted, handleDeath, captureArea, resetTrailOnly, gameState.level, gameState.mode, explodeBug, explodeSnakes]);

  useEffect(() => { frameIdRef.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(frameIdRef.current); }, [loop]);

  return (
    <div className="flex h-screen w-screen bg-[#008080] font-sans overflow-hidden items-center justify-center p-4 select-none">
      
      {/* START SCREEN MODAL */}
      {!gameState.isStarted && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]">
          <div className="bg-[#c0c0c0] border-t-2 border-l-2 border-white border-b-2 border-r-2 border-[#808080] p-1 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] w-[350px]">
            <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between font-bold text-sm">
               <span>Hoşgeldiniz</span>
               <div className="flex gap-1">
                 <button className="bg-[#c0c0c0] border border-white border-b-[#808080] border-r-[#808080] px-1 text-black text-[10px] font-bold">X</button>
               </div>
            </div>
            <div className="p-4 flex flex-col items-center gap-6">
               <img src="https://win98icons.alexmeub.com/icons/png/msagent-0.png" className="w-16 h-16" alt="logo" />
               <div className="text-center">
                 <h1 className="text-xl font-bold mb-2" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>MAMBA QUEST 98</h1>
                 <p className="text-xs">Lütfen bir oyun modu seçin:</p>
               </div>
               <div className="flex gap-2 w-full">
                 <button 
                   onClick={() => startGame('classic')}
                   className="flex-1 bg-[#c0c0c0] border-t-white border-l-white border-b-[#808080] border-r-[#808080] border-2 active:border-inset p-3 flex flex-col items-center gap-2 hover:bg-[#d0d0d0]"
                 >
                   <img src="https://win98icons.alexmeub.com/icons/png/spider-0.png" className="w-10 h-10 mb-1" alt="classic" />
                   <span className="text-[9px] text-gray-700 leading-tight">Klasik: Böcek ol, alanı kapla!</span>
                 </button>
                 <button 
                   onClick={() => startGame('snake')}
                   className="flex-1 bg-[#c0c0c0] border-t-white border-l-white border-b-[#808080] border-r-[#808080] border-2 active:border-inset p-3 flex flex-col items-center gap-2 hover:bg-[#d0d0d0]"
                 >
                   <img src="https://win98icons.alexmeub.com/icons/png/joystick-2.png" className="w-10 h-10 mb-1" alt="snake" />
                   <span className="text-[9px] text-gray-700 leading-tight">Yılan: Yılan ol, böceği avla!</span>
                 </button>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* GAME UI */}
      {gameState.isStarted && (
        <div className="bg-[#c0c0c0] border-t-2 border-l-2 border-white border-b-2 border-r-2 border-[#808080] p-1 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="bg-gradient-to-r from-[#000080] to-[#1084d0] text-white px-2 py-1 flex justify-between items-center mb-1">
            <span className="font-bold flex items-center gap-2 text-sm uppercase" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>
               <img src="https://win98icons.alexmeub.com/icons/png/msagent-0.png" className="w-4 h-4" alt="icon" />
               Mamba Quest 98 - {gameState.mode === 'classic' ? 'Böcek' : 'Yılan'}
            </span>
            <div className="flex gap-1">
              <button className="bg-[#c0c0c0] border border-white border-b-[#808080] border-r-[#808080] px-1 text-black text-[10px] font-bold">_</button>
              <button onClick={() => setGameState(p => ({...p, isStarted: false}))} className="bg-[#c0c0c0] border border-white border-b-[#808080] border-r-[#808080] px-1 text-black text-[10px] font-bold">X</button>
            </div>
          </div>

          <div className="flex gap-1">
            <div className="bg-black border-2 border-inset border-[#808080] shadow-[inset_2px_2px_0px_rgba(0,0,0,1)]">
              <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
            </div>

            <div className="w-[200px] flex flex-col gap-2">
              <div className="bg-[#c0c0c0] border-t-[#808080] border-l-[#808080] border-b-white border-r-white border p-3 flex flex-col gap-3">
                <div>
                  <label className="text-[10px] text-gray-700 uppercase block mb-1 font-bold" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>PUAN</label>
                  <div className="bg-black text-[#00ff00] p-1 text-xl font-mono text-right border-inset border-2 border-[#808080]">
                    {String(gameState.score).padStart(6, '0')}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-700 uppercase block mb-1 font-bold" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>CANLAR</label>
                  <div className="flex justify-center bg-[#b0b0b0] p-1 border-inset border border-[#808080] h-8 items-center">
                    {[...Array(3)].map((_, i) => <HeartIcon key={i} filled={i < gameState.lives} />)}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-700 uppercase block mb-1 font-bold" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>
                    {gameState.mode === 'classic' ? 'ALAN HEDEFİ (%80)' : 'AV DURUMU'}
                  </label>
                  <div className="h-5 w-full bg-white border-inset border-2 border-[#808080] relative">
                    <div className="h-full bg-[#000080]" style={{ width: `${gameState.mode === 'classic' ? gameState.percentageCaptured : (100 - gameState.percentageCaptured)}%` }} />
                    <span className="absolute inset-0 text-[10px] flex items-center justify-center mix-blend-difference text-white font-bold">
                      {gameState.mode === 'classic' ? `%${gameState.percentageCaptured}` : (gameState.isLevelComplete ? 'AVLANDI!' : 'AVLA!')}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs border-t border-[#808080] pt-2" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>
                  <span className="font-bold">BÖLÜM:</span>
                  <span className="font-mono">{gameState.level}</span>
                </div>
                <div className="flex justify-between items-center text-xs" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>
                  <span className="font-bold">SÜRE:</span>
                  <span className={`font-mono ${gameState.timeLeft < 10 ? 'text-red-600 animate-pulse' : ''}`}>{gameState.timeLeft}s</span>
                </div>
              </div>

              <div className="flex flex-col gap-1 mt-auto">
                <button onClick={() => setGameState(p => ({...p, isStarted: false}))} className="bg-[#c0c0c0] border-t-white border-l-white border-b-[#808080] border-r-[#808080] border-2 active:border-inset p-1 text-xs font-bold shadow-sm" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>Yeni Oyuna Başla</button>
                <button onClick={() => setGameState(p => ({...p, isPaused: !p.isPaused}))} className="bg-[#c0c0c0] border-t-white border-l-white border-b-[#808080] border-r-[#808080] border-2 active:border-inset p-1 text-xs font-bold shadow-sm" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>
                  {gameState.isPaused ? 'Devam' : 'Durdur'}
                </button>
              </div>
            </div>
          </div>
          
          <div className="mt-1 bg-[#c0c0c0] border border-[#808080] p-0.5 text-[10px] flex gap-4 text-gray-700 border-t-[#808080] border-l-[#808080] border-b-white border-r-white" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>
            <div className="px-2 border-r border-[#808080]">Kontrol: {gameState.mode === 'classic' ? 'Böcek' : 'Yılan'}</div>
            <div className="px-2 border-r border-[#808080]">P: Duraklat</div>
            <div className="px-2">Hedef: {gameState.mode === 'classic' ? '%80 Alan' : 'Böceği Yakala'}</div>
          </div>
        </div>
      )}

      {/* GAME OVER DIALOG */}
      {gameState.isGameOver && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[200]">
          <div className="bg-[#c0c0c0] border-2 border-white shadow-2xl p-4 max-w-xs w-full">
            <div className="bg-[#000080] text-white px-2 py-0.5 mb-4 text-xs font-bold uppercase" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>Sistem Mesajı</div>
            <p className="mb-6 font-sans text-xs text-black" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>Oyun bitti. Skorunuz: {gameState.score}. Modu değiştirmek için Yeni Oyun'u seçin.</p>
            <div className="text-center">
              <button onClick={() => setGameState(p => ({...p, isStarted: false}))} className="bg-[#c0c0c0] border-t-white border-l-white border-b-2 border-r-2 border-[#808080] border px-6 py-1 text-xs font-bold hover:bg-[#d0d0d0]" style={{ fontFamily: "'MS Sans Serif', sans-serif" }}>TAMAM</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
