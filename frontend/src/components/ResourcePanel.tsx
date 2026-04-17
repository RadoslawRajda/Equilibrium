import { motion } from "framer-motion";
import { BatteryCharging, Pickaxe, TreePine, UtensilsCrossed, Wheat } from "lucide-react";
import type { PlayerState } from "../types";

type Props = {
  me: PlayerState | null;
  pollution: number;
  round: number;
  effects: Array<{ id: string; label: string; remainingRounds: number }>;
};

const Item = ({ icon: Icon, label, value, accent }: { icon: any; label: string; value: number; accent: string }) => (
  <motion.div whileHover={{ scale: 1.04 }} className="resource-item" style={{ borderColor: accent }}>
    <Icon size={18} color={accent} />
    <div>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  </motion.div>
);

export function ResourcePanel({ me, pollution, round, effects }: Props) {
  return (
    <aside className="panel left-panel">
      <h2>Your Resources</h2>
      <div className="resource-grid">
        <Item icon={Wheat} label="Food" value={me?.resources.food ?? 0} accent="#ffd369" />
        <Item icon={TreePine} label="Wood" value={me?.resources.wood ?? 0} accent="#5bff9d" />
        <Item icon={Pickaxe} label="Stone" value={me?.resources.stone ?? 0} accent="#96b7ff" />
        <Item icon={UtensilsCrossed} label="Ore" value={me?.resources.ore ?? 0} accent="#ff9f6e" />
        <Item icon={BatteryCharging} label="Energy" value={me?.resources.energy ?? 0} accent="#56f0ff" />
      </div>

      <div className="status-card">
        <p>Round: <strong>{round}</strong></p>
        <p>Pollution: <strong>{pollution}%</strong></p>
      </div>

      <div className="effects-list">
        <h3>Active Effects</h3>
        {effects.length === 0 && <p>None</p>}
        {effects.map((effect) => (
          <div key={effect.id} className="effect-chip">
            {effect.label} ({effect.remainingRounds})
          </div>
        ))}
      </div>
    </aside>
  );
}
