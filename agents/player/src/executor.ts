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
        const parts = hexId.split(",");
        if (parts.length !== 2) throw new Error(`discover: bad hexId ${hexId}`);
        const q = BigInt(parts[0].trim());
        const r = BigInt(parts[1].trim());
        const hash = await walletClient.writeContract({
          address: gameCore,
          abi: gameCoreAbi,
          functionName: "discoverHex",
          args: [lobbyId, hexId, q, r],
          chain,
          account
        });
        await publicClient.waitForTransactionReceipt({ hash });
        continue;
      }
      if (type === "collect") {
        const hexId = String(a.hexId ?? "");
        const hash = await walletClient.writeContract({
          address: gameCore,
          abi: gameCoreAbi,
          functionName: "collect",
          args: [lobbyId, hexId],
          chain,
          account
        });
        await publicClient.waitForTransactionReceipt({ hash });
        continue;
      }
      if (type === "buildStructure" || type === "build") {
        const hexId = String(a.hexId ?? "");
        const hash = await walletClient.writeContract({
          address: gameCore,
          abi: gameCoreAbi,
          functionName: "buildStructure",
          args: [lobbyId, hexId],
          chain,
          account
        });
        await publicClient.waitForTransactionReceipt({ hash });
        continue;
      }
      if (type === "upgradeStructure" || type === "upgrade") {
        const hexId = String(a.hexId ?? "");
        const hash = await walletClient.writeContract({
          address: gameCore,
          abi: gameCoreAbi,
          functionName: "upgradeStructure",
          args: [lobbyId, hexId],
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
      if (type === "acceptTrade") {
        const tradeId = BigInt(Number(a.tradeId ?? 0));
        const hash = await walletClient.writeContract({
          address: gameCore,
          abi: gameCoreAbi,
          functionName: "acceptTrade",
          args: [lobbyId, tradeId],
          chain,
          account
        });
        await publicClient.waitForTransactionReceipt({ hash });
        continue;
      }
      if (type === "createTrade") {
        const rawTaker = String(a.taker ?? "");
        const taker = (
          rawTaker.startsWith("0x") && rawTaker.length >= 42
            ? rawTaker
            : "0x0000000000000000000000000000000000000000"
        ) as `0x${string}`;
        const offerRaw = a.offer as Record<string, unknown> | undefined;
        const requestRaw = a.request as Record<string, unknown> | undefined;
        const offer = {
          food: BigInt(Number(offerRaw?.food ?? 0)),
          wood: BigInt(Number(offerRaw?.wood ?? 0)),
          stone: BigInt(Number(offerRaw?.stone ?? 0)),
          ore: BigInt(Number(offerRaw?.ore ?? 0)),
          energy: BigInt(Number(offerRaw?.energy ?? 0))
        };
        const request = {
          food: BigInt(Number(requestRaw?.food ?? 0)),
          wood: BigInt(Number(requestRaw?.wood ?? 0)),
          stone: BigInt(Number(requestRaw?.stone ?? 0)),
          ore: BigInt(Number(requestRaw?.ore ?? 0)),
          energy: BigInt(Number(requestRaw?.energy ?? 0))
        };
        const expiryRounds = BigInt(Number(a.expiryRounds ?? 5));
        const hash = await walletClient.writeContract({
          address: gameCore,
          abi: gameCoreAbi,
          functionName: "createTrade",
          args: [lobbyId, taker, offer, request, expiryRounds],
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
      console.warn(`[player-agent] action ${i} (${type}) failed`, e);
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
