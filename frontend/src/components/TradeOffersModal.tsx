import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, Search, X } from "lucide-react";

import { TradeOfferCard } from "./TradeOfferCard";
import { canPlayerAcceptOffer, tradeMatchesQuery } from "../lib/tradeOfferDisplay";
import type { TradeOfferView } from "../types";

type Props = {
  open: boolean;
  onClose: () => void;
  offers: TradeOfferView[];
  /** Logical round (projected); used for expiry + accept eligibility. */
  currentRoundIndex: number;
  viewerAddress?: string;
  shortAddr: (a?: string) => string;
  onAccept: (tradeId: number) => void;
  acceptPending?: boolean;
};

export function TradeOffersModal({
  open,
  onClose,
  offers,
  currentRoundIndex,
  viewerAddress,
  shortAddr,
  onAccept,
  acceptPending
}: Props) {
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const filtered = useMemo(
    () => [...offers].filter((o) => tradeMatchesQuery(o, q)).sort((a, b) => a.id - b.id),
    [offers, q]
  );

  if (!open) return null;

  const node = (
    <div
      className="trade-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="trade-modal-panel" role="dialog" aria-modal="true" aria-labelledby="trade-offers-title">
        <div className="modal-header">
          <h3 id="trade-offers-title" className="trade-modal-title">
            <ArrowRightLeft size={22} aria-hidden /> Trading offers
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <p className="trade-modal-lede">
          Maker locks <strong>offer</strong>; you pay <strong>request</strong> to accept. Open = anyone can take unless a specific
          address is set.
        </p>
        <label className="trade-modal-search">
          <Search size={17} aria-hidden />
          <input
            type="search"
            placeholder="Search id, address, food, ore…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </label>
        <div className="trade-modal-list">
          {filtered.length === 0 ? (
            <p className="selected-text">{offers.length === 0 ? "No trades in this lobby yet." : "No offers match your search."}</p>
          ) : (
            filtered.map((o) => (
              <TradeOfferCard
                key={o.id}
                offer={o}
                effectiveRoundIndex={currentRoundIndex}
                shortAddr={shortAddr}
                variant="player"
                showAccept={canPlayerAcceptOffer(o, currentRoundIndex, viewerAddress)}
                acceptPending={acceptPending}
                onAccept={onAccept}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
