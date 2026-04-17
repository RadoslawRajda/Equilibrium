import type { HexTile } from "../types";

export type BiomeName = HexTile["biome"];

export type SpawnRange = {
  min: number;
  max: number;
};

export type PropAssetRef = {
  /** Stable ID for this prop kind (used for filtering/removal rules). */
  id: string;
  /** GLTF/GLB URL for the prop mesh. */
  url: string;
  /**
   * If true, use `MAP_3D_SHARED_PROP_TEXTURE.url` unless `textureUrl` is provided.
   * Useful when many props share one atlas/texture.
   */
  useSharedTexture?: boolean;
  /** Optional per-prop override texture URL. */
  textureUrl?: string;
};

export type PropSpawnRule = {
  asset: PropAssetRef;
  /** Relative spawn chance for weighted random selection in a biome. */
  weight: number;
  /** How many copies of this prop may appear on one tile. */
  quantity: SpawnRange;
  /** Radial placement bounds from tile center in local tile space. */
  radialPlacement: {
    minRadius: number;
    maxRadius: number;
  };
  /**
   * Safety ring around structure position that should stay clear.
   * This makes it easier to add a house/city later.
   */
  keepOutRadiusFromStructure?: number;
  /** Per-instance random Y rotation range (degrees). */
  randomYawDeg?: SpawnRange;
  /** Uniform random scale range. */
  randomScale?: SpawnRange;
  /** Small vertical offset if needed for model pivots. */
  yOffset?: number;
  /**
   * Tag props for future culling behavior. Example tags: foliage, grass, rock.
   */
  tags?: string[];
  /**
   * If set, this prop can be automatically removed when structure reaches these levels.
   */
  removeOnStructureLevel?: Array<1 | 2>;
};

export type BiomePropSet = {
  /** Optional tile-level cap for all generated prop instances on one hex. */
  maxInstancesPerTile?: number;
  rules: PropSpawnRule[];
};

/** One shared texture for tile props (as requested). */
export const MAP_3D_SHARED_PROP_TEXTURE = {
  // Replace when artist delivers the shared texture atlas/file.
  url: "/assets/props/props_shared.png"
} as const;

/** Current delivered biome texture atlases (separate per folder). */
const FOREST_PROP_TEXTURE_URL = "/assets/forest/Forest_props.png";
const DESERT_PROP_TEXTURE_URL = "/assets/desert/Desert_props.png";

/**
 * Master biome prop config.
 *
 * - Add new props by appending to biome `rules`.
 * - Set `useSharedTexture: true` on props that use the shared texture.
 * - Control quantity/placement randomness per prop rule.
 * - Use `removeOnStructureLevel` and `keepOutRadiusFromStructure` to support house/city upgrades.
 */
export const MAP_3D_BIOME_PROP_SETS: Record<BiomeName, BiomePropSet> = {
  Forest: {
    maxInstancesPerTile: 9,
    rules: [
      {
        asset: { id: "forest.tree.1", url: "/assets/forest/Tree_1.gltf", textureUrl: FOREST_PROP_TEXTURE_URL },
        weight: 12,
        quantity: { min: 1, max: 2 },
        radialPlacement: { minRadius: 0.2, maxRadius: 1.35 },
        keepOutRadiusFromStructure: 0.6,
        randomYawDeg: { min: 0, max: 360 },
        randomScale: { min: 1.84, max: 2.32 },
        tags: ["foliage", "tree"],
        removeOnStructureLevel: [1, 2]
      },
      {
        asset: { id: "forest.tree.2", url: "/assets/forest/Tree_2.gltf", textureUrl: FOREST_PROP_TEXTURE_URL },
        weight: 9,
        quantity: { min: 0, max: 2 },
        radialPlacement: { minRadius: 0.2, maxRadius: 1.4 },
        keepOutRadiusFromStructure: 0.6,
        randomYawDeg: { min: 0, max: 360 },
        randomScale: { min: 1.8, max: 2.2 },
        tags: ["foliage", "tree"],
        removeOnStructureLevel: [1, 2]
      },
      {
        asset: { id: "forest.bush.1", url: "/assets/forest/bush_1.gltf", textureUrl: FOREST_PROP_TEXTURE_URL },
        weight: 10,
        quantity: { min: 1, max: 2 },
        radialPlacement: { minRadius: 0.2, maxRadius: 1.4 },
        keepOutRadiusFromStructure: 0.48,
        randomYawDeg: { min: 0, max: 360 },
        randomScale: { min: 0.88, max: 1.12 },
        tags: ["foliage", "bush"],
        removeOnStructureLevel: [1, 2]
      },
      {
        asset: { id: "forest.plant.1", url: "/assets/forest/plant_1.gltf", textureUrl: FOREST_PROP_TEXTURE_URL },
        weight: 14,
        quantity: { min: 2, max: 4 },
        radialPlacement: { minRadius: 0.15, maxRadius: 1.45 },
        keepOutRadiusFromStructure: 0.4,
        randomYawDeg: { min: 0, max: 360 },
        randomScale: { min: 0.9, max: 1.18 },
        tags: ["foliage", "plant", "grass"],
        removeOnStructureLevel: [1, 2]
      }
    ]
  },
  Plains: {
    // Pending artist delivery for plains props.
    maxInstancesPerTile: 0,
    rules: []
  },
  Desert: {
    maxInstancesPerTile: 8,
    rules: [
      {
        asset: { id: "desert.cactus.1", url: "/assets/desert/cactus_1.gltf", textureUrl: DESERT_PROP_TEXTURE_URL },
        weight: 9,
        quantity: { min: 1, max: 2 },
        radialPlacement: { minRadius: 0.25, maxRadius: 1.35 },
        keepOutRadiusFromStructure: 0.55,
        randomYawDeg: { min: 0, max: 360 },
        randomScale: { min: 0.425, max: 0.575 },
        tags: ["cactus"],
        removeOnStructureLevel: [1, 2]
      },
      {
        asset: { id: "desert.smallCactus.1", url: "/assets/desert/small_cactus_1.gltf", textureUrl: DESERT_PROP_TEXTURE_URL }, 
        weight: 8,
        quantity: { min: 1, max: 3 },
        radialPlacement: { minRadius: 0.18, maxRadius: 1.45 },
        keepOutRadiusFromStructure: 0.5,
        randomYawDeg: { min: 0, max: 360 },
        randomScale: { min: 0.45, max: 0.6 },
        tags: ["cactus", "shrub"],
        removeOnStructureLevel: [1, 2]
      },
      {
        asset: { id: "desert.rocks.1", url: "/assets/desert/desert_rocks_1.gltf", textureUrl: DESERT_PROP_TEXTURE_URL },
        weight: 7,
        quantity: { min: 1, max: 3 },
        radialPlacement: { minRadius: 0.15, maxRadius: 1.45 },
        keepOutRadiusFromStructure: 0.45,
        randomYawDeg: { min: 0, max: 360 },
        randomScale: { min: 0.88, max: 1.15 },
        tags: ["rock"],
        removeOnStructureLevel: [2]
      },
      {
        asset: { id: "desert.skeleton.1", url: "/assets/desert/cow_skeleton_1.gltf", textureUrl: DESERT_PROP_TEXTURE_URL },
        weight: 3,
        quantity: { min: 0, max: 1 },
        radialPlacement: { minRadius: 0.2, maxRadius: 1.3 },
        keepOutRadiusFromStructure: 0.55,
        randomYawDeg: { min: 0, max: 360 },
        randomScale: { min: 0.9, max: 1.1 },
        tags: ["skeleton", "detail"],
        removeOnStructureLevel: [1, 2]
      }
    ]
  },
  Mountains: {
    // Pending artist delivery for mountain props.
    maxInstancesPerTile: 0,
    rules: []
  }
};

export type PropInstancePlan = {
  assetId: string;
  url: string;
  textureUrl?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  tags: string[];
};

/**
 * Optional deterministic planner for future renderer integration.
 *
 * It returns instance plans per tile biome and current structure level.
 * The same tile id + seed will always produce the same placements.
 */
export function generateTilePropPlan(
  tile: Pick<HexTile, "id" | "biome" | "structure">,
  seed = "cryptocatan-props"
): PropInstancePlan[] {
  const set = MAP_3D_BIOME_PROP_SETS[tile.biome];
  if (!set) return [];

  const out: PropInstancePlan[] = [];
  let state = hash32(`${seed}:${tile.id}:${tile.biome}`);

  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  for (const rule of set.rules) {
    const count = randomInt(rule.quantity.min, rule.quantity.max, next);
    for (let i = 0; i < count; i += 1) {
      const level = tile.structure?.level;
      if (level && rule.removeOnStructureLevel?.includes(level)) {
        continue;
      }

      const radius = lerp(rule.radialPlacement.minRadius, rule.radialPlacement.maxRadius, next());
      const angle = next() * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      if (rule.keepOutRadiusFromStructure && x * x + z * z < rule.keepOutRadiusFromStructure * rule.keepOutRadiusFromStructure) {
        continue;
      }

      const yawDeg = rule.randomYawDeg ? lerp(rule.randomYawDeg.min, rule.randomYawDeg.max, next()) : 0;
      const s = rule.randomScale ? lerp(rule.randomScale.min, rule.randomScale.max, next()) : 1;
      out.push({
        assetId: rule.asset.id,
        url: rule.asset.url,
        textureUrl: rule.asset.textureUrl ?? (rule.asset.useSharedTexture ? MAP_3D_SHARED_PROP_TEXTURE.url : undefined),
        position: [x, rule.yOffset ?? 0, z],
        rotation: [0, (yawDeg * Math.PI) / 180, 0],
        scale: [s, s, s],
        tags: rule.tags ?? []
      });
    }
  }

  if (set.maxInstancesPerTile && out.length > set.maxInstancesPerTile) {
    return out.slice(0, set.maxInstancesPerTile);
  }

  return out;
}

function randomInt(min: number, max: number, next: () => number) {
  if (max <= min) return min;
  return Math.floor(lerp(min, max + 1, next()));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function hash32(value: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
