import type { LobbyState } from "../types";

const END_ROUND_CLOSE_ROUNDS_AHEAD = 999;

type EndRoundEligibilityInput = {
  status: LobbyState["status"];
  pendingAction: string | null | undefined;
  me: LobbyState["me"];
};

export const canCreateEndRoundProposal = ({
  status,
  pendingAction,
  me
}: EndRoundEligibilityInput): boolean =>
  status === "running" && !pendingAction && Boolean(me) && me.alive === true;

export const getEndRoundProposalCloseRound = (roundIndex: number): number => {
  const normalizedRoundIndex = Number.isFinite(roundIndex)
    ? Math.max(0, Math.floor(roundIndex))
    : 0;
  return normalizedRoundIndex + END_ROUND_CLOSE_ROUNDS_AHEAD;
};
