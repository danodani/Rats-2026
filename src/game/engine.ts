import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { soundEngine } from './audio';
import {
  createRatModel,
  createTempBarrierModel,
  createToolModel,
  createTunnelModel,
  createWallTunnelModel,
  createWhiteGasCloudMesh,
  getRatPalette,
  type RatMeshRefs,
  type TempBarrierRefs,
} from './models';
import { createBiomeVisuals, createSoftDiscTexture, type BiomeVisualSet } from './textures';
import {
  BASE_TOOL_ORDER,
  DIFFICULTIES,
  STORE_MAX_STOCK,
  TOOLS_META,
  type BaseToolType,
  type DifficultyLevel,
  type GameObjectiveMode,
  type GameSnapshot,
  type GameStatus,
  type LevelConfig,
  type RatSex,
  type StoreToolType,
  type ToolType,
} from './types';

// Module-level reusable scratch objects (Zero GC in tick loop)
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hitPoint = new THREE.Vector3();
const _dummy = new THREE.Object3D();

interface RatActor {
  id: number;
  sex: RatSex;
  isBaby: boolean;
  babyTimer: number; // 20s until becoming adult with random sex
  x: number;
  z: number;
  targetCol: number;
  targetRow: number;
  dirX: number;
  dirZ: number;
  heading: number;
  speedMul: number;
  breedCooldown: number;
  matingTimer: number;
  pregnantTimer: number; // 7s gestation -> 3-6 babies
  sterile: boolean;
  infected: boolean;
  plagueTimer: number;
  tunnelCooldown: number;
  hitWallCooldown: number;
  gasExposure: number;
  spawnAnim: number;
  dyingTimer: number;
  phase: number;
  mesh: RatMeshRefs;
}

interface PlacedProp {
  id: number;
  type: ToolType;
  col: number;
  row: number;
  timer: number;
  maxTimer: number;
  hp: number;
  maxHp: number;
  charges: number;
  group: THREE.Group;
  accentMesh?: THREE.Mesh;
  barrierRefs?: TempBarrierRefs;
  hitAnimTimer?: number;
}

interface HazardCell {
  col: number;
  row: number;
  kind: 'gas' | 'radiation';
  baseY: number;
  timer: number;
  maxTimer: number;
  object: THREE.Object3D;
  mat: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial;
}

interface GasWave {
  frontier: Array<{ c: number; r: number }>;
  visited: Set<string>;
  step: number;
  maxSteps: number;
  stepTimer: number;
}

interface FloorTunnelTarget {
  toCol: number;
  toRow: number;
  hex: number;
}

interface WallTunnelTarget {
  entryCol: number;
  entryRow: number;
  toHoleCol: number;
  toHoleRow: number;
  toExitCol: number;
  toExitRow: number;
  exitDirX: number;
  exitDirZ: number;
  hex: number;
}

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravity: number;
  scaleStart: number;
}

interface Shockwave {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxScale: number;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function emptyBaseNumbers(val = 0): Record<BaseToolType, number> {
  return {
    bomb: val,
    gas: val,
    poison: val,
    nuclear: val,
    tempWall: val,
    mutagen: val,
  };
}

function emptyAllToolNumbers(val = 0): Record<ToolType, number> {
  return {
    bomb: val,
    gas: val,
    poison: val,
    nuclear: val,
    tempWall: val,
    mutagen: val,
    permWall: val,
    plague: val,
  };
}

export class RatsGameEngine {
  private container: HTMLElement;
  private onSnapshot: (snap: GameSnapshot) => void;
  private onConsumeStoreItem: (tool: StoreToolType) => void;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private maxAnisotropy: number;

  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;

  private contactShadowTex: THREE.CanvasTexture;
  private particleGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  private shockwaveGeo = new THREE.RingGeometry(0.3, 0.48, 24);
  private hazardGeo = new THREE.PlaneGeometry(0.94, 0.94);

  private keyLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private rimLight: THREE.DirectionalLight;
  private flashLight: THREE.PointLight;
  private flashIntensity = 0;

  private level!: LevelConfig;
  private difficulty: DifficultyLevel = 'normal';
  private effectiveCriticalLimit = 55;
  private effectiveRatSpeed = 2.35;
  private effectiveBreedCooldown = 5.0;
  private baseRewardCredits = 120;

  private cols = 19;
  private rows = 15;
  private grid: boolean[][] = [];
  private floorTunnelMap = new Map<string, FloorTunnelTarget>();
  private wallTunnelMap = new Map<string, WallTunnelTarget>();
  private wallExitToHoleMap = new Map<string, Array<{ holeCol: number; holeRow: number }>>();

  private levelGroup = new THREE.Group();
  private actorsGroup = new THREE.Group();
  private propsGroup = new THREE.Group();
  private fxGroup = new THREE.Group();
  private biomeVisuals: BiomeVisualSet | null = null;

  private previewGroup = new THREE.Group();
  private previewCellRing: THREE.Mesh;
  private previewAoeRing: THREE.Mesh;
  private previewCrossH: THREE.Mesh;
  private previewCrossV: THREE.Mesh;
  private previewCellMat: THREE.MeshBasicMaterial;
  private previewAoeMat: THREE.MeshBasicMaterial;
  private previewCrossMat: THREE.MeshBasicMaterial;
  private hoveredCell: { col: number; row: number } | null = null;

  private nextId = 1;
  private rats: RatActor[] = [];
  private props: PlacedProp[] = [];
  private hazards: HazardCell[] = [];
  private gasWaves: GasWave[] = [];
  private particles: Particle[] = [];
  private shockwaves: Shockwave[] = [];
  private tunnelSpinners: THREE.Mesh[] = [];

  private status: GameStatus = 'playing';
  private selectedTool: ToolType | null = 'bomb';
  private inventory = emptyAllToolNumbers(0);
  private maxInventory = emptyBaseNumbers(0);
  private regenSec = emptyBaseNumbers(0);
  private regenTimers = emptyBaseNumbers(0);

  private speedMultiplier: 1 | 2 = 1;
  private elapsedSeconds = 0;
  private eliminatedCount = 0;
  private babiesEliminatedCount = 0;
  private bornCount = 0;
  private lossReason = '';
  private shakeIntensity = 0;
  private baseCamPos = new THREE.Vector3(0, 18, 6);
  private baseCamLook = new THREE.Vector3(0, 0, 0);
  private panX = 0;
  private panZ = 0;
  private panMaxX = 0;
  private panMaxZ = 0;
  private canPan = false;
  private mobileFitMode = false;
  private camDist = 18;
  private fitCamDist = 18;
  private comfortCamDist = 18;
  private zoomFactor = 1;
  private readonly tiltRad = THREE.MathUtils.degToRad(14);
  private snapshotTimer = 0;

  private activePointerId: number | null = null;
  private isTouchPointer = false;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private panStartX = 0;
  private panStartZ = 0;
  private isSwiping = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    container: HTMLElement,
    initialLevel: LevelConfig,
    difficulty: DifficultyLevel,
    initialStoreStock: Record<StoreToolType, number>,
    onSnapshot: (snap: GameSnapshot) => void,
    onConsumeStoreItem: (tool: StoreToolType) => void,
  ) {
    this.container = container;
    this.difficulty = difficulty;
    this.onSnapshot = onSnapshot;
    this.onConsumeStoreItem = onConsumeStoreItem;

    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';

    this.maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.5, 480);

    this.hemiLight = new THREE.HemisphereLight(0x9be2ff, 0x2a5e28, 0.85);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff8e7, 1.85);
    this.keyLight.position.set(14, 34, 14);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 200;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0xffffff, 0.45);
    this.rimLight.position.set(-12, 12, -14);
    this.scene.add(this.rimLight);

    this.flashLight = new THREE.PointLight(0xff8833, 0, 14, 1.5);
    this.flashLight.position.set(0, 1.8, 0);
    this.scene.add(this.flashLight);

    this.scene.add(this.levelGroup);
    this.scene.add(this.actorsGroup);
    this.scene.add(this.propsGroup);
    this.scene.add(this.fxGroup);

    this.contactShadowTex = createSoftDiscTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)');

    this.previewCellMat = new THREE.MeshBasicMaterial({
      color: 0xff6b1a,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.previewCellRing = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.46, 4), this.previewCellMat);
    this.previewCellRing.rotation.x = -Math.PI / 2;
    this.previewCellRing.rotation.z = Math.PI / 4;
    this.previewCellRing.position.y = 0.036;

    this.previewAoeMat = new THREE.MeshBasicMaterial({
      color: 0xff6b1a,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.previewAoeRing = new THREE.Mesh(new THREE.RingGeometry(0.84, 1.0, 32), this.previewAoeMat);
    this.previewAoeRing.rotation.x = -Math.PI / 2;
    this.previewAoeRing.position.y = 0.03;

    this.previewCrossMat = new THREE.MeshBasicMaterial({
      color: 0xff6b1a,
      transparent: true,
      opacity: 0.36,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.previewCrossH = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.56), this.previewCrossMat);
    this.previewCrossH.rotation.x = -Math.PI / 2;
    this.previewCrossH.position.y = 0.032;

    this.previewCrossV = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 1), this.previewCrossMat);
    this.previewCrossV.rotation.x = -Math.PI / 2;
    this.previewCrossV.position.y = 0.032;

    this.previewGroup.add(this.previewCellRing);
    this.previewGroup.add(this.previewAoeRing);
    this.previewGroup.add(this.previewCrossH);
    this.previewGroup.add(this.previewCrossV);
    this.previewGroup.visible = false;
    this.scene.add(this.previewGroup);

    this.loadLevel(initialLevel, difficulty, initialStoreStock);
    this.handleResize();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.clock.start();
    this.tick();
  }

  private bindEvents(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerCancel);
    dom.addEventListener('pointerleave', this.onPointerLeave);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('webglcontextlost', this.onContextLost);
    window.addEventListener('resize', this.handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.container);
    }
  }

  private unbindEvents(): void {
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointercancel', this.onPointerCancel);
    dom.removeEventListener('pointerleave', this.onPointerLeave);
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('webglcontextlost', this.onContextLost);
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
  };

  private handleResize = () => {
    if (this.disposed) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.fitCamera();
  };

  private updateCameraTransform(): void {
    this.panX = Math.max(-this.panMaxX, Math.min(this.panMaxX, this.panX));
    this.panZ = Math.max(-this.panMaxZ, Math.min(this.panMaxZ, this.panZ));
    this.baseCamLook.set(this.panX, 0, this.panZ);
    this.baseCamPos.set(
      this.panX,
      Math.cos(this.tiltRad) * this.camDist,
      this.panZ + Math.sin(this.tiltRad) * this.camDist,
    );
    this.camera.position.copy(this.baseCamPos);
    this.camera.lookAt(this.baseCamLook);
  }

  private fitCamera(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const aspect = w / h;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    const boardW = this.cols + 1.2;
    const boardH = this.rows + 1.2;

    const distH = (boardH * 0.5) / Math.tan(vFov / 2);
    const distW = (boardW * 0.5) / Math.tan(hFov / 2);
    const fitDist = Math.max(distH, distW);
    this.fitCamDist = fitDist;

    // On mobile OR large desktop maps (e.g. 50x50..100x100), zoom to comfortable cell size and allow drag-panning
    const isCompactViewport = w < 768 || aspect < 0.95;
    const minCellPx = isCompactViewport ? 28 : 22;
    const comfortVisCols = w / minCellPx;
    const comfortVisRows = h / minCellPx;
    const comfortDistW = (comfortVisCols * 0.5) / Math.tan(hFov / 2);
    const comfortDistH = (comfortVisRows * 0.5) / Math.tan(vFov / 2);
    const comfortDist = Math.min(comfortDistW, comfortDistH);
    this.comfortCamDist = comfortDist;

    const needsPan = fitDist > comfortDist * 1.08;

    if (needsPan && !this.mobileFitMode) {
      this.camDist = Math.min(fitDist, Math.max(10, comfortDist * this.zoomFactor));
    } else {
      this.camDist = fitDist;
    }

    const visW = 2 * this.camDist * Math.tan(hFov / 2);
    const visH = (2 * this.camDist * Math.tan(vFov / 2)) / Math.cos(this.tiltRad);
    this.panMaxX = Math.max(0, (boardW - visW) * 0.5);
    this.panMaxZ = Math.max(0, (boardH - visH) * 0.5);
    this.canPan = needsPan;

    if (!this.canPan || this.mobileFitMode) {
      this.panX = 0;
      this.panZ = 0;
    }

    this.updateCameraTransform();
  }

  public toggleMobileFitMode(): void {
    this.mobileFitMode = !this.mobileFitMode;
    if (!this.mobileFitMode) {
      this.zoomFactor = 1;
    }
    this.fitCamera();
    this.emitSnapshot();
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.canPan || this.disposed) return;
    e.preventDefault();
    const step = e.deltaY > 0 ? 1.12 : 0.89;
    if (this.mobileFitMode && e.deltaY < 0) {
      this.mobileFitMode = false;
      this.zoomFactor = Math.max(0.65, (this.fitCamDist / Math.max(1, this.comfortCamDist)) * 0.88);
    } else {
      this.zoomFactor = Math.max(0.65, Math.min(this.fitCamDist / Math.max(1, this.comfortCamDist), this.zoomFactor * step));
      if (this.comfortCamDist * this.zoomFactor >= this.fitCamDist * 0.96) {
        this.mobileFitMode = true;
      } else {
        this.mobileFitMode = false;
      }
    }
    this.fitCamera();
    this.emitSnapshot();
  };

  private gridToWorld(col: number, row: number): { x: number; z: number } {
    return {
      x: col - (this.cols - 1) / 2,
      z: row - (this.rows - 1) / 2,
    };
  }

  private worldToGrid(wx: number, wz: number): { col: number; row: number } | null {
    const col = Math.round(wx + (this.cols - 1) / 2);
    const row = Math.round(wz + (this.rows - 1) / 2);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return { col, row };
  }

  public syncStoreStock(stock: Record<StoreToolType, number>): void {
    this.inventory.permWall = Math.max(0, Math.min(STORE_MAX_STOCK.permWall, stock.permWall));
    this.inventory.plague = Math.max(0, Math.min(STORE_MAX_STOCK.plague, stock.plague));
    this.emitSnapshot();
  }

  private findAdjacentWalkable(col: number, row: number): { col: number; row: number; dirX: number; dirZ: number } | null {
    const dirs: Array<[number, number]> = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    for (const [dx, dz] of dirs) {
      const nc = col + dx;
      const nr = row + dz;
      if (this.isWalkable(nc, nr)) {
        return { col: nc, row: nr, dirX: dx, dirZ: dz };
      }
    }
    return null;
  }

  public loadLevel(
    level: LevelConfig,
    difficulty: DifficultyLevel = this.difficulty,
    storeStock?: Record<StoreToolType, number>,
  ): void {
    this.level = level;
    this.difficulty = difficulty;
    const diffCfg = DIFFICULTIES[difficulty];

    this.effectiveCriticalLimit = level.isCommunity
      ? level.criticalLimit
      : Math.max(40, level.criticalLimit + diffCfg.limitOffset);
    this.effectiveRatSpeed = level.ratSpeed * diffCfg.ratSpeedMul;
    this.effectiveBreedCooldown = level.breedCooldown * diffCfg.breedCooldownMul;
    this.baseRewardCredits = Math.round(level.rewardCredits * diffCfg.rewardMul);

    this.rows = level.layout.length;
    this.cols = level.layout[0].length;

    this.clearGroup(this.levelGroup);
    this.clearGroup(this.actorsGroup);
    this.clearGroup(this.propsGroup);
    this.clearGroup(this.fxGroup);
    this.biomeVisuals?.dispose();

    this.rats = [];
    this.props = [];
    this.hazards = [];
    this.gasWaves = [];
    this.particles = [];
    this.shockwaves = [];
    this.tunnelSpinners = [];
    this.floorTunnelMap.clear();
    this.wallTunnelMap.clear();
    this.wallExitToHoleMap.clear();

    const halfW = this.cols / 2 + 4;
    const halfH = this.rows / 2 + 4;
    this.keyLight.shadow.camera.left = -halfW;
    this.keyLight.shadow.camera.right = halfW;
    this.keyLight.shadow.camera.top = halfH;
    this.keyLight.shadow.camera.bottom = -halfH;
    this.keyLight.shadow.camera.updateProjectionMatrix();

    const prevPerm = Math.max(
      0,
      Math.min(STORE_MAX_STOCK.permWall, storeStock ? storeStock.permWall : this.inventory.permWall),
    );
    const prevPlague = Math.max(
      0,
      Math.min(STORE_MAX_STOCK.plague, storeStock ? storeStock.plague : this.inventory.plague),
    );

    this.inventory = emptyAllToolNumbers(0);
    this.inventory.permWall = prevPerm;
    this.inventory.plague = prevPlague;
    this.maxInventory = emptyBaseNumbers(0);
    this.regenSec = emptyBaseNumbers(0);
    this.regenTimers = emptyBaseNumbers(0);

    for (const t of BASE_TOOL_ORDER) {
      const cfg = level.tools[t];
      this.inventory[t] = cfg.start;
      this.maxInventory[t] = cfg.max;
      this.regenSec[t] = Number((cfg.regenSec * diffCfg.regenSecMul).toFixed(2));
    }

    this.selectedTool = 'bomb';
    this.status = 'playing';
    this.elapsedSeconds = 0;
    this.eliminatedCount = 0;
    this.babiesEliminatedCount = 0;
    this.bornCount = 0;
    this.lossReason = '';
    this.shakeIntensity = 0;
    this.panX = 0;
    this.panZ = 0;
    this.mobileFitMode = false;
    this.zoomFactor = 1;
    this.hoveredCell = null;
    this.previewGroup.visible = false;

    this.biomeVisuals = createBiomeVisuals(level.biome, this.maxAnisotropy, {
      wallColor: level.customWallColor,
      floorColor: level.customFloorColor,
    });
    this.scene.background = new THREE.Color(this.biomeVisuals.bgHex);
    const maxDim = Math.max(this.cols, this.rows);
    const fogDensity = Math.min(0.0085, 0.22 / Math.max(20, maxDim));
    this.scene.fog = new THREE.FogExp2(this.biomeVisuals.fogHex, fogDensity);
    this.keyLight.color.setHex(this.biomeVisuals.keyColor);
    this.hemiLight.color.setHex(this.biomeVisuals.hemiSky);
    this.hemiLight.groundColor.setHex(this.biomeVisuals.hemiGround);

    const surroundSize = Math.max(160, maxDim * 2.8);
    const surround = new THREE.Mesh(
      new THREE.PlaneGeometry(surroundSize, surroundSize),
      this.biomeVisuals.surroundMat,
    );
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.18;
    surround.receiveShadow = true;
    this.levelGroup.add(surround);

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(this.cols + 0.9, 0.24, this.rows + 0.9),
      this.biomeVisuals.surroundMat,
    );
    plinth.position.y = -0.13;
    plinth.receiveShadow = true;
    this.levelGroup.add(plinth);

    const floorMap = this.biomeVisuals.floorMat.map!;
    floorMap.repeat.set(this.cols, this.rows);

    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.cols, this.rows),
      this.biomeVisuals.floorMat,
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = true;
    this.levelGroup.add(floorMesh);

    this.grid = [];
    const wallCoords: Array<{ x: number; z: number }> = [];
    for (let r = 0; r < this.rows; r++) {
      const rowArr: boolean[] = [];
      for (let c = 0; c < this.cols; c++) {
        const isWall = level.layout[r][c] === '#';
        rowArr.push(isWall);
        if (isWall) {
          wallCoords.push(this.gridToWorld(c, r));
        }
      }
      this.grid.push(rowArr);
    }

    if (wallCoords.length > 0) {
      // Crisp contiguous Minecraft-like voxel wall blocks
      const wallGeo = new THREE.BoxGeometry(1.0, 0.72, 1.0);
      const wallsInst = new THREE.InstancedMesh(wallGeo, this.biomeVisuals.wallMat, wallCoords.length);
      wallsInst.castShadow = !this.isSoftwareGl;
      wallsInst.receiveShadow = true;
      wallCoords.forEach((pos, idx) => {
        _dummy.position.set(pos.x, 0.36, pos.z);
        _dummy.scale.set(1, 1, 1);
        _dummy.updateMatrix();
        wallsInst.setMatrixAt(idx, _dummy.matrix);
      });
      wallsInst.instanceMatrix.needsUpdate = true;
      wallsInst.computeBoundingSphere();
      this.levelGroup.add(wallsInst);
    }

    // Build Floor Holes AND Wall Mouse-Holes
    for (const t of level.tunnels) {
      const kind = t.kind ?? 'floor';
      if (kind === 'floor') {
        const keyA = `${t.a[0]},${t.a[1]}`;
        const keyB = `${t.b[0]},${t.b[1]}`;
        this.floorTunnelMap.set(keyA, { toCol: t.b[0], toRow: t.b[1], hex: t.hex });
        this.floorTunnelMap.set(keyB, { toCol: t.a[0], toRow: t.a[1], hex: t.hex });

        for (const [col, row] of [t.a, t.b]) {
          const { x, z } = this.gridToWorld(col, row);
          const { group, ring } = createTunnelModel(t.hex);
          group.position.set(x, 0, z);
          this.levelGroup.add(group);
          this.tunnelSpinners.push(ring);
        }
      } else {
        // Wall mouse-holes carved into wall tiles, facing adjacent walkable corridor
        const adjA = this.findAdjacentWalkable(t.a[0], t.a[1]);
        const adjB = this.findAdjacentWalkable(t.b[0], t.b[1]);
        if (adjA && adjB) {
          this.wallTunnelMap.set(`${t.a[0]},${t.a[1]}`, {
            entryCol: adjA.col,
            entryRow: adjA.row,
            toHoleCol: t.b[0],
            toHoleRow: t.b[1],
            toExitCol: adjB.col,
            toExitRow: adjB.row,
            exitDirX: adjB.dirX,
            exitDirZ: adjB.dirZ,
            hex: t.hex,
          });
          this.wallTunnelMap.set(`${t.b[0]},${t.b[1]}`, {
            entryCol: adjB.col,
            entryRow: adjB.row,
            toHoleCol: t.a[0],
            toHoleRow: t.a[1],
            toExitCol: adjA.col,
            toExitRow: adjA.row,
            exitDirX: adjA.dirX,
            exitDirZ: adjA.dirZ,
            hex: t.hex,
          });

          const listA = this.wallExitToHoleMap.get(`${adjA.col},${adjA.row}`) ?? [];
          listA.push({ holeCol: t.a[0], holeRow: t.a[1] });
          this.wallExitToHoleMap.set(`${adjA.col},${adjA.row}`, listA);

          const listB = this.wallExitToHoleMap.get(`${adjB.col},${adjB.row}`) ?? [];
          listB.push({ holeCol: t.b[0], holeRow: t.b[1] });
          this.wallExitToHoleMap.set(`${adjB.col},${adjB.row}`, listB);

          for (const [holeCoords, adj] of [
            [t.a, adjA],
            [t.b, adjB],
          ] as const) {
            const { x, z } = this.gridToWorld(holeCoords[0], holeCoords[1]);
            const { group, ring } = createWallTunnelModel(t.hex, adj.dirX, adj.dirZ);
            group.position.set(x, 0, z);
            this.levelGroup.add(group);
            this.tunnelSpinners.push(ring);
          }
        }
      }
    }

    for (const r of level.initialRats) {
      this.spawnRat(r.col, r.row, r.sex, false, false, false);
    }

    this.fitCamera();
    this.emitSnapshot();
  }

  private clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }
  }

  private spawnRat(
    col: number,
    row: number,
    sex: RatSex,
    isBaby: boolean,
    infected: boolean,
    withPopAnimation: boolean,
  ): RatActor {
    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const validDirs = dirs.filter(([dx, dz]) => this.isWalkable(col + dx, row + dz));
    const chosen =
      validDirs.length > 0
        ? validDirs[Math.floor(Math.random() * validDirs.length)]
        : ([0, 0] as [number, number]);

    const meshRefs = createRatModel(sex, isBaby, infected, this.contactShadowTex);
    const { x, z } = this.gridToWorld(col, row);
    meshRefs.group.position.set(x, 0, z);
    const heading = Math.atan2(chosen[0], chosen[1]);
    meshRefs.group.rotation.y = heading;
    if (withPopAnimation) {
      meshRefs.group.scale.setScalar(0.15);
    }
    this.actorsGroup.add(meshRefs.group);

    const actor: RatActor = {
      id: this.nextId++,
      sex,
      isBaby,
      babyTimer: isBaby ? 20.0 : 0, // 20 seconds maturation!
      x: col,
      z: row,
      targetCol: col + chosen[0],
      targetRow: row + chosen[1],
      dirX: chosen[0],
      dirZ: chosen[1],
      heading,
      speedMul: infected ? 1.18 : isBaby ? 1.06 : 0.92 + Math.random() * 0.16,
      breedCooldown: this.effectiveBreedCooldown * (0.65 + Math.random() * 0.4),
      matingTimer: 0,
      pregnantTimer: 0,
      sterile: false,
      infected,
      plagueTimer: infected ? 6.5 : 0,
      tunnelCooldown: 0.6,
      hitWallCooldown: 0,
      gasExposure: 0,
      spawnAnim: withPopAnimation ? 0.15 : 1,
      dyingTimer: 0,
      phase: Math.random() * Math.PI * 2,
      mesh: meshRefs,
    };
    this.rats.push(actor);
    return actor;
  }

  private isWalkable(col: number, row: number): boolean {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    return !this.grid[row][col];
  }

  public setSelectedTool(tool: ToolType | null): void {
    this.selectedTool = tool;
    soundEngine.playUiClick(740);
    this.updatePreviewVisuals();
    this.emitSnapshot();
  }

  public setSpeedMultiplier(speed: 1 | 2): void {
    this.speedMultiplier = speed;
    soundEngine.playUiClick(speed === 2 ? 860 : 620);
    this.emitSnapshot();
  }

  public togglePause(): void {
    if (this.status === 'won' || this.status === 'lost') return;
    this.status = this.status === 'paused' ? 'playing' : 'paused';
    soundEngine.playUiClick(this.status === 'paused' ? 500 : 760);
    this.emitSnapshot();
  }

  public restartLevel(difficulty?: DifficultyLevel, storeStock?: Record<StoreToolType, number>): void {
    soundEngine.playUiClick(640);
    this.loadLevel(this.level, difficulty ?? this.difficulty, storeStock);
  }

  private canPlaceAt(col: number, row: number, tool: ToolType): boolean {
    if (!this.isWalkable(col, row)) return false;
    if (tool === 'tempWall' || tool === 'permWall') {
      if (this.floorTunnelMap.has(`${col},${row}`)) return false;
      if (this.props.some((p) => p.col === col && p.row === row)) return false;
    }
    return true;
  }

  private getBombCrossRayExtents(col: number, row: number): {
    cells: Array<{ col: number; row: number }>;
    hitTempWalls: PlacedProp[];
    minC: number;
    maxC: number;
    minR: number;
    maxR: number;
  } {
    const cells: Array<{ col: number; row: number }> = [{ col, row }];
    const hitTempWalls: PlacedProp[] = [];
    let minC = col;
    let maxC = col;
    let minR = row;
    let maxR = row;

    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (const [dc, dr] of dirs) {
      let c = col + dc;
      let r = row + dr;
      while (c >= 0 && c < this.cols && r >= 0 && r < this.rows) {
        if (this.isWalkable(c, r)) {
          cells.push({ col: c, row: r });
          minC = Math.min(minC, c);
          maxC = Math.max(maxC, c);
          minR = Math.min(minR, r);
          maxR = Math.max(maxR, r);
          c += dc;
          r += dr;
        } else {
          const tw = this.props.find((p) => p.type === 'tempWall' && p.col === c && p.row === r);
          if (tw) {
            hitTempWalls.push(tw);
            cells.push({ col: c, row: r });
            minC = Math.min(minC, c);
            maxC = Math.max(maxC, c);
            minR = Math.min(minR, r);
            maxR = Math.max(maxR, r);
          }
          break;
        }
      }
    }

    return { cells, hitTempWalls, minC, maxC, minR, maxR };
  }

  private updatePreviewVisuals(): void {
    if (!this.hoveredCell || !this.selectedTool || this.status !== 'playing') {
      this.previewGroup.visible = false;
      return;
    }

    const meta = TOOLS_META[this.selectedTool];
    const hasCharge = this.inventory[this.selectedTool] > 0;
    const valid = hasCharge && this.canPlaceAt(this.hoveredCell.col, this.hoveredCell.row, this.selectedTool);
    const { x, z } = this.gridToWorld(this.hoveredCell.col, this.hoveredCell.row);
    this.previewGroup.position.set(x, 0, z);
    this.previewGroup.visible = true;

    const color = valid ? meta.accentHex : 0xef4444;
    this.previewCellMat.color.setHex(color);
    this.previewAoeMat.color.setHex(color);
    this.previewCrossMat.color.setHex(color);

    if (meta.previewMode === 'cross' && this.isWalkable(this.hoveredCell.col, this.hoveredCell.row)) {
      this.previewAoeRing.visible = false;
      this.previewCrossH.visible = true;
      this.previewCrossV.visible = true;

      const ext = this.getBombCrossRayExtents(this.hoveredCell.col, this.hoveredCell.row);
      const spanW = ext.maxC - ext.minC + 1;
      const offsetX = (ext.minC + ext.maxC) * 0.5 - this.hoveredCell.col;
      this.previewCrossH.scale.set(spanW, 1, 1);
      this.previewCrossH.position.set(offsetX, 0.032, 0);

      const spanH = ext.maxR - ext.minR + 1;
      const offsetZ = (ext.minR + ext.maxR) * 0.5 - this.hoveredCell.row;
      this.previewCrossV.scale.set(1, spanH, 1);
      this.previewCrossV.position.set(0, 0.032, offsetZ);
    } else if (meta.previewMode === 'radius' && meta.radius > 0) {
      this.previewCrossH.visible = false;
      this.previewCrossV.visible = false;
      this.previewAoeRing.visible = true;
      this.previewAoeRing.scale.setScalar(meta.radius);
    } else {
      this.previewAoeRing.visible = false;
      this.previewCrossH.visible = false;
      this.previewCrossV.visible = false;
    }
  }

  private raycastCell(clientX: number, clientY: number): { col: number; row: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_ndc, this.camera);
    const hit = _raycaster.ray.intersectPlane(_groundPlane, _hitPoint);
    if (!hit) return null;
    return this.worldToGrid(hit.x, hit.z);
  }

  private onPointerDown = (e: PointerEvent) => {
    soundEngine.unlock();
    if (this.status !== 'playing') return;
    this.activePointerId = e.pointerId;
    this.isTouchPointer = e.pointerType === 'touch';
    this.pointerStartX = e.clientX;
    this.pointerStartY = e.clientY;
    this.panStartX = this.panX;
    this.panStartZ = this.panZ;
    this.isSwiping = false;

    const cell = this.raycastCell(e.clientX, e.clientY);
    this.hoveredCell = cell;
    this.updatePreviewVisuals();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.activePointerId === e.pointerId && this.canPan && !this.mobileFitMode) {
      const dxPx = e.clientX - this.pointerStartX;
      const dyPx = e.clientY - this.pointerStartY;
      if (!this.isSwiping && Math.hypot(dxPx, dyPx) > 8) {
        this.isSwiping = true;
        this.hoveredCell = null;
        this.previewGroup.visible = false;
      }
      if (this.isSwiping) {
        const w = Math.max(1, this.container.clientWidth);
        const h = Math.max(1, this.container.clientHeight);
        const aspect = w / h;
        const vFov = THREE.MathUtils.degToRad(this.camera.fov);
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
        const visW = 2 * this.camDist * Math.tan(hFov / 2);
        const visH = (2 * this.camDist * Math.tan(vFov / 2)) / Math.cos(this.tiltRad);
        this.panX = this.panStartX - (dxPx / w) * visW;
        this.panZ = this.panStartZ - (dyPx / h) * visH;
        this.updateCameraTransform();
        return;
      }
    }

    const cell = this.raycastCell(e.clientX, e.clientY);
    this.hoveredCell = cell;
    this.updatePreviewVisuals();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.activePointerId !== e.pointerId) return;
    const wasSwiping = this.isSwiping;
    this.activePointerId = null;
    this.isSwiping = false;

    if (!wasSwiping && this.status === 'playing') {
      const cell = this.raycastCell(e.clientX, e.clientY);
      if (cell) {
        this.placeToolAt(cell.col, cell.row);
      }
    }
    if (this.isTouchPointer) {
      this.hoveredCell = null;
      this.previewGroup.visible = false;
    }
  };

  private onPointerCancel = () => {
    this.activePointerId = null;
    this.isSwiping = false;
    if (this.isTouchPointer) {
      this.hoveredCell = null;
      this.previewGroup.visible = false;
    }
  };

  private onPointerLeave = () => {
    this.hoveredCell = null;
    this.previewGroup.visible = false;
  };

  private addHazardCell(
    col: number,
    row: number,
    kind: 'gas' | 'radiation',
    duration: number,
    colorHex: number,
    baseY = 0,
  ): void {
    const existing = this.hazards.find(
      (h) => h.col === col && h.row === row && h.kind === kind,
    );
    if (existing) {
      existing.timer = Math.max(existing.timer, duration);
      return;
    }

    const { x, z } = this.gridToWorld(col, row);
    if (kind === 'gas') {
      const { group, mat } = createWhiteGasCloudMesh();
      group.position.set(x, baseY, z);
      group.rotation.y = ((col * 7 + row * 13) % 4) * (Math.PI / 2);
      this.fxGroup.add(group);
      this.hazards.push({
        col,
        row,
        kind,
        baseY,
        timer: duration,
        maxTimer: duration,
        object: group,
        mat,
      });
    } else {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.hazardGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.024, z);
      this.fxGroup.add(mesh);
      this.hazards.push({
        col,
        row,
        kind,
        baseY: 0.024,
        timer: duration,
        maxTimer: duration,
        object: mesh,
        mat,
      });
    }
  }

  private placeToolAt(col: number, row: number): void {
    const tool = this.selectedTool;
    if (!tool || this.inventory[tool] <= 0) {
      soundEngine.play('clunk', 180, 0.4);
      return;
    }

    if (!this.canPlaceAt(col, row, tool)) {
      soundEngine.play('clunk', 140, 0.55);
      return;
    }

    this.inventory[tool] -= 1;
    if (tool === 'permWall' || tool === 'plague') {
      this.onConsumeStoreItem(tool);
    }

    const { x, z } = this.gridToWorld(col, row);

    if (tool === 'bomb') {
      soundEngine.play('putdown', 60, 0.72);
      const { group, accentMesh } = createToolModel('bomb');
      group.position.set(x, 0, z);
      this.propsGroup.add(group);
      this.props.push({
        id: this.nextId++,
        type: 'bomb',
        col,
        row,
        timer: 2.35,
        maxTimer: 2.35,
        hp: 1,
        maxHp: 1,
        charges: 1,
        group,
        accentMesh,
      });
    } else if (tool === 'gas') {
      soundEngine.play('gas', 100, 0.78);
      const { group, accentMesh } = createToolModel('gas');
      group.position.set(x, 0, z);
      this.propsGroup.add(group);
      this.props.push({
        id: this.nextId++,
        type: 'gas',
        col,
        row,
        timer: 2.1,
        maxTimer: 2.1,
        hp: 1,
        maxHp: 1,
        charges: 1,
        group,
        accentMesh,
      });
      // Slow cell-by-cell propagating white gas cloud!
      this.addHazardCell(col, row, 'gas', 7.5, 0xf1f5f9);
      this.gasWaves.push({
        frontier: [{ c: col, r: row }],
        visited: new Set<string>([`${col},${row}`]),
        step: 0,
        maxSteps: 3,
        stepTimer: 0.45,
      });
      this.spawnBurst(x, 0.35, z, 0xf1f5f9, 10, 1.3);
    } else if (tool === 'poison') {
      soundEngine.play('putdown', 60, 0.72);
      const { group, accentMesh } = createToolModel('poison');
      group.position.set(x, 0, z);
      this.propsGroup.add(group);
      this.props.push({
        id: this.nextId++,
        type: 'poison',
        col,
        row,
        timer: 9999,
        maxTimer: 9999,
        hp: 1,
        maxHp: 1,
        charges: 1,
        group,
        accentMesh,
      });
      this.spawnBurst(x, 0.3, z, 0xfacc15, 10, 1.3);
    } else if (tool === 'nuclear') {
      soundEngine.play('nuclear', 150, 0.85);
      this.shakeIntensity = Math.max(this.shakeIntensity, 0.25);

      const { group, accentMesh } = createToolModel('nuclear');
      group.position.set(x, 0, z);
      this.propsGroup.add(group);
      this.props.push({
        id: this.nextId++,
        type: 'nuclear',
        col,
        row,
        timer: 3.0,
        maxTimer: 3.0,
        hp: 1,
        maxHp: 1,
        charges: 1,
        group,
        accentMesh,
      });

      this.sterilizeFemalesInRadius(col, row, TOOLS_META.nuclear.radius);
      this.spreadRadiationBfs(col, row, 2.6, 3.0, 0x65a30d);
      this.spawnShockwave(x, z, 0x84cc16, TOOLS_META.nuclear.radius * 2.0, 0.6);
      this.spawnBurst(x, 0.4, z, 0x84cc16, 18, 2.4);
    } else if (tool === 'tempWall') {
      soundEngine.play('clunk', 80, 0.75);
      this.grid[row][col] = true;
      const barrierRefs = createTempBarrierModel();
      barrierRefs.group.position.set(x, 0, z);
      this.propsGroup.add(barrierRefs.group);
      this.props.push({
        id: this.nextId++,
        type: 'tempWall',
        col,
        row,
        timer: 9999,
        maxTimer: 9999,
        hp: 12,
        maxHp: 12,
        charges: 12,
        group: barrierRefs.group,
        barrierRefs,
        hitAnimTimer: 0,
      });
      this.pushRatsOutOfCell(col, row);
      this.spawnBurst(x, 0.4, z, 0xdc2626, 8, 1.4);
      this.spawnBurst(x, 0.42, z, 0xf8fafc, 4, 1.2);
    } else if (tool === 'permWall') {
      soundEngine.play('putdown', 80, 0.78);
      this.grid[row][col] = true;
      const { group, accentMesh } = createToolModel('permWall');
      group.position.set(x, 0, z);
      this.propsGroup.add(group);
      this.props.push({
        id: this.nextId++,
        type: 'permWall',
        col,
        row,
        timer: 9999,
        maxTimer: 9999,
        hp: 9999,
        maxHp: 9999,
        charges: 1,
        group,
        accentMesh,
      });
      this.pushRatsOutOfCell(col, row);
      this.spawnBurst(x, 0.4, z, 0x64748b, 12, 1.5);
    } else if (tool === 'plague') {
      soundEngine.play('choke', 120, 0.7);
      const sex: RatSex = Math.random() < 0.5 ? 'M' : 'F';
      this.spawnRat(col, row, sex, false, true, true);
      this.spawnBurst(x, 0.25, z, 0x658330, 14, 1.6);
    } else if (tool === 'mutagen') {
      soundEngine.play('putdown', 60, 0.72);
      const { group } = createToolModel('mutagen');
      group.position.set(x, 0, z);
      this.propsGroup.add(group);
      this.props.push({
        id: this.nextId++,
        type: 'mutagen',
        col,
        row,
        timer: 9999,
        maxTimer: 9999,
        hp: 1,
        maxHp: 1,
        charges: 1,
        group,
      });
      this.spawnBurst(x, 0.3, z, 0xdb2777, 10, 1.4);
    }

    this.updatePreviewVisuals();
    this.emitSnapshot();
  }

  private sterilizeRat(rat: RatActor): void {
    if (rat.isBaby || rat.sex !== 'F' || rat.sterile) return;
    rat.sterile = true;
    rat.pregnantTimer = 0;
    rat.mesh.torso.scale.set(0.98, 0.86, 1.32);
    const pal = getRatPalette('F', false, rat.infected, true);
    rat.mesh.bodyMat.color.setHex(pal.fur);
    rat.mesh.skinMat.color.setHex(pal.skin);
    rat.mesh.statusRing.visible = true;
    (rat.mesh.statusRing.material as THREE.MeshBasicMaterial).color.setHex(0x84cc16);
    const wPos = this.gridToWorld(rat.x, rat.z);
    this.spawnBurst(wPos.x, 0.28, wPos.z, 0x4ade80, 7, 1.2);
  }

  private sterilizeFemalesInRadius(col: number, row: number, radius: number): void {
    const rSq = radius * radius;
    for (const rat of this.rats) {
      if (rat.dyingTimer > 0) continue;
      const dx = rat.x - col;
      const dz = rat.z - row;
      if (dx * dx + dz * dz <= rSq && !rat.isBaby && rat.sex === 'F') {
        this.sterilizeRat(rat);
      }
    }
  }

  private infectRat(rat: RatActor): void {
    if (rat.infected) return;
    rat.infected = true;
    rat.plagueTimer = 6.5;
    rat.speedMul = 1.18;
    const pal = getRatPalette(rat.sex, rat.isBaby, true, rat.sterile);
    rat.mesh.bodyMat.color.setHex(pal.fur);
    rat.mesh.skinMat.color.setHex(pal.skin);
    rat.mesh.statusRing.visible = true;
    (rat.mesh.statusRing.material as THREE.MeshBasicMaterial).color.setHex(0x65a30d);
    const wPos = this.gridToWorld(rat.x, rat.z);
    this.spawnBurst(wPos.x, 0.25, wPos.z, 0x65a30d, 7, 1.3);
  }

  private flipRatSex(rat: RatActor): void {
    rat.sex = rat.sex === 'M' ? 'F' : 'M';
    rat.pregnantTimer = 0;
    rat.sterile = false;
    rat.mesh.torso.scale.set(0.98, 0.86, 1.32);
    rat.mesh.statusRing.visible = rat.infected;
    const pal = getRatPalette(rat.sex, false, rat.infected, false);
    rat.mesh.bodyMat.color.setHex(pal.fur);
    rat.mesh.skinMat.color.setHex(pal.skin);
    const { x, z } = this.gridToWorld(rat.x, rat.z);
    this.spawnBurst(x, 0.28, z, rat.sex === 'M' ? 0x1e78ff : 0xf03892, 8, 1.4);
  }

  private graduateBabyRat(rat: RatActor): void {
    rat.isBaby = false;
    rat.babyTimer = 0;
    rat.sex = Math.random() < 0.5 ? 'M' : 'F';
    rat.breedCooldown = 2.0;
    rat.speedMul = rat.infected ? 1.18 : 0.92 + Math.random() * 0.16;
    rat.mesh.actor.scale.setScalar(1.0);
    const pal = getRatPalette(rat.sex, false, rat.infected, false);
    rat.mesh.bodyMat.color.setHex(pal.fur);
    rat.mesh.skinMat.color.setHex(pal.skin);
    const { x, z } = this.gridToWorld(rat.x, rat.z);
    this.spawnBurst(x, 0.26, z, rat.sex === 'M' ? 0x1e78ff : 0xf03892, 8, 1.4);
  }

  private pushRatsOutOfCell(col: number, row: number): void {
    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const open = dirs.find(([dx, dz]) => this.isWalkable(col + dx, row + dz));
    for (const rat of this.rats) {
      if (Math.round(rat.x) === col && Math.round(rat.z) === row) {
        if (open) {
          rat.x = col + open[0];
          rat.z = row + open[1];
          rat.targetCol = col + open[0];
          rat.targetRow = row + open[1];
        }
      } else if (rat.targetCol === col && rat.targetRow === row) {
        rat.targetCol = Math.round(rat.x);
        rat.targetRow = Math.round(rat.z);
      }
    }
  }

  private destroyTempWall(wall: PlacedProp): void {
    this.grid[wall.row][wall.col] = false;
    this.propsGroup.remove(wall.group);
    const idx = this.props.indexOf(wall);
    if (idx >= 0) this.props.splice(idx, 1);
    const { x, z } = this.gridToWorld(wall.col, wall.row);
    soundEngine.play('clunk', 60, 0.72);
    this.spawnBurst(x, 0.38, z, 0xdc2626, 12, 2.2);
    this.spawnBurst(x, 0.42, z, 0xf8fafc, 8, 2.0);
  }

  private damageTempWall(col: number, row: number, rat: RatActor): void {
    if (rat.hitWallCooldown > 0) return;
    const wall = this.props.find((p) => p.type === 'tempWall' && p.col === col && p.row === row);
    if (!wall) return;

    rat.hitWallCooldown = 0.55;
    wall.hp -= 1;
    wall.hitAnimTimer = 0.42;
    const { x, z } = this.gridToWorld(col, row);
    soundEngine.play('clunk', 110, 0.38);
    this.spawnBurst(x, 0.35, z, 0xdc2626, 4, 1.2);
    this.spawnBurst(x, 0.38, z, 0xf8fafc, 2, 1.1);

    if (wall.barrierRefs) {
      const refs = wall.barrierRefs;
      const dmg = Math.min(1, Math.max(0, 1 - wall.hp / wall.maxHp));

      // Progressively reveal cracks across the sign (hp 11 -> 1)
      const crackThresholds = [11, 9, 8, 6, 5, 3, 2];
      refs.cracks.forEach((crack, idx) => {
        const show = wall.hp <= crackThresholds[idx];
        crack.visible = show;
        if (show) {
          crack.scale.set(1 + dmg * 0.25, 1, 1 + dmg * 0.45);
        }
      });

      // Break off perimeter chunks at damage milestones
      const biteThresholds = [9, 6, 4, 2];
      refs.bites.forEach((bite, idx) => {
        const wasVisible = bite.visible;
        const show = wall.hp <= biteThresholds[idx];
        bite.visible = show;
        if (show && !wasVisible) {
          this.spawnBurst(x, 0.34, z, 0xdc2626, 6, 1.6);
        }
      });

      // Weather sign colors from bright red/white toward battered dark red/gray
      refs.redMat.color.setRGB(
        THREE.MathUtils.lerp(0.86, 0.46, dmg),
        THREE.MathUtils.lerp(0.15, 0.08, dmg),
        THREE.MathUtils.lerp(0.15, 0.08, dmg),
      );
      refs.whiteMat.color.setRGB(
        THREE.MathUtils.lerp(0.97, 0.58, dmg),
        THREE.MathUtils.lerp(0.98, 0.6, dmg),
        THREE.MathUtils.lerp(0.99, 0.64, dmg),
      );
    }

    if (wall.hp <= 0) {
      this.destroyTempWall(wall);
    }
  }

  private spreadRadiationBfs(
    startCol: number,
    startRow: number,
    maxDist: number,
    duration: number,
    colorHex: number,
  ): void {
    const queue: Array<{ c: number; r: number }> = [{ c: startCol, r: startRow }];
    const visited = new Set<string>([`${startCol},${startRow}`]);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const dist = Math.hypot(curr.c - startCol, curr.r - startRow);
      if (dist > maxDist) continue;

      this.addHazardCell(curr.c, curr.r, 'radiation', duration, colorHex);

      const neighbors: Array<[number, number]> = [
        [curr.c + 1, curr.r],
        [curr.c - 1, curr.r],
        [curr.c, curr.r + 1],
        [curr.c, curr.r - 1],
      ];
      for (const [nc, nr] of neighbors) {
        const key = `${nc},${nr}`;
        if (!visited.has(key) && this.isWalkable(nc, nr)) {
          visited.add(key);
          queue.push({ c: nc, r: nr });
        }
      }
    }
  }

  private detonateBombCross(col: number, row: number): void {
    const { cells, hitTempWalls } = this.getBombCrossRayExtents(col, row);
    const cellSet = new Set(cells.map((c) => `${c.col},${c.row}`));

    for (const tw of hitTempWalls) {
      this.destroyTempWall(tw);
    }

    // Eliminate all other placed tools/props along the blast row and column
    for (let i = this.props.length - 1; i >= 0; i--) {
      const prop = this.props[i];
      if (prop.type === 'permWall') continue;
      if (!cellSet.has(`${prop.col},${prop.row}`)) continue;

      if (prop.type === 'tempWall') {
        this.destroyTempWall(prop);
      } else {
        const { x, z } = this.gridToWorld(prop.col, prop.row);
        this.spawnBurst(x, 0.3, z, TOOLS_META[prop.type].accentHex, 8, 1.6);
        this.propsGroup.remove(prop.group);
        this.props.splice(i, 1);
      }
    }

    // Clear active gas clouds and radiation hazards in the blast row and column
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (!cellSet.has(`${h.col},${h.row}`)) continue;
      this.fxGroup.remove(h.object);
      h.mat.dispose();
      this.hazards.splice(i, 1);
    }
    for (let i = this.gasWaves.length - 1; i >= 0; i--) {
      const wave = this.gasWaves[i];
      wave.frontier = wave.frontier.filter((cell) => !cellSet.has(`${cell.c},${cell.r}`));
      if (wave.frontier.length === 0) {
        this.gasWaves.splice(i, 1);
      }
    }

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const { x, z } = this.gridToWorld(cell.col, cell.row);
      this.spawnBurst(x, 0.28, z, i === 0 ? 0xff6b1a : 0xfbbf24, i === 0 ? 18 : 5, i === 0 ? 3.2 : 1.7);
    }

    for (const rat of this.rats) {
      if (rat.dyingTimer > 0) continue;
      const rc = Math.round(rat.x);
      const rr = Math.round(rat.z);
      if (cellSet.has(`${rc},${rr}`)) {
        this.markRatDead(rat, 0xff6b1a);
      } else {
        for (const c of cells) {
          if (Math.hypot(rat.x - c.col, rat.z - c.row) < 0.56) {
            this.markRatDead(rat, 0xff6b1a);
            break;
          }
        }
      }
    }
  }

  private markRatDead(rat: RatActor, particleColor: number): void {
    if (rat.dyingTimer > 0) return;
    rat.dyingTimer = 0.34;
    this.eliminatedCount += 1;
    if (rat.isBaby) {
      this.babiesEliminatedCount += 1;
    }
    const { x, z } = this.gridToWorld(rat.x, rat.z);
    this.spawnBurst(x, 0.24, z, particleColor, 10, 2.0);
  }

  private spawnReinforcementWave(count = 3): void {
    const safeCells: Array<{ c: number; r: number }> = [];
    const fallbackCells: Array<{ c: number; r: number }> = [];

    for (let r = 1; r < this.rows - 1; r++) {
      for (let c = 1; c < this.cols - 1; c++) {
        if (!this.isWalkable(c, r)) continue;
        fallbackCells.push({ c, r });
        const hasProp = this.props.some((p) => p.col === c && p.row === r);
        const hasHazard = this.hazards.some((h) => h.col === c && h.row === r);
        if (!hasProp && !hasHazard) {
          safeCells.push({ c, r });
        }
      }
    }

    const pool = safeCells.length > 0 ? safeCells : fallbackCells;
    if (pool.length === 0) return;

    const sexes: RatSex[] = ['M', 'F', Math.random() < 0.5 ? 'M' : 'F'];
    for (let i = 0; i < count; i++) {
      const picked = pool[Math.floor(Math.random() * pool.length)];
      const sex = sexes[i % sexes.length];
      this.spawnRat(picked.c, picked.r, sex, false, false, true);
      const { x, z } = this.gridToWorld(picked.c, picked.r);
      this.spawnBurst(x, 0.28, z, sex === 'M' ? 0x38bdf8 : 0xf472b6, 7, 1.4);
    }
    soundEngine.play('birth', 180, 0.52);
  }

  private spawnBurst(
    x: number,
    y: number,
    z: number,
    colorHex: number,
    count: number,
    speed: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      mesh.position.set(x, y, z);
      const scaleStart = 0.6 + Math.random() * 0.75;
      mesh.scale.setScalar(scaleStart);
      this.fxGroup.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const spd = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * spd,
        vy: speed * (0.55 + Math.random() * 0.9),
        vz: Math.sin(angle) * spd,
        life: 0.45 + Math.random() * 0.35,
        maxLife: 0.8,
        gravity: 5.5,
        scaleStart,
      });
    }
  }

  private spawnShockwave(
    x: number,
    z: number,
    colorHex: number,
    maxScale: number,
    duration: number,
  ): void {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.shockwaveGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.05, z);
    mesh.scale.setScalar(0.3);
    this.fxGroup.add(mesh);
    this.shockwaves.push({
      mesh,
      life: duration,
      maxLife: duration,
      maxScale,
    });
  }

  private tick = () => {
    if (this.disposed) return;

    const rawDt = Math.min(0.05, this.clock.getDelta());
    const simDt = this.status === 'playing' ? rawDt * this.speedMultiplier : 0;

    if (simDt > 0) {
      this.elapsedSeconds += simDt;
      this.stepSimulation(simDt);
    }

    this.stepVisualFx(rawDt);

    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private getRegenSpeedMultiplier(): number {
    return Math.min(2.25, 1 + this.elapsedSeconds / 68);
  }

  private getObjectiveMode(): GameObjectiveMode {
    return this.level?.objectiveMode ?? 'eradication';
  }

  private getTargetDurationSec(): number {
    return Math.max(30, this.level?.targetDurationSec ?? 180);
  }

  private getTargetKills(): number {
    return Math.max(10, this.level?.targetKills ?? 40);
  }

  private computeRunScore(remainingRats: number): number {
    const mode = this.getObjectiveMode();
    if (mode === 'survival') {
      const targetDur = this.getTargetDurationSec();
      const earlyClear = remainingRats === 0 && this.elapsedSeconds < targetDur;
      const earlyBonus = earlyClear ? Math.round((targetDur - this.elapsedSeconds) * 10) : 0;
      return Math.max(
        100,
        10000 +
          earlyBonus +
          this.eliminatedCount * 25 +
          Math.max(0, this.effectiveCriticalLimit - remainingRats) * 15,
      );
    }
    return Math.max(100, Math.round(10000 - this.elapsedSeconds * 20) + this.eliminatedCount * 10);
  }

  private getCurrentRewardCredits(): number {
    if (this.getObjectiveMode() === 'survival') {
      return this.baseRewardCredits;
    }
    // Full reward during first 25s; then decays smoothly down to a 25% minimum floor
    const graceSec = 25;
    const penalty = Math.floor(Math.max(0, this.elapsedSeconds - graceSec) * (this.baseRewardCredits / 180));
    const floor = Math.max(25, Math.round(this.baseRewardCredits * 0.25));
    return Math.max(floor, this.baseRewardCredits - penalty);
  }

  private stepSimulation(dt: number): void {
    // 0. Regenerate all 6 Base Tools (accelerating over time)
    const regenBonus = this.getRegenSpeedMultiplier();
    for (const tool of BASE_TOOL_ORDER) {
      const max = this.maxInventory[tool];
      if (max > 0 && this.inventory[tool] < max && this.regenSec[tool] > 0) {
        this.regenTimers[tool] += dt * regenBonus;
        if (this.regenTimers[tool] >= this.regenSec[tool]) {
          this.regenTimers[tool] -= this.regenSec[tool];
          this.inventory[tool] += 1;
        }
      } else {
        this.regenTimers[tool] = 0;
      }
    }

    // 0b. Slowly propagating Toxic Gas waves (cell-by-cell along open corridors AND through tunnels/wall holes)
    for (let i = this.gasWaves.length - 1; i >= 0; i--) {
      const wave = this.gasWaves[i];
      wave.stepTimer -= dt;
      if (wave.stepTimer <= 0) {
        wave.stepTimer += 0.45;
        const nextFrontier: Array<{ c: number; r: number }> = [];
        const dirs: Array<[number, number]> = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const curr of wave.frontier) {
          for (const [dc, dr] of dirs) {
            const nc = curr.c + dc;
            const nr = curr.r + dr;
            const key = `${nc},${nr}`;
            if (!wave.visited.has(key) && this.isWalkable(nc, nr)) {
              wave.visited.add(key);
              nextFrontier.push({ c: nc, r: nr });
              this.addHazardCell(nc, nr, 'gas', 7.5, 0xf1f5f9);
              const { x, z } = this.gridToWorld(nc, nr);
              this.spawnBurst(x, 0.28, z, 0xf1f5f9, 3, 0.7);
            }
          }

          // Spread through Floor Tunnels
          const fDest = this.floorTunnelMap.get(`${curr.c},${curr.r}`);
          if (fDest) {
            const destKey = `${fDest.toCol},${fDest.toRow}`;
            if (!wave.visited.has(destKey) && this.isWalkable(fDest.toCol, fDest.toRow)) {
              wave.visited.add(destKey);
              nextFrontier.push({ c: fDest.toCol, r: fDest.toRow });
              this.addHazardCell(fDest.toCol, fDest.toRow, 'gas', 7.5, 0xf1f5f9);
              const { x, z } = this.gridToWorld(fDest.toCol, fDest.toRow);
              this.spawnBurst(x, 0.32, z, fDest.hex, 5, 1.0);
              this.spawnBurst(x, 0.35, z, 0xf1f5f9, 4, 0.9);
            }
          }

          // Spread INTO Wall Mouse-Holes (killing rats inside the hole) and OUT the paired exit
          const holes = this.wallExitToHoleMap.get(`${curr.c},${curr.r}`);
          if (holes) {
            for (const hole of holes) {
              const holeKey = `${hole.holeCol},${hole.holeRow}`;
              if (!wave.visited.has(holeKey)) {
                wave.visited.add(holeKey);
                this.addHazardCell(hole.holeCol, hole.holeRow, 'gas', 7.5, 0xf1f5f9, 0.42);
                const hPos = this.gridToWorld(hole.holeCol, hole.holeRow);
                this.spawnBurst(hPos.x, 0.56, hPos.z, 0xf1f5f9, 4, 0.85);
              }

              const wDest = this.wallTunnelMap.get(holeKey);
              if (wDest) {
                const pairHoleKey = `${wDest.toHoleCol},${wDest.toHoleRow}`;
                if (!wave.visited.has(pairHoleKey)) {
                  wave.visited.add(pairHoleKey);
                  this.addHazardCell(wDest.toHoleCol, wDest.toHoleRow, 'gas', 7.5, 0xf1f5f9, 0.42);
                  const phPos = this.gridToWorld(wDest.toHoleCol, wDest.toHoleRow);
                  this.spawnBurst(phPos.x, 0.56, phPos.z, wDest.hex, 4, 0.9);
                }

                const exitKey = `${wDest.toExitCol},${wDest.toExitRow}`;
                if (!wave.visited.has(exitKey) && this.isWalkable(wDest.toExitCol, wDest.toExitRow)) {
                  wave.visited.add(exitKey);
                  nextFrontier.push({ c: wDest.toExitCol, r: wDest.toExitRow });
                  this.addHazardCell(wDest.toExitCol, wDest.toExitRow, 'gas', 7.5, 0xf1f5f9);
                  const exPos = this.gridToWorld(wDest.toExitCol, wDest.toExitRow);
                  this.spawnBurst(exPos.x, 0.28, exPos.z, 0xf1f5f9, 5, 0.9);
                }
              }
            }
          }
        }
        wave.frontier = nextFrontier;
        wave.step += 1;
        if (wave.step >= wave.maxSteps || nextFrontier.length === 0) {
          this.gasWaves.splice(i, 1);
        }
      }
    }

    // 1. Update Props (iterate snapshot since bomb detonation can destroy other props)
    for (const p of [...this.props]) {
      if (!this.props.includes(p)) continue;
      p.timer -= dt;

      if (p.type === 'bomb') {
        const urgency = 1 - Math.max(0, p.timer / p.maxTimer);
        const pulse = 1 + Math.sin(this.elapsedSeconds * (10 + urgency * 24)) * 0.14;
        p.group.scale.setScalar(pulse);
        if (p.timer <= 0) {
          const { x, z } = this.gridToWorld(p.col, p.row);
          const idx = this.props.indexOf(p);
          if (idx >= 0) this.props.splice(idx, 1);
          this.propsGroup.remove(p.group);

          soundEngine.play('bomb', 40, 0.88);
          this.shakeIntensity = Math.max(this.shakeIntensity, 0.3);
          this.flashLight.position.set(x, 1.8, z);
          this.flashLight.color.setHex(0xff8833);
          this.flashIntensity = 7;
          this.detonateBombCross(p.col, p.row);
          this.spawnShockwave(x, z, 0xea580c, 4.0, 0.42);
        }
      } else if (p.type === 'gas' || p.type === 'nuclear') {
        if (p.timer <= 0) {
          this.propsGroup.remove(p.group);
          const idx = this.props.indexOf(p);
          if (idx >= 0) this.props.splice(idx, 1);
        }
      } else if (p.type === 'poison') {
        p.group.position.y = Math.sin(this.elapsedSeconds * 3.5 + p.id) * 0.025;
        if (p.charges <= 0) {
          this.propsGroup.remove(p.group);
          const idx = this.props.indexOf(p);
          if (idx >= 0) this.props.splice(idx, 1);
        }
      } else if (p.type === 'mutagen') {
        p.group.rotation.y += dt * 1.8;
        if (p.charges <= 0) {
          this.propsGroup.remove(p.group);
          const idx = this.props.indexOf(p);
          if (idx >= 0) this.props.splice(idx, 1);
        }
      } else if (p.type === 'tempWall' && p.barrierRefs) {
        const dmg = Math.min(1, Math.max(0, 1 - p.hp / p.maxHp));
        const leanSign = p.id % 2 === 0 ? 1 : -1;
        const restTiltZ = leanSign * dmg * 0.34;
        const restTiltX = 0.24 + dmg * 0.24;
        const restY = 0.27 - dmg * 0.065;

        let wobbleZ = 0;
        let wobbleX = 0;
        let bounceY = 0;
        if (p.hitAnimTimer && p.hitAnimTimer > 0) {
          p.hitAnimTimer = Math.max(0, p.hitAnimTimer - dt);
          const t = p.hitAnimTimer / 0.42;
          const wave = Math.sin(p.hitAnimTimer * 52);
          wobbleZ = wave * t * 0.28;
          wobbleX = Math.cos(p.hitAnimTimer * 44) * t * 0.18;
          bounceY = Math.abs(wave) * t * 0.055;
        }

        const sp = p.barrierRefs.signPivot;
        sp.rotation.z = restTiltZ + wobbleZ;
        sp.rotation.x = restTiltX + wobbleX;
        sp.position.y = restY + bounceY;
      }
    }

    // 2. Update Hazards
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.timer -= dt;
      const ratio = Math.max(0, h.timer / h.maxTimer);
      if (h.kind === 'gas') {
        h.mat.opacity = 0.88 * Math.min(1, ratio * 2.2) * (0.9 + Math.sin(this.elapsedSeconds * 3.5 + h.col) * 0.1);
        h.object.position.y = h.baseY + Math.sin(this.elapsedSeconds * 2.8 + h.row) * 0.03;
      } else {
        h.mat.opacity = 0.26 * Math.min(1, ratio * 2.2) * (0.85 + Math.sin(this.elapsedSeconds * 4 + h.col) * 0.15);
      }
      if (h.timer <= 0) {
        this.fxGroup.remove(h.object);
        h.mat.dispose();
        this.hazards.splice(i, 1);
      }
    }

    // 3. Move & Update Rats (Baby growth 20s, Pregnancy 7s -> 3-6 babies, Plague, Hazards)
    const baseSpeed = this.effectiveRatSpeed;

    for (let i = this.rats.length - 1; i >= 0; i--) {
      const rat = this.rats[i];

      if (rat.dyingTimer > 0) {
        rat.dyingTimer -= dt;
        const s = Math.max(0.01, rat.dyingTimer / 0.34);
        rat.mesh.group.scale.setScalar(s);
        rat.mesh.group.rotation.y += dt * 14;
        if (rat.dyingTimer <= 0) {
          this.actorsGroup.remove(rat.mesh.group);
          this.rats.splice(i, 1);
        }
        continue;
      }

      if (rat.spawnAnim < 1) {
        rat.spawnAnim = Math.min(1, rat.spawnAnim + dt * 4.5);
        rat.mesh.group.scale.setScalar(rat.spawnAnim);
      }

      if (rat.breedCooldown > 0) rat.breedCooldown -= dt;
      if (rat.tunnelCooldown > 0) rat.tunnelCooldown -= dt;
      if (rat.hitWallCooldown > 0) rat.hitWallCooldown -= dt;

      // Baby rat maturation (20 seconds before becoming adult with random sex)
      if (rat.isBaby) {
        rat.babyTimer -= dt;
        if (rat.babyTimer <= 0) {
          this.graduateBabyRat(rat);
        }
      }

      // Plague countdown
      if (rat.infected) {
        rat.plagueTimer -= dt;
        if (rat.plagueTimer <= 0) {
          soundEngine.play('choke', 180, 0.6);
          this.markRatDead(rat, 0x65a30d);
          continue;
        }
      }

      // Female gestation countdown (7s) -> gives birth to 3..6 Baby rats!
      if (!rat.isBaby && rat.pregnantTimer > 0) {
        rat.pregnantTimer -= dt;
        if (rat.pregnantTimer <= 0) {
          rat.pregnantTimer = 0;
          rat.mesh.torso.scale.set(0.98, 0.86, 1.32);
          rat.mesh.statusRing.visible = rat.infected;

          const birthCol = Math.round(rat.x);
          const birthRow = Math.round(rat.z);
          if (this.isWalkable(birthCol, birthRow)) {
            const litterSize = 3 + Math.floor(Math.random() * 4); // 3 to 6 baby rats!
            for (let bIdx = 0; bIdx < litterSize; bIdx++) {
              const placeholderSex: RatSex = Math.random() < 0.5 ? 'M' : 'F';
              this.spawnRat(birthCol, birthRow, placeholderSex, true, false, true);
              this.bornCount += 1;
            }
            soundEngine.play('birth', 220, 0.75);
            const wPos = this.gridToWorld(birthCol, birthRow);
            this.spawnBurst(wPos.x, 0.28, wPos.z, 0xf3ead8, 12, 1.7);
          }
        }
      }

      // Hazard exposure
      const cellC = Math.round(rat.x);
      const cellR = Math.round(rat.z);
      const haz = this.hazards.find((h) => h.col === cellC && h.row === cellR);
      if (haz) {
        if (haz.kind === 'gas') {
          rat.gasExposure += dt * 1.15;
          if (rat.gasExposure >= 1.0) {
            soundEngine.play('choke', 200, 0.65);
            this.markRatDead(rat, 0xf1f5f9);
            continue;
          }
        } else if (haz.kind === 'radiation' && !rat.isBaby && rat.sex === 'F' && !rat.sterile) {
          this.sterilizeRat(rat);
        }
      } else {
        rat.gasExposure = Math.max(0, rat.gasExposure - dt * 0.5);
      }

      // Poison Bait: 1 kill per bait
      const poisonProp = this.props.find(
        (p) => p.type === 'poison' && p.charges > 0 && Math.hypot(rat.x - p.col, rat.z - p.row) < 0.45,
      );
      if (poisonProp) {
        poisonProp.charges -= 1;
        soundEngine.play('poison', 140, 0.75);
        this.markRatDead(rat, 0xfacc15);
        continue;
      }

      // Mutagen DNA Trap: flips sex of 1 adult rat passing over it
      if (!rat.isBaby) {
        const mutagenProp = this.props.find(
          (p) => p.type === 'mutagen' && p.charges > 0 && Math.hypot(rat.x - p.col, rat.z - p.row) < 0.45,
        );
        if (mutagenProp) {
          mutagenProp.charges -= 1;
          soundEngine.play('newsex', 100, 0.8);
          this.flipRatSex(rat);
        }
      }

      if (rat.matingTimer > 0) {
        rat.matingTimer -= dt;
        rat.mesh.group.position.y = Math.abs(Math.sin(this.elapsedSeconds * 18)) * 0.1;
        continue;
      }

      const dx = rat.targetCol - rat.x;
      const dz = rat.targetRow - rat.z;
      const dist = Math.hypot(dx, dz);
      const step = baseSpeed * rat.speedMul * dt;

      if (dist <= step || dist < 0.02) {
        rat.x = rat.targetCol;
        rat.z = rat.targetRow;

        // Check Floor Tunnel teleport
        const fDest = this.floorTunnelMap.get(`${rat.targetCol},${rat.targetRow}`);
        if (fDest && rat.tunnelCooldown <= 0) {
          const fromPos = this.gridToWorld(rat.targetCol, rat.targetRow);
          this.spawnBurst(fromPos.x, 0.25, fromPos.z, fDest.hex, 9, 1.5);
          rat.x = fDest.toCol;
          rat.z = fDest.toRow;
          rat.targetCol = fDest.toCol;
          rat.targetRow = fDest.toRow;
          rat.tunnelCooldown = 1.8;
          const toPos = this.gridToWorld(fDest.toCol, fDest.toRow);
          this.spawnBurst(toPos.x, 0.25, toPos.z, fDest.hex, 9, 1.5);
        } else {
          // Check Wall Mouse-Hole teleport
          const wDest = this.wallTunnelMap.get(`${rat.targetCol},${rat.targetRow}`);
          if (wDest) {
            const fromPos = this.gridToWorld(rat.targetCol, rat.targetRow);
            this.spawnBurst(fromPos.x, 0.25, fromPos.z, wDest.hex, 9, 1.5);
            if (this.isWalkable(wDest.toExitCol, wDest.toExitRow)) {
              rat.x = wDest.toExitCol;
              rat.z = wDest.toExitRow;
              rat.targetCol = wDest.toExitCol;
              rat.targetRow = wDest.toExitRow;
              rat.dirX = wDest.exitDirX;
              rat.dirZ = wDest.exitDirZ;
              rat.tunnelCooldown = 2.1;
              const toPos = this.gridToWorld(wDest.toExitCol, wDest.toExitRow);
              this.spawnBurst(toPos.x, 0.25, toPos.z, wDest.hex, 9, 1.5);
            } else {
              // Exit corridor blocked by a player wall -> bounce back to entry corridor
              rat.x = wDest.entryCol;
              rat.z = wDest.entryRow;
              rat.targetCol = wDest.entryCol;
              rat.targetRow = wDest.entryRow;
              rat.tunnelCooldown = 1.2;
            }
          }
        }

        this.chooseNextRatTarget(rat);
      } else {
        rat.x += (dx / dist) * step;
        rat.z += (dz / dist) * step;
      }

      const worldPos = this.gridToWorld(rat.x, rat.z);
      rat.mesh.group.position.set(worldPos.x, 0, worldPos.z);

      const targetHeading = Math.atan2(rat.dirX, rat.dirZ);
      const diff = normalizeAngle(targetHeading - rat.heading);
      rat.heading = normalizeAngle(rat.heading + diff * Math.min(1, dt * 14));
      rat.mesh.group.rotation.y = rat.heading;

      const stride = this.elapsedSeconds * 18 * rat.speedMul + rat.phase;
      rat.mesh.tailPivot.rotation.y = Math.sin(stride * 0.6) * 0.38;
      rat.mesh.paws[0].position.z = 0.12 + Math.sin(stride) * 0.04;
      rat.mesh.paws[1].position.z = 0.12 - Math.sin(stride) * 0.04;
      rat.mesh.paws[2].position.z = -0.14 - Math.sin(stride) * 0.04;
      rat.mesh.paws[3].position.z = -0.14 + Math.sin(stride) * 0.04;
    }

    // 4. Rat-to-Rat Interactions (Plague Spread & Adult Mating)
    for (let i = 0; i < this.rats.length; i++) {
      const a = this.rats[i];
      if (a.dyingTimer > 0) continue;

      for (let j = i + 1; j < this.rats.length; j++) {
        const b = this.rats[j];
        if (b.dyingTimer > 0) continue;

        const dSq = (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z);
        if (dSq > 0.36) continue;

        if (a.infected && !b.infected) {
          this.infectRat(b);
        } else if (b.infected && !a.infected) {
          this.infectRat(a);
        }

        if (a.isBaby || b.isBaby || a.sex === b.sex) continue;

        const female = a.sex === 'F' ? a : b;
        const male = a.sex === 'M' ? a : b;

        if (
          !female.infected &&
          !male.infected &&
          !female.sterile &&
          female.pregnantTimer <= 0 &&
          female.breedCooldown <= 0 &&
          male.breedCooldown <= 0 &&
          female.matingTimer <= 0 &&
          male.matingTimer <= 0
        ) {
          female.breedCooldown = this.effectiveBreedCooldown;
          male.breedCooldown = this.effectiveBreedCooldown;
          female.matingTimer = 0.42;
          male.matingTimer = 0.42;
          female.pregnantTimer = 7.0; // 7 seconds gestation!
          female.mesh.torso.scale.set(1.24, 1.04, 1.44);
          female.mesh.statusRing.visible = true;
          (female.mesh.statusRing.material as THREE.MeshBasicMaterial).color.setHex(0xe11d48);

          soundEngine.play('sex', 320, 0.65);
          const midX = (a.x + b.x) * 0.5;
          const midZ = (a.z + b.z) * 0.5;
          const wPos = this.gridToWorld(midX, midZ);
          this.spawnBurst(wPos.x, 0.38, wPos.z, 0xf43f5e, 10, 1.4);
          break;
        }
      }
    }

    // 5. Win / Loss Checks
    const activeRats = this.rats.filter((r) => r.dyingTimer <= 0);
    const total = activeRats.length;
    soundEngine.setDangerIntensity(total / this.effectiveCriticalLimit);

    if (total >= this.effectiveCriticalLimit) {
      this.status = 'lost';
      this.lossReason = `Sovraffollamento! I ratti hanno raggiunto il limite critico di ${this.effectiveCriticalLimit}.`;
      soundEngine.setDangerIntensity(0);
      soundEngine.play('wewin', 0, 0.85);
      this.emitSnapshot();
      return;
    }

    const mode = this.getObjectiveMode();
    const targetDur = this.getTargetDurationSec();
    const targetKills = this.getTargetKills();

    const wonByWipeout = mode === 'eradication' && total === 0 && this.rats.length === 0;
    const wonBySurvival = mode === 'survival' && this.elapsedSeconds >= targetDur;
    const wonByQuota = mode === 'target_kills' && this.eliminatedCount >= targetKills;

    if (wonByWipeout || wonBySurvival || wonByQuota) {
      if (wonBySurvival && this.elapsedSeconds > targetDur) {
        this.elapsedSeconds = targetDur;
      }
      this.status = 'won';
      soundEngine.setDangerIntensity(0);
      soundEngine.play('welldone', 0, 0.85);
      window.setTimeout(() => {
        if (!this.disposed && this.status === 'won') {
          soundEngine.play('victory', 0, 0.85);
        }
      }, 650);
      this.emitSnapshot();
      return;
    }

    // Automatic reinforcement wave: in survival or target_kills, keep active population supplied
    if ((mode === 'survival' || mode === 'target_kills') && total < 3) {
      this.spawnReinforcementWave(3);
    }

    this.snapshotTimer += dt;
    if (this.snapshotTimer >= 0.1) {
      this.snapshotTimer = 0;
      this.emitSnapshot();
    }
  }

  private chooseNextRatTarget(rat: RatActor): void {
    const col = Math.round(rat.x);
    const row = Math.round(rat.z);

    if (rat.dirX !== 0 || rat.dirZ !== 0) {
      const aheadC = col + rat.dirX;
      const aheadR = row + rat.dirZ;
      if (!this.isWalkable(aheadC, aheadR)) {
        this.damageTempWall(aheadC, aheadR, rat);
      }
    }

    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const valid = dirs.filter(([dx, dz]) => this.isWalkable(col + dx, row + dz));

    // Include adjacent Wall Mouse-Holes when cooldown allows
    if (rat.tunnelCooldown <= 0) {
      const holes = this.wallExitToHoleMap.get(`${col},${row}`);
      if (holes && holes.length > 0 && Math.random() < 0.42) {
        const picked = holes[Math.floor(Math.random() * holes.length)];
        rat.dirX = picked.holeCol - col;
        rat.dirZ = picked.holeRow - row;
        rat.targetCol = picked.holeCol;
        rat.targetRow = picked.holeRow;
        return;
      }
    }

    if (valid.length === 0) {
      rat.targetCol = col;
      rat.targetRow = row;
      return;
    }

    const nearbyPoison = this.props.find(
      (p) => p.type === 'poison' && p.charges > 0 && Math.hypot(p.col - col, p.row - row) <= 2.6,
    );
    if (nearbyPoison && Math.random() < 0.75) {
      valid.sort((a, b) => {
        const da = Math.hypot(col + a[0] - nearbyPoison.col, row + a[1] - nearbyPoison.row);
        const db = Math.hypot(col + b[0] - nearbyPoison.col, row + b[1] - nearbyPoison.row);
        return da - db;
      });
      const chosen = valid[0];
      rat.dirX = chosen[0];
      rat.dirZ = chosen[1];
      rat.targetCol = col + chosen[0];
      rat.targetRow = row + chosen[1];
      return;
    }

    const nonReverse = valid.filter(([dx, dz]) => !(dx === -rat.dirX && dz === -rat.dirZ));
    const candidates = nonReverse.length > 0 ? nonReverse : valid;

    const straight = candidates.find(([dx, dz]) => dx === rat.dirX && dz === rat.dirZ);
    const chosen =
      straight && Math.random() < 0.58
        ? straight
        : candidates[Math.floor(Math.random() * candidates.length)];

    rat.dirX = chosen[0];
    rat.dirZ = chosen[1];
    rat.targetCol = col + chosen[0];
    rat.targetRow = row + chosen[1];
  }

  private stepVisualFx(dt: number): void {
    for (const ring of this.tunnelSpinners) {
      ring.rotation.z += dt * 1.4;
    }

    if (this.previewGroup.visible) {
      const s = 1 + Math.sin(this.elapsedSeconds * 7) * 0.06;
      this.previewCellRing.scale.setScalar(s);
    }

    if (this.flashIntensity > 0) {
      this.flashIntensity = Math.max(0, this.flashIntensity - dt * 32);
      this.flashLight.intensity = this.flashIntensity;
    }

    if (this.shakeIntensity > 0.001) {
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.4);
      const sx = (Math.random() - 0.5) * this.shakeIntensity;
      const sz = (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.set(this.baseCamPos.x + sx, this.baseCamPos.y, this.baseCamPos.z + sz);
      this.camera.lookAt(this.baseCamLook);
    } else if (this.camera.position.x !== this.baseCamPos.x) {
      this.camera.position.copy(this.baseCamPos);
      this.camera.lookAt(this.baseCamLook);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      pt.vy -= pt.gravity * dt;
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y = Math.max(0.04, pt.mesh.position.y + pt.vy * dt);
      pt.mesh.position.z += pt.vz * dt;
      const t = Math.max(0, pt.life / pt.maxLife);
      pt.mesh.scale.setScalar(Math.max(0.01, pt.scaleStart * t));
      (pt.mesh.material as THREE.MeshBasicMaterial).opacity = t;
      if (pt.life <= 0) {
        this.fxGroup.remove(pt.mesh);
        (pt.mesh.material as THREE.MeshBasicMaterial).dispose();
        this.particles.splice(i, 1);
      }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life -= dt;
      const progress = 1 - Math.max(0, sw.life / sw.maxLife);
      sw.mesh.scale.setScalar(0.3 + progress * sw.maxScale);
      (sw.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.85;
      if (sw.life <= 0) {
        this.fxGroup.remove(sw.mesh);
        (sw.mesh.material as THREE.MeshBasicMaterial).dispose();
        this.shockwaves.splice(i, 1);
      }
    }
  }

  private emitSnapshot(): void {
    let males = 0;
    let females = 0;
    let babies = 0;
    let pregnant = 0;
    let sterile = 0;
    let infected = 0;

    for (const r of this.rats) {
      if (r.dyingTimer > 0) continue;
      if (r.infected) infected += 1;
      if (r.isBaby) {
        babies += 1;
      } else if (r.sex === 'M') {
        males += 1;
      } else {
        females += 1;
        if (r.pregnantTimer > 0) pregnant += 1;
        if (r.sterile) sterile += 1;
      }
    }

    const regenProgress = emptyBaseNumbers(0);
    for (const t of BASE_TOOL_ORDER) {
      if (this.maxInventory[t] > 0 && this.inventory[t] < this.maxInventory[t] && this.regenSec[t] > 0) {
        regenProgress[t] = Math.min(1, this.regenTimers[t] / this.regenSec[t]);
      }
    }

    const objectiveMode = this.getObjectiveMode();
    const targetDurationSec = this.getTargetDurationSec();
    const targetKills = this.getTargetKills();
    const totalRats = males + females + babies;
    const survivalRemainingSec =
      objectiveMode === 'survival' ? Math.max(0, targetDurationSec - this.elapsedSeconds) : undefined;

    this.onSnapshot({
      levelId: this.level.id,
      levelName: this.level.name,
      biome: this.level.biome,
      difficulty: this.difficulty,
      objectiveMode,
      targetDurationSec: objectiveMode === 'survival' ? targetDurationSec : undefined,
      targetKills: objectiveMode === 'target_kills' ? targetKills : undefined,
      survivalRemainingSec,
      score: this.computeRunScore(totalRats),
      isCommunity: this.level.isCommunity,
      communityId: this.level.communityId,
      status: this.status,
      males,
      females,
      babies,
      pregnant,
      sterile,
      infected,
      totalRats,
      criticalLimit: this.effectiveCriticalLimit,
      eliminatedCount: this.eliminatedCount,
      babiesEliminatedCount: this.babiesEliminatedCount,
      bornCount: this.bornCount,
      elapsedSeconds: this.elapsedSeconds,
      regenSpeedBonus: this.getRegenSpeedMultiplier(),
      inventory: { ...this.inventory },
      maxInventory: { ...this.maxInventory },
      regenProgress,
      selectedTool: this.selectedTool,
      speedMultiplier: this.speedMultiplier,
      baseRewardCredits: this.baseRewardCredits,
      currentRewardCredits: this.getCurrentRewardCredits(),
      canPan: this.canPan,
      mobileFitMode: this.mobileFitMode,
      lossReason: this.lossReason || undefined,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.unbindEvents();
    soundEngine.setDangerIntensity(0);

    this.biomeVisuals?.dispose();
    this.contactShadowTex.dispose();
    this.particleGeo.dispose();
    this.shockwaveGeo.dispose();
    this.hazardGeo.dispose();
    this.previewCellMat.dispose();
    this.previewAoeMat.dispose();
    this.previewCrossMat.dispose();

    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
