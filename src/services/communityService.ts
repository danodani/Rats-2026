import type { User } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { getCreatorDifficultyDefaults } from '../game/levels';
import type {
  BiomeType,
  CommunityLevelDoc,
  CommunityTunnelDraft,
  DifficultyLevel,
  LevelRunDoc,
  RatSex,
} from '../game/types';

const LEVELS_COLLECTION = 'community_levels';

const VALID_BIOMES = new Set<BiomeType>(['grass', 'sand', 'city', 'ice', 'lava', 'moon']);
const VALID_DIFFS = new Set<DifficultyLevel>(['easy', 'normal', 'hard']);
const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

function cleanHexOrEmpty(val?: string): string {
  const trimmed = (val ?? '').trim();
  return HEX_REGEX.test(trimmed) ? trimmed : '';
}

function toTimestampMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (val && typeof val === 'object' && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

function parseCommunityLevelDoc(id: string, data: Record<string, unknown>): CommunityLevelDoc | null {
  try {
    const biome = typeof data.biome === 'string' && VALID_BIOMES.has(data.biome as BiomeType)
      ? (data.biome as BiomeType)
      : 'grass';
    const difficulty = typeof data.difficulty === 'string' && VALID_DIFFS.has(data.difficulty as DifficultyLevel)
      ? (data.difficulty as DifficultyLevel)
      : 'normal';
    const layout = Array.isArray(data.layout)
      ? data.layout.filter((r): r is string => typeof r === 'string')
      : [];
    if (layout.length < 9 || layout.length > 100 || layout[0].length < 11 || layout[0].length > 100) return null;

    const tunnels: CommunityTunnelDraft[] = Array.isArray(data.tunnels)
      ? data.tunnels
          .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
          .slice(0, 4)
          .map((t, idx) => ({
            id: typeof t.id === 'string' ? t.id.slice(0, 4) : String.fromCharCode(65 + idx),
            kind: t.kind === 'wall' ? 'wall' : 'floor',
            ax: Math.floor(Number(t.ax ?? 1)),
            ay: Math.floor(Number(t.ay ?? 1)),
            bx: Math.floor(Number(t.bx ?? 1)),
            by: Math.floor(Number(t.by ?? 1)),
            hex: typeof t.hex === 'number' ? Math.floor(t.hex) : 0x38bdf8,
          }))
      : [];

    const initialRats: Array<{ col: number; row: number; sex: RatSex }> = Array.isArray(data.initialRats)
      ? data.initialRats
          .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
          .slice(0, 50)
          .map((r) => ({
            col: Math.floor(Number(r.col ?? 1)),
            row: Math.floor(Number(r.row ?? 1)),
            sex: r.sex === 'F' ? 'F' : 'M',
          }))
      : [];
    if (initialRats.length < 2) return null;

    const defaults = getCreatorDifficultyDefaults(difficulty);
    return {
      id,
      title: typeof data.title === 'string' ? data.title.slice(0, 40) : 'Custom Map',
      description: typeof data.description === 'string' ? data.description.slice(0, 140) : '',
      authorId: typeof data.authorId === 'string' ? data.authorId : '',
      authorName: typeof data.authorName === 'string' ? data.authorName.slice(0, 24) : 'Player',
      biome,
      customWallColor: cleanHexOrEmpty(typeof data.customWallColor === 'string' ? data.customWallColor : ''),
      customFloorColor: cleanHexOrEmpty(typeof data.customFloorColor === 'string' ? data.customFloorColor : ''),
      difficulty,
      criticalLimit: Math.max(30, Math.min(250, Math.round(Number(data.criticalLimit ?? 65)))),
      ratSpeed: typeof data.ratSpeed === 'number' ? data.ratSpeed : defaults.ratSpeed,
      breedCooldown: typeof data.breedCooldown === 'number' ? data.breedCooldown : defaults.breedCooldown,
      layout,
      tunnels,
      initialRats,
      isPublished: Boolean(data.isPublished),
      bestTimeMs: Math.max(0, Math.round(Number(data.bestTimeMs ?? 0))),
      bestPlayerName: typeof data.bestPlayerName === 'string' ? data.bestPlayerName.slice(0, 24) : '',
      playCount: Math.max(0, Math.round(Number(data.playCount ?? 0))),
      createdAtMs: toTimestampMs(data.createdAt),
    };
  } catch {
    return null;
  }
}

export function subscribePublishedLevels(
  onLevels: (levels: CommunityLevelDoc[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const path = LEVELS_COLLECTION;
  const q = query(
    collection(db, path),
    where('isPublished', '==', true),
    limit(60),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: CommunityLevelDoc[] = [];
      snap.forEach((docSnap) => {
        const parsed = parseCommunityLevelDoc(docSnap.id, docSnap.data() as Record<string, unknown>);
        if (parsed) items.push(parsed);
      });
      items.sort((a, b) => b.createdAtMs - a.createdAtMs);
      onLevels(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError) onError(wrapped);
      }
    },
  );
}

export async function fetchCommunityLevelById(levelId: string): Promise<CommunityLevelDoc | null> {
  const cleanId = levelId.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) return null;
  const path = `${LEVELS_COLLECTION}/${cleanId}`;
  try {
    const snap = await getDoc(doc(db, LEVELS_COLLECTION, cleanId));
    if (!snap.exists()) return null;
    return parseCommunityLevelDoc(snap.id, snap.data() as Record<string, unknown>);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export interface PublishLevelInput {
  title: string;
  description: string;
  biome: BiomeType;
  customWallColor: string;
  customFloorColor: string;
  difficulty: DifficultyLevel;
  criticalLimit: number;
  layout: string[];
  tunnels: CommunityTunnelDraft[];
  initialRats: Array<{ col: number; row: number; sex: RatSex }>;
}

export async function publishCommunityLevel(
  input: PublishLevelInput,
  user: User,
  nickname: string,
): Promise<string> {
  const cleanTitle = input.title.trim().slice(0, 40);
  if (cleanTitle.length < 2) {
    throw new Error('Title must be at least 2 characters.');
  }
  const cleanDesc = input.description.trim().slice(0, 140);
  const cleanAuthor = (nickname.trim() || user.displayName || 'Player').slice(0, 24);
  const targetCols = Math.max(11, Math.min(100, input.layout[0]?.length ?? 17));
  const cleanLayout = input.layout
    .slice(0, 100)
    .map((row) => row.slice(0, targetCols).padEnd(targetCols, '#'));
  if (cleanLayout.length < 9) {
    throw new Error('Layout must have at least 9 rows.');
  }
  const cleanTunnels = input.tunnels.slice(0, 4).map((t, idx) => ({
    id: t.id.slice(0, 4) || String.fromCharCode(65 + idx),
    kind: t.kind === 'wall' ? 'wall' : 'floor',
    ax: Math.floor(t.ax),
    ay: Math.floor(t.ay),
    bx: Math.floor(t.bx),
    by: Math.floor(t.by),
    hex: Math.floor(t.hex),
  }));
  const cleanRats = input.initialRats.slice(0, 50).map((r) => ({
    col: Math.floor(r.col),
    row: Math.floor(r.row),
    sex: r.sex === 'F' ? 'F' : 'M',
  }));
  if (cleanRats.length < 2) {
    throw new Error('At least 2 rats are required.');
  }

  const defaults = getCreatorDifficultyDefaults(input.difficulty);
  const payload = {
    title: cleanTitle,
    description: cleanDesc,
    authorId: user.uid,
    authorName: cleanAuthor,
    biome: VALID_BIOMES.has(input.biome) ? input.biome : 'grass',
    customWallColor: cleanHexOrEmpty(input.customWallColor),
    customFloorColor: cleanHexOrEmpty(input.customFloorColor),
    difficulty: VALID_DIFFS.has(input.difficulty) ? input.difficulty : 'normal',
    criticalLimit: Math.max(30, Math.min(250, Math.round(input.criticalLimit))),
    ratSpeed: defaults.ratSpeed,
    breedCooldown: defaults.breedCooldown,
    layout: cleanLayout,
    tunnels: cleanTunnels,
    initialRats: cleanRats,
    isPublished: true,
    bestTimeMs: 0,
    bestPlayerName: '',
    playCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const ref = await addDoc(collection(db, LEVELS_COLLECTION), payload);
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, LEVELS_COLLECTION);
  }
}

export async function deleteCommunityLevel(levelId: string): Promise<void> {
  const path = `${LEVELS_COLLECTION}/${levelId}`;
  try {
    await deleteDoc(doc(db, LEVELS_COLLECTION, levelId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function fetchLevelLeaderboard(levelId: string): Promise<LevelRunDoc[]> {
  const path = `${LEVELS_COLLECTION}/${levelId}/runs`;
  try {
    const q = query(
      collection(db, LEVELS_COLLECTION, levelId, 'runs'),
      where('isPublic', '==', true),
      limit(100),
    );
    const snap = await getDocs(q);
    const list: LevelRunDoc[] = [];
    snap.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      list.push({
        runnerId: typeof data.runnerId === 'string' ? data.runnerId : d.id,
        levelId,
        playerName: typeof data.playerName === 'string' ? data.playerName.slice(0, 24) : 'Player',
        timeMs: Math.max(1000, Math.round(Number(data.timeMs ?? 1000))),
        eliminatedCount: Math.max(0, Math.round(Number(data.eliminatedCount ?? 0))),
        bornCount: Math.max(0, Math.round(Number(data.bornCount ?? 0))),
      });
    });
    list.sort((a, b) => a.timeMs - b.timeMs);
    return list.slice(0, 20);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function submitCommunityRun(
  levelId: string,
  elapsedSeconds: number,
  eliminatedCount: number,
  bornCount: number,
  user: User,
  nickname: string,
): Promise<{
  isNewWorldRecord: boolean;
  isNewPersonalBest: boolean;
  recordedTimeMs: number;
}> {
  const cleanName = (nickname.trim() || user.displayName || 'Player').slice(0, 24);
  const runTimeMs = Math.max(1000, Math.min(36000000, Math.round(elapsedSeconds * 1000)));
  const cleanElim = Math.max(0, Math.min(10000, Math.round(eliminatedCount)));
  const cleanBorn = Math.max(0, Math.min(10000, Math.round(bornCount)));

  const levelRef = doc(db, LEVELS_COLLECTION, levelId);
  const runRef = doc(db, LEVELS_COLLECTION, levelId, 'runs', user.uid);
  const levelPath = `${LEVELS_COLLECTION}/${levelId}`;
  const runPath = `${LEVELS_COLLECTION}/${levelId}/runs/${user.uid}`;

  let levelSnap;
  let existingRunSnap;
  try {
    [levelSnap, existingRunSnap] = await Promise.all([getDoc(levelRef), getDoc(runRef)]);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, levelPath);
  }

  if (!levelSnap.exists()) {
    throw new Error('Community level no longer exists.');
  }
  const levelData = levelSnap.data() as Record<string, unknown>;
  const currentBestMs = Math.max(0, Math.round(Number(levelData.bestTimeMs ?? 0)));
  const currentBestName = typeof levelData.bestPlayerName === 'string' ? levelData.bestPlayerName : '';
  const currentPlays = Math.max(0, Math.round(Number(levelData.playCount ?? 0)));

  const prevRunTimeMs = existingRunSnap.exists()
    ? Math.max(1000, Math.round(Number((existingRunSnap.data() as Record<string, unknown>).timeMs ?? runTimeMs)))
    : null;

  const isNewPersonalBest = prevRunTimeMs === null || runTimeMs < prevRunTimeMs;
  const bestPersonalMs = prevRunTimeMs === null ? runTimeMs : Math.min(prevRunTimeMs, runTimeMs);
  const isNewWorldRecord = currentBestMs === 0 || runTimeMs < currentBestMs;

  const batch = writeBatch(db);
  if (!existingRunSnap.exists()) {
    batch.set(runRef, {
      levelId,
      runnerId: user.uid,
      playerName: cleanName,
      timeMs: runTimeMs,
      eliminatedCount: cleanElim,
      bornCount: cleanBorn,
      isPublic: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.update(runRef, {
      playerName: cleanName,
      timeMs: bestPersonalMs,
      eliminatedCount: isNewPersonalBest
        ? cleanElim
        : Math.max(0, Math.round(Number((existingRunSnap.data() as Record<string, unknown>).eliminatedCount ?? cleanElim))),
      bornCount: isNewPersonalBest
        ? cleanBorn
        : Math.max(0, Math.round(Number((existingRunSnap.data() as Record<string, unknown>).bornCount ?? cleanBorn))),
      updatedAt: serverTimestamp(),
    });
  }

  batch.update(levelRef, {
    playCount: currentPlays + 1,
    bestTimeMs: isNewWorldRecord ? runTimeMs : currentBestMs,
    bestPlayerName: isNewWorldRecord ? cleanName : currentBestName,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, runPath);
  }

  return {
    isNewWorldRecord,
    isNewPersonalBest,
    recordedTimeMs: runTimeMs,
  };
}

export function formatRunTime(ms: number): string {
  if (!ms || ms <= 0) return '--:--.-';
  const totalSec = ms / 1000;
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}
