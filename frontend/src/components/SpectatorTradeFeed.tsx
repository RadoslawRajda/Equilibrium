import { ArrowRightLeft } from "lucide-react";

import type { TradeFeedItem } from "../lib/tradeActivityFeed";

type Props = {
  items: TradeFeedItem[];
  loading?: boolean;
};

export function SpectatorTradeFeed({ items, loading }: Props) {
  return (
    <div className="spectator-trade-feed">
      <h3 className="spectator-trade-feed-title">
        <ArrowRightLeft size={16} aria-hidden />
        Trades & bank
      </h3>
      {loading ? (
        <p className="spectator-trade-feed-muted">Loading activity…</p>
      ) : items.length === 0 ? (
        <p className="spectator-trade-feed-muted">No bank or player trades in this lobby yet.</p>
      ) : (
        <ul className="spectator-trade-feed-list">
          {items.map((row) => (
            <li key={row.id} className="spectator-trade-feed-line">
              {row.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
