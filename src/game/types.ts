export type LanguageCode = 'it' | 'en' | 'de' | 'es' | 'zh' | 'fr';

export type BiomeType = 'grass' | 'sand' | 'city' | 'ice' | 'lava' | 'moon';

export type DifficultyLevel = 'easy' | 'normal' | 'hard';

export interface DifficultyConfig {
  id: DifficultyLevel;
  label: string;
  subtitle: string;
  ratSpeedMul: number;
  breedCooldownMul: number;
  regenSecMul: number;
  limitOffset: number;
  rewardMul: number;
}

export const DIFFICULTY_ORDER: DifficultyLevel[] = ['easy', 'normal', 'hard'];

export const DIFFICULTIES: Record<DifficultyLevel, DifficultyConfig> = {
  easy: {
    id: 'easy',
    label: 'Facile',
    subtitle: 'Ratti -15% vel., ricariche rapide, limite +15',
    ratSpeedMul: 0.85,
    breedCooldownMul: 1.25,
    regenSecMul: 0.82,
    limitOffset: 15,
    rewardMul: 0.85,
  },
  normal: {
    id: 'normal',
    label: 'Normale',
    subtitle: 'Ritmo bilanciato e regole classiche di Rats!',
    ratSpeedMul: 1.0,
    breedCooldownMul: 1.0,
    regenSecMul: 1.0,
    limitOffset: 0,
    rewardMul: 1.0,
  },
  hard: {
    id: 'hard',
    label: 'Difficile',
    subtitle: 'Ratti +16% vel., ricariche lente, +35% crediti',
    ratSpeedMul: 1.16,
    breedCooldownMul: 0.85,
    regenSecMul: 1.18,
    limitOffset: -5,
    rewardMul: 1.35,
  },
};

export type BaseToolType =
  | 'bomb'
  | 'gas'
  | 'poison'
  | 'nuclear'
  | 'tempWall'
  | 'mutagen';

export type StoreToolType = 'permWall' | 'plague';

export type ToolType = BaseToolType | StoreToolType;

export type RatSex = 'M' | 'F';

export type GameStatus = 'playing' | 'paused' | 'won' | 'lost';

export interface ToolMeta {
  id: ToolType;
  name: string;
  shortName: string;
  description: string;
  previewMode: 'cross' | 'radius' | 'single';
  radius: number;
  color: string;
  accentHex: number;
  isStoreItem?: boolean;
  storePrice?: number;
  maxStock?: number;
}

export const BASE_TOOL_ORDER: BaseToolType[] = [
  'bomb',
  'tempWall',
  'mutagen',
  'nuclear',
  'gas',
  'poison',
];

export const STORE_TOOL_ORDER: StoreToolType[] = ['permWall', 'plague'];

export const STORE_MAX_STOCK: Record<StoreToolType, number> = {
  permWall: 3,
  plague: 1,
};

export const TOOL_ORDER: ToolType[] = [...BASE_TOOL_ORDER, ...STORE_TOOL_ORDER];

export const TOOLS_META: Record<ToolType, ToolMeta> = {
  bomb: {
    id: 'bomb',
    name: 'Bomba',
    shortName: 'Bomba',
    description: 'Esplode su riga e colonna fino ai muri, eliminando topi, barriere e tutti gli strumenti nel raggio.',
    previewMode: 'cross',
    radius: 0,
    color: '#ea580c',
    accentHex: 0xea580c,
  },
  gas: {
    id: 'gas',
    name: 'Gas Tossico',
    shortName: 'Gas',
    description: 'Nuvola bianca che si propaga lentamente lungo i corridoi liberi.',
    previewMode: 'radius',
    radius: 2.8,
    color: '#cbd5e1',
    accentHex: 0xe2e8f0,
  },
  poison: {
    id: 'poison',
    name: 'Esca Veleno',
    shortName: 'Veleno',
    description: 'Attira ed elimina 1 ratto. Ricarica più lenta di tutte.',
    previewMode: 'radius',
    radius: 2.4,
    color: '#eab308',
    accentHex: 0xfacc15,
  },
  nuclear: {
    id: 'nuclear',
    name: 'Rifiuti Nucleari',
    shortName: 'Nucleare',
    description: 'Barile radioattivo: sterilizza le femmine nell’area per 3 secondi.',
    previewMode: 'radius',
    radius: 2.6,
    color: '#84cc16',
    accentHex: 0x84cc16,
  },
  tempWall: {
    id: 'tempWall',
    name: 'Barriera Temp.',
    shortName: 'Barriera',
    description: 'Blocca un passaggio: resiste a 12 urti dei ratti o 1 bomba.',
    previewMode: 'single',
    radius: 0,
    color: '#dc2626',
    accentHex: 0xdc2626,
  },
  mutagen: {
    id: 'mutagen',
    name: 'Mutageno Sesso',
    shortName: 'Mutageno',
    description: 'Trappola DNA: inverte il sesso del primo ratto adulto che ci passa sopra (Blu ↔ Rosa).',
    previewMode: 'single',
    radius: 0,
    color: '#db2777',
    accentHex: 0xdb2777,
  },
  permWall: {
    id: 'permWall',
    name: 'Muro Permanente',
    shortName: 'Muro Perm.',
    description: 'Oggetto Store: sigilla definitivamente una cella del labirinto (max 3).',
    previewMode: 'single',
    radius: 0,
    color: '#64748b',
    accentHex: 0x64748b,
    isStoreItem: true,
    storePrice: 200,
    maxStock: 3,
  },
  plague: {
    id: 'plague',
    name: 'Ratto Appestato',
    shortName: 'Appestato',
    description: 'Oggetto Store: diffonde un contagio letale al contatto con gli altri ratti (max 1).',
    previewMode: 'radius',
    radius: 0.9,
    color: '#65a30d',
    accentHex: 0x65a30d,
    isStoreItem: true,
    storePrice: 1500,
    maxStock: 1,
  },
};

export interface ToolSlotConfig {
  start: number;
  max: number;
  regenSec: number;
}

export interface TunnelPair {
  id: string;
  kind?: 'floor' | 'wall';
  a: [number, number];
  b: [number, number];
  color: string;
  hex: number;
}

export interface LevelConfig {
  id: number;
  name: string;
  subtitle: string;
  biome: BiomeType;
  customWallColor?: string;
  customFloorColor?: string;
  isCommunity?: boolean;
  communityId?: string;
  authorName?: string;
  creatorDifficulty?: DifficultyLevel;
  layout: string[];
  tunnels: TunnelPair[];
  initialRats: Array<{ col: number; row: number; sex: RatSex }>;
  criticalLimit: number;
  rewardCredits: number;
  tools: Record<BaseToolType, ToolSlotConfig>;
  ratSpeed: number;
  breedCooldown: number;
}

export interface CommunityTunnelDraft {
  id: string;
  kind: 'floor' | 'wall';
  ax: number;
  ay: number;
  bx: number;
  by: number;
  hex: number;
}

export interface CommunityLevelDoc {
  id: string;
  title: string;
  description: string;
  authorId: string;
  authorName: string;
  biome: BiomeType;
  customWallColor: string;
  customFloorColor: string;
  difficulty: DifficultyLevel;
  criticalLimit: number;
  ratSpeed: number;
  breedCooldown: number;
  layout: string[];
  tunnels: CommunityTunnelDraft[];
  initialRats: Array<{ col: number; row: number; sex: RatSex }>;
  isPublished: boolean;
  bestTimeMs: number;
  bestPlayerName: string;
  playCount: number;
  createdAtMs: number;
}

export interface LevelRunDoc {
  runnerId: string;
  levelId: string;
  playerName: string;
  timeMs: number;
  eliminatedCount: number;
  bornCount: number;
}

export interface PlayerProfile {
  username: string;
  language: LanguageCode;
  credits: number;
  difficulty: DifficultyLevel;
  unlockedLevel: number;
  completedLevels: number[];
  storeStock: Record<StoreToolType, number>;
  lastSavedAt: string | null;
}

export interface GameSnapshot {
  levelId: number;
  levelName: string;
  biome: BiomeType;
  difficulty: DifficultyLevel;
  isCommunity?: boolean;
  communityId?: string;
  status: GameStatus;
  males: number;
  females: number;
  babies: number;
  pregnant: number;
  sterile: number;
  infected: number;
  totalRats: number;
  criticalLimit: number;
  eliminatedCount: number;
  bornCount: number;
  elapsedSeconds: number;
  regenSpeedBonus: number;
  inventory: Record<ToolType, number>;
  maxInventory: Record<BaseToolType, number>;
  regenProgress: Record<BaseToolType, number>;
  selectedTool: ToolType | null;
  speedMultiplier: 1 | 2;
  baseRewardCredits: number;
  currentRewardCredits: number;
  canPan?: boolean;
  mobileFitMode?: boolean;
  lossReason?: string;
}
