import type { GameSnapshot } from "./snapshot.js";
import type { ParsedPlan } from "./llm.js";

function isNoopish(a: Record<string, unknown>): boolean {
  return String(a.type ?? "noop") === "noop";
}

/**
 * If the model returns only noops despite affordable on-chain moves, force one sensible tx so the agent does not stall.
 */
export function mergePlanWithHeuristic(snap: GameSnapshot, plan: ParsedPlan): ParsedPlan {
  const actions = plan.actions?.length ? plan.actions : [{ type: "noop" }];
  const productive = actions.some((x) => !isNoopish(x as Record<string, unknown>));
  if (productive) return { ...plan, actions };

  const h = snap.economyHints;
  if (!h?.roundIsRunning) return { ...plan, actions };

  if (h.canCraftAlloy) {
    console.log("[equinox] heuristic: craftAlloy (model had only noop)");
    return {
      thought: `${plan.thought ?? ""} [heuristic: craftAlloy]`.trim(),
      actions: [{ type: "craftAlloy" }]
    };
  }

  const nextHex = snap.tiles.find((t) => !t.discovered);
  if (nextHex && h.canAffordDiscover) {
    console.log(`[equinox] heuristic: discover ${nextHex.id} (model had only noop)`);
    return {
      thought: `${plan.thought ?? ""} [heuristic: discover ${nextHex.id}]`.trim(),
      actions: [{ type: "discover", hexId: nextHex.id }]
    };
  }

  return { ...plan, actions };
}
