import { useMemo } from "react";
import { ArrowRight, ArrowRightLeft } from "lucide-react";

import { TradeResourceStrip } from "./TradeResourceStrip";
import { partitionTradeOffers } from "../lib/tradeOfferDisplay";
import type { TradeOfferView } from "../types";

type Props = {
  offers: TradeOfferView[];
  /** Logical round (projected from wall clock when running), not only last chain hydrate. */
  effectiveRoundIndex: number;
  shortAddr: (a?: string) => string;
};

function MinimalTradeRow({ o, shortAddr }: { o: TradeOfferView; shortAddr: (a?: string) => string }) {
  return (
    <div className="spectator-trade-row">
      <div className="spectator-trade-row__meta">
        <span className="spectator-trade-row__id">#{o.id}</span>
        <span className="spectator-trade-row__who">{shortAddr(o.maker)}</span>
        <span className="spectator-trade-row__exp">≤r{o.expiresAtRound}</span>
      </div>
      <div className="spectator-trade-row__flow">
        <TradeResourceStrip resources={o.offer} />
        <ArrowRight className="spectator-trade-row__arrow" size={16} aria-hidden />
        <TradeResourceStrip resources={o.request} />
      </div>
    </div>
  );
}

export function SpectatorOnChainTrades({ offers, effectiveRoundIndex, shortAddr }: Props) {
  const active = useMemo(() => partitionTradeOffers(offers, effectiveRoundIndex).active, [offers, effectiveRoundIndex]);

  return (
    <div className="spectator-onchain-trades spectator-onchain-trades--minimal">
      <div className="spectator-onchain-trades__head">
        <h3 className="spectator-onchain-trades__title">
          <ArrowRightLeft size={15} aria-hidden />
          Open trades
        </h3>
        <span className="spectator-onchain-trades__badge">{active.length}</span>
      </div>

      {active.length === 0 ? (
        <p className="spectator-onchain-trades__empty">None</p>
      ) : (
        <div className="spectator-onchain-trades__list">
          {active.map((o) => (
            <MinimalTradeRow key={o.id} o={o} shortAddr={shortAddr} />
          ))}
        </div>
      )}
    </div>
  );
}
