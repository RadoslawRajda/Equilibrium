import { canPayResources, type ResourcePouch } from "./snapshot.js";

const BASICS = ["food", "wood", "stone", "ore"] as const;
export type BasicResourceKey = (typeof BASICS)[number];

/**
 * When basics are skewed and other players exist, suggests an open-market barter
 * (surplus → shortage) so agents actually post trades instead of only banking/collecting.
 */
export function computeRebalanceTradeDraft(
  resources: ResourcePouch,
  hasPeers: boolean,
  roundIsRunning: boolean
): {
  surplus: BasicResourceKey;
  shortage: BasicResourceKey;
  offer: ResourcePouch;
  request: ResourcePouch;
  expiryRounds: number;
} | null {
  if (!roundIsRunning || !hasPeers) return null;

  let maxK: BasicResourceKey = "food";
  let minK: BasicResourceKey = "food";
  let maxV = -1;
  let minV = Number.POSITIVE_INFINITY;
  for (const k of BASICS) {
    const v = resources[k];
    if (v > maxV) {
      maxV = v;
      maxK = k;
    }
    if (v < minV) {
      minV = v;
      minK = k;
    }
  }
  if (maxK === minK) return null;
  const spread = maxV - minV;
  // Enough gap to justify a player trade; spare stock on the high line
  if (spread < 16 || maxV < 24) return null;

  const offerAmt = Math.min(52, Math.max(8, Math.floor(spread / 2)));
  const requestAmt = Math.min(40, Math.max(5, Math.floor(offerAmt * 0.4)));

  const offer: ResourcePouch = { food: 0, wood: 0, stone: 0, ore: 0, energy: 0 };
  const request: ResourcePouch = { food: 0, wood: 0, stone: 0, ore: 0, energy: 0 };
  offer[maxK] = offerAmt;
  request[minK] = requestAmt;

  if (!canPayResources(resources, offer)) return null;

  return {
    surplus: maxK,
    shortage: minK,
    offer,
    request,
    expiryRounds: 8
  };
}
