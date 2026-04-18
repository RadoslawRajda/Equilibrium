import { motion } from "framer-motion";
import { ArrowLeft, BatteryCharging, Factory, Gem, Pickaxe, TreePine, Wheat } from "lucide-react";
import type { PlayerState } from "../types";

type Props = {
  me: PlayerState | null;
  round: number;
  effects: Array<{ id: string; label: string; remainingRounds: number }>;
  onBack?: () => void;
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

export function ResourcePanel({ me, round, effects, onBack }: Props) {
  return (
    <aside className="panel left-panel">
      {onBack && (
        <button className="ghost-button" onClick={onBack} style={{ margin: "0 0 1rem 0", width: "100%", position: "relative", justifyContent: "center", opacity: 0.8 }}>
          <ArrowLeft size={16} style={{ position: "absolute", left: "1rem" }} /> Return to Lobby
        </button>
      )}
      <h2 style={{ marginTop: onBack ? 0 : undefined }}>Your Resources</h2>
      <div className="resource-grid">
        <Item icon={Wheat} label="Food" value={me?.resources.food ?? 0} accent="#ffd369" />
        <Item icon={TreePine} label="Wood" value={me?.resources.wood ?? 0} accent="#5bff9d" />
        <Item icon={Pickaxe} label="Stone" value={me?.resources.stone ?? 0} accent="#96b7ff" />
        <Item icon={Gem} label="Ore" value={me?.resources.ore ?? 0} accent="#ff9f6e" />
        <Item icon={BatteryCharging} label="Energy" value={me?.resources.energy ?? 0} accent="#56f0ff" />
        <Item icon={Factory} label="Alloy" value={me?.craftedGoods ?? 0} accent="#e0b0ff" />
      </div>


    </aside>
  );
}
