import type { ResourceKey, TradeOfferView } from "../types";

const ZERO = "0x0000000000000000000000000000000000000000";

const RK: ResourceKey[] = ["food", "wood", "stone", "ore", "energy"];

export function formatTradePile(r: Record<ResourceKey, number>): string {
  const parts = RK.map((k) => (r[k] > 0 ? `${r[k]} ${k}` : null)).filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
}

export function tradeOfferSearchBlob(o: TradeOfferView): string {
  return [
    String(o.id),
    o.maker,
    o.taker,
    formatTradePile(o.offer),
    formatTradePile(o.request)
  ]
    .join(" ")
    .toLowerCase();
}

export function tradeMatchesQuery(o: TradeOfferView, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return tradeOfferSearchBlob(o).includes(s);
}

/** `effectiveRoundIndex`: same projection as UI round (wall clock when running), not only stale chain read. */
export function canPlayerAcceptOffer(
  o: TradeOfferView,
  effectiveRoundIndex: number,
  viewer: string | undefined
): boolean {
  if (o.accepted) return false;
  if (effectiveRoundIndex > o.expiresAtRound) return false;
  if (!viewer) return false;
  if (viewer.toLowerCase() === o.maker.toLowerCase()) return false;
  const t = o.taker?.toLowerCase?.() ?? "";
  if (t !== ZERO.toLowerCase() && t !== viewer.toLowerCase()) return false;
  return true;
}

export function partitionTradeOffers(offers: TradeOfferView[], effectiveRoundIndex: number) {
  const active: TradeOfferView[] = [];
  const history: TradeOfferView[] = [];
  for (const o of offers) {
    const expired = !o.accepted && effectiveRoundIndex > o.expiresAtRound;
    if (o.accepted || expired) history.push(o);
    else active.push(o);
  }
  active.sort((a, b) => a.id - b.id);
  history.sort((a, b) => b.id - a.id);
  return { active, history };
}
