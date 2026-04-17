import type { GameSnapshot } from "./snapshot.js";
import type { ParsedPlan } from "./llm.js";
import { canPayResources, collectionEnergyForLevel } from "./snapshot.js";

function isNoopish(a: Record<string, unknown>): boolean {
  return String(a.type ?? "noop") === "noop";
}

function thoughtBeforeHeuristic(plan: ParsedPlan): string {
  const th = (plan.thought ?? "").trim();
  if (th === "json-error" || th === "parse-fail") {
    const clip = plan.assistantPreview?.trim();
    return clip
      ? `LLM reply was not usable JSON (${clip})`
      : "LLM reply was not a usable JSON plan";
  }
  return th || "(no thought)";
}

function isMine(snap: GameSnapshot, owner: string | null): boolean {
  return Boolean(owner && owner.toLowerCase() === snap.playerAddress);
}

/**
 * If the model returns only noops despite affordable on-chain moves, force one sensible tx so the agent does not stall.
 * Order matches tuned economy: income and buildings before expensive smelt / blind expansion.
 */
export function mergePlanWithHeuristic(snap: GameSnapshot, plan: ParsedPlan): ParsedPlan {
  const actions = plan.actions?.length ? plan.actions : [{ type: "noop" }];
  const productive = actions.some((x) => !isNoopish(x as Record<string, unknown>));
  if (productive) return { ...plan, actions };

  const h = snap.economyHints;
  if (!h?.roundIsRunning) return { ...plan, actions };

  const ri = snap.round.clock?.logicalRoundIndex ?? snap.round.roundIndex;

  const collectTile = snap.tiles.find((t) => {
    if (!isMine(snap, t.owner) || !t.structure.exists) return false;
    if (t.structure.builtAtRound >= ri) return false;
    if (t.structure.collectedThisRound) return false;
    const need = collectionEnergyForLevel(t.structure.level, h);
    return snap.resources.energy >= need;
  });
  if (collectTile) {
    console.log(
      `[player-agent] heuristic: collect ${collectTile.id} (model had only noop or unparseable JSON)`
    );
    return {
      ...plan,
      thought: `${thoughtBeforeHeuristic(plan)} · applied heuristic: collect ${collectTile.id}`.trim(),
      actions: [{ type: "collect", hexId: collectTile.id }]
    };
  }

  const buildTile = h.canAffordBuildSomewhere
    ? snap.tiles.find((t) => isMine(snap, t.owner) && t.discovered && !t.structure.exists)
    : undefined;
  if (buildTile) {
    console.log(
      `[player-agent] heuristic: buildStructure ${buildTile.id} (model had only noop or unparseable JSON)`
    );
    return {
      ...plan,
      thought: `${thoughtBeforeHeuristic(plan)} · applied heuristic: buildStructure ${buildTile.id}`.trim(),
      actions: [{ type: "buildStructure", hexId: buildTile.id }]
    };
  }

  const upgradeTile = h.canAffordUpgradeSomewhere
    ? snap.tiles.find(
        (t) => isMine(snap, t.owner) && t.structure.exists && t.structure.level === 1
      )
    : undefined;
  if (upgradeTile) {
    console.log(
      `[player-agent] heuristic: upgradeStructure ${upgradeTile.id} (model had only noop or unparseable JSON)`
    );
    return {
      ...plan,
      thought: `${thoughtBeforeHeuristic(plan)} · applied heuristic: upgradeStructure ${upgradeTile.id}`.trim(),
      actions: [{ type: "upgradeStructure", hexId: upgradeTile.id }]
    };
  }

  const incomingFirst = snap.openTrades?.find((t) => canPayResources(snap.resources, t.request));
  if (incomingFirst) {
    console.log(
      `[player-agent] heuristic: acceptTrade #${incomingFirst.tradeId} (model had only noop or unparseable JSON)`
    );
    return {
      ...plan,
      thought: `${thoughtBeforeHeuristic(plan)} · applied heuristic: acceptTrade #${incomingFirst.tradeId}`.trim(),
      actions: [{ type: "acceptTrade", tradeId: incomingFirst.tradeId }]
    };
  }

  const draft = h.rebalanceTradeDraft;
  if (draft) {
    console.log(
      `[player-agent] heuristic: createTrade rebalance ${draft.surplus}→${draft.shortage} (model had only noop or unparseable JSON)`
    );
    return {
      ...plan,
      thought: `${thoughtBeforeHeuristic(plan)} · applied heuristic: createTrade open market`.trim(),
      actions: [
        {
          type: "createTrade",
          taker: "0x0000000000000000000000000000000000000000",
          offer: {
            food: draft.offer.food,
            wood: draft.offer.wood,
            stone: draft.offer.stone,
            ore: draft.offer.ore,
            energy: draft.offer.energy
          },
          request: {
            food: draft.request.food,
            wood: draft.request.wood,
            stone: draft.request.stone,
            ore: draft.request.ore,
            energy: draft.request.energy
          },
          expiryRounds: draft.expiryRounds
        }
      ]
    };
  }

  const discoverId = h.discoverableHexIds?.[0];
  const nextHex = discoverId ? snap.tiles.find((t) => t.id === discoverId) : undefined;
  if (nextHex && h.canAffordDiscover) {
    console.log(`[player-agent] heuristic: discover ${nextHex.id} (model had only noop or unparseable JSON)`);
    return {
      ...plan,
      thought: `${thoughtBeforeHeuristic(plan)} · applied heuristic: discover ${nextHex.id}`.trim(),
      actions: [{ type: "discover", hexId: nextHex.id }]
    };
  }

  if (h.craftAlloyReasonable) {
    console.log("[player-agent] heuristic: craftAlloy (model had only noop or unparseable JSON)");
    return {
      ...plan,
      thought: `${thoughtBeforeHeuristic(plan)} · applied heuristic: craftAlloy`.trim(),
      actions: [{ type: "craftAlloy" }]
    };
  }

  const endRound = snap.proposals.find((p) => !p.resolved && p.effectKey === "__END_ROUND__");
  if (endRound) {
    console.log(
      `[player-agent] heuristic: endRoundVote proposal ${endRound.id} (no better move — advance time)`
    );
    return {
      ...plan,
      thought: `${thoughtBeforeHeuristic(plan)} · applied heuristic: endRoundVote`.trim(),
      actions: [{ type: "endRoundVote", proposalId: endRound.id }]
    };
  }

  return { ...plan, actions };
}
