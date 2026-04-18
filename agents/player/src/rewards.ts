import type { Address, Chain, PublicClient, WalletClient } from "viem";
import { formatEther } from "viem";

/** LobbyManager.LobbyStatus */
const LM_COMPLETED = 2;
const LM_CANCELLED = 3;

const withdrawAnnounced = new Set<string>();

/**
 * After a lobby is COMPLETED or CANCELLED, call `distributeSessionSponsorRemainder` if the sponsor pool is non-zero,
 * then pull `playerBalance` to the wallet with `withdraw()`.
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
  if (status !== LM_COMPLETED && status !== LM_CANCELLED) {
    return;
  }

  const pool = (await publicClient.readContract({
    address: lobbyManager,
    abi: lobbyManagerAbi,
    functionName: "sessionSponsorPool",
    args: [lobbyId]
  })) as bigint;

  if (pool > 0n) {
    try {
      const distHash = await walletClient.writeContract({
        address: lobbyManager,
        abi: lobbyManagerAbi,
        functionName: "distributeSessionSponsorRemainder",
        args: [lobbyId],
        chain,
        account
      } as never);
      await publicClient.waitForTransactionReceipt({ hash: distHash });
    } catch (e) {
      console.warn("[player-agent] distributeSessionSponsorRemainder failed", e);
    }
  }

  const bal = (await publicClient.readContract({
    address: lobbyManager,
    abi: lobbyManagerAbi,
    functionName: "getPlayerBalance",
    args: [account]
  })) as bigint;

  if (bal === 0n) return;

  const key = `${lobbyIdStr}:${account.toLowerCase()}`;
  if (!withdrawAnnounced.has(key)) {
    withdrawAnnounced.add(key);
    console.log(
      `[player-agent] Lobby ${lobbyIdStr} settled — claiming ${formatEther(bal)} ETH (your share on LobbyManager)`
    );
  }

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
