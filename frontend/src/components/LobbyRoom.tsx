import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Bot, LogOut, Play, TicketX, UserMinus, Wallet, X } from "lucide-react";
import type { LobbyState, PlayerState } from "../types";
import { short } from "../lib/gameUtils";
import { LobbyAgentInvitePanel } from "./LobbyAgentInvitePanel";

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
  /** Rows from `ERC8004PlayerAgentRegistry.listAgents` (on-chain). */
  registeredAgents?: { address: string; name: string; identity?: string }[];
  /** Last RPC / ABI error when reading the on-chain registry (if any). */
  chainRegistryAgentsError?: string | null;
  inviteUses4337?: boolean;
  onInviteAgent?: (agentAddress: string) => void | Promise<void>;
  inviteAgentPending?: boolean;
  /** Host removes a non-host from OPEN lobby; same refund path as voluntary leave (`playerBalance` + `withdraw`). */
  onKickPlayer?: (playerAddress: string) => void | Promise<void>;
  /** Lowercased address currently being kicked (tx in flight), or null. */
  kickPlayerPendingAddress?: string | null;
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
  chainRegistryAgentsError = null,
  inviteUses4337 = false,
  onInviteAgent,
  inviteAgentPending = false,
  onKickPlayer,
  kickPlayerPendingAddress = null
}: Props) {
  const [kickConfirmPlayer, setKickConfirmPlayer] = useState<PlayerState | null>(null);

  useEffect(() => {
    if (!kickConfirmPlayer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setKickConfirmPlayer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kickConfirmPlayer]);

  useEffect(() => {
    if (lobby.status !== "waiting") setKickConfirmPlayer(null);
  }, [lobby.status]);

  const canHostKick =
    Boolean(isHost && onKickPlayer && lobby.status === "waiting");
  const registryByAddress = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of registeredAgents) {
      m.set(a.address.toLowerCase(), a.name);
    }
    return m;
  }, [registeredAgents]);

  const kickModal =
    kickConfirmPlayer && onKickPlayer
      ? createPortal(
          <div
            className="trade-modal-backdrop"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setKickConfirmPlayer(null);
            }}
          >
            <div
              className="modal-panel lobby-kick-modal-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lobby-kick-confirm-title"
            >
              <div className="modal-header">
                <h3 id="lobby-kick-confirm-title" className="trade-modal-title">
                  <UserMinus size={22} aria-hidden /> Remove from lobby
                </h3>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setKickConfirmPlayer(null)}
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="trade-modal-lede">
                Remove <strong>{kickConfirmPlayer.nickname}</strong> ({short(kickConfirmPlayer.address)}) from the lobby?
                Their ticket share is credited on the contract (same as if they left) — they claim ETH with Withdraw.
              </p>
              <div className="lobby-kick-modal-actions">
                <button type="button" className="ghost-button" onClick={() => setKickConfirmPlayer(null)}>
                  Cancel
                </button>
                <motion.button
                  type="button"
                  className="danger"
                  whileTap={{ scale: 0.98 }}
                  whileHover={{ scale: 1.02 }}
                  disabled={Boolean(kickPlayerPendingAddress)}
                  onClick={() => {
                    void onKickPlayer(kickConfirmPlayer.address);
                    setKickConfirmPlayer(null);
                  }}
                >
                  Remove player
                </motion.button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="lobby-shell lobby-room-shell">
      <header className="lobby-room-header">
        <button className="ghost-button" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <div>
          <h1>{lobby.name}</h1>
          <p>
            Lobby #{lobby.id} • {lobby.status} • {lobby.players.length} players
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
          <motion.button whileTap={{ scale: 0.98 }} whileHover={{ scale: 1.02 }} onClick={onBuyTicket}>
            <TicketX size={18} /> Buy ticket {ticketPriceLabel} ETH
          </motion.button>
        )}
        {canLeaveLobby && onLeaveLobby ? (
          <motion.button
            whileTap={{ scale: 0.98 }}
            whileHover={{ scale: 1.02 }}
            className="danger"
            onClick={onLeaveLobby}
            disabled={leaveLobbyPending}
          >
            {leaveLobbyPending ? "Leaving…" : "Exit lobby (refund)"}
          </motion.button>
        ) : null}
        {isHost ? (
          <div className="lobby-room-start-only">
            <motion.button
              type="button"
              className="lobby-room-start-btn"
              whileTap={{ scale: 0.98 }}
              onClick={onStart}
              disabled={!canStart || starting}
            >
              <Play size={20} aria-hidden />
              {starting ? "Starting…" : "Start"}
            </motion.button>
          </div>
        ) : null}
      </section>

      {hasTicket && !isHost ? (
        <p className="selected-text" style={{ maxWidth: "42rem", marginTop: "0.5rem" }}>
          Leaving refunds your share of sponsor funds still on this contract (then use Claim ETH). Deposits already on the
          EntryPoint for AA gas are not pulled back here.
        </p>
      ) : null}

      <div className={`lobby-room-main${isHost && onInviteAgent ? " lobby-room-main--with-sidebar" : ""}`}>
        {isHost && onInviteAgent ? (
          <aside className="lobby-room-sidebar">
            <LobbyAgentInvitePanel
              agents={registeredAgents}
              registryError={chainRegistryAgentsError}
              uses4337={inviteUses4337}
              busy={inviteAgentPending}
              onInvite={onInviteAgent}
            />
          </aside>
        ) : null}
        <section className="lobby-list">
          <div className="lobby-list__head">
            <h2>Players</h2>
            {isHost ? (
              <button type="button" className="lobby-room-cancel-secondary lobby-list__cancel" onClick={onCancel}>
                Cancel lobby
              </button>
            ) : null}
          </div>
          <div className="lobby-list__body">
            {lobby.players.length === 0 && <p>No players yet.</p>}
            {lobby.players.map((player) => {
              const addrLc = player.address.toLowerCase();
              const isAgent = agentAddresses?.has(addrLc);
              const isRowHost = addrLc === lobby.host.toLowerCase();
              const kickingThis = kickPlayerPendingAddress === addrLc;
              const agentRegistryName = registryByAddress.get(addrLc);
              return (
                <div key={player.address} className="lobby-card">
                  <div>
                    <h3 style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      {isAgent ? <Bot size={18} aria-label="Registered AI agent" /> : null}
                      {player.nickname}
                    </h3>
                    {agentRegistryName ? (
                      <p className="lobby-card-agent-name" title="Name from ERC8004PlayerAgentRegistry">
                        Agent: {agentRegistryName}
                      </p>
                    ) : null}
                    <p className="lobby-card-address">{short(player.address)}</p>
                  </div>
                  <div className="lobby-card-actions">
                    {isRowHost ? <span className="lobby-host-label">Host</span> : null}
                    {canHostKick && !isRowHost && player.hasTicket && onKickPlayer ? (
                      <motion.button
                        type="button"
                        className="danger lobby-kick-btn"
                        whileTap={{ scale: 0.96 }}
                        whileHover={{ scale: 1.02 }}
                        disabled={Boolean(kickPlayerPendingAddress)}
                        aria-busy={kickingThis}
                        onClick={() => setKickConfirmPlayer(player)}
                      >
                        <UserMinus size={16} aria-hidden />
                        {kickingThis ? "Removing…" : "Remove"}
                      </motion.button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      {kickModal}
    </div>
  );
}
