import { motion } from "framer-motion";
import { PlusCircle, Wallet } from "lucide-react";
import { useState } from "react";

type LobbySummary = {
  id: string;
  name: string;
  status: string;
  playerCount: number;
  host: string;
  prizePool?: string;
};

type Props = {
  address?: string;
  lobbies: LobbySummary[];
  creating: boolean;
  onCreate: (radius: number) => void;
  onOpen: (lobbyId: string) => void;
  onDisconnect: () => void;
  deployHint?: string | null;
};

export function Lobby({ address, lobbies, creating, onCreate, onOpen, onDisconnect, deployHint }: Props) {
  const [radius, setRadius] = useState(4);

  return (
    <div className="lobby-shell">
      <header>
        <h1>Equilibrium</h1>
        <p>Strategic economy game with an AI Game Master</p>
      </header>

      <div className="wallet-strip">
        <Wallet size={18} />
        <span>{address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "No wallet connected"}</span>
        <button onClick={onDisconnect}>Disconnect</button>
      </div>

      {deployHint ? <p className="error-banner">{deployHint}</p> : null}

      <section className="lobby-actions">
        <label className="lobby-radius-picker">
          <span>Map radius</span>
          <select value={radius} onChange={(event) => setRadius(Number(event.target.value))}>
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={5}>5</option>
            <option value={6}>6</option>
          </select>
        </label>
        <motion.button whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.04 }} onClick={() => onCreate(radius)} disabled={creating}>
          <PlusCircle size={18} /> New Lobby
        </motion.button>
      </section>

      <section className="lobby-list">
        <h2>Active Lobbies</h2>
        {lobbies.length === 0 && <p>No open games.</p>}
        {lobbies.map((lobby) => (
          <motion.div key={lobby.id} className="lobby-card" whileHover={{ y: -4 }}>
            <div>
              <h3>{lobby.name}</h3>
              <p>{lobby.playerCount} players • {lobby.status} • prize pool {lobby.prizePool ?? "0"} ETH</p>
            </div>
            <button onClick={() => onOpen(lobby.id)}>Open</button>
          </motion.div>
        ))}
      </section>
    </div>
  );
}
