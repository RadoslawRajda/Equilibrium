/**
 * Wall-clock projection for running matches — mirrors `GameCore._syncRoundFromTimestamp`
 * (skipped rounds from `roundEndsAt` + duration), so the UI shows correct round + countdown
 * even before the next on-chain transaction refreshes state.
 */
export type RunningRoundClockInput = {
  chainRoundIndex: number;
  /** `getLobbyRound` → `roundEndsAt` (unix seconds). */
  roundEndsAt: number;
  /** `getLobbyRound` → `roundDurationSeconds`. */
  durationSeconds: number;
  nowSec: number;
};

export type RunningRoundClockResult = {
  /** Display round index after applying the same skip math as the contract would on the next tx. */
  logicalRoundIndex: number;
  /** End of the current logical tick; countdown = max(0, this − nowSec). */
  nextDeadlineSec: number;
};

export function projectRunningRoundClock(input: RunningRoundClockInput): RunningRoundClockResult {
  const { chainRoundIndex: R, roundEndsAt: E, durationSeconds: D, nowSec: now } = input;
  if (D <= 0 || E <= 0) {
    return { logicalRoundIndex: R, nextDeadlineSec: E };
  }
  if (now < E) {
    return { logicalRoundIndex: R, nextDeadlineSec: E };
  }
  const elapsedFromEnd = now - E;
  const skipped = Math.floor(elapsedFromEnd / D) + 1;
  const logicalRoundIndex = R + skipped;
  const nextDeadlineSec = E + skipped * D;
  return { logicalRoundIndex, nextDeadlineSec };
}
