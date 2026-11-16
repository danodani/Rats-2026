import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clock,
  Globe,
  LogIn,
  LogOut,
  Play,
  Plus,
  Search,
  Share2,
  Trash2,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { soundEngine } from '../game/audio';
import { LANGUAGE_OPTIONS, type TranslationPack } from '../game/i18n';
import type { CommunityLevelDoc, LanguageCode, LevelRunDoc } from '../game/types';
import {
  deleteCommunityLevel,
  fetchCommunityLevelById,
  fetchLevelLeaderboard,
  formatRunTime,
  subscribePublishedLevels,
} from '../services/communityService';

interface CommunityHubProps {
  t: TranslationPack;
  language: LanguageCode;
  user: User | null;
  username: string;
  onLanguageChange: (lang: LanguageCode) => void;
  onBackToModes: () => void;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onOpenEditor: () => void;
  onPlayLevel: (level: CommunityLevelDoc) => void;
}

function extractLevelId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    if (trimmed.includes('http') || trimmed.includes('level=')) {
      const idx = trimmed.indexOf('level=');
      if (idx >= 0) {
        return trimmed.slice(idx + 6).split('&')[0].trim();
      }
    }
  } catch {
    // fallback to trimmed string
  }
  return trimmed;
}

const MiniGridPreview: React.FC<{
  layout: string[];
  wallColor: string;
  floorColor: string;
}> = ({ layout, wallColor, floorColor }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rows = layout.length;
  const cols = layout[0]?.length ?? 17;

  const maxW = 84;
  const maxH = 96;
  const scale = Math.min(maxW / Math.max(1, cols), maxH / Math.max(1, rows));
  const width = Math.max(28, Math.round(cols * scale));
  const height = Math.max(28, Math.round(rows * scale));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = floorColor;
    ctx.fillRect(0, 0, width, height);

    const cellW = width / cols;
    const cellH = height / rows;
    ctx.fillStyle = wallColor;
    for (let r = 0; r < rows; r++) {
      const rowStr = layout[r] ?? '';
      for (let c = 0; c < cols; c++) {
        if (rowStr[c] === '#') {
          ctx.fillRect(c * cellW, r * cellH, Math.ceil(cellW), Math.ceil(cellH));
        }
      }
    }
  }, [layout, wallColor, floorColor, cols, rows, width, height]);

  return (
    <div
      className="p-1.5 rounded-lg bg-black/50 border border-white/10 shrink-0 flex items-center justify-center"
      style={{ width: maxW + 10, height: maxH + 10 }}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        className="rounded-sm block"
      />
    </div>
  );
};

const BIOME_FALLBACK: Record<string, { wall: string; floor: string }> = {
  grass: { wall: '#289e28', floor: '#6e7073' },
  sand: { wall: '#d2a44e', floor: '#5c544a' },
  city: { wall: '#b25e40', floor: '#2e3440' },
  ice: { wall: '#b6def4', floor: '#3e4a5e' },
  lava: { wall: '#a8362e', floor: '#5e6066' },
  moon: { wall: '#c2cad6', floor: '#272c38' },
};

export const CommunityHub: React.FC<CommunityHubProps> = ({
  t,
  language,
  user,
  onLanguageChange,
  onBackToModes,
  onSignIn,
  onSignOut,
  onOpenEditor,
  onPlayLevel,
}) => {
  const [levels, setLevels] = useState<CommunityLevelDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'all' | 'mine'>('all');
  const [joinCode, setJoinCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [leaderboardLevel, setLeaderboardLevel] = useState<CommunityLevelDoc | null>(null);
  const [runs, setRuns] = useState<LevelRunDoc[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribePublishedLevels(
      (items) => {
        setLevels(items);
        setLoading(false);
      },
      () => {
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const handleOpenByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = extractLevelId(joinCode);
    if (!cleanId) return;
    soundEngine.unlock();
    soundEngine.playUiClick(740);
    const found = await fetchCommunityLevelById(cleanId);
    if (!found) {
      setNotice(t.onlineCodeNotFound);
      window.setTimeout(() => setNotice(null), 3000);
      return;
    }
    onPlayLevel(found);
  };

  const handleShare = async (levelId: string) => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?level=${encodeURIComponent(levelId)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      setJoinCode(shareUrl);
    }
    setCopiedId(levelId);
    setNotice(t.onlineShareCopied);
    window.setTimeout(() => {
      setCopiedId(null);
      setNotice(null);
    }, 2800);
  };

  const handleOpenLeaderboard = async (lvl: CommunityLevelDoc) => {
    soundEngine.playUiClick(720);
    setLeaderboardLevel(lvl);
    setRuns([]);
    setRunsLoading(true);
    try {
      const list = await fetchLevelLeaderboard(lvl.id);
      setRuns(list);
    } finally {
      setRunsLoading(false);
    }
  };

  const handleDelete = async (lvl: CommunityLevelDoc) => {
    if (!user || lvl.authorId !== user.uid) return;
    soundEngine.playUiClick(580);
    await deleteCommunityLevel(lvl.id);
  };

  const displayed =
    filterTab === 'mine' && user
      ? levels.filter((l) => l.authorId === user.uid)
      : levels;

  return (
    <div className="relative w-full h-[100dvh] overflow-y-auto bg-[#0f1720] text-slate-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5">
        {/* Top Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackToModes}
              className="min-h-[40px] px-3 rounded-xl border border-white/10 bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t.switchModeBtn}</span>
            </button>
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
                {t.onlineTitle}
              </h1>
              <p className="text-xs text-slate-400">{t.onlineSubtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="min-h-[40px] px-2.5 flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium cursor-pointer">
              <Globe className="w-4 h-4 text-sky-400 shrink-0" />
              <select
                aria-label={t.languageLabel}
                value={language}
                onChange={(e) => onLanguageChange(e.target.value as LanguageCode)}
                className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer pr-1"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code} className="bg-slate-900 text-white">
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            {user ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 min-h-[40px] text-xs">
                <span className="text-emerald-200 truncate max-w-[140px]">
                  {t.onlineSignedInAs}: <strong>{user.displayName || 'Player'}</strong>
                </span>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="text-slate-300 hover:text-white flex items-center gap-1"
                  title={t.onlineSignOutBtn}
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                className="min-h-[40px] px-3.5 rounded-xl bg-white hover:bg-slate-200 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition"
              >
                <LogIn className="w-4 h-4" />
                <span>{t.onlineSignInBtn}</span>
              </button>
            )}
          </div>
        </header>

        {!user && (
          <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-200 flex flex-wrap items-center justify-between gap-2">
            <span>{t.onlineSignInRequired}</span>
            <button
              type="button"
              onClick={onSignIn}
              className="font-bold text-white underline hover:text-sky-300"
            >
              {t.onlineSignInBtn}
            </button>
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-4 py-2.5 text-xs font-medium text-emerald-200">
            {notice}
          </div>
        )}

        {/* Controls Bar: Create Map + Join Friend Code */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenEditor}
              className="min-h-[44px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center gap-2 transition"
            >
              <Plus className="w-4 h-4" />
              <span>{t.onlineCreateMapBtn.replace(/^\+\s*/, '')}</span>
            </button>

            <div className="flex items-center p-1 rounded-xl bg-slate-900 border border-white/10">
              <button
                type="button"
                onClick={() => setFilterTab('all')}
                className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition ${
                  filterTab === 'all' ? 'bg-sky-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                {t.onlineAllMaps}
              </button>
              {user && (
                <button
                  type="button"
                  onClick={() => setFilterTab('mine')}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition ${
                    filterTab === 'mine' ? 'bg-sky-500 text-slate-950' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {t.onlineMyMaps}
                </button>
              )}
            </div>
          </div>

          <form onSubmit={handleOpenByCode} className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-slate-900 px-3 min-h-[42px] flex-1 sm:w-64">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder={t.onlineJoinCodePlaceholder}
                className="w-full bg-transparent text-xs text-white focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="min-h-[42px] px-3.5 rounded-xl border border-white/15 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition"
            >
              {t.onlineJoinBtn}
            </button>
          </form>
        </div>

        {/* Maps Grid */}
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">...</div>
        ) : displayed.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-8 text-center space-y-3">
            <Users className="w-8 h-8 text-slate-500 mx-auto" />
            <p className="text-sm text-slate-300">{t.onlineEmptyState}</p>
            <button
              type="button"
              onClick={onOpenEditor}
              className="min-h-[42px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>{t.onlineCreateMapBtn.replace(/^\+\s*/, '')}</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
            {displayed.map((lvl) => {
              const fb = BIOME_FALLBACK[lvl.biome] ?? BIOME_FALLBACK.grass;
              const wallCol = lvl.customWallColor || fb.wall;
              const floorCol = lvl.customFloorColor || fb.floor;
              const diffLabel = t.difficulties[lvl.difficulty]?.label ?? lvl.difficulty;
              const isOwner = Boolean(user && lvl.authorId === user.uid);

              return (
                <div
                  key={lvl.id}
                  className="rounded-2xl border border-white/10 bg-slate-900/85 p-4 flex flex-col justify-between gap-3.5"
                >
                  <div className="flex items-start gap-3.5">
                    <MiniGridPreview
                      layout={lvl.layout}
                      wallColor={wallCol}
                      floorColor={floorCol}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-display text-base font-bold text-white truncate">
                          {lvl.title}
                        </h3>
                        <span className="text-[10px] font-mono-nums px-2 py-0.5 rounded bg-slate-800 border border-white/10 text-slate-300 shrink-0">
                          {lvl.layout[0].length}×{lvl.layout.length}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate">
                        by <span className="text-slate-200 font-medium">{lvl.authorName}</span> ·{' '}
                        {t.biomes[lvl.biome]}
                      </p>
                      {lvl.description && (
                        <p className="mt-1 text-xs text-slate-300 line-clamp-2">{lvl.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <span
                          className={`px-2 py-0.5 rounded font-semibold ${
                            lvl.difficulty === 'easy'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : lvl.difficulty === 'hard'
                                ? 'bg-rose-500/15 text-rose-300'
                                : 'bg-sky-500/15 text-sky-300'
                          }`}
                        >
                          {t.onlineCreatorDiff(diffLabel)}
                        </span>
                        <span className="font-mono-nums text-slate-400">
                          {t.levelCardRatsLimit(lvl.initialRats.length, lvl.criticalLimit)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Record Strip */}
                  <div className="flex items-center justify-between rounded-xl bg-slate-950/75 border border-white/5 px-3 py-2 text-xs">
                    <div className="flex items-center gap-1.5 text-amber-300">
                      <Trophy className="w-4 h-4 shrink-0" />
                      {lvl.bestTimeMs > 0 ? (
                        <span className="font-mono-nums">
                          {t.onlineRecordLabel}: <strong>{formatRunTime(lvl.bestTimeMs)}</strong> (
                          {lvl.bestPlayerName})
                        </span>
                      ) : (
                        <span className="text-slate-400">{t.onlineNoRecordYet}</span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono-nums text-slate-400">
                      {t.onlinePlaysCount(lvl.playCount)}
                    </span>
                  </div>

                  {/* Card Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onPlayLevel(lvl)}
                      className="flex-1 min-h-[40px] px-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{t.onlinePlayBtn}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenLeaderboard(lvl)}
                      className="min-h-[40px] px-3 rounded-xl border border-white/15 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-xs flex items-center gap-1.5 transition"
                    >
                      <Trophy className="w-3.5 h-3.5 text-amber-400" />
                      <span>{t.onlineLeaderboardBtn}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleShare(lvl.id)}
                      className="min-h-[40px] px-3 rounded-xl border border-white/15 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-xs flex items-center gap-1.5 transition"
                      title={t.onlineShareBtn}
                    >
                      {copiedId === lvl.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Share2 className="w-3.5 h-3.5 text-sky-400" />
                      )}
                      <span className="hidden sm:inline">{t.onlineShareBtn}</span>
                    </button>

                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => handleDelete(lvl)}
                        className="min-h-[40px] min-w-[40px] rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 flex items-center justify-center transition"
                        title={t.onlineDeleteBtn}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Leaderboard Modal */}
      {leaderboardLevel && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md max-h-[85dvh] flex flex-col rounded-2xl border border-white/15 bg-slate-950 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2 min-w-0">
                <Trophy className="w-5 h-5 text-amber-400 shrink-0" />
                <h2 className="font-display text-base font-bold text-white truncate">
                  {t.onlineLeaderboardTitle(leaderboardLevel.title)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setLeaderboardLevel(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-2">
              {runsLoading ? (
                <div className="py-8 text-center text-xs text-slate-400">...</div>
              ) : runs.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  {t.onlineLeaderboardEmpty}
                </div>
              ) : (
                runs.map((run, idx) => (
                  <div
                    key={run.runnerId}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs ${
                      idx === 0
                        ? 'border-amber-400/40 bg-amber-500/10'
                        : idx === 1
                          ? 'border-slate-300/30 bg-slate-800/70'
                          : idx === 2
                            ? 'border-orange-500/30 bg-orange-500/10'
                            : 'border-white/10 bg-slate-900/70'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono-nums font-bold w-6 text-center text-amber-300">
                        #{idx + 1}
                      </span>
                      <span className="font-semibold text-white truncate">{run.playerName}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] text-slate-400 font-mono-nums">
                        {run.eliminatedCount} {t.statEliminated.toLowerCase()}
                      </span>
                      <span className="font-mono-nums font-bold text-sky-300 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {formatRunTime(run.timeMs)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
