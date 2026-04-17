import { useMemo } from "react";
import { BatteryCharging, Factory, Gem, Pickaxe, Skull, TreePine, UserCheck, Wheat } from "lucide-react";
import type { PlayerState } from "../types";
import { short } from "../lib/gameUtils";

type Props = {
  players: PlayerState[];
  host: string;
  round: number;
  statusLabel: string;
  victoryAlloyTarget: number | null;
  /** LM ticket held but not yet on GameCore roster — hint to join from lobby. */
  viewerNeedsGameCoreJoin?: boolean;
  onBack: () => void;
};

const ACCENTS = {
  food: "#ffd369",
  wood: "#5bff9d",
  stone: "#96b7ff",
  ore: "#ff9f6e",
  energy: "#56f0ff",
  alloy: "#e0b0ff"
} as const;

function ResChip({
  icon: Icon,
  value,
  accent,
  title
}: {
  icon: typeof Wheat;
  value: number;
  accent: string;
  title: string;
}) {
  return (
    <span className="spectator-res-chip" style={{ borderColor: `${accent}55` }} title={title}>
      <Icon size={18} color={accent} aria-hidden />
      <strong>{value}</strong>
    </span>
  );
}

export function SpectatorPlayersPanel({
  players,
  host,
  round,
  statusLabel,
  victoryAlloyTarget,
  viewerNeedsGameCoreJoin,
  onBack
}: Props) {
  const sorted = useMemo(() => {
    const h = host.toLowerCase();
    return [...players].sort((a, b) => {
      if (a.address.toLowerCase() === h) return -1;
      if (b.address.toLowerCase() === h) return 1;
      return a.address.localeCompare(b.address);
    });
  }, [players, host]);

  return (
    <div className="spectator-sidebar-inner">
      <div className="spectator-sidebar-head">
        <h2>Spectator</h2>
        <p className="spectator-meta">
          {statusLabel} · Round <strong>{round}</strong>
          {victoryAlloyTarget != null ? (
            <>
              {" "}
              · Win at <strong>{victoryAlloyTarget}</strong> alloy
            </>
          ) : null}
        </p>
        <button type="button" className="spectator-back" onClick={onBack}>
          ← Lobbies
        </button>
      </div>

      <p className="spectator-hint">
        {viewerNeedsGameCoreJoin
          ? "You have a lobby ticket but are not on the game roster yet — go back to lobbies and complete join / sync."
          : "Read-only view — use a wallet with a ticket to play."}
      </p>

      <div className="spectator-players-scroll">
        {sorted.length === 0 ? (
          <p className="selected-text">No player roster yet.</p>
        ) : (
          sorted.map((player) => {
            const active = player.alive !== false;
            const isHost = player.address.toLowerCase() === host.toLowerCase();
            return (
              <div
                key={player.address}
                className={`spectator-player-card ${active ? "spectator-player-card--active" : "spectator-player-card--out"}`}
              >
                <div className="spectator-player-head">
                  <div>
                    <strong className="spectator-player-name">{player.nickname || short(player.address)}</strong>
                    <p className="spectator-player-addr">
                      {short(player.address)}
                      {isHost ? " · host" : ""}
                    </p>
                  </div>
                  <span className={`spectator-status-pill ${active ? "spectator-status-pill--live" : "spectator-status-pill--out"}`}>
                    {active ? (
                      <>
                        <UserCheck size={12} /> Active
                      </>
                    ) : (
                      <>
                        <Skull size={12} /> Out
                      </>
                    )}
                  </span>
                </div>
                <div className="spectator-resources-row" aria-label="Resources">
                  <ResChip icon={Wheat} value={player.resources.food} accent={ACCENTS.food} title="Food" />
                  <ResChip icon={TreePine} value={player.resources.wood} accent={ACCENTS.wood} title="Wood" />
                  <ResChip icon={Pickaxe} value={player.resources.stone} accent={ACCENTS.stone} title="Stone" />
                  <ResChip icon={Gem} value={player.resources.ore} accent={ACCENTS.ore} title="Ore" />
                  <ResChip icon={BatteryCharging} value={player.resources.energy} accent={ACCENTS.energy} title="Energy" />
                  <ResChip icon={Factory} value={player.craftedGoods ?? 0} accent={ACCENTS.alloy} title="Alloy" />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
