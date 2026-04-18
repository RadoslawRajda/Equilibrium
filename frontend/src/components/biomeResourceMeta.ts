import { Gem, Pickaxe, TreePine, Wheat } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { HexTile } from "../types";

export type BiomeResourceMetadata = {
  label: string;
  color: string;
  Icon: LucideIcon;
};

export const biomeResourceMeta: Record<HexTile["biome"], BiomeResourceMetadata> = {
  Plains: { label: "food", color: "#ffd369", Icon: Wheat },
  Forest: { label: "wood", color: "#5bff9d", Icon: TreePine },
  Mountains: { label: "stone", color: "#96b7ff", Icon: Pickaxe },
  Desert: { label: "ore", color: "#ff9f6e", Icon: Gem }
};
