import type {
  BaseToolType,
  BiomeType,
  CommunityLevelDoc,
  DifficultyLevel,
  GameObjectiveMode,
  LevelConfig,
  RatSex,
  ToolSlotConfig,
  TunnelPair,
} from './types';

export function makeToolsForDifficulty(difficulty: number): Record<BaseToolType, ToolSlotConfig> {
  // difficulty in [0..29]
  // Speed hierarchy: bomb (fastest) < tempWall < mutagen < nuclear < gas < poison (slowest)
  // Normal tool max capacity is always 5 for every tool; only regen time varies.
  const scale = 1 + (difficulty / 29) * 0.52;
  return {
    bomb: { start: 3, max: 5, regenSec: Number((5.0 * scale).toFixed(1)) },
    tempWall: { start: 3, max: 5, regenSec: Number((7.5 * scale).toFixed(1)) },
    mutagen: { start: 2, max: 5, regenSec: Number((9.2 * scale).toFixed(1)) },
    nuclear: { start: 1, max: 5, regenSec: Number((10.4 * scale).toFixed(1)) },
    gas: { start: 2, max: 5, regenSec: Number((11.8 * scale).toFixed(1)) },
    poison: { start: 2, max: 5, regenSec: Number((14.8 * scale).toFixed(1)) },
  };
}

export function getCreatorDifficultyDefaults(diff: DifficultyLevel): {
  toolTier: number;
  ratSpeed: number;
  breedCooldown: number;
} {
  if (diff === 'easy') return { toolTier: 4, ratSpeed: 2.45, breedCooldown: 5.0 };
  if (diff === 'hard') return { toolTier: 23, ratSpeed: 3.15, breedCooldown: 3.7 };
  return { toolTier: 12, ratSpeed: 2.8, breedCooldown: 4.3 };
}

export function communityLevelToConfig(doc: CommunityLevelDoc): LevelConfig {
  const tier = doc.difficulty === 'easy' ? 4 : doc.difficulty === 'hard' ? 23 : 12;
  return {
    id: 0,
    name: doc.title,
    subtitle: doc.description,
    biome: doc.biome,
    objectiveMode: doc.objectiveMode ?? 'eradication',
    targetDurationSec: doc.targetDurationSec ?? 180,
    targetKills: doc.targetKills ?? 40,
    customWallColor: doc.customWallColor || undefined,
    customFloorColor: doc.customFloorColor || undefined,
    isCommunity: true,
    communityId: doc.id,
    authorName: doc.authorName,
    creatorDifficulty: doc.difficulty,
    layout: doc.layout,
    tunnels: doc.tunnels.map((t) => ({
      id: t.id,
      kind: t.kind,
      a: [t.ax, t.ay],
      b: [t.bx, t.by],
      color: `#${t.hex.toString(16).padStart(6, '0')}`,
      hex: t.hex,
    })),
    initialRats: doc.initialRats,
    criticalLimit: doc.criticalLimit,
    rewardCredits: 0,
    tools: makeToolsForDifficulty(tier),
    ratSpeed: doc.ratSpeed,
    breedCooldown: doc.breedCooldown,
  };
}

// =============================================================================
// Deterministic Vertical/Square Architectural Maze Builder (Levels 6 - 30)
// Guarantees connected walkable corridors, symmetric layout, valid wall holes &
// valid rat spawns from 19x23 up to 70x70.
// =============================================================================
interface ProceduralSpec {
  id: number;
  name: string;
  subtitle: string;
  biome: BiomeType;
  objectiveMode?: GameObjectiveMode;
  targetDurationSec?: number;
  targetKills?: number;
  cols: number;
  rows: number;
  ratCount: number;
  tunnelPairs: number;
  criticalLimit: number;
  rewardCredits: number;
  ratSpeed: number;
  breedCooldown: number;
}

const TUNNEL_PALETTE: Array<{ color: string; hex: number }> = [
  { color: '#38bdf8', hex: 0x38bdf8 },
  { color: '#f59e0b', hex: 0xf59e0b },
  { color: '#ec4899', hex: 0xec4899 },
  { color: '#a3e635', hex: 0xa3e635 },
];

function createSeededRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function ensureFullyConnected(grid: string[][]): void {
  const rows = grid.length;
  const cols = grid[0].length;
  grid[1][1] = '.';

  const dirs: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const markVisited = (): Set<string> => {
    const visited = new Set<string>();
    const queue: Array<[number, number]> = [[1, 1]];
    visited.add('1,1');
    let head = 0;
    while (head < queue.length) {
      const [cx, cy] = queue[head++];
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx > 0 && nx < cols - 1 && ny > 0 && ny < rows - 1 && grid[ny][nx] === '.') {
          const k = `${nx},${ny}`;
          if (!visited.has(k)) {
            visited.add(k);
            queue.push([nx, ny]);
          }
        }
      }
    }
    return visited;
  };

  let visited = markVisited();
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[r][c] === '.' && !visited.has(`${c},${r}`)) {
        // Carve straight L-corridor toward (1,1) or nearest visited cell
        let tx = c;
        let ty = r;
        let safety = cols + rows;
        while (safety-- > 0 && !visited.has(`${tx},${ty}`)) {
          if (tx > 1 && (ty <= 1 || tx % 2 === 1)) tx -= 1;
          else if (ty > 1) ty -= 1;
          else break;
          grid[ty][tx] = '.';
        }
        visited = markVisited();
      }
    }
  }
}

function hasCardWalkableNeighbor(grid: string[][], c: number, r: number): boolean {
  const rows = grid.length;
  const cols = grid[0].length;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  return dirs.some(([dx, dy]) => {
    const nc = c + dx;
    const nr = r + dy;
    return nc > 0 && nc < cols - 1 && nr > 0 && nr < rows - 1 && grid[nr][nc] === '.';
  });
}

function buildProceduralLevel(spec: ProceduralSpec): LevelConfig {
  const { cols, rows, biome, id } = spec;
  const rng = createSeededRng(id * 977 + cols * 31 + rows * 17);

  // Initialize outer wall border & walkable perimeter
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const rowArr: string[] = [];
    for (let c = 0; c < cols; c++) {
      const isOuter = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      rowArr.push(isOuter ? '#' : '.');
    }
    grid.push(rowArr);
  }

  const midC = Math.floor(cols / 2);
  const midR = Math.floor(rows / 2);

  if (biome === 'city') {
    // Crisp city blocks separated by 1-cell avenues (step 4 vertically & horizontally)
    for (let r = 2; r < rows - 2; r++) {
      for (let c = 2; c <= midC; c++) {
        const blockRow = r % 4 !== 1;
        const blockCol = c % 4 !== 1;
        if (blockRow && blockCol) {
          // Occasionally leave small alley courtyard inside big blocks
          const isAlleyGap = rng() < 0.14;
          if (!isAlleyGap) {
            grid[r][c] = '#';
            grid[r][cols - 1 - c] = '#';
          }
        }
      }
    }
    // Cross-city central avenues
    for (let c = 1; c < cols - 1; c++) grid[midR][c] = '.';
    for (let r = 1; r < rows - 1; r++) grid[r][midC] = '.';
  } else if (biome === 'lava') {
    // Diamond-shaped volcanic islands (inspired by Rats! Level 32)
    const spacing = cols >= 52 ? 10 : 8;
    const radius = cols >= 52 ? 3 : 2;
    for (let cy = 4; cy < rows - 4; cy += spacing) {
      for (let cx = 4; cx < cols - 4; cx += spacing) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const rr = cy + dy;
            const cc = cx + dx;
            if (rr <= 1 || rr >= rows - 2 || cc <= 1 || cc >= cols - 2) continue;
            if (Math.abs(dx) + Math.abs(dy) <= radius) {
              grid[rr][cc] = '#';
            }
          }
        }
      }
    }
    // Add basalt maze ribs in open lanes
    for (let r = 2; r < rows - 2; r += 2) {
      for (let c = 2; c <= midC; c += 2) {
        if (r % 4 === 0 && c % 4 === 0 && rng() < 0.45) {
          grid[r][c] = '#';
          grid[r][cols - 1 - c] = '#';
        }
      }
    }
  } else if (biome === 'sand') {
    // Concentric sandstone courtyard rings with symmetric gates
    for (let ring = 2; ring < Math.min(midC, midR) - 1; ring += 3) {
      const rTop = ring;
      const rBot = rows - 1 - ring;
      const cLeft = ring;
      const cRight = cols - 1 - ring;
      for (let c = cLeft; c <= cRight; c++) {
        if (Math.abs(c - midC) > 1 && c % 5 !== 0) {
          grid[rTop][c] = '#';
          grid[rBot][c] = '#';
        }
      }
      for (let r = rTop; r <= rBot; r++) {
        if (Math.abs(r - midR) > 1 && r % 5 !== 0) {
          grid[r][cLeft] = '#';
          grid[r][cRight] = '#';
        }
      }
    }
    // Colonnade pillars inside wider lanes
    for (let r = 3; r < rows - 3; r += 3) {
      for (let c = 3; c <= midC; c += 3) {
        if (rng() < 0.42) {
          grid[r][c] = '#';
          grid[r][cols - 1 - c] = '#';
        }
      }
    }
  } else if (biome === 'ice') {
    // Fractured glacial lattice with long vertical corridors
    for (let r = 2; r < rows - 2; r++) {
      for (let c = 2; c <= midC; c++) {
        const isPillar = r % 2 === 0 && c % 2 === 0;
        const isVWall = c % 4 === 2 && r % 6 !== 0 && rng() < 0.72;
        const isHWall = r % 4 === 2 && c % 5 !== 0 && rng() < 0.48;
        if (isPillar || isVWall || isHWall) {
          grid[r][c] = '#';
          grid[r][cols - 1 - c] = '#';
        }
      }
    }
    for (let r = 1; r < rows - 1; r++) {
      grid[r][1] = '.';
      grid[r][cols - 2] = '.';
      grid[r][midC] = '.';
    }
  } else {
    // Moon: concentric crater rings + deep vertical basalt trenches
    const maxRing = Math.min(midC, midR) - 2;
    for (let r = 2; r < rows - 2; r++) {
      for (let c = 2; c <= midC; c++) {
        const dr = Math.abs(r - midR);
        const dc = Math.abs(c - midC);
        const dist = Math.max(dr, dc);
        const isRing = dist > 2 && dist <= maxRing && dist % 4 === 0;
        const gate = dr <= 1 || dc <= 1 || ((c + r) % 7 === 0);
        if (isRing && !gate) {
          grid[r][c] = '#';
          grid[r][cols - 1 - c] = '#';
        } else if (r % 3 === 0 && c % 3 === 0 && rng() < 0.58) {
          grid[r][c] = '#';
          grid[r][cols - 1 - c] = '#';
        }
      }
    }
    for (let c = 1; c < cols - 1; c++) grid[midR][c] = '.';
    for (let r = 1; r < rows - 1; r++) grid[r][midC] = '.';
  }

  // Ensure crisp walkable outer inner-ring so perimeter patrols always flow
  for (let c = 1; c < cols - 1; c++) {
    grid[1][c] = '.';
    grid[rows - 2][c] = '.';
  }
  for (let r = 1; r < rows - 1; r++) {
    grid[r][1] = '.';
    grid[r][cols - 2] = '.';
  }

  ensureFullyConnected(grid);

  // Collect all walkable floor tiles & interior wall-hole candidates
  const floorCells: Array<[number, number]> = [];
  const wallHoleCandidates: Array<[number, number]> = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      if (grid[r][c] === '.') {
        floorCells.push([c, r]);
      } else if (r >= 2 && r <= rows - 3 && c >= 2 && c <= cols - 3 && hasCardWalkableNeighbor(grid, c, r)) {
        wallHoleCandidates.push([c, r]);
      }
    }
  }

  const pickNearestFloor = (tc: number, tr: number, used: Set<string>): [number, number] => {
    let best: [number, number] = floorCells[0];
    let bestDist = Infinity;
    for (const [fc, fr] of floorCells) {
      const k = `${fc},${fr}`;
      if (used.has(k)) continue;
      const d = (fc - tc) * (fc - tc) + (fr - tr) * (fr - tr);
      if (d < bestDist) {
        bestDist = d;
        best = [fc, fr];
      }
    }
    used.add(`${best[0]},${best[1]}`);
    return best;
  };

  const pickNearestWallHole = (tc: number, tr: number, used: Set<string>): [number, number] | null => {
    let best: [number, number] | null = null;
    let bestDist = Infinity;
    for (const [wc, wr] of wallHoleCandidates) {
      const k = `${wc},${wr}`;
      if (used.has(k)) continue;
      const d = (wc - tc) * (wc - tc) + (wr - tr) * (wr - tr);
      if (d < bestDist) {
        bestDist = d;
        best = [wc, wr];
      }
    }
    if (best) used.add(`${best[0]},${best[1]}`);
    return best;
  };

  const usedCells = new Set<string>();
  const tunnels: TunnelPair[] = [];

  const tunnelAnchorPairs: Array<{
    kind: 'floor' | 'wall';
    a: [number, number];
    b: [number, number];
  }> = [
    { kind: 'floor', a: [2, 2], b: [cols - 3, rows - 3] },
    { kind: 'wall', a: [midC, Math.floor(rows * 0.28)], b: [midC, Math.floor(rows * 0.72)] },
    { kind: 'floor', a: [cols - 3, 2], b: [2, rows - 3] },
    { kind: 'wall', a: [Math.floor(cols * 0.28), midR], b: [Math.floor(cols * 0.72), midR] },
  ];

  for (let i = 0; i < Math.min(spec.tunnelPairs, tunnelAnchorPairs.length); i++) {
    const anch = tunnelAnchorPairs[i];
    const pal = TUNNEL_PALETTE[i % TUNNEL_PALETTE.length];
    if (anch.kind === 'floor') {
      const a = pickNearestFloor(anch.a[0], anch.a[1], usedCells);
      const b = pickNearestFloor(anch.b[0], anch.b[1], usedCells);
      tunnels.push({
        id: String.fromCharCode(65 + i),
        kind: 'floor',
        a,
        b,
        color: pal.color,
        hex: pal.hex,
      });
    } else {
      const wa = pickNearestWallHole(anch.a[0], anch.a[1], usedCells);
      const wb = pickNearestWallHole(anch.b[0], anch.b[1], usedCells);
      if (wa && wb) {
        tunnels.push({
          id: String.fromCharCode(65 + i),
          kind: 'wall',
          a: wa,
          b: wb,
          color: pal.color,
          hex: pal.hex,
        });
      } else {
        const a = pickNearestFloor(anch.a[0], anch.a[1], usedCells);
        const b = pickNearestFloor(anch.b[0], anch.b[1], usedCells);
        tunnels.push({
          id: String.fromCharCode(65 + i),
          kind: 'floor',
          a,
          b,
          color: pal.color,
          hex: pal.hex,
        });
      }
    }
  }

  // Spread initial rats across symmetric grid bands on valid floor tiles
  const initialRats: Array<{ col: number; row: number; sex: RatSex }> = [];
  const bandCols = 4;
  const bandRows = Math.ceil(spec.ratCount / bandCols);
  for (let i = 0; i < spec.ratCount; i++) {
    const bx = i % bandCols;
    const by = Math.floor(i / bandCols);
    const tc = Math.round(((bx + 0.5) / bandCols) * (cols - 2)) + 1;
    const tr = Math.round(((by + 0.5) / Math.max(1, bandRows)) * (rows - 2)) + 1;
    const [rc, rr] = pickNearestFloor(tc, tr, usedCells);
    initialRats.push({
      col: rc,
      row: rr,
      sex: i % 2 === 0 ? 'M' : 'F',
    });
  }

  return {
    id: spec.id,
    name: spec.name,
    subtitle: spec.subtitle,
    biome: spec.biome,
    objectiveMode: spec.objectiveMode ?? 'eradication',
    targetDurationSec: spec.targetDurationSec,
    targetKills: spec.targetKills,
    layout: grid.map((r) => r.join('')),
    tunnels,
    initialRats,
    criticalLimit: spec.criticalLimit,
    rewardCredits: spec.rewardCredits,
    tools: makeToolsForDifficulty(spec.id - 1),
    ratSpeed: spec.ratSpeed,
    breedCooldown: spec.breedCooldown,
  };
}

// Hand-crafted first 5 Garden levels (17x17 -> 17x17 -> 17x19 -> 17x19 -> 19x19)
const GARDEN_LEVELS: LevelConfig[] = [
  {
    id: 1,
    name: 'Giardino Classico',
    subtitle: 'Ispirato al Livello 1 originale: grande isola centrale e tane nei muri.',
    biome: 'grass',
    layout: [
      '#################',
      '#...#...#...#...#',
      '#...............#',
      '#.###.#####.###.#',
      '#.#...#####...#.#',
      '#.#...#####...#.#',
      '#.....#####.....#',
      '#.#...#####...#.#',
      '#.#...#####...#.#',
      '#.#...#####...#.#',
      '#.....#####.....#',
      '#.#...#####...#.#',
      '#.#...#####...#.#',
      '#.###.#####.###.#',
      '#...............#',
      '#...#.......#...#',
      '#################',
    ],
    tunnels: [
      { id: 'A', kind: 'wall', a: [6, 3], b: [10, 3], color: '#38bdf8', hex: 0x38bdf8 },
      { id: 'B', kind: 'wall', a: [8, 13], b: [8, 3], color: '#fbbf24', hex: 0xfbbf24 },
    ],
    initialRats: [
      { col: 1, row: 2, sex: 'M' },
      { col: 3, row: 2, sex: 'F' },
      { col: 13, row: 2, sex: 'M' },
      { col: 15, row: 2, sex: 'F' },
      { col: 1, row: 6, sex: 'M' },
      { col: 15, row: 6, sex: 'F' },
      { col: 4, row: 14, sex: 'F' },
      { col: 12, row: 14, sex: 'M' },
    ],
    criticalLimit: 55,
    rewardCredits: 120,
    tools: makeToolsForDifficulty(0),
    ratSpeed: 2.35,
    breedCooldown: 5.2,
  },
  {
    id: 2,
    name: 'Cortili del Prato',
    subtitle: 'Doppio anello verde con passaggi collegati tra siepi e pavimento.',
    biome: 'grass',
    layout: [
      '#################',
      '#.....#...#.....#',
      '#.###.#.#.#.###.#',
      '#...#.......#...#',
      '###.#.#####.#.###',
      '#...............#',
      '#.###.##.##.###.#',
      '#.#...........#.#',
      '#.#.###.#.###.#.#',
      '#.#...........#.#',
      '#.###.##.##.###.#',
      '#...............#',
      '###.#.#####.#.###',
      '#...#.......#...#',
      '#.###.#.#.#.###.#',
      '#.....#...#.....#',
      '#################',
    ],
    tunnels: [
      { id: 'A', kind: 'floor', a: [1, 1], b: [15, 15], color: '#38bdf8', hex: 0x38bdf8 },
      { id: 'B', kind: 'wall', a: [8, 8], b: [1, 4], color: '#f59e0b', hex: 0xf59e0b },
    ],
    initialRats: [
      { col: 2, row: 1, sex: 'M' },
      { col: 4, row: 1, sex: 'F' },
      { col: 12, row: 1, sex: 'M' },
      { col: 14, row: 1, sex: 'F' },
      { col: 4, row: 5, sex: 'M' },
      { col: 12, row: 5, sex: 'F' },
      { col: 4, row: 11, sex: 'F' },
      { col: 12, row: 11, sex: 'M' },
      { col: 2, row: 15, sex: 'F' },
      { col: 14, row: 15, sex: 'M' },
    ],
    criticalLimit: 62,
    rewardCredits: 145,
    tools: makeToolsForDifficulty(1),
    ratSpeed: 2.42,
    breedCooldown: 5.0,
  },
  {
    id: 3,
    name: 'Siepi Ramificate',
    subtitle: 'Ispirato al Livello 3 classico: incroci fitti e vicoli ciechi nel prato.',
    biome: 'grass',
    layout: [
      '#################',
      '#.#...#...#...#.#',
      '#...#.......#...#',
      '###.#.#####.#.###',
      '#...#...#...#...#',
      '#.#####.#.#####.#',
      '#.......#.......#',
      '###.#.#####.#.###',
      '#...#.......#...#',
      '#.###.##.##.###.#',
      '#...#.......#...#',
      '###.#.#####.#.###',
      '#.......#.......#',
      '#.#####.#.#####.#',
      '#...#...#...#...#',
      '###.#.#####.#.###',
      '#...#.......#...#',
      '#.#...#...#...#.#',
      '#################',
    ],
    tunnels: [
      { id: 'A', kind: 'floor', a: [1, 2], b: [15, 16], color: '#38bdf8', hex: 0x38bdf8 },
      { id: 'B', kind: 'wall', a: [8, 3], b: [8, 15], color: '#f472b6', hex: 0xf472b6 },
    ],
    initialRats: [
      { col: 3, row: 2, sex: 'M' },
      { col: 7, row: 2, sex: 'F' },
      { col: 9, row: 2, sex: 'M' },
      { col: 13, row: 2, sex: 'F' },
      { col: 2, row: 6, sex: 'F' },
      { col: 14, row: 6, sex: 'M' },
      { col: 5, row: 10, sex: 'M' },
      { col: 11, row: 10, sex: 'F' },
      { col: 3, row: 16, sex: 'F' },
      { col: 13, row: 16, sex: 'M' },
    ],
    criticalLimit: 68,
    rewardCredits: 170,
    tools: makeToolsForDifficulty(2),
    ratSpeed: 2.48,
    breedCooldown: 4.9,
  },
  {
    id: 4,
    name: 'Labirinto della Serra',
    subtitle: 'Aiuole simmetriche e passaggi rapidi verticali tra prato e siepi.',
    biome: 'grass',
    layout: [
      '#################',
      '#.....#...#.....#',
      '#.###.#.#.#.###.#',
      '#.#...........#.#',
      '#.#.###.#.###.#.#',
      '#...#.......#...#',
      '###.#.#####.#.###',
      '#.....#...#.....#',
      '#.###.#.#.#.###.#',
      '#...............#',
      '#.###.#.#.#.###.#',
      '#.....#...#.....#',
      '###.#.#####.#.###',
      '#...#.......#...#',
      '#.#.###.#.###.#.#',
      '#.#...........#.#',
      '#.###.#.#.#.###.#',
      '#.....#...#.....#',
      '#################',
    ],
    tunnels: [
      { id: 'A', kind: 'floor', a: [1, 1], b: [15, 17], color: '#38bdf8', hex: 0x38bdf8 },
      { id: 'B', kind: 'wall', a: [8, 6], b: [8, 12], color: '#fbbf24', hex: 0xfbbf24 },
    ],
    initialRats: [
      { col: 2, row: 1, sex: 'M' },
      { col: 8, row: 1, sex: 'F' },
      { col: 14, row: 1, sex: 'M' },
      { col: 5, row: 5, sex: 'F' },
      { col: 11, row: 5, sex: 'M' },
      { col: 3, row: 9, sex: 'M' },
      { col: 13, row: 9, sex: 'F' },
      { col: 5, row: 13, sex: 'F' },
      { col: 11, row: 13, sex: 'M' },
      { col: 2, row: 17, sex: 'F' },
      { col: 14, row: 17, sex: 'M' },
    ],
    criticalLimit: 72,
    rewardCredits: 190,
    tools: makeToolsForDifficulty(3),
    ratSpeed: 2.54,
    breedCooldown: 4.8,
  },
  {
    id: 5,
    name: 'Giardino Reale',
    subtitle: 'Grande tenuta verde 19×19 con doppie gallerie e incroci multipli.',
    biome: 'grass',
    layout: [
      '###################',
      '#.....#.....#.....#',
      '#.###.#.###.#.###.#',
      '#.#...#.....#...#.#',
      '#.#.###.###.###.#.#',
      '#.......#.#.......#',
      '###.###.#.#.###.###',
      '#.................#',
      '#.###.##.#.##.###.#',
      '#.....#.....#.....#',
      '#.###.##.#.##.###.#',
      '#.................#',
      '###.###.#.#.###.###',
      '#.......#.#.......#',
      '#.#.###.###.###.#.#',
      '#.#...#.....#...#.#',
      '#.###.#.###.#.###.#',
      '#.....#.....#.....#',
      '###################',
    ],
    tunnels: [
      { id: 'A', kind: 'floor', a: [1, 9], b: [17, 9], color: '#38bdf8', hex: 0x38bdf8 },
      { id: 'B', kind: 'floor', a: [1, 1], b: [17, 17], color: '#ec4899', hex: 0xec4899 },
      { id: 'C', kind: 'wall', a: [9, 2], b: [9, 16], color: '#fbbf24', hex: 0xfbbf24 },
    ],
    initialRats: [
      { col: 2, row: 1, sex: 'M' },
      { col: 9, row: 1, sex: 'F' },
      { col: 16, row: 1, sex: 'M' },
      { col: 5, row: 5, sex: 'F' },
      { col: 13, row: 5, sex: 'M' },
      { col: 4, row: 9, sex: 'M' },
      { col: 14, row: 9, sex: 'F' },
      { col: 5, row: 13, sex: 'F' },
      { col: 13, row: 13, sex: 'M' },
      { col: 2, row: 17, sex: 'F' },
      { col: 9, row: 17, sex: 'M' },
      { col: 16, row: 17, sex: 'F' },
    ],
    criticalLimit: 76,
    rewardCredits: 215,
    tools: makeToolsForDifficulty(4),
    ratSpeed: 2.58,
    breedCooldown: 4.7,
  },
];

// Progressive vertical / square specifications for Levels 6 - 30 up to 70x70
const PROCEDURAL_SPECS: ProceduralSpec[] = [
  // DESERT (Levels 6 - 10)
  {
    id: 6,
    name: 'Dune e Oasi',
    subtitle: 'Sabbia dorata e tane nascoste tra i blocchi di arenaria.',
    biome: 'sand',
    cols: 19,
    rows: 23,
    ratCount: 10,
    tunnelPairs: 2,
    criticalLimit: 78,
    rewardCredits: 235,
    ratSpeed: 2.62,
    breedCooldown: 4.6,
  },
  {
    id: 7,
    name: 'Rovine di Arenaria',
    subtitle: 'Camere simmetriche collegate da stretti varchi nei muri.',
    biome: 'sand',
    cols: 21,
    rows: 25,
    ratCount: 12,
    tunnelPairs: 3,
    criticalLimit: 82,
    rewardCredits: 260,
    ratSpeed: 2.68,
    breedCooldown: 4.5,
  },
  {
    id: 8,
    name: 'Cittadella del Sole',
    subtitle: 'Lunghe corsie verticali desertiche: intercetta i ratti con gas e barriere.',
    biome: 'sand',
    objectiveMode: 'survival',
    targetDurationSec: 180,
    cols: 23,
    rows: 27,
    ratCount: 13,
    tunnelPairs: 3,
    criticalLimit: 86,
    rewardCredits: 285,
    ratSpeed: 2.74,
    breedCooldown: 4.4,
  },
  {
    id: 9,
    name: 'Tempio delle Sabbie',
    subtitle: 'Colonnati di arenaria e tre coppie di tunnel per aggiramenti continui.',
    biome: 'sand',
    cols: 25,
    rows: 29,
    ratCount: 14,
    tunnelPairs: 3,
    criticalLimit: 90,
    rewardCredits: 310,
    ratSpeed: 2.8,
    breedCooldown: 4.3,
  },
  {
    id: 10,
    name: 'Piramide Sepolta',
    subtitle: 'Anelli concentrici nel deserto profondo: sigilla gli accessi centrali.',
    biome: 'sand',
    cols: 27,
    rows: 31,
    ratCount: 15,
    tunnelPairs: 3,
    criticalLimit: 94,
    rewardCredits: 340,
    ratSpeed: 2.84,
    breedCooldown: 4.2,
  },

  // CITY (Levels 11 - 15)
  {
    id: 11,
    name: 'Vicoli del Centro',
    subtitle: 'Isolati di mattoni e strade asfaltate con tombini collegati.',
    biome: 'city',
    cols: 29,
    rows: 35,
    ratCount: 14,
    tunnelPairs: 3,
    criticalLimit: 96,
    rewardCredits: 370,
    ratSpeed: 2.88,
    breedCooldown: 4.15,
  },
  {
    id: 12,
    name: 'Incrocio Metropolitano',
    subtitle: 'Grandi viali verticali ideali per bombe in croce e blocchi stradali.',
    biome: 'city',
    cols: 31,
    rows: 37,
    ratCount: 15,
    tunnelPairs: 3,
    criticalLimit: 100,
    rewardCredits: 395,
    ratSpeed: 2.92,
    breedCooldown: 4.1,
  },
  {
    id: 13,
    name: 'Quartiere Industriale',
    subtitle: 'Capannoni serrati con condotti nei muri per spostamenti rapidi.',
    biome: 'city',
    objectiveMode: 'target_kills',
    targetKills: 45,
    cols: 33,
    rows: 39,
    ratCount: 16,
    tunnelPairs: 3,
    criticalLimit: 104,
    rewardCredits: 425,
    ratSpeed: 2.96,
    breedCooldown: 4.0,
  },
  {
    id: 14,
    name: 'Fognature Urbane',
    subtitle: 'Condotte parallele sotto la città con 4 coppie di tombini attivi.',
    biome: 'city',
    objectiveMode: 'survival',
    targetDurationSec: 180,
    cols: 35,
    rows: 41,
    ratCount: 17,
    tunnelPairs: 4,
    criticalLimit: 108,
    rewardCredits: 455,
    ratSpeed: 3.0,
    breedCooldown: 3.95,
  },
  {
    id: 15,
    name: 'Grattacieli e Piazze',
    subtitle: 'Quartiere fitto di torri e piazze collegate da tunnel sotterranei.',
    biome: 'city',
    cols: 37,
    rows: 43,
    ratCount: 18,
    tunnelPairs: 4,
    criticalLimit: 112,
    rewardCredits: 485,
    ratSpeed: 3.04,
    breedCooldown: 3.9,
  },

  // ICE (Levels 16 - 20)
  {
    id: 16,
    name: 'Lastra Artica',
    subtitle: 'Corridoi ghiacciati e tane verticali nei blocchi di ghiaccio compatto.',
    biome: 'ice',
    cols: 39,
    rows: 45,
    ratCount: 18,
    tunnelPairs: 3,
    criticalLimit: 114,
    rewardCredits: 515,
    ratSpeed: 3.08,
    breedCooldown: 3.85,
  },
  {
    id: 17,
    name: 'Cripta di Cristallo',
    subtitle: 'Grandi saloni di ghiaccio: incrocia le bombe tra le colonne.',
    biome: 'ice',
    cols: 41,
    rows: 47,
    ratCount: 19,
    tunnelPairs: 4,
    criticalLimit: 118,
    rewardCredits: 545,
    ratSpeed: 3.12,
    breedCooldown: 3.8,
  },
  {
    id: 18,
    name: 'Labirinto Polare',
    subtitle: 'Griglia glaciale estesa con 4 coppie di tunnel su pavimento e muri.',
    biome: 'ice',
    objectiveMode: 'survival',
    targetDurationSec: 180,
    cols: 43,
    rows: 49,
    ratCount: 20,
    tunnelPairs: 4,
    criticalLimit: 122,
    rewardCredits: 580,
    ratSpeed: 3.16,
    breedCooldown: 3.75,
  },
  {
    id: 19,
    name: 'Ghiacciaio Fratturato',
    subtitle: 'Crepacci incrociati e isole di ghiaccio con doppi varchi nei muri.',
    biome: 'ice',
    objectiveMode: 'target_kills',
    targetKills: 55,
    cols: 45,
    rows: 51,
    ratCount: 21,
    tunnelPairs: 4,
    criticalLimit: 125,
    rewardCredits: 615,
    ratSpeed: 3.2,
    breedCooldown: 3.7,
  },
  {
    id: 20,
    name: 'Fortezza Glaciale',
    subtitle: 'Bastione polare esteso: controlla i quattro quadranti con barriere e gas.',
    biome: 'ice',
    objectiveMode: 'survival',
    targetDurationSec: 180,
    cols: 47,
    rows: 53,
    ratCount: 22,
    tunnelPairs: 4,
    criticalLimit: 128,
    rewardCredits: 650,
    ratSpeed: 3.24,
    breedCooldown: 3.65,
  },

  // LAVA (Levels 21 - 25)
  {
    id: 21,
    name: 'Fornace Basaltica',
    subtitle: 'Blocchi roventi e lunghi passaggi: elimina i ratti prima che si dividano.',
    biome: 'lava',
    objectiveMode: 'target_kills',
    targetKills: 60,
    cols: 49,
    rows: 55,
    ratCount: 22,
    tunnelPairs: 3,
    criticalLimit: 132,
    rewardCredits: 685,
    ratSpeed: 3.28,
    breedCooldown: 3.6,
  },
  {
    id: 22,
    name: 'Caldera Magmatica',
    subtitle: 'Isole laviche estese e tunnel incrociati ad alta densità.',
    biome: 'lava',
    objectiveMode: 'survival',
    targetDurationSec: 180,
    cols: 51,
    rows: 57,
    ratCount: 23,
    tunnelPairs: 4,
    criticalLimit: 136,
    rewardCredits: 720,
    ratSpeed: 3.32,
    breedCooldown: 3.55,
  },
  {
    id: 23,
    name: 'Diamanti di Lava',
    subtitle: 'Ispirato al Livello 32 classico: grandi isole laviche a rombo.',
    biome: 'lava',
    cols: 53,
    rows: 59,
    ratCount: 24,
    tunnelPairs: 4,
    criticalLimit: 140,
    rewardCredits: 755,
    ratSpeed: 3.36,
    breedCooldown: 3.5,
  },
  {
    id: 24,
    name: 'Faglia Vulcanica',
    subtitle: 'Fratture nella roccia lavica: sfrutta i tunnel nei muri per dividere i gruppi.',
    biome: 'lava',
    objectiveMode: 'survival',
    targetDurationSec: 180,
    cols: 55,
    rows: 61,
    ratCount: 25,
    tunnelPairs: 4,
    criticalLimit: 144,
    rewardCredits: 790,
    ratSpeed: 3.4,
    breedCooldown: 3.45,
  },
  {
    id: 25,
    name: 'Nucleo del Vulcano',
    subtitle: 'Camera magmatica ad alta pressione con 4 coppie di tunnel.',
    biome: 'lava',
    objectiveMode: 'target_kills',
    targetKills: 75,
    cols: 57,
    rows: 63,
    ratCount: 26,
    tunnelPairs: 4,
    criticalLimit: 148,
    rewardCredits: 830,
    ratSpeed: 3.44,
    breedCooldown: 3.4,
  },

  // MOON (Levels 26 - 30, reaching 70x70 on Lv 30)
  {
    id: 26,
    name: 'Mare della Tranquillità',
    subtitle: 'Cratere lunare con regolite chiara e trincee scure di basalto.',
    biome: 'moon',
    objectiveMode: 'survival',
    targetDurationSec: 180,
    cols: 59,
    rows: 65,
    ratCount: 26,
    tunnelPairs: 4,
    criticalLimit: 152,
    rewardCredits: 870,
    ratSpeed: 3.48,
    breedCooldown: 3.38,
  },
  {
    id: 27,
    name: 'Base Lunare Alpha',
    subtitle: 'Moduli pressurizzati e camere stagne collegate da tunnel nei crateri.',
    biome: 'moon',
    objectiveMode: 'target_kills',
    targetKills: 80,
    cols: 61,
    rows: 67,
    ratCount: 27,
    tunnelPairs: 4,
    criticalLimit: 156,
    rewardCredits: 910,
    ratSpeed: 3.52,
    breedCooldown: 3.34,
  },
  {
    id: 28,
    name: 'Cratere Tycho',
    subtitle: 'Anelli concentrici di polvere lunare con 4 coppie di passaggi rapidi.',
    biome: 'moon',
    objectiveMode: 'survival',
    targetDurationSec: 180,
    cols: 63,
    rows: 69,
    ratCount: 28,
    tunnelPairs: 4,
    criticalLimit: 160,
    rewardCredits: 950,
    ratSpeed: 3.55,
    breedCooldown: 3.3,
  },
  {
    id: 29,
    name: 'Faglia di Selenite',
    subtitle: 'Canyon lunari verticali monumentali: anticipa i flussi tra le fenditure.',
    biome: 'moon',
    objectiveMode: 'target_kills',
    targetKills: 90,
    cols: 65,
    rows: 70,
    ratCount: 30,
    tunnelPairs: 4,
    criticalLimit: 164,
    rewardCredits: 1000,
    ratSpeed: 3.58,
    breedCooldown: 3.26,
  },
  {
    id: 30,
    name: 'Abisso Lunare',
    subtitle: 'Sfida finale 70×70 sul lato oscuro della Luna: 4 tunnel e labirinto colossale.',
    biome: 'moon',
    objectiveMode: 'survival',
    targetDurationSec: 180,
    cols: 70,
    rows: 70,
    ratCount: 32,
    tunnelPairs: 4,
    criticalLimit: 170,
    rewardCredits: 1200,
    ratSpeed: 3.62,
    breedCooldown: 3.22,
  },
];

export const LEVELS: LevelConfig[] = [
  ...GARDEN_LEVELS,
  ...PROCEDURAL_SPECS.map((spec) => buildProceduralLevel(spec)),
];
