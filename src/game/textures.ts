import * as THREE from 'three';
import type { BiomeType } from './types';

export interface BiomeVisualSet {
  floorMat: THREE.MeshStandardMaterial;
  wallMat: THREE.MeshStandardMaterial;
  surroundMat: THREE.MeshStandardMaterial;
  bgHex: number;
  fogHex: number;
  keyColor: number;
  hemiSky: number;
  hemiGround: number;
  dispose: () => void;
}

function hash2D(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function makePixelTexture(
  gridSize: number,
  paint: (x: number, y: number) => [number, number, number],
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = gridSize;
  canvas.height = gridSize;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(gridSize, gridSize);

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const [r, g, b] = paint(x, y);
      const idx = (y * gridSize + x) * 4;
      img.data[idx] = Math.max(0, Math.min(255, Math.round(r)));
      img.data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      img.data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function createBiomeVisuals(biome: BiomeType, maxAnisotropy: number): BiomeVisualSet {
  const texturesToDispose: THREE.Texture[] = [];

  // High-contrast walkable corridor tiles (matte stone paths)
  const floorMap = makePixelTexture(
    16,
    (x, y) => {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const n = hash2D(x, y, biome.length + 7);
      if (biome === 'grass') {
        // Classic Rats! gray slate corridor contrasting strongly with green grass walls
        const base = edge ? 84 : 110 + (n > 0.65 ? 8 : n < 0.25 ? -6 : 0);
        return [base, base + 2, base + 5];
      }
      if (biome === 'sand') {
        // Dark brown-slate path contrasting cleanly with warm golden sandstone walls
        const base = edge ? 68 : 92 + (n > 0.65 ? 7 : n < 0.25 ? -6 : 0);
        return [base + 4, base - 2, base - 10];
      }
      if (biome === 'city') {
        // Dark asphalt road surface contrasting cleanly with warm terracotta brick buildings
        const centerDash = (x === 7 || x === 8) && y >= 4 && y <= 11;
        if (centerDash) return [84, 90, 102];
        const base = edge ? 34 : 46 + (n > 0.7 ? 6 : n < 0.25 ? -5 : 0);
        return [base, base + 4, base + 12];
      }
      if (biome === 'ice') {
        // Deep charcoal-blue stone path contrasting sharply with pale icy walls
        const base = edge ? 48 : 66 + (n > 0.65 ? 8 : n < 0.25 ? -6 : 0);
        return [base - 4, base + 6, base + 20];
      }
      if (biome === 'moon') {
        // Deep dark basalt lunar mare trench contrasting sharply with bright cratered regolith walls
        const base = edge ? 28 : 39 + (n > 0.7 ? 7 : n < 0.25 ? -5 : 0);
        return [base, base + 5, base + 14];
      }
      // Lava: classic slate-gray path contrasting cleanly with matte red/orange rock walls
      const base = edge ? 72 : 94 + (n > 0.7 ? 8 : n < 0.25 ? -6 : 0);
      return [base, base + 2, base + 6];
    },
    maxAnisotropy,
  );
  texturesToDispose.push(floorMap);

  // Normal, non-fluorescent, classic pixel wall textures
  const wallMap = makePixelTexture(
    16,
    (x, y) => {
      const border = x === 0 || y === 0 || x === 15 || y === 15;
      const n = hash2D(x, y, biome.length * 13);

      if (biome === 'grass') {
        // Natural rich meadow green with classic flower dots (no neon)
        if (!border && ((x === 4 && y === 5) || (x === 11 && y === 11))) {
          if (n > 0.75) return [214, 72, 168]; // soft magenta flower
          if (n > 0.5) return [72, 168, 224]; // sky blue flower
          if (n > 0.25) return [240, 240, 232]; // white daisy
          return [212, 68, 52]; // red poppy
        }
        if (border) return [26, 118, 28];
        if (n > 0.72) return [52, 178, 46];
        if (n < 0.28) return [30, 136, 32];
        return [40, 158, 40];
      }

      if (biome === 'sand') {
        // Warm natural sandstone blocks
        if (border) return [164, 110, 42];
        if (y === 7 || (x === 8 && y > 7)) return [176, 122, 48];
        if (n > 0.72) return [224, 182, 96];
        if (n < 0.25) return [194, 144, 62];
        return [210, 164, 78];
      }

      if (biome === 'city') {
        // Urban terracotta-brick & concrete building blocks with miniature lit/unlit window pixels
        if (border) return [116, 62, 46];
        const winRow = (y >= 3 && y <= 5) || (y >= 10 && y <= 12);
        const winCol = (x >= 3 && x <= 5) || (x >= 10 && x <= 12);
        if (winRow && winCol) {
          return (x + y) % 3 === 0 ? [232, 206, 132] : [66, 86, 112];
        }
        if (y === 7 || y === 8) return [134, 74, 54]; // concrete floor cornice
        if (n > 0.72) return [198, 108, 72];
        if (n < 0.25) return [156, 80, 56];
        return [178, 94, 64];
      }

      if (biome === 'ice') {
        // Crisp light ice & snow blocks (strong contrast against dark slate floor)
        if (border) return [118, 172, 206];
        if ((x + y) % 9 === 0 && n > 0.4) return [236, 248, 255];
        if (n > 0.72) return [208, 236, 250];
        if (n < 0.25) return [158, 204, 232];
        return [182, 222, 244];
      }

      if (biome === 'moon') {
        // Bright silver-gray lunar regolith blocks with crater rings (strong contrast vs dark basalt paths)
        if (border) return [142, 150, 164];
        const dx = x - 7.5;
        const dy = y - 7.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= 2.8 && dist <= 4.1) return [232, 238, 246]; // crater rim highlight
        if (dist < 2.8) return [150, 158, 172]; // crater bowl shadow
        if (n > 0.72) return [214, 220, 230];
        if (n < 0.25) return [172, 180, 192];
        return [194, 202, 214];
      }

      // Lava biome: natural matte red-orange rock (NO emissive fluorescence)
      if (border) return [112, 34, 30];
      if (n > 0.88) return [226, 168, 58]; // warm ochre stone
      if (n > 0.72) return [204, 92, 42]; // terracotta orange
      if (n < 0.3) return [136, 44, 38]; // dark brick red
      return [168, 54, 46];
    },
    maxAnisotropy,
  );
  texturesToDispose.push(wallMap);

  const floorMat = new THREE.MeshStandardMaterial({
    map: floorMap,
    roughness: 0.9,
    metalness: 0.0,
  });

  const wallMat = new THREE.MeshStandardMaterial({
    map: wallMap,
    roughness: 0.88,
    metalness: 0.0,
  });

  const palette = {
    grass: {
      surround: 0x227824,
      bg: 0x1b4720,
      fog: 0x1b4720,
      key: 0xfff8eb,
      hemiSky: 0xcceeff,
      hemiGround: 0x2d542c,
    },
    sand: {
      surround: 0x9e6c2b,
      bg: 0x543a1a,
      fog: 0x543a1a,
      key: 0xfff2d6,
      hemiSky: 0xffe8bd,
      hemiGround: 0x593d1e,
    },
    city: {
      surround: 0x6b3f31,
      bg: 0x1f2532,
      fog: 0x1f2532,
      key: 0xfff3e0,
      hemiSky: 0xd9e4f5,
      hemiGround: 0x3b2c28,
    },
    ice: {
      surround: 0x5c8eb0,
      bg: 0x1e3852,
      fog: 0x1e3852,
      key: 0xf4faff,
      hemiSky: 0xd6efff,
      hemiGround: 0x2c4763,
    },
    lava: {
      surround: 0x6b2824,
      bg: 0x2e1414,
      fog: 0x2e1414,
      key: 0xffe4d1,
      hemiSky: 0xffd0ba,
      hemiGround: 0x421a18,
    },
    moon: {
      surround: 0x7b8494,
      bg: 0x0b101b,
      fog: 0x0b101b,
      key: 0xf8fafc,
      hemiSky: 0xdbeafe,
      hemiGround: 0x2c3340,
    },
  }[biome];

  const surroundMat = new THREE.MeshStandardMaterial({
    color: palette.surround,
    roughness: 0.94,
    metalness: 0.0,
  });

  return {
    floorMat,
    wallMat,
    surroundMat,
    bgHex: palette.bg,
    fogHex: palette.fog,
    keyColor: palette.key,
    hemiSky: palette.hemiSky,
    hemiGround: palette.hemiGround,
    dispose: () => {
      floorMat.dispose();
      wallMat.dispose();
      surroundMat.dispose();
      texturesToDispose.forEach((t) => t.dispose());
    },
  };
}

export function createSoftDiscTexture(innerRgba: string, outerRgba: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, innerRgba);
  grad.addColorStop(0.5, innerRgba);
  grad.addColorStop(1, outerRgba);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
