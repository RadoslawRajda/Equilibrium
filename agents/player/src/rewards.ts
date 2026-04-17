import type { Address, Chain, PublicClient, WalletClient } from "viem";
import { formatEther } from "viem";

/** LobbyManager.LobbyStatus */
const LM_COMPLETED = 2;

const winAnnounced = new Set<string>();

/**
 * When LobbyManager marks the lobby completed and we are the winner, log once and pull `playerBalance` via `withdraw()`.
 */
export async function claimLobbyRewardsIfWinner(
  walletClient: WalletClient,
  publicClient: PublicClient,
  lobbyManager: `0x${string}`,
  lobbyManagerAbi: readonly unknown[],
  lobbyIdStr: string,
  account: Address,
  chain: Chain
): Promise<void> {
  const lobbyId = BigInt(lobbyIdStr);
  const row = (await publicClient.readContract({
    address: lobbyManager,
    abi: lobbyManagerAbi,
    functionName: "getLobby",
    args: [lobbyId]
  })) as unknown;
  const g = row as Record<string, unknown> | unknown[];
  const at = (i: number, name: string): unknown =>
    Array.isArray(g) ? g[i] : (g as Record<string, unknown>)[name];

  const status = Number(at(3, "status") ?? 0);
  const prizePoolWei = BigInt(String(at(4, "prizePool") ?? 0));
  const winner = at(6, "winner") as Address;

  if (status !== LM_COMPLETED || winner.toLowerCase() !== account.toLowerCase()) {
    return;
  }

  if (!winAnnounced.has(lobbyIdStr)) {
    winAnnounced.add(lobbyIdStr);
    console.log(
      `[player-agent] WON lobby ${lobbyIdStr}! Prize pool credited: ${formatEther(prizePoolWei)} ETH (LobbyManager → playerBalance)`
    );
  }

  const bal = (await publicClient.readContract({
    address: lobbyManager,
    abi: lobbyManagerAbi,
    functionName: "getPlayerBalance",
    args: [account]
  })) as bigint;

  if (bal === 0n) return;

  try {
    const hash = await walletClient.writeContract({
      address: lobbyManager,
      abi: lobbyManagerAbi,
      functionName: "withdraw",
      args: [],
      chain,
      account
    } as never);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[player-agent] claimed ${formatEther(bal)} ETH to wallet ${account}`);
  } catch (e) {
    console.warn("[player-agent] LobbyManager.withdraw failed", e);
  }
}
