import { ArrowRight, Clock, User } from "lucide-react";

import { TradeResourceStrip } from "./TradeResourceStrip";
import type { TradeOfferView } from "../types";

const ZERO = "0x0000000000000000000000000000000000000000";

export function tradeOfferStatus(
  o: TradeOfferView,
  effectiveRoundIndex: number
): "open" | "expired" | "accepted" {
  if (o.accepted) return "accepted";
  if (effectiveRoundIndex > o.expiresAtRound) return "expired";
  return "open";
}

type Props = {
  offer: TradeOfferView;
  effectiveRoundIndex: number;
  shortAddr: (a?: string) => string;
  /** Player modal: escrow wording; spectator: neutral */
  variant: "player" | "spectator";
  showAccept?: boolean;
  acceptPending?: boolean;
  onAccept?: (id: number) => void;
};

export function TradeOfferCard({
  offer: o,
  effectiveRoundIndex,
  shortAddr,
  variant,
  showAccept,
  acceptPending,
  onAccept
}: Props) {
  const status = tradeOfferStatus(o, effectiveRoundIndex);
  const openToAll = !o.taker || o.taker.toLowerCase() === ZERO.toLowerCase();
  const offerLabel = variant === "player" ? "They offer" : "Gives";
  const requestLabel = variant === "player" ? "You pay" : "Wants";

  return (
    <div
      className={`trade-offer-card trade-offer-card--${variant}`}
      data-status={status}
      style={{
        opacity: status === "accepted" ? 0.85 : 1,
        borderColor: status === "expired" ? "rgba(255, 125, 125, 0.35)" : undefined
      }}
    >
      <div className="trade-offer-card__head">
        <div>
          <strong className="trade-offer-card__id">#{o.id}</strong>{" "}
          <span className="trade-offer-card__maker">
            <User size={14} aria-hidden />
            {shortAddr(o.maker)}
          </span>
        </div>
        <span className={`trade-offer-card__pill trade-offer-card__pill--${status}`}>
          {status === "accepted" ? "Accepted" : status === "expired" ? "Expired" : "Open"}
        </span>
      </div>
      <p className="trade-offer-card__meta">
        {openToAll ? (
          <>
            <strong>Open to:</strong> anyone
          </>
        ) : (
          <>
            <strong>For:</strong> {shortAddr(o.taker)}
          </>
        )}
      </p>
      <div className="trade-flow trade-flow--strip">
        <div className="trade-pile trade-pile--strip">
          <div className="trade-pile__label">{offerLabel}</div>
          <TradeResourceStrip resources={o.offer} iconSize={15} />
        </div>
        <div className="trade-arrow-cell" aria-hidden>
          <ArrowRight size={22} strokeWidth={2.25} />
        </div>
        <div className="trade-pile trade-pile--strip">
          <div className="trade-pile__label">{requestLabel}</div>
          <TradeResourceStrip resources={o.request} iconSize={15} />
        </div>
      </div>
      <div className="trade-offer-card__rounds">
        <Clock size={15} aria-hidden />
        <span>
          r<strong>{o.createdAtRound}</strong> → expires r<strong>{o.expiresAtRound}</strong>
          <span className="trade-offer-card__now"> · now r{effectiveRoundIndex}</span>
        </span>
      </div>
      {showAccept && onAccept ? (
        <button
          type="button"
          className="trade-offer-card__accept"
          disabled={acceptPending}
          onClick={() => onAccept(o.id)}
        >
          Accept #{o.id}
        </button>
      ) : null}
    </div>
  );
}
