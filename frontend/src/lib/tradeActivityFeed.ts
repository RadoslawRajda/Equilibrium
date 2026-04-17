import type { PublicClient } from "viem";
import { getAbiItem } from "viem";

import { short } from "./gameUtils";

const KIND_LABEL = ["food", "wood", "stone", "ore"] as const;

export type TradeFeedItem = {
  id: string;
  sortKey: bigint;
  text: string;
};

function addr(a: string) {
  return short(a);
}

/**
 * Bank + P2P trade events for one lobby (newest first). Uses `getLogs` (viem 2.19+).
 */
export async function fetchLobbyTradeActivityLog(
  publicClient: PublicClient,
  gameCore: `0x${string}`,
  gameCoreAbi: readonly unknown[],
  lobbyId: bigint,
  fromBlock: bigint = 0n
): Promise<TradeFeedItem[]> {
  const abi = gameCoreAbi as any[];
  const bankItem = getAbiItem({ abi, name: "BankTrade" });
  const createdItem = getAbiItem({ abi, name: "TradeCreated" });
  const acceptedItem = getAbiItem({ abi, name: "TradeAccepted" });

  const [bankLogs, createdLogs, acceptedLogs] = await Promise.all([
    publicClient
      .getLogs({
        address: gameCore,
        event: bankItem,
        args: { lobbyId },
        fromBlock,
        toBlock: "latest"
      })
      .catch(() => []),
    publicClient
      .getLogs({
        address: gameCore,
        event: createdItem,
        args: { lobbyId },
        fromBlock,
        toBlock: "latest"
      })
      .catch(() => []),
    publicClient
      .getLogs({
        address: gameCore,
        event: acceptedItem,
        args: { lobbyId },
        fromBlock,
        toBlock: "latest"
      })
      .catch(() => [])
  ]);

  const out: TradeFeedItem[] = [];

  for (const log of bankLogs as any[]) {
    const a = log.args as {
      player?: `0x${string}`;
      sellKind?: number;
      buyKind?: number;
      sellAmount?: bigint;
      buyAmount?: bigint;
    };
    const sk = (log.blockNumber ?? 0n) * 100000n + BigInt(log.logIndex ?? 0);
    const sell = KIND_LABEL[Number(a.sellKind ?? 0) % 4] ?? "?";
    const buy = KIND_LABEL[Number(a.buyKind ?? 0) % 4] ?? "?";
    out.push({
      id: `bank-${log.transactionHash}-${log.logIndex}`,
      sortKey: sk,
      text: `${addr(String(a.player ?? ""))} · bank ${sell} → ${buy} (${String(a.sellAmount ?? "?")} for ${String(a.buyAmount ?? "?")})`
    });
  }

  for (const log of createdLogs as any[]) {
    const a = log.args as {
      tradeId?: bigint;
      maker?: `0x${string}`;
      taker?: `0x${string}`;
    };
    const sk = (log.blockNumber ?? 0n) * 100000n + BigInt(log.logIndex ?? 0);
    const taker = a.taker;
    const open = !taker || taker === "0x0000000000000000000000000000000000000000";
    out.push({
      id: `tc-${log.transactionHash}-${log.logIndex}`,
      sortKey: sk,
      text: `${addr(String(a.maker ?? ""))} · offered trade #${String(a.tradeId ?? "?")} ${open ? "(open)" : `→ ${addr(String(taker))}`}`
    });
  }

  for (const log of acceptedLogs as any[]) {
    const a = log.args as { tradeId?: bigint; taker?: `0x${string}` };
    const sk = (log.blockNumber ?? 0n) * 100000n + BigInt(log.logIndex ?? 0);
    out.push({
      id: `ta-${log.transactionHash}-${log.logIndex}`,
      sortKey: sk,
      text: `${addr(String(a.taker ?? ""))} · accepted trade #${String(a.tradeId ?? "?")}`
    });
  }

  out.sort((x, y) => (x.sortKey > y.sortKey ? -1 : x.sortKey < y.sortKey ? 1 : 0));
  return out.slice(0, 80);
}
