export type Map3dAssetKey =
  | "tile.Plains"
  | "tile.Forest"
  | "tile.Mountains"
  | "tile.Desert"
  | "structure.Plains.level1"
  | "structure.Plains.level2"
  | "structure.Forest.level1"
  | "structure.Forest.level2"
  | "structure.Mountains.level1"
  | "structure.Mountains.level2"
  | "structure.Desert.level1"
  | "structure.Desert.level2";

export type Map3dAssetConfig = {
  /**
   * Public URL to a GLB/GLTF file. If omitted or if loading fails,
   * the renderer falls back to the procedural mesh.
   */
  url?: string;
  /**
   * Optional texture override. Useful when model geometry is shared
   * and terrain appearance comes from external PNGs.
   */
  textureUrl?: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
};

const STRUCTURE_MODEL_POSITION: [number, number, number] = [0, 0.15, 0];
const STRUCTURE_MODEL_SCALE: [number, number, number] = [2.5, 2.5, 2.5];

/**
 * Single source of truth for optional 3D asset links.
 *
 * You can replace any URL with your own hosted/local asset.
 * Missing files are handled gracefully by procedural fallback.
 */
export const MAP_3D_ASSETS: Record<Map3dAssetKey, Map3dAssetConfig> = {
  "tile.Plains": {
    url: "/assets/Hex_tile_model.gltf",
    textureUrl: "/assets/Tile_Plains_Hex.png",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  },
  "tile.Forest": {
    url: "/assets/Hex_tile_model.gltf",
    textureUrl: "/assets/Tile_Forest_Hex.png",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  },
  "tile.Mountains": {
    url: "/assets/Hex_tile_model.gltf",
    textureUrl: "/assets/Tile_Mountains_Hex.png",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  },
  "tile.Desert": {
    url: "/assets/Hex_tile_model.gltf",
    textureUrl: "/assets/Tile_Desert_Hex.png",
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  },
  "structure.Plains.level1": {
    url: "/assets/houses/plains_house_1.gltf",
    position: STRUCTURE_MODEL_POSITION,
    rotation: [0, 0, 0],
    scale: STRUCTURE_MODEL_SCALE
  },
  "structure.Plains.level2": {
    url: "/assets/houses/plains_house_2.gltf",
    position: STRUCTURE_MODEL_POSITION,
    rotation: [0, 0, 0],
    scale: STRUCTURE_MODEL_SCALE
  },
  "structure.Forest.level1": {
    url: "/assets/houses/forest_house_1.gltf",
    position: STRUCTURE_MODEL_POSITION,
    rotation: [0, 0, 0],
    scale: STRUCTURE_MODEL_SCALE
  },
  "structure.Forest.level2": {
    url: "/assets/houses/forest_house_2.gltf",
    position: STRUCTURE_MODEL_POSITION,
    rotation: [0, 0, 0],
    scale: STRUCTURE_MODEL_SCALE
  },
  "structure.Mountains.level1": {
    url: "/assets/houses/mountain_house_1.gltf",
    position: STRUCTURE_MODEL_POSITION,
    rotation: [0, 0, 0],
    scale: STRUCTURE_MODEL_SCALE
  },
  "structure.Mountains.level2": {
    url: "/assets/houses/mountain_house_2.gltf",
    position: STRUCTURE_MODEL_POSITION,
    rotation: [0, 0, 0],
    scale: STRUCTURE_MODEL_SCALE
  },
  "structure.Desert.level1": {
    url: "/assets/houses/desert_house_1.gltf",
    position: STRUCTURE_MODEL_POSITION,
    rotation: [0, 0, 0],
    scale: STRUCTURE_MODEL_SCALE
  },
  "structure.Desert.level2": {
    url: "/assets/houses/desert_house_2.gltf",
    position: STRUCTURE_MODEL_POSITION,
    rotation: [0, 0, 0],
    scale: STRUCTURE_MODEL_SCALE
  }
};

export const BIOME_ASSET_KEY: Record<"Plains" | "Forest" | "Mountains" | "Desert", Map3dAssetKey> = {
  Plains: "tile.Plains",
  Forest: "tile.Forest",
  Mountains: "tile.Mountains",
  Desert: "tile.Desert"
};

export const STRUCTURE_ASSET_KEY: Record<
  "Plains" | "Forest" | "Mountains" | "Desert",
  { level1: Map3dAssetKey; level2: Map3dAssetKey }
> = {
  Plains: {
    level1: "structure.Plains.level1",
    level2: "structure.Plains.level2"
  },
  Forest: {
    level1: "structure.Forest.level1",
    level2: "structure.Forest.level2"
  },
  Mountains: {
    level1: "structure.Mountains.level1",
    level2: "structure.Mountains.level2"
  },
  Desert: {
    level1: "structure.Desert.level1",
    level2: "structure.Desert.level2"
  }
};
