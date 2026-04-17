import { describe, expect, it } from "vitest";

import { projectRunningRoundClock } from "./roundClock";

describe("projectRunningRoundClock", () => {
  const D = 300; // 5 min

  it("before deadline: same chain index, countdown to roundEndsAt", () => {
    const E = 1000;
    const r = projectRunningRoundClock({
      chainRoundIndex: 1,
      roundEndsAt: E,
      durationSeconds: D,
      nowSec: E - 60
    });
    expect(r.logicalRoundIndex).toBe(1);
    expect(r.nextDeadlineSec).toBe(E);
  });

  it("just after deadline: one skip", () => {
    const E = 1000;
    const r = projectRunningRoundClock({
      chainRoundIndex: 1,
      roundEndsAt: E,
      durationSeconds: D,
      nowSec: E
    });
    expect(r.logicalRoundIndex).toBe(2);
    expect(r.nextDeadlineSec).toBe(E + D);
  });

  it("11 min after round 1 start (5 min round): 6 min past deadline → +2 skips → logical round 3", () => {
    const E = 1300;
    const nowSec = 1660; // 11 min after start if start=1000, i.e. 6 min after E
    const r = projectRunningRoundClock({
      chainRoundIndex: 1,
      roundEndsAt: E,
      durationSeconds: D,
      nowSec
    });
    expect(r.logicalRoundIndex).toBe(3);
    expect(r.nextDeadlineSec).toBe(E + 2 * D);
  });

  it("long idle after deadline: many skips", () => {
    const E = 1000;
    const nowSec = E + 11 * 60;
    const r = projectRunningRoundClock({
      chainRoundIndex: 1,
      roundEndsAt: E,
      durationSeconds: D,
      nowSec
    });
    expect(r.logicalRoundIndex).toBe(4);
  });
});
