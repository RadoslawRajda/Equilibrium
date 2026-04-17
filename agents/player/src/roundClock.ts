/**
 * Same wall-clock math as `GameCore._syncRoundFromTimestamp` (see `frontend/src/lib/roundClock.ts`).
 * Agents use this so `logicalRoundIndex` / deadlines match what the chain will apply on the next tx.
 */
export type RunningRoundClockInput = {
  chainRoundIndex: number;
  roundEndsAt: number;
  durationSeconds: number;
  nowSec: number;
};

export type RunningRoundClockResult = {
  logicalRoundIndex: number;
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
