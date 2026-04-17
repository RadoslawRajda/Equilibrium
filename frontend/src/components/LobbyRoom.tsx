import { motion } from "framer-motion";
import { ArrowLeft, LogOut, Play, TicketX, Wallet } from "lucide-react";
import type { LobbyState } from "../types";

type Props = {
  address?: string;
  lobby: LobbyState;
  isHost: boolean;
  hasTicket: boolean;
  canStart: boolean;
  onBuyTicket: () => void;
  onStart: () => void;
  onCancel: () => void;
  onBack: () => void;
  onDisconnect: () => void;
};

const short = (address?: string) => (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "?");

export function LobbyRoom({
  address,
  lobby,
  isHost,
  hasTicket,
  canStart,
  onBuyTicket,
  onStart,
  onCancel,
  onBack,
  onDisconnect
}: Props) {
  return (
    <div className="lobby-shell lobby-room-shell">
      <header className="lobby-room-header">
        <button className="ghost-button" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <div>
          <h1>{lobby.name}</h1>
          <p>
            Lobby #{lobby.id} • {lobby.status} • {lobby.players.length} players • prize pool {lobby.prizePool ? `${lobby.prizePool} ETH` : "0 ETH"}
          </p>
        </div>
      </header>

      <div className="wallet-strip">
        <Wallet size={18} />
        <span>{address ? short(address) : "No wallet connected"}</span>
        <button onClick={onDisconnect}>
          <LogOut size={16} /> Disconnect
        </button>
      </div>

      <section className="lobby-actions">
        {!hasTicket && (
          <motion.button whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.04 }} onClick={onBuyTicket}>
            <TicketX size={18} /> Buy ticket 0.05 ETH
          </motion.button>
        )}
        {isHost && (
          <>
            <motion.button whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.04 }} onClick={onStart} disabled={!canStart}>
              <Play size={18} /> Start
            </motion.button>
            <motion.button whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.04 }} className="danger" onClick={onCancel}>
              Cancel lobby
            </motion.button>
          </>
        )}
      </section>

      <section className="lobby-list">
        <h2>Players</h2>
        {lobby.players.length === 0 && <p>No players yet.</p>}
        {lobby.players.map((player) => (
          <motion.div key={player.address} className="lobby-card" whileHover={{ y: -2 }}>
            <div>
              <h3>{player.nickname}</h3>
              <p>{short(player.address)} {player.address.toLowerCase() === lobby.host.toLowerCase() ? "• host" : ""}</p>
            </div>
            <span>{player.hasTicket ? "ticket" : "no ticket"}</span>
          </motion.div>
        ))}
      </section>
    </div>
  );
}
