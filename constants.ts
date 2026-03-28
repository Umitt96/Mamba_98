
export const GRID_WIDTH = 70;
export const GRID_HEIGHT = 56;
export const CELL_SIZE = 10; 
export const CANVAS_WIDTH = GRID_WIDTH * CELL_SIZE;
export const CANVAS_HEIGHT = GRID_HEIGHT * CELL_SIZE;

export const SNAKE_LENGTH = 13; // Yılan uzunluğu 13 blok olarak sabitlendi
export const SNAKE_SEGMENT_DISTANCE = 4; // Segmentler arası mesafe
export const INITIAL_TIME = 90; 
export const CAPTURE_THRESHOLD = 80;

export const COLORS = {
  SAFE: '#c0c0c0',      // Windows 98 Grisi
  ACTIVE: '#008080',    // Masaüstü Turkuazı
  TRAIL: '#000000',     // Siyah İp (İnce olacak)
  PLAYER: '#000000',    // Örümcek/Böcek
  SNAKE: '#00ff00',     // Yeşil Yılan
  SNAKE_HEAD: '#ff0000',// Kırmızı Yılan Kafası
  BORDER: '#808080'     
};
