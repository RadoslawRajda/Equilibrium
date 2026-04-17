import type { Address, Chain, PublicClient, WalletClient } from "viem";
import type { ParsedPlan } from "./llm.js";

/** Sequential round intent batch (off-chain “bundle”; on-chain = separate txs). */
export async function executeRoundBatch(
  walletClient: WalletClient,
  publicClient: PublicClient,
  gameCore: `0x${string}`,
  gameCoreAbi: readonly unknown[],
  lobbyId: bigint,
  plan: ParsedPlan,
  chain: Chain,
  account: Address
): Promise<void> {
  const max = Math.min(plan.actions.length, 12);
  for (let i = 0; i < max; i += 1) {
    const a = plan.actions[i] as Record<string, unknown>;
    const type = String(a.type ?? "noop");
    try {
      if (type === "noop") continue;
      if (type === "craftAlloy") {
        const hash = await walletClient.writeContract({
          address: gameCore,
          abi: gameCoreAbi,
          functionName: "craftAlloy",
          args: [lobbyId],
          chain,
          account
        });
        await publicClient.waitForTransactionReceipt({ hash });
        continue;
      }
      if (type === "discover") {
        const hexId = String(a.hexId ?? "");
        const hash = await walletClient.writeContract({
          address: gameCore,
          abi: gameCoreAbi,
          functionName: "discoverHex",
          args: [lobbyId, hexId],
          chain,
          account
        });
        await publicClient.waitForTransactionReceipt({ hash });
        continue;
      }
      if (type === "collect") {
        const hexId = String(a.hexId ?? "");
        const amount = BigInt(Number(a.amount ?? 1));
        const hash = await walletClient.writeContract({
          address: gameCore,
          abi: gameCoreAbi,
          functionName: "collect",
          args: [lobbyId, hexId, amount],
          chain,
          account
        });
        await publicClient.waitForTransactionReceipt({ hash });
        continue;
      }
      if (type === "bankTrade") {
        const sellKind = Number(a.sellKind ?? 0);
        const buyKind = Number(a.buyKind ?? 1);
        const hash = await walletClient.writeContract({
          address: gameCore,
          abi: gameCoreAbi,
          functionName: "tradeWithBank",
          args: [lobbyId, sellKind, buyKind],
          chain,
          account
        });
        await publicClient.waitForTransactionReceipt({ hash });
        continue;
      }
      if (type === "endRoundVote") {
        const proposalId = BigInt(Number(a.proposalId ?? 0));
        const hash = await walletClient.writeContract({
          address: gameCore,
          abi: gameCoreAbi,
          functionName: "vote",
          args: [lobbyId, proposalId, true],
          chain,
          account
        });
        await publicClient.waitForTransactionReceipt({ hash });
        continue;
      }
    } catch (e) {
      console.warn(`[equinox] action ${i} (${type}) failed`, e);
    }
  }
}

export async function pickStartingHex(
  walletClient: WalletClient,
  publicClient: PublicClient,
  gameCore: `0x${string}`,
  gameCoreAbi: readonly unknown[],
  lobbyId: bigint,
  hexId: string,
  q: number,
  r: number,
  chain: Chain,
  account: Address
) {
  const hash = await walletClient.writeContract({
    address: gameCore,
    abi: gameCoreAbi,
    functionName: "pickStartingHex",
    args: [lobbyId, hexId, BigInt(q), BigInt(r)],
    chain,
    account
  });
  await publicClient.waitForTransactionReceipt({ hash });
}
