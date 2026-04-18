import { describe, expect, it } from "vitest";

import type { PlayerState } from "../types";
import { canCreateEndRoundProposal, getEndRoundProposalCloseRound } from "./voteUtils";

const alivePlayer: PlayerState = {
  address: "0x1111111111111111111111111111111111111111",
  nickname: "Tester",
  hasTicket: true,
  bankruptRounds: 0,
  alive: true,
  resources: {
    food: 0,
    wood: 0,
    stone: 0,
    ore: 0,
    energy: 0
  }
};

describe("voteUtils", () => {
  it("allows end-round proposal only for active players in running lobbies", () => {
    expect(
      canCreateEndRoundProposal({
        status: "running",
        pendingAction: null,
        me: alivePlayer
      })
    ).toBe(true);

    expect(
      canCreateEndRoundProposal({
        status: "running",
        pendingAction: "vote:create",
        me: alivePlayer
      })
    ).toBe(false);

    expect(
      canCreateEndRoundProposal({
        status: "zero-round",
        pendingAction: null,
        me: alivePlayer
      })
    ).toBe(false);

    expect(
      canCreateEndRoundProposal({
        status: "running",
        pendingAction: null,
        me: null
      })
    ).toBe(false);

    expect(
      canCreateEndRoundProposal({
        status: "running",
        pendingAction: null,
        me: {
          ...alivePlayer,
          alive: false
        }
      })
    ).toBe(false);
  });

  it("computes end-round proposal closeRound as a future round", () => {
    expect(getEndRoundProposalCloseRound(0)).toBe(999);
    expect(getEndRoundProposalCloseRound(1)).toBe(1000);
    expect(getEndRoundProposalCloseRound(120)).toBe(1119);

    for (const roundIndex of [0, 1, 2, 10, 120, 999, 5000]) {
      expect(getEndRoundProposalCloseRound(roundIndex)).toBeGreaterThan(roundIndex);
    }
  });
});
