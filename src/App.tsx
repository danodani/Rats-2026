import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Atom,
  Bomb,
  BrickWall,
  Check,
  Clock,
  Coins,
  Copy,
  Dna,
  Download,
  FastForward,
  FlaskConical,
  Globe,
  HelpCircle,
  Home,
  Lock,
  Maximize2,
  Pause,
  Play,
  Radiation,
  RotateCcw,
  Save,
  Share2,
  ShieldAlert,
  ShoppingBag,
  Skull,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  User,
  Users,
  Volume2,
  VolumeX,
  Wind,
  X,
  ZoomIn,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { soundEngine } from './game/audio';
import { RatsGameEngine } from './game/engine';
import {
  detectBrowserLanguage,
  getLocaleForLanguage,
  LANGUAGE_OPTIONS,
  TRANSLATIONS,
} from './game/i18n';
import { communityLevelToConfig, LEVELS } from './game/levels';
import {
  BASE_TOOL_ORDER,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  STORE_MAX_STOCK,
  STORE_TOOL_ORDER,
  TOOL_ORDER,
  TOOLS_META,
  type BaseToolType,
  type BiomeType,
  type CommunityLevelDoc,
  type DifficultyLevel,
  type GameSnapshot,
  type LanguageCode,
  type LevelConfig,
  type PlayerProfile,
  type StoreToolType,
  type ToolType,
} from './game/types';
import { CommunityHub } from './components/CommunityHub';
import { LevelEditorModal } from './components/LevelEditorModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import {
  fetchCommunityLevelById,
  formatRunTime,
  submitCommunityRun,
} from './services/communityService';

const PROFILE_STORAGE_KEY = 'rats_player_profile_v2';

const TOOL_ICONS: Record<ToolType, React.FC<{ className?: string }>> = {
  bomb: Bomb,
  gas: Wind,
  poison: FlaskConical,
  nuclear: Radiation,
  tempWall: ShieldAlert,
  mutagen: Dna,
  permWall: BrickWall,
  plague: Skull,
};

const BIOME_ORDER: BiomeType[] = ['grass', 'sand', 'city', 'ice', 'lava', 'moon'];

const BIOME_ACCENT: Record<BiomeType, string> = {
  grass: '#28a828',
  sand: '#d49b3b',
  city: '#b25e40',
  ice: '#7fc4e8',
  lava: '#c94036',
  moon: '#cbd5e1',
};

const VALID_LANGUAGES = new Set<LanguageCode>(['it', 'en', 'de', 'es', 'zh', 'fr']);

function computeSequentialUnlocked(completedLevels: number[]): number {
  let unlocked = 1;
  while (unlocked < LEVELS.length && completedLevels.includes(unlocked)) {
    unlocked += 1;
  }
  return unlocked;
}

function defaultProfile(langOverride?: LanguageCode, usernameOverride?: string): PlayerProfile {
  const lang = langOverride ?? detectBrowserLanguage();
  const cleanName = usernameOverride?.trim().slice(0, 20);
  return {
    username: cleanName || TRANSLATIONS[lang].defaultUsername,
    language: lang,
    credits: 0,
    difficulty: 'normal',
    unlockedLevel: 1,
    completedLevels: [],
    storeStock: { permWall: 0, plague: 0 },
    lastSavedAt: null,
  };
}

function sanitizeProfile(raw: Partial<PlayerProfile>): PlayerProfile {
  const fallbackLang = detectBrowserLanguage();
  const lang: LanguageCode =
    typeof raw.language === 'string' && VALID_LANGUAGES.has(raw.language as LanguageCode)
      ? (raw.language as LanguageCode)
      : fallbackLang;
  const diff: DifficultyLevel =
    raw.difficulty === 'easy' || raw.difficulty === 'normal' || raw.difficulty === 'hard'
      ? raw.difficulty
      : 'normal';
  const completed = Array.isArray(raw.completedLevels)
    ? Array.from(
        new Set(
          raw.completedLevels.filter(
            (n) => typeof n === 'number' && n >= 1 && n <= LEVELS.length,
          ),
        ),
      )
    : [];
  // Strictly unlock Level 1 by default; every subsequent level requires completing the previous one
  const unlockedLevel = computeSequentialUnlocked(completed);

  return {
    username:
      typeof raw.username === 'string' && raw.username.trim()
        ? raw.username.trim().slice(0, 20)
        : TRANSLATIONS[lang].defaultUsername,
    language: lang,
    credits:
      typeof raw.credits === 'number' && Number.isFinite(raw.credits) && raw.credits >= 0
        ? Math.floor(raw.credits)
        : 0,
    difficulty: diff,
    unlockedLevel,
    completedLevels: completed,
    storeStock: {
      permWall: Math.max(
        0,
        Math.min(STORE_MAX_STOCK.permWall, Math.floor(Number(raw.storeStock?.permWall ?? 0))),
      ),
      plague: Math.max(
        0,
        Math.min(STORE_MAX_STOCK.plague, Math.floor(Number(raw.storeStock?.plague ?? 0))),
      ),
    },
    lastSavedAt: typeof raw.lastSavedAt === 'string' ? raw.lastSavedAt : null,
  };
}

function loadStoredProfile(): { profile: PlayerProfile; hasSavedGame: boolean } {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = sanitizeProfile(JSON.parse(raw) as Partial<PlayerProfile>);
      return { profile: parsed, hasSavedGame: true };
    }
  } catch {
    // ignore storage errors
  }
  return { profile: defaultProfile(), hasSavedGame: false };
}

function saveProfile(profile: PlayerProfile): void {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore storage errors
  }
}

function formatSavedTime(
  iso: string | null,
  lang: LanguageCode,
  autoLabel: string,
  savedLabel: string,
): string {
  if (!iso) return autoLabel;
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(getLocaleForLanguage(lang), {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return savedLabel;
  }
}

function buildInitialSnapshotFromConfig(
  lvl: LevelConfig,
  difficulty: DifficultyLevel,
  stock: Record<StoreToolType, number>,
): GameSnapshot {
  const diff = DIFFICULTIES[difficulty];
  const baseReward = lvl.isCommunity ? 0 : Math.round(lvl.rewardCredits * diff.rewardMul);
  const inv: Record<ToolType, number> = {
    bomb: lvl.tools.bomb.start,
    gas: lvl.tools.gas.start,
    poison: lvl.tools.poison.start,
    nuclear: lvl.tools.nuclear.start,
    tempWall: lvl.tools.tempWall.start,
    mutagen: lvl.tools.mutagen.start,
    permWall: lvl.isCommunity ? 0 : Math.max(0, Math.min(STORE_MAX_STOCK.permWall, stock.permWall)),
    plague: lvl.isCommunity ? 0 : Math.max(0, Math.min(STORE_MAX_STOCK.plague, stock.plague)),
  };
  const maxInv: Record<BaseToolType, number> = {
    bomb: lvl.tools.bomb.max,
    gas: lvl.tools.gas.max,
    poison: lvl.tools.poison.max,
    nuclear: lvl.tools.nuclear.max,
    tempWall: lvl.tools.tempWall.max,
    mutagen: lvl.tools.mutagen.max,
  };
  return {
    levelId: lvl.id,
    levelName: lvl.name,
    biome: lvl.biome,
    difficulty,
    isCommunity: lvl.isCommunity,
    communityId: lvl.communityId,
    status: 'playing',
    males: lvl.initialRats.filter((r) => r.sex === 'M').length,
    females: lvl.initialRats.filter((r) => r.sex === 'F').length,
    babies: 0,
    pregnant: 0,
    sterile: 0,
    infected: 0,
    totalRats: lvl.initialRats.length,
    criticalLimit: Math.max(30, lvl.criticalLimit + (lvl.isCommunity ? 0 : diff.limitOffset)),
    eliminatedCount: 0,
    bornCount: 0,
    elapsedSeconds: 0,
    regenSpeedBonus: 1,
    inventory: inv,
    maxInventory: maxInv,
    regenProgress: {
      bomb: 0,
      gas: 0,
      poison: 0,
      nuclear: 0,
      tempWall: 0,
      mutagen: 0,
    },
    selectedTool: 'bomb',
    speedMultiplier: 1,
    baseRewardCredits: baseReward,
    currentRewardCredits: baseReward,
  };
}

export default function App() {
  const [initialStored] = useState(() => loadStoredProfile());
  const [profile, setProfile] = useState<PlayerProfile>(initialStored.profile);
  const [hasSavedGame, setHasSavedGame] = useState<boolean>(initialStored.hasSavedGame);
  const [welcomeName, setWelcomeName] = useState<string>(
    initialStored.hasSavedGame ? '' : initialStored.profile.username,
  );
  const [screen, setScreen] = useState<'welcome' | 'modes' | 'menu' | 'online' | 'game'>('welcome');
  const [menuTab, setMenuTab] = useState<'levels' | 'store' | 'save' | 'rules'>('levels');
  const [levelIdx, setLevelIdx] = useState(0);
  const [activeCommunityConfig, setActiveCommunityConfig] = useState<LevelConfig | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const firebaseUserRef = useRef<FirebaseUser | null>(null);
  firebaseUserRef.current = firebaseUser;

  const [pendingDeepLinkId, setPendingDeepLinkId] = useState<string | null>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('level');
      return p && p.trim() ? p.trim() : null;
    } catch {
      return null;
    }
  });

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RatsGameEngine | null>(null);
  const rewardClaimedRef = useRef(false);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const levelIdxRef = useRef(levelIdx);
  levelIdxRef.current = levelIdx;
  const communityConfigRef = useRef<LevelConfig | null>(activeCommunityConfig);
  communityConfigRef.current = activeCommunityConfig;

  const [snapshot, setSnapshot] = useState<GameSnapshot>(() =>
    buildInitialSnapshotFromConfig(LEVELS[0], profile.difficulty, profile.storeStock),
  );
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [muted, setMuted] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [lastWinSummary, setLastWinSummary] = useState<{
    base: number;
    earned: number;
    penalty: number;
  } | null>(null);

  const [communityRunStatus, setCommunityRunStatus] = useState<{
    submitting: boolean;
    saved: boolean;
    isNewWorldRecord: boolean;
    isNewPersonalBest: boolean;
    recordedTimeMs: number;
    error?: string;
  } | null>(null);
  const [victoryShareCopied, setVictoryShareCopied] = useState(false);

  // Save manager UI states
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  const t = TRANSLATIONS[profile.language];

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setFirebaseUser(u);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    document.documentElement.lang = profile.language;
  }, [profile.language]);

  const handleGoogleSignIn = async () => {
    try {
      soundEngine.unlock();
      await signInWithPopup(auth, googleProvider);
    } catch {
      // popup cancelled or blocked
    }
  };

  const handleGoogleSignOut = async () => {
    await signOut(auth);
  };

  const updateProfile = (updater: (prev: PlayerProfile) => PlayerProfile, stampSave = true) => {
    setProfile((prev) => {
      const updated = updater(prev);
      const next = stampSave
        ? { ...updated, lastSavedAt: new Date().toISOString() }
        : updated;
      saveProfile(next);
      setHasSavedGame(true);
      return next;
    });
  };

  const triggerManualSave = () => {
    soundEngine.unlock();
    soundEngine.playUiClick(780);
    updateProfile((prev) => ({ ...prev }), true);
    setSaveNotice(t.noticeSaved);
    window.setTimeout(() => setSaveNotice(null), 2600);
  };

  const recordCommunityVictory = async (
    communityId: string,
    elapsedSeconds: number,
    eliminatedCount: number,
    bornCount: number,
    user: FirebaseUser,
  ) => {
    setCommunityRunStatus({
      submitting: true,
      saved: false,
      isNewWorldRecord: false,
      isNewPersonalBest: false,
      recordedTimeMs: Math.max(1000, Math.round(elapsedSeconds * 1000)),
    });
    try {
      const res = await submitCommunityRun(
        communityId,
        elapsedSeconds,
        eliminatedCount,
        bornCount,
        user,
        profileRef.current.username,
      );
      setCommunityRunStatus({
        submitting: false,
        saved: true,
        isNewWorldRecord: res.isNewWorldRecord,
        isNewPersonalBest: res.isNewPersonalBest,
        recordedTimeMs: res.recordedTimeMs,
      });
    } catch (e) {
      setCommunityRunStatus({
        submitting: false,
        saved: false,
        isNewWorldRecord: false,
        isNewPersonalBest: false,
        recordedTimeMs: Math.max(1000, Math.round(elapsedSeconds * 1000)),
        error: e instanceof Error ? e.message : 'Error',
      });
    }
  };

  // Mount/unmount WebGL engine strictly when entering/exiting the 3D arena
  useEffect(() => {
    if (screen !== 'game' || !canvasHostRef.current) return;

    rewardClaimedRef.current = false;
    setLastWinSummary(null);
    setCommunityRunStatus(null);
    setVictoryShareCopied(false);

    const customLevel = communityConfigRef.current;
    const chosenLevel = customLevel ?? LEVELS[levelIdxRef.current];
    const effectiveDiff = customLevel
      ? customLevel.creatorDifficulty ?? 'normal'
      : profileRef.current.difficulty;
    const initialStock = customLevel
      ? { permWall: 0, plague: 0 }
      : { ...profileRef.current.storeStock };
    setSnapshot(buildInitialSnapshotFromConfig(chosenLevel, effectiveDiff, initialStock));

    const engine = new RatsGameEngine(
      canvasHostRef.current,
      chosenLevel,
      effectiveDiff,
      initialStock,
      (snap) => {
        setSnapshot(snap);
        if (snap.status === 'won' && !rewardClaimedRef.current) {
          rewardClaimedRef.current = true;
          if (snap.isCommunity) {
            const timeMs = Math.max(1000, Math.round(snap.elapsedSeconds * 1000));
            if (snap.communityId && firebaseUserRef.current) {
              void recordCommunityVictory(
                snap.communityId,
                snap.elapsedSeconds,
                snap.eliminatedCount,
                snap.bornCount,
                firebaseUserRef.current,
              );
            } else {
              setCommunityRunStatus({
                submitting: false,
                saved: false,
                isNewWorldRecord: false,
                isNewPersonalBest: false,
                recordedTimeMs: timeMs,
              });
            }
            return;
          }

          const earned = snap.currentRewardCredits;
          const base = snap.baseRewardCredits;
          const penalty = Math.max(0, base - earned);
          setLastWinSummary({ base, earned, penalty });
          updateProfile((prev) => {
            const nextCompleted = prev.completedLevels.includes(snap.levelId)
              ? prev.completedLevels
              : [...prev.completedLevels, snap.levelId];
            return {
              ...prev,
              credits: prev.credits + earned,
              completedLevels: nextCompleted,
              unlockedLevel: computeSequentialUnlocked(nextCompleted),
            };
          });
        }
      },
      (storeTool) => {
        if (communityConfigRef.current) return;
        updateProfile((prev) => ({
          ...prev,
          storeStock: {
            ...prev.storeStock,
            [storeTool]: Math.max(0, prev.storeStock[storeTool] - 1),
          },
        }));
      },
    );
    engineRef.current = engine;

    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === ' ') {
        e.preventDefault();
        engine.togglePause();
        return;
      }

      const numMatch = /^(?:Digit|Numpad)?([1-8])$/.exec(e.code) ?? /^([1-8])$/.exec(e.key);
      if (numMatch) {
        const slot = Number(numMatch[1]);
        if (slot >= 1 && slot <= 6) {
          engine.setSelectedTool(BASE_TOOL_ORDER[slot - 1]);
        } else if (slot === 7 && snapshotRef.current.inventory.permWall > 0) {
          engine.setSelectedTool('permWall');
        } else if (slot === 8 && snapshotRef.current.inventory.plague > 0) {
          engine.setSelectedTool('plague');
        }
      }
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      window.removeEventListener('keydown', handleKey);
      engine.dispose();
      engineRef.current = null;
    };
  }, [screen]);

  const startLevel = (idx: number) => {
    const lvl = LEVELS[idx];
    const isUnlocked = lvl.id === 1 || profile.completedLevels.includes(lvl.id - 1);
    if (!isUnlocked) return;

    soundEngine.unlock();
    soundEngine.playUiClick(740);
    rewardClaimedRef.current = false;
    communityConfigRef.current = null;
    setActiveCommunityConfig(null);
    levelIdxRef.current = idx;
    setLevelIdx(idx);
    if (screen === 'game' && engineRef.current) {
      setLastWinSummary(null);
      engineRef.current.loadLevel(LEVELS[idx], profile.difficulty, profile.storeStock);
    } else {
      setScreen('game');
    }
  };

  const startCommunityConfig = (cfg: LevelConfig) => {
    soundEngine.unlock();
    soundEngine.playUiClick(740);
    rewardClaimedRef.current = false;
    setLastWinSummary(null);
    setCommunityRunStatus(null);
    setShowEditor(false);
    communityConfigRef.current = cfg;
    setActiveCommunityConfig(cfg);
    if (screen === 'game' && engineRef.current) {
      engineRef.current.loadLevel(cfg, cfg.creatorDifficulty ?? 'normal', {
        permWall: 0,
        plague: 0,
      });
    } else {
      setScreen('game');
    }
  };

  const startCommunityDoc = (docItem: CommunityLevelDoc) => {
    startCommunityConfig(communityLevelToConfig(docItem));
  };

  const restartCurrentLevel = () => {
    rewardClaimedRef.current = false;
    setLastWinSummary(null);
    setCommunityRunStatus(null);
    const custom = communityConfigRef.current;
    if (custom) {
      engineRef.current?.loadLevel(custom, custom.creatorDifficulty ?? 'normal', {
        permWall: 0,
        plague: 0,
      });
    } else {
      engineRef.current?.restartLevel(profile.difficulty, profile.storeStock);
    }
  };

  const buyStoreItem = (item: StoreToolType) => {
    const meta = TOOLS_META[item];
    const price = meta.storePrice ?? 200;
    const maxCap = STORE_MAX_STOCK[item];
    if (profile.storeStock[item] >= maxCap || profile.credits < price) {
      soundEngine.play('clunk', 120, 0.5);
      return;
    }
    soundEngine.unlock();
    soundEngine.play('putdown', 60, 0.72);
    updateProfile((prev) => {
      const nextStock = {
        ...prev.storeStock,
        [item]: Math.min(maxCap, prev.storeStock[item] + 1),
      };
      engineRef.current?.syncStoreStock(nextStock);
      return {
        ...prev,
        credits: prev.credits - price,
        storeStock: nextStock,
      };
    });
  };

  const copySaveCode = async () => {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(profile))));
    try {
      await navigator.clipboard.writeText(encoded);
      setSaveNotice(t.noticeCopied);
    } catch {
      setImportText(encoded);
      setSaveNotice(t.noticeCopyFallback);
    }
    window.setTimeout(() => setSaveNotice(null), 3000);
  };

  const downloadSaveJson = () => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rats-save-${profile.username.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'player'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setSaveNotice(t.noticeDownloaded);
    window.setTimeout(() => setSaveNotice(null), 2600);
  };

  const handleImportSave = () => {
    const trimmed = importText.trim();
    if (!trimmed) return;
    try {
      let parsed: Partial<PlayerProfile>;
      if (trimmed.startsWith('{')) {
        parsed = JSON.parse(trimmed) as Partial<PlayerProfile>;
      } else {
        const decoded = decodeURIComponent(escape(atob(trimmed)));
        parsed = JSON.parse(decoded) as Partial<PlayerProfile>;
      }
      const clean = sanitizeProfile(parsed);
      clean.lastSavedAt = new Date().toISOString();
      saveProfile(clean);
      setProfile(clean);
      setImportText('');
      setSaveNotice(TRANSLATIONS[clean.language].noticeRestored);
      soundEngine.play('putdown', 60, 0.7);
    } catch {
      setSaveNotice(t.noticeInvalidImport);
      soundEngine.play('clunk', 120, 0.5);
    }
    window.setTimeout(() => setSaveNotice(null), 3200);
  };

  const handleResetProfile = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    const fresh: PlayerProfile = {
      ...defaultProfile(profile.language),
      username: TRANSLATIONS[profile.language].defaultUsername,
    };
    try {
      localStorage.removeItem(PROFILE_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    setProfile(fresh);
    setHasSavedGame(false);
    setConfirmReset(false);
    setSaveNotice(t.noticeReset);
    window.setTimeout(() => setSaveNotice(null), 2600);
  };

  const routeAfterWelcome = async () => {
    if (pendingDeepLinkId) {
      const targetId = pendingDeepLinkId;
      setPendingDeepLinkId(null);
      try {
        window.history.replaceState({}, '', window.location.pathname);
      } catch {
        // ignore
      }
      const docFound = await fetchCommunityLevelById(targetId);
      if (docFound) {
        startCommunityDoc(docFound);
        return;
      }
      setScreen('online');
      return;
    }
    setScreen('modes');
  };

  const handleStartNewGame = (e: React.FormEvent) => {
    e.preventDefault();
    soundEngine.unlock();
    soundEngine.playUiClick(780);
    const chosenName = welcomeName.trim() || t.defaultUsername;
    const fresh: PlayerProfile = {
      ...defaultProfile(profile.language, chosenName),
      lastSavedAt: new Date().toISOString(),
    };
    saveProfile(fresh);
    setProfile(fresh);
    setHasSavedGame(true);
    setLevelIdx(0);
    setMenuTab('levels');
    void routeAfterWelcome();
  };

  const handleContinueGame = () => {
    soundEngine.unlock();
    soundEngine.playUiClick(760);
    setMenuTab('levels');
    void routeAfterWelcome();
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundEngine.setMuted(next);
  };

  const handleLanguageChange = (newLang: LanguageCode) => {
    soundEngine.unlock();
    soundEngine.playUiClick(740);
    if (screen === 'welcome' && !hasSavedGame) {
      const oldDefault = TRANSLATIONS[profile.language].defaultUsername;
      const newDefault = TRANSLATIONS[newLang].defaultUsername;
      setProfile((prev) => ({
        ...prev,
        language: newLang,
        username: prev.username === oldDefault ? newDefault : prev.username,
      }));
      if (!welcomeName.trim() || welcomeName.trim() === oldDefault) {
        setWelcomeName(newDefault);
      }
      return;
    }
    updateProfile((prev) => {
      const oldDefault = TRANSLATIONS[prev.language].defaultUsername;
      const newDefault = TRANSLATIONS[newLang].defaultUsername;
      return {
        ...prev,
        language: newLang,
        username: prev.username === oldDefault ? newDefault : prev.username,
      };
    });
  };

  const pwaLabels = {
    installApp: t.pwaInstallApp,
    installShort: t.pwaInstallShort,
    installTitle: t.pwaInstallTitle,
    iosTitle: t.pwaIosTitle,
    iosStep1: t.pwaIosStep1,
    iosStep2: t.pwaIosStep2,
    understood: t.pwaUnderstood,
    close: t.helpClose,
  };

  if (screen === 'welcome') {
    return (
      <div className="relative w-full h-[100dvh] overflow-y-auto bg-[#0f1720] text-slate-100 flex flex-col">
        <OfflineIndicator label={t.offlineMode} />

        {/* Top Utility Strip */}
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 pt-4 flex items-center justify-end gap-2">
          <label className="min-h-[40px] px-2.5 flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium transition cursor-pointer">
            <Globe className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="sr-only">{t.languageLabel}</span>
            <select
              aria-label={t.languageLabel}
              value={profile.language}
              onChange={(e) => handleLanguageChange(e.target.value as LanguageCode)}
              className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer pr-1"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code} className="bg-slate-900 text-white">
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <PWAInstallButton labels={pwaLabels} />

          <button
            type="button"
            onClick={toggleMute}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-white/10 bg-slate-900 hover:bg-slate-800 text-slate-200 transition"
            aria-label={muted ? t.audioOn : t.audioOff}
          >
            {muted ? (
              <VolumeX className="w-4 h-4 text-slate-500" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Center Title & Entry Card */}
        <main className="flex-1 flex items-center justify-center px-4 py-6">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900/90 p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-block px-3 py-1 rounded-md border border-amber-400/30 bg-amber-500/10 text-[11px] font-mono-nums uppercase tracking-widest text-amber-300">
                {t.welcomeSubtitle}
              </div>
              <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white">
                {t.welcomeTitle}
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed">{t.welcomeTagline}</p>
            </div>

            {/* Continue Saved Game Card (shown only when an existing save is detected) */}
            {hasSavedGame && (
              <div className="rounded-2xl border border-sky-400/35 bg-sky-500/10 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-sky-300">
                      {t.welcomeContinueTitle}
                    </div>
                    <div className="mt-0.5 text-sm font-semibold text-white">
                      {t.welcomeContinueMeta(
                        profile.username,
                        profile.completedLevels.length,
                        LEVELS.length,
                        profile.credits,
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleContinueGame}
                  className="w-full min-h-[46px] rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.99] text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>{t.welcomeContinueBtn}</span>
                </button>
              </div>
            )}

            {/* Player Name Choice & Start New Game */}
            <form
              onSubmit={handleStartNewGame}
              className="rounded-2xl border border-white/10 bg-slate-950/75 p-4 space-y-3.5"
            >
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t.welcomeNewTitle}
              </div>

              <div>
                <label htmlFor="welcome-username" className="block text-xs text-slate-400 mb-1">
                  {t.usernameLabel}
                </label>
                <div className="flex items-center gap-2.5 rounded-xl border border-white/15 bg-slate-900 px-3 py-2 focus-within:border-emerald-400">
                  <User className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    id="welcome-username"
                    type="text"
                    maxLength={20}
                    value={welcomeName}
                    onChange={(e) => setWelcomeName(e.target.value)}
                    placeholder={t.usernamePlaceholder}
                    className="w-full bg-transparent text-sm font-semibold text-white focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                className={`w-full min-h-[46px] rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition ${
                  hasSavedGame
                    ? 'border border-emerald-400/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                }`}
              >
                <Play className="w-4 h-4" />
                <span>{hasSavedGame ? t.welcomeStartNewBtn : t.welcomePlayNowBtn}</span>
              </button>

              <p className="text-[11px] text-slate-400 text-center">
                {hasSavedGame ? t.welcomeNewHint : t.welcomeUnlockHint}
              </p>
            </form>
          </div>
        </main>
      </div>
    );
  }

  if (screen === 'modes') {
    return (
      <div className="relative w-full h-[100dvh] overflow-y-auto bg-[#0f1720] text-slate-100 flex flex-col">
        <OfflineIndicator label={t.offlineMode} />

        {/* Top Bar */}
        <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 pt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setScreen('welcome')}
            className="min-h-[40px] px-3 rounded-xl border border-white/10 bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t.backToTitleBtn}</span>
          </button>

          <div className="flex items-center gap-2">
            <label className="min-h-[40px] px-2.5 flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium transition cursor-pointer">
              <Globe className="w-4 h-4 text-sky-400 shrink-0" />
              <select
                aria-label={t.languageLabel}
                value={profile.language}
                onChange={(e) => handleLanguageChange(e.target.value as LanguageCode)}
                className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer pr-1"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code} className="bg-slate-900 text-white">
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <PWAInstallButton labels={pwaLabels} />
          </div>
        </div>

        {/* Center Mode Cards */}
        <main className="flex-1 flex items-center justify-center px-4 py-6">
          <div className="w-full max-w-4xl space-y-6">
            <div className="text-center space-y-1.5">
              <h1 className="font-display text-3xl sm:text-4xl font-bold text-white">
                {t.modesTitle}
              </h1>
              <p className="text-sm text-slate-300">{t.modesSubtitle(profile.username)}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Mode 1: Storia della Disinfestazione */}
              <div className="rounded-3xl border border-sky-400/30 bg-slate-900/90 p-6 flex flex-col justify-between gap-5 shadow-2xl">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="p-3 rounded-2xl bg-sky-500/15 border border-sky-400/30 text-sky-300">
                      <Trophy className="w-6 h-6" />
                    </span>
                    <span className="px-2.5 py-1 rounded-md bg-sky-500/15 border border-sky-400/25 text-[11px] font-mono-nums font-bold text-sky-300">
                      {t.modeStoryBadge}
                    </span>
                  </div>
                  <h2 className="font-display text-2xl font-bold text-white">
                    {t.modeStoryTitle}
                  </h2>
                  <p className="text-sm text-slate-300 leading-relaxed">{t.modeStoryDesc}</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400 border-t border-white/10 pt-3 font-mono-nums">
                    <span>
                      {t.completedCount}: <strong className="text-white">{profile.completedLevels.length}/{LEVELS.length}</strong>
                    </span>
                    <span className="text-amber-300 font-bold">
                      {profile.credits} {t.creditsUnit}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.unlock();
                      soundEngine.playUiClick(740);
                      setMenuTab('levels');
                      setScreen('menu');
                    }}
                    className="w-full min-h-[48px] rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>{t.modeStoryBtn}</span>
                  </button>
                </div>
              </div>

              {/* Mode 2: Disinfestazione Online */}
              <div className="rounded-3xl border border-emerald-400/30 bg-slate-900/90 p-6 flex flex-col justify-between gap-5 shadow-2xl">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-300">
                      <Users className="w-6 h-6" />
                    </span>
                    <span className="px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-400/25 text-[11px] font-mono-nums font-bold text-emerald-300">
                      {t.modeOnlineBadge}
                    </span>
                  </div>
                  <h2 className="font-display text-2xl font-bold text-white">
                    {t.modeOnlineTitle}
                  </h2>
                  <p className="text-sm text-slate-300 leading-relaxed">{t.modeOnlineDesc}</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400 border-t border-white/10 pt-3">
                    <span className="flex items-center gap-1.5 text-emerald-300">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{t.editorTitle}</span>
                    </span>
                    <span className="font-mono-nums text-amber-300 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      Top 20
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.unlock();
                      soundEngine.playUiClick(760);
                      setScreen('online');
                    }}
                    className="w-full min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition"
                  >
                    <Users className="w-4 h-4" />
                    <span>{t.modeOnlineBtn}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (screen === 'online') {
    return (
      <>
        <CommunityHub
          t={t}
          language={profile.language}
          user={firebaseUser}
          username={profile.username}
          onLanguageChange={handleLanguageChange}
          onBackToModes={() => setScreen('modes')}
          onSignIn={handleGoogleSignIn}
          onSignOut={handleGoogleSignOut}
          onOpenEditor={() => setShowEditor(true)}
          onPlayLevel={startCommunityDoc}
        />
        {showEditor && (
          <LevelEditorModal
            t={t}
            user={firebaseUser}
            username={profile.username}
            onSignIn={handleGoogleSignIn}
            onClose={() => setShowEditor(false)}
            onTestLevel={(cfg) => startCommunityConfig(cfg)}
            onPublished={async (newId) => {
              setShowEditor(false);
              const created = await fetchCommunityLevelById(newId);
              if (created) {
                startCommunityDoc(created);
              }
            }}
          />
        )}
      </>
    );
  }

  if (screen === 'menu') {
    const activeDiff = DIFFICULTIES[profile.difficulty];
    const activeDiffLabel = t.difficulties[profile.difficulty].label;
    const activeDiffSubtitle = t.difficulties[profile.difficulty].subtitle;

    return (
      <div className="relative w-full h-[100dvh] overflow-y-auto bg-[#0f1720] text-slate-100">
        <OfflineIndicator label={t.offlineMode} />

        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5">
          {/* Top Brand, Language Switcher, Quick Save & Install */}
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setScreen('modes')}
                className="min-h-[40px] px-3 rounded-xl border border-white/10 bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition"
                title={t.switchModeBtn}
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">{t.switchModeBtn}</span>
              </button>
              <button
                type="button"
                onClick={() => setScreen('welcome')}
                title={t.backToTitleBtn}
                className="text-left group"
              >
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white group-hover:text-sky-300 transition">
                  {t.modeStoryTitle}
                </h1>
                <p className="text-xs sm:text-sm text-slate-400">
                  {t.brandSubtitle(activeDiffLabel)}
                </p>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Language Switcher (IT / EN / DE / ES / ZH / FR) */}
              <label className="min-h-[40px] px-2.5 flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-medium transition cursor-pointer">
                <Globe className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="sr-only">{t.languageLabel}</span>
                <select
                  aria-label={t.languageLabel}
                  value={profile.language}
                  onChange={(e) => handleLanguageChange(e.target.value as LanguageCode)}
                  className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer pr-1"
                >
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code} className="bg-slate-900 text-white">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={triggerManualSave}
                className="min-h-[40px] px-3 flex items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-semibold transition"
                title={t.saveBtnTitle}
              >
                <Save className="w-4 h-4" />
                <span>
                  {t.saveBtn(
                    formatSavedTime(profile.lastSavedAt, profile.language, t.autoSaved, t.savedWord),
                  )}
                </span>
              </button>

              <PWAInstallButton labels={pwaLabels} />

              <button
                type="button"
                onClick={toggleMute}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-white/10 bg-slate-900 hover:bg-slate-800 text-slate-200 transition"
                aria-label={muted ? t.audioOn : t.audioOff}
              >
                {muted ? (
                  <VolumeX className="w-4 h-4 text-slate-500" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </header>

          {saveNotice && (
            <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-4 py-2.5 text-xs font-medium text-emerald-200">
              {saveNotice}
            </div>
          )}

          {/* Player Profile + Credit Balance Strip */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 flex items-center gap-3">
              <span className="p-2.5 rounded-xl bg-sky-500/15 text-sky-400 shrink-0">
                <User className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1">
                <label htmlFor="username-input" className="block text-xs text-slate-400">
                  {t.usernameLabel}
                </label>
                <input
                  id="username-input"
                  type="text"
                  maxLength={20}
                  value={profile.username}
                  onChange={(e) =>
                    updateProfile((prev) => ({ ...prev, username: e.target.value }), false)
                  }
                  onBlur={() =>
                    updateProfile((prev) => ({
                      ...prev,
                      username: prev.username.trim() || t.defaultUsername,
                    }))
                  }
                  placeholder={t.usernamePlaceholder}
                  className="mt-0.5 w-full bg-transparent font-display text-base font-semibold text-white border-b border-white/15 focus:border-sky-400 focus:outline-none py-0.5"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="p-2.5 rounded-xl bg-amber-500/15 text-amber-400 shrink-0">
                  <Coins className="w-5 h-5" />
                </span>
                <div>
                  <div className="text-xs text-slate-400">{t.creditsBalance}</div>
                  <div className="font-mono-nums text-2xl font-bold text-amber-400">
                    {profile.credits}
                  </div>
                </div>
              </div>

              <div className="text-right text-xs text-slate-400 space-y-0.5">
                <div>
                  {t.completedCount}:{' '}
                  <strong className="font-mono-nums text-white">
                    {profile.completedLevels.length}/{LEVELS.length}
                  </strong>
                </div>
                <div>
                  {t.wallsShort}:{' '}
                  <strong className="font-mono-nums text-white">
                    {profile.storeStock.permWall}/{STORE_MAX_STOCK.permWall}
                  </strong>{' '}
                  · {t.plagueShort}:{' '}
                  <strong className="font-mono-nums text-white">
                    {profile.storeStock.plague}/{STORE_MAX_STOCK.plague}
                  </strong>
                </div>
              </div>
            </div>
          </section>

          {/* 3 Difficulty Levels Selector */}
          <section className="rounded-2xl border border-white/10 bg-slate-900/75 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t.difficultyTitle}
              </h2>
              <span className="text-xs text-slate-400">{activeDiffSubtitle}</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {DIFFICULTY_ORDER.map((id) => {
                const cfg = DIFFICULTIES[id];
                const localizedDiff = t.difficulties[id];
                const selected = profile.difficulty === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      soundEngine.unlock();
                      soundEngine.playUiClick(700);
                      updateProfile((prev) => ({ ...prev, difficulty: id }));
                    }}
                    className={`min-h-[46px] px-3 py-2 rounded-xl border text-left transition ${
                      selected
                        ? id === 'easy'
                          ? 'bg-emerald-500/20 border-emerald-400 text-white'
                          : id === 'normal'
                            ? 'bg-sky-500/20 border-sky-400 text-white'
                            : 'bg-rose-500/20 border-rose-400 text-white'
                        : 'bg-slate-950/60 border-white/10 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="font-display text-sm font-bold">{localizedDiff.label}</div>
                    <div className="hidden sm:block text-[11px] text-slate-400 truncate">
                      {t.creditsWord} {Math.round(cfg.rewardMul * 100)}%
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Segmented Navigation Tabs */}
          <nav className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-900 border border-white/10 w-fit">
            <button
              type="button"
              onClick={() => setMenuTab('levels')}
              className={`min-h-[40px] px-4 py-1.5 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                menuTab === 'levels'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {t.tabLevels(LEVELS.length)}
            </button>
            <button
              type="button"
              onClick={() => setMenuTab('store')}
              className={`flex items-center gap-1.5 min-h-[40px] px-4 py-1.5 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                menuTab === 'store'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <ShoppingBag className="w-4 h-4" />
              <span>{t.tabStore}</span>
            </button>
            <button
              type="button"
              onClick={() => setMenuTab('save')}
              className={`flex items-center gap-1.5 min-h-[40px] px-4 py-1.5 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                menuTab === 'save'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Save className="w-4 h-4" />
              <span>{t.tabSave}</span>
            </button>
            <button
              type="button"
              onClick={() => setMenuTab('rules')}
              className={`min-h-[40px] px-4 py-1.5 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                menuTab === 'rules'
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {t.tabRules}
            </button>
          </nav>

          {/* Tab 1: Levels grouped by 6 Biomes in difficulty order (Only Level 1 active initially, sequential unlock) */}
          {menuTab === 'levels' && (
            <section className="space-y-6 pb-8">
              {BIOME_ORDER.map((biomeKey) => {
                const biomeLevels = LEVELS.filter((l) => l.biome === biomeKey);
                return (
                  <div key={biomeKey} className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: BIOME_ACCENT[biomeKey] }}
                      />
                      <h2 className="font-display text-sm font-bold uppercase tracking-wider text-slate-200">
                        {t.biomes[biomeKey]}
                      </h2>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {biomeLevels.map((lvl) => {
                        const idx = LEVELS.findIndex((x) => x.id === lvl.id);
                        const unlocked =
                          lvl.id === 1 || profile.completedLevels.includes(lvl.id - 1);
                        const completed = profile.completedLevels.includes(lvl.id);
                        const maxReward = Math.round(lvl.rewardCredits * activeDiff.rewardMul);
                        const effLimit = Math.max(40, lvl.criticalLimit + activeDiff.limitOffset);
                        const lvlCopy = t.levels[lvl.id] ?? {
                          name: lvl.name,
                          subtitle: lvl.subtitle,
                        };

                        return (
                          <button
                            key={lvl.id}
                            type="button"
                            disabled={!unlocked}
                            onClick={() => unlocked && startLevel(idx)}
                            className={`group flex flex-col justify-between gap-3 rounded-2xl border p-4 text-left transition ${
                              unlocked
                                ? 'border-white/10 bg-slate-900/85 hover:bg-slate-800/95 hover:border-sky-400/45'
                                : 'border-white/5 bg-slate-950/60 opacity-60 cursor-not-allowed'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                                  <span
                                    className={`font-mono-nums font-bold ${
                                      unlocked ? 'text-sky-400' : 'text-slate-500'
                                    }`}
                                  >
                                    Lv.{String(lvl.id).padStart(2, '0')}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono-nums">
                                    {lvl.layout[0].length}×{lvl.layout.length}
                                  </span>
                                  {completed && (
                                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                  )}
                                  {!unlocked && (
                                    <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                  )}
                                </div>
                                <h3
                                  className={`mt-1 font-display text-base font-bold transition ${
                                    unlocked
                                      ? 'text-white group-hover:text-sky-300'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {lvlCopy.name}
                                </h3>
                                <p className="mt-0.5 text-xs text-slate-400 line-clamp-2">
                                  {unlocked ? lvlCopy.subtitle : t.levelCardLocked(lvl.id - 1)}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between border-t border-white/5 pt-2.5 text-xs text-slate-400">
                              <span className="font-mono-nums">
                                {t.levelCardRatsLimit(lvl.initialRats.length, effLimit)}
                              </span>
                              <span
                                className={`font-mono-nums font-semibold ${
                                  unlocked ? 'text-amber-400' : 'text-slate-500'
                                }`}
                              >
                                {unlocked ? t.levelCardUpTo(maxReward) : t.locked}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* Tab 2: Store (PermWall: 200 cr, max 3; Plague: 1500 cr, max 1) */}
          {menuTab === 'store' && (
            <section className="space-y-4 pb-8">
              <p className="text-sm text-slate-300">{t.storeIntro}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {STORE_TOOL_ORDER.map((id) => {
                  const meta = TOOLS_META[id];
                  const localizedTool = t.tools[id];
                  const Icon = TOOL_ICONS[id];
                  const price = meta.storePrice ?? 200;
                  const maxCap = STORE_MAX_STOCK[id];
                  const owned = profile.storeStock[id];
                  const atMax = owned >= maxCap;
                  const canAfford = profile.credits >= price;
                  const canBuy = !atMax && canAfford;

                  return (
                    <div
                      key={id}
                      className="rounded-2xl border border-white/10 bg-slate-900/85 p-5 flex flex-col justify-between gap-4"
                    >
                      <div className="flex items-start gap-3.5">
                        <span
                          className="p-3 rounded-xl bg-slate-950 border border-white/10 shrink-0"
                          style={{ color: meta.color }}
                        >
                          <Icon className="w-6 h-6" />
                        </span>
                        <div>
                          <h3 className="font-display text-lg font-bold text-white">
                            {localizedTool.name}
                          </h3>
                          <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                            {localizedTool.description}
                          </p>
                          <p className="mt-2 text-xs text-slate-300 font-mono-nums">
                            {t.storeCurrentStock}:{' '}
                            <strong className={atMax ? 'text-amber-300' : 'text-white'}>
                              {owned}/{maxCap}
                            </strong>
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={!canBuy}
                        onClick={() => buyStoreItem(id)}
                        className={`w-full min-h-[44px] rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition ${
                          canBuy
                            ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 active:scale-[0.98]'
                            : 'bg-slate-800 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        <Coins className="w-4 h-4" />
                        <span>
                          {atMax
                            ? t.storeMaxReached
                            : !canAfford
                              ? `${t.storeNotEnoughCredits} (${price})`
                              : t.storeBuyBtn(price)}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Tab 3: Save & Progress Management */}
          {menuTab === 'save' && (
            <section className="rounded-2xl border border-white/10 bg-slate-900/85 p-5 space-y-5 pb-8">
              <div>
                <h2 className="font-display text-lg font-bold text-white">{t.saveTitle}</h2>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                  {t.saveDescription(
                    formatSavedTime(profile.lastSavedAt, profile.language, t.autoSaved, t.savedWord),
                  )}
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={triggerManualSave}
                  className="min-h-[44px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm flex items-center gap-2 transition"
                >
                  <Save className="w-4 h-4" />
                  <span>{t.saveNow}</span>
                </button>

                <button
                  type="button"
                  onClick={copySaveCode}
                  className="min-h-[44px] px-4 rounded-xl border border-white/15 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm flex items-center gap-2 transition"
                >
                  <Copy className="w-4 h-4" />
                  <span>{t.copySaveCode}</span>
                </button>

                <button
                  type="button"
                  onClick={downloadSaveJson}
                  className="min-h-[44px] px-4 rounded-xl border border-white/15 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm flex items-center gap-2 transition"
                >
                  <Download className="w-4 h-4" />
                  <span>{t.downloadJson}</span>
                </button>
              </div>

              <div className="space-y-2 border-t border-white/10 pt-4">
                <label htmlFor="import-save-input" className="block text-xs font-semibold text-slate-300">
                  {t.importLabel}
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <textarea
                    id="import-save-input"
                    rows={2}
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={t.importPlaceholder}
                    className="flex-1 rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-xs font-mono-nums text-slate-200 focus:border-sky-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleImportSave}
                    disabled={!importText.trim()}
                    className="min-h-[44px] px-4 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition shrink-0"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{t.restoreBtn}</span>
                  </button>
                </div>
              </div>

              <div className="border-t border-white/10 pt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-400">{t.resetDesc}</div>
                <div className="flex items-center gap-2">
                  {confirmReset && (
                    <button
                      type="button"
                      onClick={() => setConfirmReset(false)}
                      className="min-h-[40px] px-3 rounded-xl border border-white/15 text-xs text-slate-300 hover:text-white"
                    >
                      {t.cancelBtn}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleResetProfile}
                    className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                      confirmReset
                        ? 'bg-rose-600 hover:bg-rose-500 text-white'
                        : 'border border-rose-500/35 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{confirmReset ? t.confirmResetBtn : t.resetBtn}</span>
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Tab 4: Rules */}
          {menuTab === 'rules' && (
            <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 space-y-4 pb-8 text-sm text-slate-300">
              <p className="leading-relaxed">{t.rulesP1}</p>
              <p className="leading-relaxed">{t.rulesP2}</p>
              <p className="leading-relaxed">{t.rulesP3}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/10">
                {TOOL_ORDER.map((id) => {
                  const m = TOOLS_META[id];
                  const localizedTool = t.tools[id];
                  const Icon = TOOL_ICONS[id];
                  return (
                    <div key={id} className="flex items-start gap-2.5">
                      <span
                        className="mt-0.5 p-1.5 rounded-lg bg-slate-950 border border-white/10 shrink-0"
                        style={{ color: m.color }}
                      >
                        <Icon className="w-4 h-4" />
                      </span>
                      <div>
                        <div className="text-xs font-semibold text-white">{localizedTool.name}</div>
                        <div className="text-xs text-slate-400">{localizedTool.description}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  // Active 3D Game Screen
  const dangerRatio = Math.min(1, snapshot.totalRats / Math.max(1, snapshot.criticalLimit));
  const selectedToolMeta = snapshot.selectedTool ? t.tools[snapshot.selectedTool] : null;
  const visibleStoreTools = STORE_TOOL_ORDER.filter((id) => snapshot.inventory[id] > 0);
  const diffLabel = t.difficulties[snapshot.difficulty].label;
  const levelNameLocalized = t.levels[snapshot.levelId]?.name ?? snapshot.levelName;

  const limitSafe = Math.max(1, snapshot.criticalLimit);
  const malePct = Math.min(100, (snapshot.males / limitSafe) * 100);
  const femalePct = Math.min(100 - malePct, (snapshot.females / limitSafe) * 100);
  const babyPct = Math.min(100 - malePct - femalePct, (snapshot.babies / limitSafe) * 100);

  return (
    <div className="relative w-full h-[100dvh] flex flex-col overflow-hidden bg-[#0b1117] text-slate-100">
      <OfflineIndicator label={t.offlineMode} />

      {/* Compact Non-Overlapping Top Bar */}
      <header className="shrink-0 z-20 flex items-center justify-between gap-2 px-2.5 sm:px-4 h-11 sm:h-12 bg-slate-950 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setScreen(snapshot.isCommunity ? 'online' : 'menu')}
            className="flex items-center gap-1.5 min-h-[36px] px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-xs font-semibold text-white transition whitespace-nowrap shrink-0"
            title={t.hudMenuTitle}
          >
            <Home className="w-3.5 h-3.5 text-sky-400" />
            <span>{snapshot.isCommunity ? 'Online' : t.hudMenu}</span>
          </button>

          <span className="hidden sm:inline text-xs font-medium text-slate-200 truncate">
            {snapshot.isCommunity
              ? `${levelNameLocalized} (${diffLabel})`
              : `Lv.${snapshot.levelId} · ${levelNameLocalized} (${diffLabel})`}
          </span>
        </div>

        {/* Live Population Telemetry */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-mono-nums whitespace-nowrap">
            <span className="text-sky-400 font-semibold" title={t.hudMalesTitle}>
              ♂ {snapshot.males}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              /
            </span>
            <span className="text-pink-400 font-semibold" title={t.hudFemalesTitle}>
              ♀ {snapshot.females}
            </span>
            {snapshot.babies > 0 && (
              <>
                <span className="text-slate-600" aria-hidden="true">
                  /
                </span>
                <span className="text-stone-300 font-semibold" title={t.hudBabiesTitle}>
                  {snapshot.babies} {t.hudBabiesShort}
                </span>
              </>
            )}
            {snapshot.pregnant > 0 && (
              <span className="hidden lg:inline text-rose-400 font-semibold" title={t.hudPregnantTitle}>
                · {snapshot.pregnant} {t.hudPregnantShort}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <div className="hidden sm:block w-16 lg:w-20 h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-150 ${
                  dangerRatio >= 0.8
                    ? 'bg-rose-500'
                    : dangerRatio >= 0.55
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                }`}
                style={{ width: `${Math.round(dangerRatio * 100)}%` }}
              />
            </div>
            <span
              className={`text-xs font-mono-nums font-bold whitespace-nowrap ${
                dangerRatio >= 0.8 ? 'text-rose-400' : 'text-slate-200'
              }`}
            >
              {snapshot.totalRats}/{snapshot.criticalLimit}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {snapshot.isCommunity ? (
            <span className="flex items-center gap-1 px-1.5 sm:px-2 text-xs font-mono-nums font-semibold text-sky-300 whitespace-nowrap">
              <Clock className="w-3.5 h-3.5" />
              <span>{formatRunTime(Math.round(snapshot.elapsedSeconds * 1000))}</span>
            </span>
          ) : (
            <span
              className="flex items-center gap-1 px-1.5 sm:px-2 text-xs font-mono-nums font-semibold text-amber-400 whitespace-nowrap"
              title={t.hudRewardTitle}
            >
              <Coins className="w-3.5 h-3.5" />
              <span>+{snapshot.currentRewardCredits}</span>
            </span>
          )}

          <button
            type="button"
            onClick={() => engineRef.current?.togglePause()}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-200 hover:bg-slate-800 transition"
            aria-label={snapshot.status === 'paused' ? t.hudResume : t.hudPause}
          >
            {snapshot.status === 'paused' ? (
              <Play className="w-4 h-4 text-emerald-400" />
            ) : (
              <Pause className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              engineRef.current?.setSpeedMultiplier(snapshot.speedMultiplier === 1 ? 2 : 1)
            }
            className={`min-h-[36px] px-2 flex items-center gap-1 rounded-lg text-xs font-mono-nums font-bold transition whitespace-nowrap ${
              snapshot.speedMultiplier === 2
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
            title={t.hudSpeedTitle}
          >
            <FastForward className="w-3.5 h-3.5" />
            <span>{snapshot.speedMultiplier}x</span>
          </button>

          <button
            type="button"
            onClick={restartCurrentLevel}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-200 hover:bg-slate-800 transition"
            aria-label={t.hudRestartTitle}
            title={t.hudRestartTitle}
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={toggleMute}
            className="hidden sm:flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-200 hover:bg-slate-800 transition"
            aria-label={muted ? t.audioOn : t.audioOff}
          >
            {muted ? <VolumeX className="w-4 h-4 text-slate-500" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-200 hover:bg-slate-800 transition"
            aria-label={t.hudHelpAria}
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Playfield Row: Always-Visible Map + Desktop Right Sidebar */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row relative overflow-hidden">
        {/* 3D Map Canvas Container (unobstructed; mobile supports swipe pan when zoomed) */}
        <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden bg-[#0b1117]">
          <div ref={canvasHostRef} className="w-full h-full" />

          {snapshot.canPan && (
            <button
              type="button"
              onClick={() => engineRef.current?.toggleMobileFitMode()}
              className="absolute top-2.5 right-2.5 z-10 min-h-[36px] px-2.5 py-1 rounded-lg bg-slate-950/85 border border-white/15 text-xs font-semibold text-slate-100 flex items-center gap-1.5 shadow-lg active:scale-95 transition"
            >
              {snapshot.mobileFitMode ? (
                <>
                  <ZoomIn className="w-3.5 h-3.5 text-sky-400" />
                  <span>{t.hudZoomInBtn}</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-sky-400" />
                  <span>{t.hudOverviewBtn}</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Desktop Right Sidebar (Classic Rats! side panel showing each individual graphical tool + vertical rat meter) */}
        <aside className="hidden md:flex md:w-72 lg:w-80 shrink-0 flex-col bg-slate-950 border-l border-white/10 select-none overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-white/10 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-mono-nums uppercase tracking-wider text-slate-400">
                {snapshot.isCommunity
                  ? `${t.modeOnlineTitle} · ${t.biomes[snapshot.biome]}`
                  : `Lv.${String(snapshot.levelId).padStart(2, '0')} · ${t.biomes[snapshot.biome]}`}
              </div>
              <div className="font-display text-sm font-bold text-white truncate">
                {levelNameLocalized}
              </div>
            </div>
            {snapshot.regenSpeedBonus > 1.08 && (
              <span className="font-mono-nums text-[11px] font-semibold text-emerald-400 shrink-0">
                {t.dockRegen(snapshot.regenSpeedBonus.toFixed(1))}
              </span>
            )}
          </div>

          <div className="flex-1 min-h-0 flex gap-2.5 px-3 py-2.5 overflow-hidden">
            {/* Left Column: Every single available tool charge shown graphically (max 5 each) */}
            <div className="flex-1 min-w-0 flex flex-col gap-1.5 overflow-y-auto pr-0.5">
              {BASE_TOOL_ORDER.map((toolId, idx) => {
                const meta = TOOLS_META[toolId];
                const localized = t.tools[toolId];
                const count = snapshot.inventory[toolId];
                const maxCount = snapshot.maxInventory[toolId];
                const regen = snapshot.regenProgress[toolId] ?? 0;
                const isSelected = snapshot.selectedTool === toolId;
                const Icon = TOOL_ICONS[toolId] || Atom;
                const hotkey = idx + 1;

                return (
                  <button
                    key={toolId}
                    type="button"
                    onClick={() => engineRef.current?.setSelectedTool(toolId)}
                    className={`w-full rounded-xl border px-2.5 py-2 text-left transition ${
                      isSelected
                        ? 'bg-slate-800 border-white/50 shadow-md'
                        : 'bg-slate-900/75 border-white/10 hover:bg-slate-800/75'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono-nums text-[10px] font-bold px-1 py-0.5 rounded bg-slate-950 border border-white/15 text-slate-300">
                          {hotkey}
                        </span>
                        <span className="text-xs font-semibold text-white truncate">
                          {localized.name}
                        </span>
                      </div>
                      <span className="font-mono-nums text-[11px] text-slate-400 shrink-0">
                        {count}/{maxCount}
                      </span>
                    </div>

                    {/* Individual graphical icons for each tool slot (up to 5) */}
                    <div className="grid grid-cols-5 gap-1">
                      {Array.from({ length: maxCount }).map((_, slotIdx) => {
                        const isAvailable = slotIdx < count;
                        const isCharging = slotIdx === count;
                        return (
                          <div
                            key={slotIdx}
                            className={`relative h-7 rounded-md flex items-center justify-center border overflow-hidden ${
                              isAvailable
                                ? 'bg-slate-950/90 border-white/15'
                                : 'bg-slate-950/35 border-white/5'
                            }`}
                          >
                            <span
                              style={{ color: isAvailable ? meta.color : '#64748b' }}
                              className={isAvailable ? 'opacity-100' : 'opacity-25'}
                            >
                              <Icon className="w-4 h-4" />
                            </span>
                            {isCharging && (
                              <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800">
                                <div
                                  className="h-full transition-[width] duration-100"
                                  style={{
                                    width: `${Math.round(regen * 100)}%`,
                                    backgroundColor: meta.color,
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </button>
                );
              })}

              {/* Store Tools (PermWall max 3, Plague max 1) rendered graphically when available */}
              {visibleStoreTools.length > 0 && (
                <div className="pt-1.5 mt-0.5 border-t border-white/10 space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/80 px-0.5">
                    {t.sidebarStoreTools}
                  </div>
                  {visibleStoreTools.map((toolId) => {
                    const meta = TOOLS_META[toolId];
                    const localized = t.tools[toolId];
                    const count = snapshot.inventory[toolId];
                    const maxCap = STORE_MAX_STOCK[toolId];
                    const isSelected = snapshot.selectedTool === toolId;
                    const Icon = TOOL_ICONS[toolId];
                    const hotkey = toolId === 'permWall' ? 7 : 8;

                    return (
                      <button
                        key={toolId}
                        type="button"
                        onClick={() => engineRef.current?.setSelectedTool(toolId)}
                        className={`w-full rounded-xl border px-2.5 py-2 text-left transition ${
                          isSelected
                            ? 'bg-amber-500/20 border-amber-400/75 shadow-md'
                            : 'bg-slate-900/85 border-amber-400/25 hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5 mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono-nums text-[10px] font-bold px-1 py-0.5 rounded bg-slate-950 border border-amber-400/30 text-amber-300">
                              {hotkey}
                            </span>
                            <span className="text-xs font-semibold text-amber-100 truncate">
                              {localized.name}
                            </span>
                          </div>
                          <span className="font-mono-nums text-[11px] text-amber-300 shrink-0">
                            {count}/{maxCap}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {Array.from({ length: maxCap }).map((_, slotIdx) => {
                            const isAvailable = slotIdx < count;
                            return (
                              <div
                                key={slotIdx}
                                className={`h-7 w-8 rounded-md flex items-center justify-center border ${
                                  isAvailable
                                    ? 'bg-slate-950 border-amber-400/30'
                                    : 'bg-slate-950/35 border-white/5 opacity-30'
                                }`}
                              >
                                <span style={{ color: meta.color }}>
                                  <Icon className="w-4 h-4" />
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Vertical Rat Population Meter (faithful to original Rats! right panel) */}
            <div
              className="w-11 shrink-0 flex flex-col items-center gap-1.5"
              title={`${t.sidebarPopulation}: ${snapshot.totalRats}/${snapshot.criticalLimit}`}
            >
              <div className="text-[10px] font-mono-nums font-bold text-slate-400">
                {snapshot.criticalLimit}
              </div>
              <div className="flex-1 w-6 rounded-md bg-slate-900 border border-white/15 overflow-hidden flex flex-col-reverse">
                <div
                  className="w-full bg-[#1e78ff] transition-all duration-150"
                  style={{ height: `${malePct}%` }}
                />
                <div
                  className="w-full bg-[#f03892] transition-all duration-150"
                  style={{ height: `${femalePct}%` }}
                />
                <div
                  className="w-full bg-[#d6c9b4] transition-all duration-150"
                  style={{ height: `${babyPct}%` }}
                />
              </div>
              <div
                className={`text-[11px] font-mono-nums font-bold ${
                  dangerRatio >= 0.8 ? 'text-rose-400' : 'text-white'
                }`}
              >
                {snapshot.totalRats}
              </div>
            </div>
          </div>

          {/* Selected Tool Description Footer */}
          <div className="px-3.5 py-2.5 border-t border-white/10 bg-slate-900/50 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white truncate">
                {selectedToolMeta ? selectedToolMeta.name : t.dockSelectTool}
              </span>
              <span className="text-[10px] font-mono-nums text-slate-400 shrink-0">
                {t.hotkeysHint}
              </span>
            </div>
            {selectedToolMeta && (
              <p className="text-[11px] text-slate-400 leading-snug line-clamp-2">
                {selectedToolMeta.description}
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Mobile Bottom Tool Bar (compact, sits BELOW the map with remaining counts) */}
      <div className="md:hidden shrink-0 z-20 bg-slate-950 border-t border-white/10 px-1.5 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-1 overflow-x-auto no-scrollbar">
          {BASE_TOOL_ORDER.map((toolId) => {
            const meta = TOOLS_META[toolId];
            const localized = t.tools[toolId];
            const count = snapshot.inventory[toolId];
            const maxCount = snapshot.maxInventory[toolId];
            const regen = snapshot.regenProgress[toolId] ?? 0;
            const isSelected = snapshot.selectedTool === toolId;
            const Icon = TOOL_ICONS[toolId] || Atom;

            return (
              <button
                key={toolId}
                type="button"
                onClick={() => engineRef.current?.setSelectedTool(toolId)}
                className={`relative flex-1 min-w-[52px] min-h-[50px] flex flex-col items-center justify-center px-1 py-1 rounded-lg border transition overflow-hidden ${
                  isSelected
                    ? 'bg-slate-800 border-white/55 shadow'
                    : 'bg-slate-900/80 border-white/10'
                } ${count <= 0 ? 'opacity-65' : ''}`}
              >
                <div className="flex items-center gap-1">
                  <span style={{ color: meta.color }}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="font-mono-nums text-xs font-bold text-white">{count}</span>
                </div>
                <span className="mt-0.5 text-[10px] font-medium text-slate-300 truncate max-w-full">
                  {localized.shortName}
                </span>

                {count < maxCount && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800">
                    <div
                      className="h-full transition-[width] duration-100"
                      style={{
                        width: `${Math.round(regen * 100)}%`,
                        backgroundColor: meta.color,
                      }}
                    />
                  </div>
                )}
              </button>
            );
          })}

          {visibleStoreTools.map((toolId) => {
            const meta = TOOLS_META[toolId];
            const localized = t.tools[toolId];
            const count = snapshot.inventory[toolId];
            const isSelected = snapshot.selectedTool === toolId;
            const Icon = TOOL_ICONS[toolId];

            return (
              <button
                key={toolId}
                type="button"
                onClick={() => engineRef.current?.setSelectedTool(toolId)}
                className={`relative flex-1 min-w-[52px] min-h-[50px] flex flex-col items-center justify-center px-1 py-1 rounded-lg border transition shrink-0 ${
                  isSelected
                    ? 'bg-amber-500/20 border-amber-400/75 shadow'
                    : 'bg-slate-900/90 border-amber-400/30'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span style={{ color: meta.color }}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="font-mono-nums text-xs font-bold text-amber-300">{count}</span>
                </div>
                <span className="mt-0.5 text-[10px] font-medium text-amber-100 truncate max-w-full">
                  {localized.shortName}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Paused Overlay */}
      {snapshot.status === 'paused' && (
        <div className="fixed inset-0 z-10 pointer-events-none flex items-center justify-center">
          <div className="pointer-events-auto rounded-2xl border border-white/15 bg-slate-950/92 px-6 py-4 text-center shadow-2xl">
            <p className="font-display text-lg font-bold text-white">{t.pausedTitle}</p>
            <p className="mt-1 text-xs text-slate-400">
              {t.pausedSub(
                t.biomes[snapshot.biome],
                snapshot.totalRats,
                snapshot.criticalLimit,
              )}
            </p>
            <button
              type="button"
              onClick={() => engineRef.current?.togglePause()}
              className="mt-3 min-h-[44px] px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm transition"
            >
              {t.hudResume}
            </button>
          </div>
        </div>
      )}

      {/* Victory / Defeat Modal */}
      {(snapshot.status === 'won' || snapshot.status === 'lost') && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-950 p-6 shadow-2xl">
            <h2 className="font-display text-2xl font-bold text-white">
              {snapshot.status === 'won'
                ? snapshot.isCommunity && !snapshot.communityId
                  ? t.onlineTestWinTitle
                  : t.wonTitle
                : t.lostTitle}
            </h2>
            <p className="mt-1.5 text-sm text-slate-300">
              {snapshot.status === 'won'
                ? t.wonSub(profile.username, levelNameLocalized)
                : t.lossOvercrowding(snapshot.criticalLimit)}
            </p>

            {/* Story Mode Credit Summary */}
            {snapshot.status === 'won' && !snapshot.isCommunity && lastWinSummary && (
              <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 space-y-1">
                <div className="flex items-center justify-between text-xs text-amber-200/80">
                  <span>{t.baseReward(diffLabel)}</span>
                  <span className="font-mono-nums">
                    {lastWinSummary.base} {t.creditsUnit}
                  </span>
                </div>
                {lastWinSummary.penalty > 0 && (
                  <div className="flex items-center justify-between text-xs text-rose-300">
                    <span>{t.timePenalty}</span>
                    <span className="font-mono-nums">
                      -{lastWinSummary.penalty} {t.creditsUnit}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-amber-400/20 pt-1.5">
                  <span className="text-xs font-semibold text-amber-200">{t.earnedCredits}</span>
                  <span className="font-mono-nums text-base font-bold text-amber-400">
                    +{lastWinSummary.earned} {t.creditsUnit}
                  </span>
                </div>
              </div>
            )}

            {/* Community Online Speedrun Record Summary */}
            {snapshot.status === 'won' && snapshot.isCommunity && communityRunStatus && (
              <div className="mt-3 rounded-xl border border-sky-400/35 bg-sky-500/10 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-sky-200">{t.onlineWonTime}</span>
                  <span className="font-mono-nums text-xl font-bold text-white">
                    {formatRunTime(communityRunStatus.recordedTimeMs)}
                  </span>
                </div>

                {snapshot.communityId && (
                  <>
                    {communityRunStatus.submitting && (
                      <div className="text-xs text-sky-300">{t.onlineSubmittingRecord}</div>
                    )}
                    {communityRunStatus.saved && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {communityRunStatus.isNewWorldRecord ? (
                          <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-bold">
                            {t.onlineNewWorldRecord}
                          </span>
                        ) : communityRunStatus.isNewPersonalBest ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500 text-slate-950 font-bold">
                            {t.onlineNewPersonalBest}
                          </span>
                        ) : null}
                        <span className="text-emerald-300">{t.onlineRecordSaved}</span>
                      </div>
                    )}
                    {!firebaseUser && (
                      <button
                        type="button"
                        onClick={async () => {
                          await handleGoogleSignIn();
                          if (auth.currentUser && snapshot.communityId) {
                            await recordCommunityVictory(
                              snapshot.communityId,
                              snapshot.elapsedSeconds,
                              snapshot.eliminatedCount,
                              snapshot.bornCount,
                              auth.currentUser,
                            );
                          }
                        }}
                        className="w-full min-h-[38px] rounded-lg bg-white hover:bg-slate-200 text-slate-950 font-bold text-xs transition"
                      >
                        {t.onlineSignInToSubmit}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="mt-4 grid grid-cols-3 gap-3 border-y border-white/10 py-3 text-center">
              <div>
                <div className="text-[11px] text-slate-400">{t.statEliminated}</div>
                <div className="font-mono-nums text-lg font-bold text-emerald-400">
                  {snapshot.eliminatedCount}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">{t.statBorn}</div>
                <div className="font-mono-nums text-lg font-bold text-pink-400">
                  {snapshot.bornCount}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">{t.statTime}</div>
                <div className="font-mono-nums text-lg font-bold text-sky-400">
                  {snapshot.isCommunity
                    ? formatRunTime(Math.round(snapshot.elapsedSeconds * 1000))
                    : `${Math.round(snapshot.elapsedSeconds)}s`}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setScreen(snapshot.isCommunity ? 'online' : 'menu')}
                className="min-h-[44px] px-4 rounded-xl border border-white/15 bg-slate-900 hover:bg-slate-800 text-slate-200 font-semibold text-sm transition"
              >
                {snapshot.isCommunity ? t.onlineBackToOnline : t.menuStoreBtn}
              </button>

              {snapshot.isCommunity && snapshot.communityId && (
                <button
                  type="button"
                  onClick={async () => {
                    const url = `${window.location.origin}${window.location.pathname}?level=${encodeURIComponent(snapshot.communityId!)}`;
                    try {
                      await navigator.clipboard.writeText(url);
                    } catch {
                      // ignore
                    }
                    setVictoryShareCopied(true);
                    window.setTimeout(() => setVictoryShareCopied(false), 2400);
                  }}
                  className="min-h-[44px] px-3.5 rounded-xl border border-white/15 bg-slate-900 hover:bg-slate-800 text-sky-300 font-semibold text-sm flex items-center gap-1.5 transition"
                >
                  {victoryShareCopied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                  <span>{t.onlineShareBtn}</span>
                </button>
              )}

              <button
                type="button"
                onClick={restartCurrentLevel}
                className="flex-1 min-h-[44px] rounded-xl border border-white/15 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition"
              >
                {t.retryBtn}
              </button>

              {snapshot.status === 'won' && !snapshot.isCommunity && levelIdx < LEVELS.length - 1 && (
                <button
                  type="button"
                  onClick={() => startLevel(levelIdx + 1)}
                  className="flex-1 min-h-[44px] rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm transition"
                >
                  {t.nextBtn}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg max-h-[85dvh] flex flex-col rounded-2xl border border-white/15 bg-slate-950 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h2 className="font-display text-lg font-bold text-white">{t.helpTitle}</h2>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white"
                aria-label={t.helpClose}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-5 space-y-4 text-sm text-slate-300">
              <p className="leading-relaxed">{t.helpP1}</p>
              <p className="leading-relaxed">{t.helpP2}</p>

              <div className="space-y-2.5">
                {TOOL_ORDER.map((id) => {
                  const m = TOOLS_META[id];
                  const localized = t.tools[id];
                  const Icon = TOOL_ICONS[id];
                  return (
                    <div key={id} className="flex items-start gap-3">
                      <span
                        className="mt-0.5 p-1.5 rounded-lg bg-slate-900 border border-white/10 shrink-0"
                        style={{ color: m.color }}
                      >
                        <Icon className="w-4 h-4" />
                      </span>
                      <div>
                        <div className="text-xs font-semibold text-white">{localized.name}</div>
                        <div className="text-xs text-slate-400">{localized.description}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
