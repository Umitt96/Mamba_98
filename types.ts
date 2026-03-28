
export enum CellState {
  ACTIVE = 0,    
  SAFE = 1,      
  TRAIL = 2      
}

export interface Position {
  x: number;
  y: number;
}

export enum Direction {
  UP = 'UP',
  DOWN = 'DOWN',
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
  NONE = 'NONE'
}

export interface Snake {
  path: Position[]; // Hareket geçmişi
  direction: Direction;
  velocity: number;
}

export interface GameState {
  score: number;
  level: number;
  lives: number;
  timeLeft: number;
  percentageCaptured: number;
  isGameOver: boolean;
  isPaused: boolean;
}
