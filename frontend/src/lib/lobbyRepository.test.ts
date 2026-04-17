import { describe, expect, it } from "vitest";

import { LobbyRepository } from "./lobbyRepository";

describe("LobbyRepository", () => {
  it("maps lobby summaries from chain reads", async () => {
    const publicClient = {
      async getBytecode() {
        return "0x1234";
      },
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

    const { lobbies: summaries } = await repo.loadSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({
      id: "1",
      name: "Alpha",
      status: "open",
      playerCount: 1,
      host: "0x1111111111111111111111111111111111111111",
      prizePool: "0.1",
      matchEndedOnChain: false
    });
  });

  it("hydrates active lobby state and action costs", async () => {
    const viewerAddress = "0x1111111111111111111111111111111111111111";
    const publicClient = {
      async getBytecode() {
        return "0x1234";
      },
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
        if (functionName === "getPlayerCraftedGoods") return 0n;
        if (functionName === "isPlayerAlive") return true;
        if (functionName === "getProposalCount") return 0n;
        if (functionName === "getBuildCost") return [1n, 1n, 1n, 0n, 0n];
        if (functionName === "getUpgradeCost") return [2n, 0n, 3n, 0n, 25n];
        if (functionName === "previewDiscoverCost" && args?.[1] === viewerAddress) return [0n, 1n, 0n, 1n, 0n];
        if (functionName === "previewCollectionEnergyCost" && args?.[0] === 1n) return 10n;
        if (functionName === "previewCollectionEnergyCost" && args?.[0] === 2n) return 10n;
        if (functionName === "previewCollectionResourceYield" && args?.[0] === 1) return 1n;
        if (functionName === "previewCollectionResourceYield" && args?.[0] === 2) return 2n;
        if (functionName === "getBankTradeBulkMaxLots") return 48n;
        if (functionName === "getBasicResourceMax") return 20n;
        if (functionName === "getEnergyConfig") return [100n, 50n];
        if (functionName === "getTradingEnergyCost") return 0n;
        if (functionName === "previewCraftAlloyCost") return [5n, 5n, 5n, 5n, 10n];
        if (functionName === "hasTicket" && args?.[1]?.toLowerCase?.() === viewerAddress.toLowerCase()) return true;
        if (functionName === "hasTicket") return false;
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
    expect(hydrated?.lobby.viewerLobbyManagerTicket).toBe(true);
    expect(hydrated?.lobby.viewerNeedsGameCoreJoin).toBe(false);
    expect(hydrated?.lobby.players[0].resources).toEqual({
      food: 50,
      wood: 40,
      stone: 30,
      ore: 20,
      energy: 10
    });
    expect(hydrated?.actionCosts?.build.food).toBe(1);
    expect(hydrated?.actionCosts?.upgrade.energy).toBe(25);
    expect(hydrated?.actionCosts?.discover.food).toBe(0);
    expect(hydrated?.actionCosts?.discover.wood).toBe(1);
    expect(hydrated?.actionCosts?.collectEnergyLevel1).toBe(10);
    expect(hydrated?.actionCosts?.collectEnergyLevel2).toBe(10);
    expect(hydrated?.actionCosts?.collectResourceYieldLevel1).toBe(1);
    expect(hydrated?.actionCosts?.collectResourceYieldLevel2).toBe(2);
    expect(hydrated?.actionCosts?.basicResourceMax).toBe(20);
    expect(hydrated?.bankTradeBulkMaxLots).toBe(48);
  });

  it("uses GameCore roster when the game has started (avoids phantom ticket-holders)", async () => {
    const viewerAddress = "0x1111111111111111111111111111111111111111";
    const ghostTicket = "0x9999999999999999999999999999999999999999";
    const lm = "0x0000000000000000000000000000000000000001";
    const gc = "0x0000000000000000000000000000000000000002";

    const publicClient = {
      async getBytecode() {
        return "0x1234";
      },
      async readContract(req: { functionName: string; args?: any[]; address?: string }) {
        const { functionName, address } = req;
        if (functionName === "getLobby") {
          return [
            viewerAddress,
            "Arena",
            0n,
            0n,
            200000000000000000n,
            2n,
            "0x0000000000000000000000000000000000000000"
          ];
        }
        if (functionName === "getLobbyPlayers" && address?.toLowerCase() === lm.toLowerCase()) {
          return [viewerAddress, ghostTicket];
        }
        if (functionName === "getLobbyPlayers" && address?.toLowerCase() === gc.toLowerCase()) {
          return [viewerAddress];
        }
        if (functionName === "getLobbyRound") return [1n, 0n, 0n, 2n, 0n, 200n];
        if (functionName === "getMapConfig") return null;
        if (functionName === "getPlayerResources") return [2n, 2n, 2n, 2n, 100n];
        if (functionName === "getPlayerCraftedGoods") return 0n;
        if (functionName === "isPlayerAlive") return true;
        if (functionName === "getProposalCount") return 0n;
        if (functionName === "getBuildCost") return [1n, 1n, 1n, 0n, 0n];
        if (functionName === "getUpgradeCost") return [2n, 0n, 3n, 0n, 25n];
        if (functionName === "previewDiscoverCost") return [0n, 1n, 0n, 1n, 0n];
        if (functionName === "previewCollectionEnergyCost" && args?.[0] === 1n) return 10n;
        if (functionName === "previewCollectionEnergyCost" && args?.[0] === 2n) return 10n;
        if (functionName === "previewCollectionResourceYield" && args?.[0] === 1) return 1n;
        if (functionName === "previewCollectionResourceYield" && args?.[0] === 2) return 2n;
        if (functionName === "getBankTradeBulkMaxLots") return 48n;
        if (functionName === "getBasicResourceMax") return 20n;
        if (functionName === "getEnergyConfig") return [100n, 50n];
        if (functionName === "getTradingEnergyCost") return 0n;
        if (functionName === "previewCraftAlloyCost") return [5n, 5n, 5n, 5n, 10n];
        if (functionName === "hasTicket" && args?.[1]?.toLowerCase?.() === ghostTicket.toLowerCase()) return true;
        if (functionName === "hasTicket" && args?.[1]?.toLowerCase?.() === viewerAddress.toLowerCase()) return true;
        if (functionName === "hasTicket") return false;
        throw new Error(`Unexpected call ${functionName}`);
      },
      async multicall() {
        return [];
      }
    };

    const repo = new LobbyRepository({
      publicClient,
      lobbyManagerAddress: lm as `0x${string}`,
      lobbyManagerAbi: [],
      gameCoreAddress: gc as `0x${string}`,
      gameCoreAbi: [],
      viewerAddress
    });

    const hydrated = await repo.loadLobbyState("1");
    expect(hydrated?.lobby.players).toHaveLength(1);
    expect(hydrated?.lobby.players[0].address.toLowerCase()).toBe(viewerAddress.toLowerCase());
    expect(hydrated?.lobby.me?.address.toLowerCase()).toBe(viewerAddress.toLowerCase());
    expect(hydrated?.lobby.viewerNeedsGameCoreJoin).toBe(false);
  });

  it("flags viewerNeedsGameCoreJoin when LobbyManager ticket exists but GameCore has no seat", async () => {
    const viewerAddress = "0x1111111111111111111111111111111111111111";
    const lm = "0x0000000000000000000000000000000000000001";
    const gc = "0x0000000000000000000000000000000000000002";

    const publicClient = {
      async getBytecode() {
        return "0x1234";
      },
      async readContract(req: { functionName: string; args?: any[]; address?: string }) {
        const { functionName, args } = req;
        if (functionName === "getLobby") {
          return [
            "0x2222222222222222222222222222222222222222",
            "Arena",
            0n,
            0n,
            200000000000000000n,
            3n,
            "0x0000000000000000000000000000000000000000"
          ];
        }
        if (functionName === "getLobbyPlayers" && req.address?.toLowerCase() === lm.toLowerCase()) {
          return [viewerAddress, "0x3333333333333333333333333333333333333333"];
        }
        if (functionName === "getLobbyPlayers" && req.address?.toLowerCase() === gc.toLowerCase()) {
          return ["0x2222222222222222222222222222222222222222"];
        }
        if (functionName === "getLobbyRound") return [1n, 0n, 0n, 2n, 0n, 200n];
        if (functionName === "getMapConfig") return null;
        if (functionName === "getPlayerResources") return [0n, 0n, 0n, 0n, 0n];
        if (functionName === "getPlayerCraftedGoods") return 0n;
        if (functionName === "isPlayerAlive") return true;
        if (functionName === "getProposalCount") return 0n;
        if (functionName === "getBuildCost") return [1n, 1n, 1n, 0n, 0n];
        if (functionName === "getUpgradeCost") return [2n, 0n, 3n, 0n, 25n];
        if (functionName === "previewDiscoverCost") return [0n, 1n, 0n, 1n, 0n];
        if (functionName === "previewCollectionEnergyCost" && args?.[0] === 1n) return 10n;
        if (functionName === "previewCollectionEnergyCost" && args?.[0] === 2n) return 10n;
        if (functionName === "previewCollectionResourceYield" && args?.[0] === 1) return 1n;
        if (functionName === "previewCollectionResourceYield" && args?.[0] === 2) return 2n;
        if (functionName === "getBankTradeBulkMaxLots") return 48n;
        if (functionName === "getBasicResourceMax") return 20n;
        if (functionName === "getEnergyConfig") return [100n, 50n];
        if (functionName === "getTradingEnergyCost") return 0n;
        if (functionName === "previewCraftAlloyCost") return [5n, 5n, 5n, 5n, 10n];
        if (functionName === "hasTicket" && args?.[1]?.toLowerCase?.() === viewerAddress.toLowerCase()) return true;
        if (functionName === "hasTicket") return false;
        throw new Error(`Unexpected call ${functionName}`);
      },
      async multicall() {
        return [];
      }
    };

    const repo = new LobbyRepository({
      publicClient,
      lobbyManagerAddress: lm as `0x${string}`,
      lobbyManagerAbi: [],
      gameCoreAddress: gc as `0x${string}`,
      gameCoreAbi: [],
      viewerAddress
    });

    const hydrated = await repo.loadLobbyState("1");
    expect(hydrated?.lobby.viewerLobbyManagerTicket).toBe(true);
    expect(hydrated?.lobby.viewerNeedsGameCoreJoin).toBe(true);
    expect(hydrated?.lobby.me).toBeNull();
  });
});
