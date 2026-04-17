export type Map3dAssetKey =
  | "tile.Plains"
  | "tile.Forest"
  | "tile.Mountains"
  | "tile.Desert"
  | "structure.level1"
  | "structure.level2";

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
  "structure.level1": {
    // Keep empty to use procedural fallback until structure assets arrive.
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  },
  "structure.level2": {
    // Keep empty to use procedural fallback until structure assets arrive.
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  }
};

export const BIOME_ASSET_KEY: Record<"Plains" | "Forest" | "Mountains" | "Desert", Map3dAssetKey> = {
  Plains: "tile.Plains",
  Forest: "tile.Forest",
  Mountains: "tile.Mountains",
  Desert: "tile.Desert"
};
