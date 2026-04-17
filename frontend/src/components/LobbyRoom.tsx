import { motion } from "framer-motion";
import { ArrowLeft, Bot, LogOut, Play, TicketX, Wallet } from "lucide-react";
import { useState } from "react";
import type { LobbyState } from "../types";
import { short } from "../lib/gameUtils";

type Props = {
  address?: string;
  lobby: LobbyState;
  isHost: boolean;
  hasTicket: boolean;
  canLeaveLobby?: boolean;
  onLeaveLobby?: () => void;
  leaveLobbyPending?: boolean;
  canStart: boolean;
  starting?: boolean;
  ticketPriceLabel?: string;
  onBuyTicket: () => void;
  onStart: () => void;
  onCancel: () => void;
  onBack: () => void;
  onDisconnect: () => void;
  actionError?: string;
  /** Lowercased addresses of ERC-8004-style registered agents (from agent registry). */
  agentAddresses?: Set<string>;
  registeredAgents?: { address: string; name: string }[];
  onInviteAgent?: (agentAddress: string) => void;
  inviteAgentPending?: boolean;
};

export function LobbyRoom({
  address,
  lobby,
  isHost,
  hasTicket,
  canLeaveLobby = false,
  onLeaveLobby,
  leaveLobbyPending = false,
  canStart,
  starting = false,
  ticketPriceLabel = "5",
  onBuyTicket,
  onStart,
  onCancel,
  onBack,
  onDisconnect,
  actionError,
  agentAddresses,
  registeredAgents = [],
  onInviteAgent,
  inviteAgentPending = false
}: Props) {
  const [invitePick, setInvitePick] = useState("");
  return (
    <div className="lobby-shell lobby-room-shell">
      <header className="lobby-room-header">
        <button className="ghost-button" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <div>
          <h1>{lobby.name}</h1>
          <p>
            Lobby #{lobby.id} • {lobby.status} • {lobby.players.length} players • prize pool{" "}
            {lobby.prizePool ? `${lobby.prizePool} ETH` : "0 ETH"}
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

      {actionError ? <p className="error-banner">{actionError}</p> : null}

      <section className="lobby-actions">
        {!hasTicket && (
          <motion.button whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.04 }} onClick={onBuyTicket}>
            <TicketX size={18} /> Buy ticket {ticketPriceLabel} ETH
          </motion.button>
        )}
        {canLeaveLobby && onLeaveLobby ? (
          <motion.button
            whileTap={{ scale: 0.96 }}
            whileHover={{ scale: 1.04 }}
            className="danger"
            onClick={onLeaveLobby}
            disabled={leaveLobbyPending}
          >
            {leaveLobbyPending ? "Leaving…" : "Exit lobby (refund)"}
          </motion.button>
        ) : null}
        {isHost && registeredAgents.length > 0 && onInviteAgent ? (
          <div className="lobby-invite-agent" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <label>
              Invite AI agent
              <select
                value={invitePick}
                onChange={(e) => setInvitePick(e.target.value)}
                style={{ marginLeft: "0.5rem" }}
              >
                <option value="">—</option>
                {registeredAgents.map((a) => (
                  <option key={a.address} value={a.address}>
                    {a.name} ({short(a.address)})
                  </option>
                ))}
              </select>
            </label>
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              whileHover={{ scale: 1.04 }}
              disabled={!invitePick || inviteAgentPending}
              onClick={() => invitePick && onInviteAgent(invitePick)}
            >
              {inviteAgentPending ? "Sending…" : "Send invite"}
            </motion.button>
          </div>
        ) : null}
        {isHost && (
          <>
            <motion.button whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.04 }} onClick={onStart} disabled={!canStart || starting}>
              <Play size={18} /> {starting ? "Starting…" : "Start"}
            </motion.button>
            <motion.button whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.04 }} className="danger" onClick={onCancel}>
              Cancel lobby
            </motion.button>
          </>
        )}
      </section>

      {hasTicket && !isHost ? (
        <p className="selected-text" style={{ maxWidth: "42rem", marginTop: "0.5rem" }}>
          Exit refunds your share of the pool held on this contract (then Claim ETH). Funds already on the EntryPoint for AA gas
          are not pulled back here.
        </p>
      ) : null}

      <section className="lobby-list">
        <h2>Players</h2>
        {lobby.players.length === 0 && <p>No players yet.</p>}
        {lobby.players.map((player) => {
          const isAgent = agentAddresses?.has(player.address.toLowerCase());
          return (
            <motion.div key={player.address} className="lobby-card" whileHover={{ y: -2 }}>
              <div>
                <h3 style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  {isAgent ? <Bot size={18} aria-label="AI agent" title="Registered AI agent" /> : null}
                  {player.nickname}
                </h3>
                <p>
                  {short(player.address)} {player.address.toLowerCase() === lobby.host.toLowerCase() ? "• host" : ""}
                </p>
              </div>
              <span>{player.hasTicket ? "ticket" : "no ticket"}</span>
            </motion.div>
          );
        })}
      </section>
    </div>
  );
}
