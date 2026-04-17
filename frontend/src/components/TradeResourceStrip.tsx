import { BatteryCharging, Gem, Pickaxe, TreePine, Wheat } from "lucide-react";

import type { ResourceKey } from "../types";

const RES: { key: ResourceKey; Icon: typeof Wheat; accent: string }[] = [
  { key: "food", Icon: Wheat, accent: "#ffd369" },
  { key: "wood", Icon: TreePine, accent: "#5bff9d" },
  { key: "stone", Icon: Pickaxe, accent: "#96b7ff" },
  { key: "ore", Icon: Gem, accent: "#ff9f6e" },
  { key: "energy", Icon: BatteryCharging, accent: "#56f0ff" }
];

type Props = {
  resources: Record<ResourceKey, number>;
  /** Default 13 (spectator); use 15–16 in modals for readability. */
  iconSize?: number;
  className?: string;
};

/** Same icon + color scheme as Your Resources / spectator trade rows. */
export function TradeResourceStrip({ resources, iconSize = 13, className }: Props) {
  const nodes = RES.map(({ key, Icon, accent }) => {
    const n = resources[key];
    if (n <= 0) return null;
    return (
      <span key={key} className="spectator-trade-chip" title={key}>
        <Icon size={iconSize} color={accent} strokeWidth={2.2} aria-hidden />
        <span className="spectator-trade-chip__n">{n}</span>
      </span>
    );
  });
  const any = nodes.some(Boolean);
  return (
    <div className={`spectator-trade-strip ${className ?? ""}`.trim()} aria-label="Resources">
      {any ? nodes : <span className="spectator-trade-strip__empty">—</span>}
    </div>
  );
}
