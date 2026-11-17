import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dices,
  Eraser,
  FlipHorizontal2,
  Maximize2,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  UploadCloud,
  X,
  ZoomIn,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { soundEngine } from '../game/audio';
import { getCreatorDifficultyDefaults, makeToolsForDifficulty } from '../game/levels';
import type { TranslationPack } from '../game/i18n';
import type {
  BiomeType,
  CommunityTunnelDraft,
  DifficultyLevel,
  GameObjectiveMode,
  LevelConfig,
  RatSex,
} from '../game/types';
import { publishCommunityLevel } from '../services/communityService';

type BrushType = 'wall' | 'floor' | 'male' | 'female' | 'floorTunnel' | 'wallTunnel' | 'erase';

const SIZE_PRESETS: Array<{ label: string; cols: number; rows: number }> = [
  { label: '17×17', cols: 17, rows: 17 },
  { label: '17×19', cols: 17, rows: 19 },
  { label: '19×19', cols: 19, rows: 19 },
  { label: '21×25', cols: 21, rows: 25 },
  { label: '25×31', cols: 25, rows: 31 },
];

const BIOME_LIST: BiomeType[] = ['grass', 'sand', 'city', 'ice', 'lava', 'moon'];

const BIOME_DEFAULTS: Record<BiomeType, { wall: string; floor: string }> = {
  grass: { wall: '#289e28', floor: '#6e7073' },
  sand: { wall: '#d2a44e', floor: '#5c544a' },
  city: { wall: '#b25e40', floor: '#2e3440' },
  ice: { wall: '#b6def4', floor: '#3e4a5e' },
  lava: { wall: '#a8362e', floor: '#5e6066' },
  moon: { wall: '#c2cad6', floor: '#272c38' },
};

const TUNNEL_COLORS = [0x38bdf8, 0xf59e0b, 0xec4899, 0xa3e635];

function clampGridDim(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Math.round(val)));
}

function makeBlankGrid(cols: number, rows: number): string[][] {
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      const isBorder = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
      row.push(isBorder ? '#' : '.');
    }
    grid.push(row);
  }
  return grid;
}

function makeStarterGrid(cols: number, rows: number): string[][] {
  const g = makeBlankGrid(cols, rows);
  for (let r = 2; r < rows - 2; r++) {
    for (let c = 2; c < cols - 2; c++) {
      if (r % 2 === 0 && c % 2 === 0) {
        g[r][c] = '#';
      }
    }
  }
  return g;
}

function defaultStarterRats(cols: number, rows: number): Array<{ col: number; row: number; sex: RatSex }> {
  const list: Array<{ col: number; row: number; sex: RatSex }> = [
    { col: 1, row: 1, sex: 'M' },
    { col: cols - 2, row: 1, sex: 'F' },
    { col: 1, row: rows - 2, sex: 'F' },
    { col: cols - 2, row: rows - 2, sex: 'M' },
  ];
  if (cols >= 35 || rows >= 35) {
    const midC = Math.floor(cols / 2);
    const midR = Math.floor(rows / 2);
    list.push({ col: midC, row: 1, sex: 'M' });
    list.push({ col: midC, row: rows - 2, sex: 'F' });
    list.push({ col: 1, row: midR, sex: 'F' });
    list.push({ col: cols - 2, row: midR, sex: 'M' });
  }
  return list;
}

interface LevelEditorModalProps {
  t: TranslationPack;
  user: User | null;
  username: string;
  onSignIn: () => Promise<void>;
  onClose: () => void;
  onTestLevel: (config: LevelConfig) => void;
  onPublished: (levelId: string) => void;
}

export const LevelEditorModal: React.FC<LevelEditorModalProps> = ({
  t,
  user,
  username,
  onSignIn,
  onClose,
  onTestLevel,
  onPublished,
}) => {
  const [sizeMode, setSizeMode] = useState<number | 'custom'>(0); // default 17x17
  const [cols, setCols] = useState(SIZE_PRESETS[0].cols);
  const [rows, setRows] = useState(SIZE_PRESETS[0].rows);
  const [customWidthInput, setCustomWidthInput] = useState('35');
  const [customHeightInput, setCustomHeightInput] = useState('45');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [biome, setBiome] = useState<BiomeType>('grass');
  const [useCustomColors, setUseCustomColors] = useState(false);
  const [customWallColor, setCustomWallColor] = useState('#289e28');
  const [customFloorColor, setCustomFloorColor] = useState('#6e7073');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('normal');
  const [objectiveMode, setObjectiveMode] = useState<GameObjectiveMode>('eradication');
  const [targetDurationSec, setTargetDurationSec] = useState<number>(180);
  const [targetKills, setTargetKills] = useState<number>(40);
  const [criticalLimit, setCriticalLimit] = useState(65);

  const [grid, setGrid] = useState<string[][]>(() =>
    makeStarterGrid(SIZE_PRESETS[0].cols, SIZE_PRESETS[0].rows),
  );
  const [rats, setRats] = useState<Array<{ col: number; row: number; sex: RatSex }>>(() =>
    defaultStarterRats(SIZE_PRESETS[0].cols, SIZE_PRESETS[0].rows),
  );
  const [tunnels, setTunnels] = useState<CommunityTunnelDraft[]>([]);
  const [pendingTunnel, setPendingTunnel] = useState<{
    kind: 'floor' | 'wall';
    col: number;
    row: number;
  } | null>(null);

  const [brush, setBrush] = useState<BrushType>('wall');
  const [symmetryX, setSymmetryX] = useState(true);
  const [zoomMode, setZoomMode] = useState<'fit' | 'paint'>('fit');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintingRef = useRef(false);
  const lastCellRef = useRef<{ col: number; row: number } | null>(null);

  const ratMap = useMemo(() => {
    const m = new Map<string, RatSex>();
    for (const r of rats) m.set(`${r.col},${r.row}`, r.sex);
    return m;
  }, [rats]);

  const tunnelMap = useMemo(() => {
    const m = new Map<string, { id: string; kind: 'floor' | 'wall'; hex: number }>();
    for (const tun of tunnels) {
      m.set(`${tun.ax},${tun.ay}`, { id: tun.id, kind: tun.kind, hex: tun.hex });
      m.set(`${tun.bx},${tun.by}`, { id: tun.id, kind: tun.kind, hex: tun.hex });
    }
    return m;
  }, [tunnels]);

  const applyDimensions = (nextCols: number, nextRows: number) => {
    setCols(nextCols);
    setRows(nextRows);
    setGrid(makeStarterGrid(nextCols, nextRows));
    setTunnels([]);
    setPendingTunnel(null);
    setRats(defaultStarterRats(nextCols, nextRows));
    const maxDim = Math.max(nextCols, nextRows);
    if (maxDim >= 70) {
      setCriticalLimit((prev) => Math.max(prev, 160));
    } else if (maxDim >= 40) {
      setCriticalLimit((prev) => Math.max(prev, 110));
    }
    setZoomMode('fit');
  };

  const handleSizePresetChange = (nextIdx: number) => {
    const next = SIZE_PRESETS[nextIdx];
    setSizeMode(nextIdx);
    applyDimensions(next.cols, next.rows);
  };

  const handleApplyCustomSize = () => {
    const c = clampGridDim(Number(customWidthInput), 11, 100);
    const r = clampGridDim(Number(customHeightInput), 11, 100);
    setCustomWidthInput(String(c));
    setCustomHeightInput(String(r));
    setSizeMode('custom');
    applyDimensions(c, r);
  };

  const handleBiomeSelect = (b: BiomeType) => {
    setBiome(b);
    if (!useCustomColors) {
      setCustomWallColor(BIOME_DEFAULTS[b].wall);
      setCustomFloorColor(BIOME_DEFAULTS[b].floor);
    }
  };

  const isBorderCell = (c: number, r: number) =>
    c === 0 || r === 0 || c === cols - 1 || r === rows - 1;

  const hasAdjacentWalkable = (g: string[][], c: number, r: number) => {
    const dirs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    return dirs.some(([dx, dy]) => g[r + dy]?.[c + dx] === '.');
  };

  const paintLinePoints = (c0: number, r0: number, c1: number, r1: number): Array<[number, number]> => {
    const pts: Array<[number, number]> = [];
    let x0 = c0;
    let y0 = r0;
    const dx = Math.abs(c1 - c0);
    const dy = Math.abs(r1 - r0);
    const sx = c0 < c1 ? 1 : -1;
    const sy = r0 < r1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      pts.push([x0, y0]);
      if (x0 === c1 && y0 === r1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
    return pts;
  };

  const applyStrokeAt = (cells: Array<[number, number]>, isClick: boolean) => {
    setErrorMsg(null);
    if (cells.length === 0) return;
    const [c, r] = cells[cells.length - 1];

    if (brush === 'floorTunnel' || brush === 'wallTunnel') {
      if (!isClick || isBorderCell(c, r)) return;
      const kind = brush === 'floorTunnel' ? 'floor' : 'wall';
      const cellVal = grid[r]?.[c];
      if (kind === 'floor' && cellVal !== '.') return;
      if (kind === 'wall' && (cellVal !== '#' || !hasAdjacentWalkable(grid, c, r))) return;

      if (!pendingTunnel || pendingTunnel.kind !== kind) {
        if (tunnels.length >= 4) {
          setTunnels((prev) => prev.slice(1));
        }
        setPendingTunnel({ kind, col: c, row: r });
        return;
      }

      if (pendingTunnel.col === c && pendingTunnel.row === r) {
        setPendingTunnel(null);
        return;
      }

      const idx = tunnels.length;
      const newTun: CommunityTunnelDraft = {
        id: String.fromCharCode(65 + idx),
        kind,
        ax: pendingTunnel.col,
        ay: pendingTunnel.row,
        bx: c,
        by: r,
        hex: TUNNEL_COLORS[idx % TUNNEL_COLORS.length],
      };
      setTunnels((prev) => [
        ...prev.filter(
          (tItem) =>
            !(
              (tItem.ax === c && tItem.ay === r) ||
              (tItem.bx === c && tItem.by === r) ||
              (tItem.ax === pendingTunnel.col && tItem.ay === pendingTunnel.row) ||
              (tItem.bx === pendingTunnel.col && tItem.by === pendingTunnel.row)
            ),
        ),
        newTun,
      ]);
      setPendingTunnel(null);
      soundEngine.playUiClick(760);
      return;
    }

    const validTargets: Array<[number, number]> = [];
    for (const [cx, cy] of cells) {
      if (isBorderCell(cx, cy)) continue;
      validTargets.push([cx, cy]);
      if (symmetryX && (brush === 'wall' || brush === 'floor' || brush === 'erase')) {
        const mirrorC = cols - 1 - cx;
        if (mirrorC !== cx && !isBorderCell(mirrorC, cy)) {
          validTargets.push([mirrorC, cy]);
        }
      }
    }
    if (validTargets.length === 0) return;

    if (brush === 'wall') {
      setGrid((prev) => {
        const next = prev.map((row) => [...row]);
        for (const [tc, tr] of validTargets) next[tr][tc] = '#';
        return next;
      });
      setRats((prev) =>
        prev.filter((rat) => !validTargets.some(([tc, tr]) => rat.col === tc && rat.row === tr)),
      );
    } else if (brush === 'floor') {
      setGrid((prev) => {
        const next = prev.map((row) => [...row]);
        for (const [tc, tr] of validTargets) next[tr][tc] = '.';
        return next;
      });
    } else if (brush === 'male' || brush === 'female') {
      if (isBorderCell(c, r)) return;
      const sex: RatSex = brush === 'male' ? 'M' : 'F';
      setGrid((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = '.';
        return next;
      });
      setRats((prev) => {
        const filtered = prev.filter((rat) => !(rat.col === c && rat.row === r));
        if (filtered.length >= 50) return prev;
        return [...filtered, { col: c, row: r, sex }];
      });
    } else if (brush === 'erase') {
      setRats((prev) =>
        prev.filter((rat) => !validTargets.some(([tc, tr]) => rat.col === tc && rat.row === tr)),
      );
      setTunnels((prev) =>
        prev.filter(
          (tun) =>
            !validTargets.some(
              ([tc, tr]) =>
                (tun.ax === tc && tun.ay === tr) || (tun.bx === tc && tun.by === tr),
            ),
        ),
      );
      if (pendingTunnel && validTargets.some(([tc, tr]) => pendingTunnel.col === tc && pendingTunnel.row === tr)) {
        setPendingTunnel(null);
      }
      setGrid((prev) => {
        const next = prev.map((row) => [...row]);
        for (const [tc, tr] of validTargets) next[tr][tc] = '.';
        return next;
      });
    }
  };

  const handleGenerateMaze = () => {
    soundEngine.playUiClick(700);
    const next = makeBlankGrid(cols, rows);
    const midR = Math.floor(rows / 2);
    const midC = Math.floor(cols / 2);
    for (let r = 2; r < rows - 2; r++) {
      for (let c = 2; c <= midC; c++) {
        if (r === midR && (c === 1 || c === cols - 2)) continue;
        const placeWall =
          (r % 2 === 0 && c % 2 === 0 && Math.random() < 0.85) ||
          ((r % 2 === 0 || c % 2 === 0) && Math.random() < 0.34);
        if (placeWall) {
          next[r][c] = '#';
          next[r][cols - 1 - c] = '#';
        }
      }
    }
    for (let c = 1; c < cols - 1; c++) {
      next[1][c] = '.';
      next[rows - 2][c] = '.';
    }
    for (let r = 1; r < rows - 1; r++) {
      next[r][1] = '.';
      next[r][cols - 2] = '.';
    }
    setGrid(next);
    const generatedTunnels: CommunityTunnelDraft[] = [
      {
        id: 'A',
        kind: 'floor',
        ax: 1,
        ay: 1,
        bx: cols - 2,
        by: rows - 2,
        hex: TUNNEL_COLORS[0],
      },
    ];
    if (cols >= 35 || rows >= 35) {
      generatedTunnels.push({
        id: 'B',
        kind: 'floor',
        ax: cols - 2,
        ay: 1,
        bx: 1,
        by: rows - 2,
        hex: TUNNEL_COLORS[1],
      });
    }
    setTunnels(generatedTunnels);
    setPendingTunnel(null);
    setRats([
      ...defaultStarterRats(cols, rows),
      ...(cols < 35 && rows < 35
        ? [
            { col: midC, row: 1, sex: 'M' as RatSex },
            { col: midC, row: rows - 2, sex: 'F' as RatSex },
          ]
        : []),
    ]);
  };

  const handleClear = () => {
    soundEngine.playUiClick(600);
    setGrid(makeBlankGrid(cols, rows));
    setTunnels([]);
    setPendingTunnel(null);
    setRats([
      { col: 1, row: 1, sex: 'M' },
      { col: cols - 2, row: rows - 2, sex: 'F' },
    ]);
  };

  const validateDraft = (requireTitle: boolean): string | null => {
    if (requireTitle && title.trim().length < 2) return t.editorValidationName;
    let floorCount = 0;
    for (const row of grid) {
      for (const ch of row) {
        if (ch === '.') floorCount += 1;
      }
    }
    if (floorCount < 12) return t.editorValidationFloor;
    if (rats.length < 2) return t.editorValidationRats;
    return null;
  };

  const handleTest = () => {
    const err = validateDraft(false);
    if (err) {
      setErrorMsg(err);
      return;
    }
    soundEngine.unlock();
    soundEngine.playUiClick(760);
    const defaults = getCreatorDifficultyDefaults(difficulty);
    const layout = grid.map((row) => row.join(''));
    const cfg: LevelConfig = {
      id: 0,
      name: title.trim() || 'Test Map',
      subtitle: description.trim(),
      biome,
      objectiveMode,
      targetDurationSec: objectiveMode === 'survival' ? targetDurationSec : undefined,
      targetKills: objectiveMode === 'target_kills' ? targetKills : undefined,
      customWallColor: useCustomColors ? customWallColor : undefined,
      customFloorColor: useCustomColors ? customFloorColor : undefined,
      isCommunity: true,
      authorName: username,
      creatorDifficulty: difficulty,
      layout,
      tunnels: tunnels.map((tun) => ({
        id: tun.id,
        kind: tun.kind,
        a: [tun.ax, tun.ay],
        b: [tun.bx, tun.by],
        color: `#${tun.hex.toString(16).padStart(6, '0')}`,
        hex: tun.hex,
      })),
      initialRats: rats,
      criticalLimit,
      rewardCredits: 0,
      tools: makeToolsForDifficulty(defaults.toolTier),
      ratSpeed: defaults.ratSpeed,
      breedCooldown: defaults.breedCooldown,
    };
    onTestLevel(cfg);
  };

  const handlePublish = async () => {
    const err = validateDraft(true);
    if (err) {
      setErrorMsg(err);
      return;
    }
    if (!user) {
      await onSignIn();
      return;
    }
    setPublishing(true);
    setErrorMsg(null);
    try {
      const levelId = await publishCommunityLevel(
        {
          title: title.trim(),
          description: description.trim(),
          biome,
          customWallColor: useCustomColors ? customWallColor : '',
          customFloorColor: useCustomColors ? customFloorColor : '',
          difficulty,
          objectiveMode,
          targetDurationSec,
          targetKills,
          criticalLimit,
          layout: grid.map((row) => row.join('')),
          tunnels,
          initialRats: rats,
        },
        user,
        username,
      );
      soundEngine.play('putdown', 60, 0.75);
      onPublished(levelId);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const activeWallColor = useCustomColors ? customWallColor : BIOME_DEFAULTS[biome].wall;
  const activeFloorColor = useCustomColors ? customFloorColor : BIOME_DEFAULTS[biome].floor;

  const isLargeGrid = cols > 26 || rows > 28;
  const fitCellPx = Math.max(4, Math.min(20, Math.floor(430 / Math.max(cols, rows * 0.95))));
  const cellPx = zoomMode === 'paint' ? Math.max(16, fitCellPx) : fitCellPx;
  const canvasW = cols * cellPx;
  const canvasH = rows * cellPx;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = activeFloorColor;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Draw walls
    ctx.fillStyle = activeWallColor;
    for (let r = 0; r < rows; r++) {
      const rowArr = grid[r];
      if (!rowArr) continue;
      for (let c = 0; c < cols; c++) {
        if (rowArr[c] === '#') {
          ctx.fillRect(c * cellPx, r * cellPx, cellPx, cellPx);
          if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            ctx.fillRect(c * cellPx, r * cellPx, cellPx, cellPx);
            ctx.fillStyle = activeWallColor;
          }
        }
      }
    }

    // Subtle grid lines when zoomed enough
    if (cellPx >= 7) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 1; c < cols; c++) {
        const x = c * cellPx + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasH);
      }
      for (let r = 1; r < rows; r++) {
        const y = r * cellPx + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(canvasW, y);
      }
      ctx.stroke();
    }

    // Draw rats
    for (const rat of rats) {
      const cx = (rat.col + 0.5) * cellPx;
      const cy = (rat.row + 0.5) * cellPx;
      const radius = Math.max(2, cellPx * 0.34);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = rat.sex === 'M' ? '#1e78ff' : '#f03892';
      ctx.fill();
      if (cellPx >= 8) {
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }

    // Draw tunnels
    for (const tun of tunnels) {
      const colHex = `#${tun.hex.toString(16).padStart(6, '0')}`;
      for (const [tx, ty] of [
        [tun.ax, tun.ay],
        [tun.bx, tun.by],
      ]) {
        const cx = (tx + 0.5) * cellPx;
        const cy = (ty + 0.5) * cellPx;
        const radius = Math.max(2.5, cellPx * 0.38);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = colHex;
        ctx.fill();
        ctx.lineWidth = Math.max(1, cellPx * 0.08);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        if (cellPx >= 11) {
          ctx.fillStyle = '#0f172a';
          ctx.font = `bold ${Math.max(8, Math.round(cellPx * 0.55))}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(tun.id, cx, cy + 0.5);
        }
      }
    }

    // Draw pending tunnel highlight
    if (pendingTunnel) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        pendingTunnel.col * cellPx + 1,
        pendingTunnel.row * cellPx + 1,
        Math.max(2, cellPx - 2),
        Math.max(2, cellPx - 2),
      );
    }
  }, [
    grid,
    rats,
    tunnels,
    pendingTunnel,
    cols,
    rows,
    cellPx,
    canvasW,
    canvasH,
    activeWallColor,
    activeFloorColor,
    ratMap,
    tunnelMap,
  ]);

  const getCellFromPointer = (clientX: number, clientY: number): { col: number; row: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const col = Math.floor(((clientX - rect.left) / rect.width) * cols);
    const row = Math.floor(((clientY - rect.top) / rect.height) * rows);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    return { col, row };
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-2 sm:p-4"
      onPointerUp={() => {
        paintingRef.current = false;
        lastCellRef.current = null;
      }}
    >
      <div className="w-full max-w-5xl max-h-[94dvh] flex flex-col rounded-2xl border border-white/15 bg-slate-950 text-slate-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <h2 className="font-display text-lg font-bold text-white">{t.editorTitle}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            aria-label={t.helpClose}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: Map Settings & Theme */}
          <div className="lg:col-span-5 space-y-4">
            <div className="space-y-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t.editorNameLabel}
                </label>
                <input
                  type="text"
                  maxLength={40}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t.editorNamePlaceholder}
                  className="w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t.editorDescLabel}
                </label>
                <input
                  type="text"
                  maxLength={140}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t.editorDescPlaceholder}
                  className="w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-xs text-white focus:border-emerald-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Grid Size (Portrait / Square presets + Custom up to 100x100) */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-300">{t.editorSizeLabel}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {SIZE_PRESETS.map((sz, i) => (
                  <button
                    key={sz.label}
                    type="button"
                    onClick={() => handleSizePresetChange(i)}
                    className={`min-h-[36px] rounded-lg border text-xs font-mono-nums font-bold transition ${
                      sizeMode === i
                        ? 'bg-sky-500 border-sky-400 text-slate-950'
                        : 'bg-slate-900 border-white/10 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {sz.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setSizeMode('custom');
                    setCustomWidthInput(String(cols));
                    setCustomHeightInput(String(rows));
                  }}
                  className={`min-h-[36px] px-2 rounded-lg border text-[11px] font-semibold transition truncate ${
                    sizeMode === 'custom'
                      ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                      : 'bg-slate-900 border-white/10 text-slate-300 hover:bg-slate-800'
                  }`}
                  title={t.editorCustomSizeBtn}
                >
                  {sizeMode === 'custom' ? `${cols}×${rows}` : '11–100'}
                </button>
              </div>

              {sizeMode === 'custom' && (
                <div className="rounded-xl border border-emerald-400/30 bg-slate-900/90 p-2.5 space-y-2">
                  <div className="text-[11px] font-semibold text-emerald-300">
                    {t.editorCustomSizeBtn}
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="flex-1 text-[11px] text-slate-300">
                      <span className="block mb-1">{t.editorWidthLabel} (11–100)</span>
                      <input
                        type="number"
                        min={11}
                        max={100}
                        value={customWidthInput}
                        onChange={(e) => setCustomWidthInput(e.target.value)}
                        className="w-full rounded-lg border border-white/15 bg-slate-950 px-2.5 py-1.5 text-xs font-mono-nums text-white focus:border-emerald-400 focus:outline-none"
                      />
                    </label>
                    <label className="flex-1 text-[11px] text-slate-300">
                      <span className="block mb-1">{t.editorHeightLabel} (11–100)</span>
                      <input
                        type="number"
                        min={11}
                        max={100}
                        value={customHeightInput}
                        onChange={(e) => setCustomHeightInput(e.target.value)}
                        className="w-full rounded-lg border border-white/15 bg-slate-950 px-2.5 py-1.5 text-xs font-mono-nums text-white focus:border-emerald-400 focus:outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleApplyCustomSize}
                      className="min-h-[34px] px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition shrink-0"
                    >
                      {t.editorApplySizeBtn}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Biome & Custom Theme Colors */}
            <div className="rounded-xl border border-white/10 bg-slate-900/70 p-3 space-y-2.5">
              <div className="text-xs font-medium text-slate-300">{t.editorBiomeLabel}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {BIOME_LIST.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => handleBiomeSelect(b)}
                    className={`px-2 py-2 rounded-lg border text-[11px] font-semibold truncate transition flex items-center gap-1.5 ${
                      biome === b
                        ? 'bg-slate-800 border-emerald-400 text-white'
                        : 'bg-slate-950/70 border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-sm shrink-0 border border-white/20"
                      style={{ backgroundColor: BIOME_DEFAULTS[b].wall }}
                    />
                    <span className="truncate">{t.biomes[b]}</span>
                  </button>
                ))}
              </div>

              <div className="pt-1 border-t border-white/10 flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCustomColors}
                    onChange={(e) => setUseCustomColors(e.target.checked)}
                    className="rounded accent-emerald-500"
                  />
                  <span>{t.editorCustomColors}</span>
                </label>
                {useCustomColors && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomWallColor(BIOME_DEFAULTS[biome].wall);
                      setCustomFloorColor(BIOME_DEFAULTS[biome].floor);
                    }}
                    className="text-[11px] text-sky-400 hover:underline"
                  >
                    {t.editorResetColors}
                  </button>
                )}
              </div>

              {useCustomColors && (
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1.5 text-xs">
                    <span className="text-slate-300">{t.editorWallColor}</span>
                    <input
                      type="color"
                      value={customWallColor}
                      onChange={(e) => setCustomWallColor(e.target.value)}
                      className="w-7 h-6 rounded cursor-pointer bg-transparent border-0"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1.5 text-xs">
                    <span className="text-slate-300">{t.editorFloorColor}</span>
                    <input
                      type="color"
                      value={customFloorColor}
                      onChange={(e) => setCustomFloorColor(e.target.value)}
                      className="w-7 h-6 rounded cursor-pointer bg-transparent border-0"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Creator-Locked Difficulty & Critical Limit */}
            <div className="rounded-xl border border-white/10 bg-slate-900/70 p-3 space-y-2.5">
              <div>
                <div className="text-xs font-medium text-slate-200">{t.editorDifficultyLabel}</div>
                <p className="text-[11px] text-slate-400">{t.editorDifficultyHint}</p>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(['easy', 'normal', 'hard'] as DifficultyLevel[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDifficulty(d)}
                    className={`min-h-[38px] rounded-lg border text-xs font-bold transition ${
                      difficulty === d
                        ? d === 'easy'
                          ? 'bg-emerald-500/20 border-emerald-400 text-white'
                          : d === 'normal'
                            ? 'bg-sky-500/20 border-sky-400 text-white'
                            : 'bg-rose-500/20 border-rose-400 text-white'
                        : 'bg-slate-950/70 border-white/10 text-slate-400'
                    }`}
                  >
                    {t.difficulties[d].label}
                  </button>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-300">{t.editorLimitLabel}</span>
                  <span className="font-mono-nums font-bold text-amber-300">{criticalLimit}</span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={250}
                  step={5}
                  value={criticalLimit}
                  onChange={(e) => setCriticalLimit(Number(e.target.value))}
                  className="w-full accent-amber-400"
                />
              </div>

              {/* Objective Mode Selector */}
              <div className="pt-2 border-t border-white/10 space-y-2">
                <div className="text-xs font-medium text-slate-200">{t.editorObjectiveLabel}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setObjectiveMode('eradication')}
                    className={`min-h-[36px] px-1.5 rounded-lg border text-[11px] font-bold transition truncate ${
                      objectiveMode === 'eradication'
                        ? 'bg-sky-500/25 border-sky-400 text-white'
                        : 'bg-slate-950/70 border-white/10 text-slate-400'
                    }`}
                  >
                    {t.modeEradicationName}
                  </button>
                  <button
                    type="button"
                    onClick={() => setObjectiveMode('survival')}
                    className={`min-h-[36px] px-1.5 rounded-lg border text-[11px] font-bold transition truncate ${
                      objectiveMode === 'survival'
                        ? 'bg-amber-500/25 border-amber-400 text-white'
                        : 'bg-slate-950/70 border-white/10 text-slate-400'
                    }`}
                  >
                    {t.modeSurvivalName(targetDurationSec)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setObjectiveMode('target_kills')}
                    className={`min-h-[36px] px-1.5 rounded-lg border text-[11px] font-bold transition truncate ${
                      objectiveMode === 'target_kills'
                        ? 'bg-emerald-500/25 border-emerald-400 text-white'
                        : 'bg-slate-950/70 border-white/10 text-slate-400'
                    }`}
                  >
                    {t.modeQuotaName(targetKills)}
                  </button>
                </div>

                {objectiveMode === 'survival' && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400">{t.editorDurationLabel}</span>
                    <div className="flex items-center gap-1">
                      {[120, 180, 240].map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setTargetDurationSec(sec)}
                          className={`px-2 py-1 rounded text-[11px] font-mono-nums font-bold border transition ${
                            targetDurationSec === sec
                              ? 'bg-amber-500 border-amber-400 text-slate-950'
                              : 'bg-slate-950 border-white/10 text-slate-300'
                          }`}
                        >
                          {Math.floor(sec / 60)}:00
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {objectiveMode === 'target_kills' && (
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-slate-400">{t.editorTargetKillsLabel}</span>
                      <span className="font-mono-nums font-bold text-emerald-300">{targetKills}</span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={120}
                      step={5}
                      value={targetKills}
                      onChange={(e) => setTargetKills(Number(e.target.value))}
                      className="w-full accent-emerald-400"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: High-Speed Canvas Grid Painter */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            {/* Brushes & Utilities */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'wall', label: t.editorBrushWall, dot: activeWallColor },
                    { id: 'floor', label: t.editorBrushFloor, dot: activeFloorColor },
                    { id: 'male', label: t.editorBrushMale, dot: '#1e78ff' },
                    { id: 'female', label: t.editorBrushFemale, dot: '#f03892' },
                    { id: 'floorTunnel', label: t.editorBrushFloorTunnel, dot: '#38bdf8' },
                    { id: 'wallTunnel', label: t.editorBrushWallTunnel, dot: '#f59e0b' },
                  ] as Array<{ id: BrushType; label: string; dot: string }>
                ).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setBrush(b.id);
                      setPendingTunnel(null);
                    }}
                    className={`min-h-[36px] px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition ${
                      brush === b.id
                        ? 'bg-slate-800 border-white text-white shadow'
                        : 'bg-slate-900 border-white/10 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-sm border border-white/30"
                      style={{ backgroundColor: b.dot }}
                    />
                    <span>{b.label}</span>
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    setBrush('erase');
                    setPendingTunnel(null);
                  }}
                  className={`min-h-[36px] px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition ${
                    brush === 'erase'
                      ? 'bg-slate-800 border-white text-white shadow'
                      : 'bg-slate-900 border-white/10 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>{t.editorBrushErase}</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {isLargeGrid && (
                  <button
                    type="button"
                    onClick={() => setZoomMode((v) => (v === 'fit' ? 'paint' : 'fit'))}
                    className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition ${
                      zoomMode === 'paint'
                        ? 'bg-sky-500/25 border-sky-400 text-sky-200'
                        : 'bg-slate-900 border-white/15 text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {zoomMode === 'paint' ? (
                      <>
                        <Maximize2 className="w-3.5 h-3.5" />
                        <span>{t.hudOverviewBtn}</span>
                      </>
                    ) : (
                      <>
                        <ZoomIn className="w-3.5 h-3.5 text-sky-400" />
                        <span>{t.hudZoomInBtn}</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSymmetryX((v) => !v)}
                  className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition ${
                    symmetryX
                      ? 'bg-indigo-500/25 border-indigo-400 text-indigo-200'
                      : 'bg-slate-900 border-white/10 text-slate-400'
                  }`}
                >
                  <FlipHorizontal2 className="w-3.5 h-3.5" />
                  <span>{t.editorSymmetryX}</span>
                </button>
                <button
                  type="button"
                  onClick={handleGenerateMaze}
                  className="min-h-[34px] px-2.5 rounded-lg border border-white/15 bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1 transition"
                >
                  <Dices className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t.editorGenerateMaze}</span>
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  className="min-h-[34px] px-2.5 rounded-lg border border-white/15 bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-slate-300 flex items-center gap-1 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t.editorClearGrid}</span>
                </button>
              </div>
            </div>

            {pendingTunnel && (
              <div className="rounded-lg border border-sky-400/40 bg-sky-500/15 px-3 py-1.5 text-xs text-sky-200">
                {t.editorTunnelPending(
                  pendingTunnel.kind === 'floor' ? t.editorBrushFloorTunnel : t.editorBrushWallTunnel,
                )}
              </div>
            )}

            {/* Canvas Grid Viewport */}
            <div className="rounded-xl border border-white/15 bg-slate-900/90 p-2 sm:p-3 max-h-[460px] overflow-auto flex items-start justify-center select-none">
              <canvas
                ref={canvasRef}
                style={{ width: canvasW, height: canvasH }}
                className="rounded-md cursor-crosshair touch-none shrink-0 shadow-inner"
                onPointerDown={(e) => {
                  e.preventDefault();
                  const cell = getCellFromPointer(e.clientX, e.clientY);
                  if (!cell) return;
                  paintingRef.current = true;
                  lastCellRef.current = cell;
                  applyStrokeAt([[cell.col, cell.row]], true);
                }}
                onPointerMove={(e) => {
                  if (!paintingRef.current) return;
                  const cell = getCellFromPointer(e.clientX, e.clientY);
                  if (!cell) return;
                  const prev = lastCellRef.current;
                  if (prev && prev.col === cell.col && prev.row === cell.row) return;
                  const cells = prev
                    ? paintLinePoints(prev.col, prev.row, cell.col, cell.row)
                    : [[cell.col, cell.row] as [number, number]];
                  lastCellRef.current = cell;
                  applyStrokeAt(cells, false);
                }}
                onPointerUp={() => {
                  paintingRef.current = false;
                  lastCellRef.current = null;
                }}
                onPointerCancel={() => {
                  paintingRef.current = false;
                  lastCellRef.current = null;
                }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <div className="flex items-center gap-3 font-mono-nums">
                <span className="flex items-center gap-1">
                  <Square className="w-3 h-3 text-sky-400" />
                  {cols}×{rows}
                </span>
                <span>
                  M:{rats.filter((x) => x.sex === 'M').length} · F:{rats.filter((x) => x.sex === 'F').length}
                </span>
                <span>Tunnels: {tunnels.length}/4</span>
              </div>
              <span>{t.onlineEqualRulesNote}</span>
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-medium text-rose-200">
                {errorMsg}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 sm:px-6 py-3.5 border-t border-white/10 bg-slate-900/60 flex flex-wrap items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleTest}
            className="min-h-[42px] px-4 rounded-xl border border-sky-400/40 bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 font-semibold text-sm flex items-center gap-2 transition"
          >
            <Play className="w-4 h-4" />
            <span>{t.editorTestBtn}</span>
          </button>

          <button
            type="button"
            disabled={publishing}
            onClick={handlePublish}
            className="min-h-[42px] px-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold text-sm flex items-center gap-2 transition"
          >
            <UploadCloud className="w-4 h-4" />
            <span>
              {publishing
                ? t.editorPublishing
                : user
                  ? t.editorPublishBtn
                  : t.onlineSignInBtn}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
