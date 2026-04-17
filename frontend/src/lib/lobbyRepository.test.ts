import { describe, expect, it } from "vitest";

import { LobbyRepository } from "./lobbyRepository";

describe("LobbyRepository", () => {
  it("maps lobby summaries from chain reads", async () => {
    const publicClient = {
      async readContract({ functionName, args }: { functionName: string; args?: bigint[] }) {
        if (functionName === "getLobbyCount") return 1n;
        if (functionName === "getLobby" && args?.[0] === 1n) {
          return [
            "0x1111111111111111111111111111111111111111",
            "Alpha",
            0n,
            0n,
            100000000000000000n,
            1n,
            "0x0000000000000000000000000000000000000000"
          ];
        }
        throw new Error(`Unexpected call ${functionName}`);
      }
    };

    const repo = new LobbyRepository({
      publicClient,
      lobbyManagerAddress: "0x0000000000000000000000000000000000000001",
      lobbyManagerAbi: []
    });

    const summaries = await repo.loadSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({
      id: "1",
      name: "Alpha",
      status: "open",
      playerCount: 1,
      host: "0x1111111111111111111111111111111111111111",
      prizePool: "0.1"
    });
  });

  it("hydrates active lobby state and action costs", async () => {
    const viewerAddress = "0x1111111111111111111111111111111111111111";
    const publicClient = {
      async readContract({ functionName, args }: { functionName: string; args?: any[] }) {
        if (functionName === "getLobby") {
          return [
            viewerAddress,
            "Arena",
            0n,
            0n,
            200000000000000000n,
            1n,
            "0x0000000000000000000000000000000000000000"
          ];
        }
        if (functionName === "getLobbyPlayers") return [viewerAddress];
        if (functionName === "getLobbyRound") return null;
        if (functionName === "getMapConfig") return null;
        if (functionName === "getPlayerResources") return [50n, 40n, 30n, 20n, 10n];
        if (functionName === "getBuildCost") return [10n, 10n, 10n, 0n, 0n];
        if (functionName === "getUpgradeCost") return [30n, 0n, 30n, 30n, 0n];
        if (functionName === "previewDiscoverCost" && args?.[1] === viewerAddress) return [40n, 40n, 40n, 40n, 0n];
        throw new Error(`Unexpected call ${functionName}`);
      },
      async multicall() {
        return [];
      }
    };

    const repo = new LobbyRepository({
      publicClient,
      lobbyManagerAddress: "0x0000000000000000000000000000000000000001",
      lobbyManagerAbi: [],
      gameCoreAddress: "0x0000000000000000000000000000000000000002",
      gameCoreAbi: [],
      viewerAddress
    });

    const hydrated = await repo.loadLobbyState("1");
    expect(hydrated).not.toBeNull();
    expect(hydrated?.lobby.name).toBe("Arena");
    expect(hydrated?.lobby.status).toBe("waiting");
    expect(hydrated?.lobby.players[0].resources).toEqual({
      food: 50,
      wood: 40,
      stone: 30,
      ore: 20,
      energy: 10
    });
    expect(hydrated?.actionCosts?.discover.food).toBe(40);
  });
});
