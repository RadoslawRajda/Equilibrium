import { BatteryCharging, Pickaxe, TreePine, Wheat } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { HexTile } from "../types";

export const biomeResourceMeta: Record<HexTile["biome"], { label: string; color: string; Icon: LucideIcon }> = {
  Plains: { label: "food", color: "#ffd369", Icon: Wheat },
  Forest: { label: "wood", color: "#5bff9d", Icon: TreePine },
  Mountains: { label: "stone/ore", color: "#96b7ff", Icon: Pickaxe },
  Desert: { label: "energy", color: "#56f0ff", Icon: BatteryCharging }
};
