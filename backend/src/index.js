import "dotenv/config";
import fs from "fs";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { JsonRpcProvider, Contract } from "ethers";
import { recoverMessageAddress } from "viem";
import { GameEngine } from "./gameEngine.js";
import { AIDirector } from "./aiDirector.js";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const roundDurationMs = Number(process.env.ROUND_DURATION_MS || 600000);
const zeroRoundDurationMs = Number(process.env.ZERO_ROUND_DURATION_MS || 300000);

const aiDirector = new AIDirector({
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "llama3.2"
});

const engine = new GameEngine({ roundDurationMs, zeroRoundDurationMs, aiDirector });

const deploymentPath = process.env.DEPLOYMENTS_PATH || "/contracts/deployments/localhost.json";
const AUTH_WINDOW_MS = 2 * 60 * 1000;

// Web3 setup
const rpcUrl = process.env.RPC_URL || "http://localhost:8545";
const provider = new JsonRpcProvider(rpcUrl);
let lobbyManagerContract = null;
let lobbyManagerDeploymentRaw = "";
let gameHubContract = null;
let gameHubDeploymentRaw = "";
let gameCoreContract = null;
let gameCoreDeploymentRaw = "";

const initLobbyManagerContract = async ({ force = false } = {}) => {
  try {
    const content = fs.readFileSync(deploymentPath, "utf8");
    if (!force && content === lobbyManagerDeploymentRaw && lobbyManagerContract) {
      return lobbyManagerContract;
    }

    const deployments = JSON.parse(content);
    const { address, abi } = deployments.contracts.LobbyManager;
    const code = await provider.getCode(address);
    if (code === "0x") {
      throw new Error(`No contract code at ${address}`);
    }

    lobbyManagerDeploymentRaw = content;
    lobbyManagerContract = new Contract(address, abi, provider);
    console.log("LobbyManager contract initialized at", address);
    return lobbyManagerContract;
  } catch (e) {
    console.error("Failed to init LobbyManager contract", e.message);
    return null;
  }
};

await initLobbyManagerContract();

const initGameHubContract = async ({ force = false } = {}) => {
  try {
    const content = fs.readFileSync(deploymentPath, "utf8");
    if (!force && content === gameHubDeploymentRaw && gameHubContract) {
      return gameHubContract;
    }

    const deployments = JSON.parse(content);
    const { address, abi } = deployments.contracts.AIGameMaster;
    const code = await provider.getCode(address);
    if (code === "0x") {
      throw new Error(`No contract code at ${address}`);
    }

    gameHubDeploymentRaw = content;
    gameHubContract = new Contract(address, abi, provider);
    console.log("AIGameMaster contract initialized at", address);
    return gameHubContract;
  } catch (e) {
    console.error("Failed to init AIGameMaster contract", e.message);
    return null;
  }
};

await initGameHubContract();

const initGameCoreContract = async ({ force = false } = {}) => {
  try {
    const content = fs.readFileSync(deploymentPath, "utf8");
    if (!force && content === gameCoreDeploymentRaw && gameCoreContract) {
      return gameCoreContract;
    }

    const deployments = JSON.parse(content);
    const { address, abi } = deployments.contracts.GameCore;
    const code = await provider.getCode(address);
    if (code === "0x") {
      throw new Error(`No contract code at ${address}`);
    }

    gameCoreDeploymentRaw = content;
    gameCoreContract = new Contract(address, abi, provider);
    console.log("GameCore contract initialized at", address);
    return gameCoreContract;
  } catch (e) {
    console.error("Failed to init GameCore contract", e.message);
    return null;
  }
};

await initGameCoreContract();

const buildSignedMessage = ({ eventName, data, timestamp, nonce }) =>
  `EQUILIBRIUM_ACTION\nevent:${eventName}\nts:${timestamp}\nnonce:${nonce}\ndata:${JSON.stringify(data)}`;

const authError = (ack, message) => ack?.({ ok: false, error: message });

const secureAction = async ({ socket, eventName, payload, ack, expectedAddress, handler }) => {
  try {
    const data = payload?.data;
    const auth = payload?.auth;

    if (!data || !auth) return authError(ack, "Missing auth payload");
    if (!auth.address || !auth.signature || !auth.timestamp || !auth.nonce) {
      return authError(ack, "Invalid auth payload");
    }

    const now = Date.now();
    if (Math.abs(now - Number(auth.timestamp)) > AUTH_WINDOW_MS) {
      return authError(ack, "Signature expired");
    }

    socket.data.usedNonces = socket.data.usedNonces || new Set();
    if (socket.data.usedNonces.has(auth.nonce)) {
      return authError(ack, "Replay detected");
    }

    const message = buildSignedMessage({
      eventName,
      data,
      timestamp: auth.timestamp,
      nonce: auth.nonce
    });

    const recovered = await recoverMessageAddress({
      message,
      signature: auth.signature
    });

    if (recovered.toLowerCase() !== auth.address.toLowerCase()) {
      return authError(ack, "Invalid signature");
    }

    if (expectedAddress && expectedAddress.toLowerCase() !== auth.address.toLowerCase()) {
      return authError(ack, "Signer mismatch");
    }

    socket.data.usedNonces.add(auth.nonce);
    if (socket.data.usedNonces.size > 300) {
      const first = socket.data.usedNonces.values().next().value;
      socket.data.usedNonces.delete(first);
    }

    await handler(data, auth.address);
  } catch (error) {
    ack?.({ ok: false, error: error.message || "Unauthorized" });
  }
};

const publishLobby = (lobbyId) => {
  const lobby = engine.getLobby(lobbyId);
  if (!lobby) return;
  io.to(lobbyId).emit("lobby:update", engine.serializeLobby(lobbyId));
  io.emit("lobby:refresh", { lobbyId, updatedAt: Date.now() });
  io.emit("lobby:list", engine.listLobbies());
};

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

// Czytaj lobbies z LobbyManager kontraktu
app.get("/api/lobbies", async (_, res) => {
  try {
    const contract = await initLobbyManagerContract();
    if (!contract) {
      return res.json([]);
    }

    const lobbyCount = await contract.getLobbyCount();
    const lobbies = [];

    for (let i = 1; i <= Number(lobbyCount); i++) {
      try {
        const [host, name, createdAt, status, prizePool, playerCount, winner] = await contract.getLobby(i);
        const players = await contract.getLobbyPlayers(i);
        lobbies.push({
          id: String(i),
          name,
          host,
          status: ["OPEN", "ACTIVE", "COMPLETED", "CANCELLED"][Number(status)],
          playerCount: Number(playerCount),
          prizePool: prizePool.toString(),
          players,
          createdAt: Number(createdAt),
          winner
        });
      } catch (e) {
        console.error("Error reading lobby", i, e.message);
      }
    }

    res.json(lobbies.reverse()); // Najnowsze najpierw
  } catch (e) {
    console.error("Failed to fetch lobbies", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/contracts", (_, res) => {
  try {
    const content = fs.readFileSync(deploymentPath, "utf8");
    res.json(JSON.parse(content));
  } catch {
    res.status(404).json({ error: "Deployments not found yet" });
  }
});

app.post("/api/map", (req, res) => {
  try {
    const seed = BigInt(req.body?.seed ?? 0);
    const radius = Number(req.body?.radius ?? 4);
    if (radius < 1 || radius > 12) {
      return res.status(400).json({ error: "Radius out of range" });
    }

    res.json({
      seed: seed.toString(),
      radius,
      hexes: engine.buildMapLayout(seed, radius)
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Invalid map request" });
  }
});

io.on("connection", (socket) => {
  // lobby:create i lobby:join są obsługiwane na kontrakcie (LobbyManager)
  // Gra się rozpoczyna za pośrednictwem Socket.IO game:start

  socket.on("game:start", async (payload, ack) => {
    await secureAction({
      socket,
      eventName: "game:start",
      payload,
      ack,
      expectedAddress: payload?.data?.by,
      handler: async (data) => {
        const { lobbyId, by } = data;
        engine.startGame({ lobbyId, by });
        publishLobby(lobbyId);
        ack?.({ ok: true });
      }
    });
  });

  socket.on("game:end-round", async (payload, ack) => {
    await secureAction({
      socket,
      eventName: "game:end-round",
      payload,
      ack,
      expectedAddress: payload?.data?.by,
      handler: async (data) => {
        const { lobbyId } = data;
        await engine.advanceRound(lobbyId);
        publishLobby(lobbyId);
        ack?.({ ok: true });
      }
    });
  });

  socket.on("game:pick-start", async (payload, ack) => {
    await secureAction({
      socket,
      eventName: "game:pick-start",
      payload,
      ack,
      expectedAddress: payload?.data?.address,
      handler: async (data) => {
        const { lobbyId, address, hexId } = data;
        engine.selectStartingHex({ lobbyId, address, hexIdValue: hexId });
        publishLobby(lobbyId);
        ack?.({ ok: true });
      }
    });
  });

  socket.on("game:discover", async (payload, ack) => {
    await secureAction({
      socket,
      eventName: "game:discover",
      payload,
      ack,
      expectedAddress: payload?.data?.address,
      handler: async (data) => {
        const { lobbyId, address, hexId } = data;
        engine.discoverHex({ lobbyId, address, targetHexId: hexId });
        publishLobby(lobbyId);
        ack?.({ ok: true });
      }
    });
  });

  socket.on("game:build", async (payload, ack) => {
    await secureAction({
      socket,
      eventName: "game:build",
      payload,
      ack,
      expectedAddress: payload?.data?.address,
      handler: async (data) => {
        const { lobbyId, address, hexId } = data;
        engine.buildStructure({ lobbyId, address, targetHexId: hexId });
        publishLobby(lobbyId);
        ack?.({ ok: true });
      }
    });
  });

  socket.on("game:upgrade", async (payload, ack) => {
    await secureAction({
      socket,
      eventName: "game:upgrade",
      payload,
      ack,
      expectedAddress: payload?.data?.address,
      handler: async (data) => {
        const { lobbyId, address, hexId } = data;
        engine.upgradeStructure({ lobbyId, address, targetHexId: hexId });
        publishLobby(lobbyId);
        ack?.({ ok: true });
      }
    });
  });

  socket.on("game:collect", async (payload, ack) => {
    await secureAction({
      socket,
      eventName: "game:collect",
      payload,
      ack,
      expectedAddress: payload?.data?.address,
      handler: async (data) => {
        const { lobbyId, address, hexId } = data;
        const result = engine.collect({ lobbyId, address, targetHexId: hexId });
        publishLobby(lobbyId);
        ack?.({ ok: true, result });
      }
    });
  });

  socket.on("barter:create", async (payload, ack) => {
    await secureAction({
      socket,
      eventName: "barter:create",
      payload,
      ack,
      expectedAddress: payload?.data?.from,
      handler: async (data) => {
        const { lobbyId, from, to, offer, request } = data;
        engine.createBarter({ lobbyId, from, to, offer, request });
        publishLobby(lobbyId);
        ack?.({ ok: true });
      }
    });
  });

  socket.on("barter:accept", async (payload, ack) => {
    await secureAction({
      socket,
      eventName: "barter:accept",
      payload,
      ack,
      expectedAddress: payload?.data?.by,
      handler: async (data) => {
        const { lobbyId, barterId, by } = data;
        engine.acceptBarter({ lobbyId, barterId, by });
        publishLobby(lobbyId);
        ack?.({ ok: true });
      }
    });
  });

  socket.on("vote:create", async (payload, ack) => {
    await secureAction({
      socket,
      eventName: "vote:create",
      payload,
      ack,
      expectedAddress: payload?.data?.by,
      handler: async (data) => {
        const { lobbyId, by, title, effect } = data;
        engine.createVote({ lobbyId, by, title, effect });
        publishLobby(lobbyId);
        ack?.({ ok: true });
      }
    });
  });

  socket.on("vote:cast", async (payload, ack) => {
    await secureAction({
      socket,
      eventName: "vote:cast",
      payload,
      ack,
      expectedAddress: payload?.data?.by,
      handler: async (data) => {
        const { lobbyId, voteId, by, support } = data;
        engine.castVote({ lobbyId, voteId, by, support });
        publishLobby(lobbyId);
        ack?.({ ok: true });
      }
    });
  });

  socket.on("lobby:watch", async ({ lobbyId, address }) => {
    socket.join(lobbyId);

    // Zawsze dociągaj stan runtime z GameCore, bo lobby może już istnieć w cache po liście lobby.
    if (lobbyManagerContract) {
      try {
        const lobby = await syncLobbyRuntimeState(lobbyId);
        if (!lobby) {
          socket.emit("lobby:update", null);
          return;
        }
      } catch (e) {
        console.error("Failed to sync lobby from contract", lobbyId, e.message);
      }
    }

    socket.emit("lobby:update", engine.serializeLobby(lobbyId, address));
  });
});

const shortAddress = (address) => `${address.slice(0, 6)}...${address.slice(-4)}`;

const ensureLobbyFromChain = async (lobbyId) => {
  const contract = await initLobbyManagerContract();
  if (!contract) return null;
  const [host, name, createdAt, status, prizePool] = await contract.getLobby(lobbyId);
  if (!host || !name) return null;
  const gameContract = await initGameCoreContract();
  let mapSeed = 0;
  let mapRadius = 4;
  if (gameContract) {
    try {
      const mapConfig = await gameContract.getMapConfig(lobbyId);
      mapSeed = Number(mapConfig[0]);
      mapRadius = Number(mapConfig[1]) || 4;
    } catch (e) {
      console.error("Failed to load map config", e.message);
    }
  }
  const existingLobby = engine.getLobby(lobbyId);
  const lobby = existingLobby || engine.createLobby({
    id: String(lobbyId),
    name,
    host,
    createdAt: Number(createdAt),
    status: ["OPEN", "ACTIVE", "COMPLETED", "CANCELLED"][Number(status)],
    prizePool: prizePool.toString(),
    mapSeed,
    mapRadius
  });
  if (existingLobby) {
    existingLobby.name = name;
    existingLobby.host = host;
    existingLobby.prizePool = prizePool.toString();
    existingLobby.status = ["OPEN", "ACTIVE", "COMPLETED", "CANCELLED"][Number(status)];
    engine.setMapConfig(lobbyId, mapSeed, mapRadius);
  }
  return lobby;
};

const syncLobbyRuntimeState = async (lobbyId) => {
  const lobby = await ensureLobbyFromChain(lobbyId);
  if (!lobby) return null;

  const gameContract = await initGameCoreContract();
  if (!gameContract) return lobby;

  try {
    const [roundIndex, roundEndsAt, zeroRoundEndsAt, status] = await gameContract.getLobbyRound(lobbyId);
    lobby.status = ["waiting", "zero-round", "running", "ended"][Number(status)] || lobby.status;
    lobby.rounds.index = Number(roundIndex);
    if (Number(roundEndsAt)) lobby.rounds.nextRoundAt = Number(roundEndsAt) * 1000;
    if (Number(zeroRoundEndsAt)) lobby.rounds.zeroRoundEndsAt = Number(zeroRoundEndsAt) * 1000;
  } catch (e) {
    console.error("Failed to sync runtime lobby state", e.message);
  }

  return lobby;
};

const bootContractListeners = async () => {
  const lobbyContract = await initLobbyManagerContract();
  if (lobbyContract) {
    lobbyContract.on("LobbyCreated", async (lobbyId, host, name) => {
      try {
        engine.createLobby({ id: String(lobbyId), name, host });
        publishLobby(String(lobbyId));
      } catch (e) {
        console.error("LobbyCreated listener failed", e.message);
      }
    });

    lobbyContract.on("TicketBought", async (lobbyId, player) => {
      try {
        const key = String(lobbyId);
        await ensureLobbyFromChain(key);
        if (engine.getLobby(key) && !engine.getPlayer(engine.getLobby(key), player)) {
          engine.joinLobby({ lobbyId: key, player: { address: player, nickname: shortAddress(player), hasTicket: true } });
        }
        engine.syncTicketStatus({ lobbyId: key, address: player, hasTicket: true });
        publishLobby(key);
      } catch (e) {
        console.error("TicketBought listener failed", e.message);
      }
    });

    lobbyContract.on("GameStarted", async (lobbyId) => {
      try {
        const key = String(lobbyId);
        const lobby = await ensureLobbyFromChain(key);
        if (!lobby) return;
        engine.startGame({ lobbyId: key, by: lobby.host });
        publishLobby(key);
      } catch (e) {
        console.error("GameStarted listener failed", e.message);
      }
    });

    lobbyContract.on("LobbyCancelled", async (lobbyId) => {
      try {
        const lobby = engine.getLobby(String(lobbyId));
        if (lobby) lobby.status = "cancelled";
        publishLobby(String(lobbyId));
      } catch (e) {
        console.error("LobbyCancelled listener failed", e.message);
      }
    });
  }

  const gameContract = await initGameCoreContract();
  if (gameContract) {
    gameContract.on("LobbyBootstrapped", async (lobbyId, host, mapSeed, mapRadius) => {
      try {
        const key = String(lobbyId);
        if (!engine.getLobby(key)) {
          engine.createLobby({ id: key, name: `Lobby ${key}`, host, mapSeed: Number(mapSeed), mapRadius: Number(mapRadius) || 4 });
        } else {
          engine.setMapConfig(key, Number(mapSeed), Number(mapRadius) || 4);
        }
        publishLobby(key);
      } catch (e) {
        console.error("LobbyBootstrapped listener failed", e.message);
      }
    });

    gameContract.on("LobbyStarted", async (lobbyId, roundIndex, roundEndsAt) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        lobby.status = "zero-round";
        lobby.rounds.index = Number(roundIndex);
        lobby.rounds.zeroRoundEndsAt = Number(roundEndsAt) * 1000;
        lobby.rounds.nextRoundAt = Number(roundEndsAt) * 1000;
        publishLobby(key);
      } catch (e) {
        console.error("LobbyStarted listener failed", e.message);
      }
    });

    gameContract.on("RoundAdvanced", async (lobbyId, roundIndex, roundEndsAt) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        lobby.status = "running";
        lobby.rounds.index = Number(roundIndex);
        lobby.rounds.nextRoundAt = Number(roundEndsAt) * 1000;
        lobby.rounds.zeroRoundEndsAt = null;
        publishLobby(key);
      } catch (e) {
        console.error("RoundAdvanced listener failed", e.message);
      }
    });

    gameContract.on("HexPicked", async (lobbyId, player, hexId) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        const hex = lobby.mapHexes.find((tile) => tile.id === String(hexId));
        if (hex) {
          hex.owner = player;
          if (!hex.discoveredBy.includes(player)) hex.discoveredBy.push(player);
        }
        publishLobby(key);
      } catch (e) {
        console.error("HexPicked listener failed", e.message);
      }
    });

    gameContract.on("HexDiscovered", async (lobbyId, player, hexId) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        const hex = lobby.mapHexes.find((tile) => tile.id === String(hexId));
        if (hex && !hex.discoveredBy.includes(player)) hex.discoveredBy.push(player);
        publishLobby(key);
      } catch (e) {
        console.error("HexDiscovered listener failed", e.message);
      }
    });

    gameContract.on("StructureBuilt", async (lobbyId, player, hexId, level) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        const hex = lobby.mapHexes.find((tile) => tile.id === String(hexId));
        if (hex) {
          hex.owner = player;
          hex.structure = { level: Number(level), collectedAtRound: null, builtAtRound: lobby.rounds.index };
        }
        publishLobby(key);
      } catch (e) {
        console.error("StructureBuilt listener failed", e.message);
      }
    });

    gameContract.on("StructureUpgraded", async (lobbyId, player, hexId, level) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        const hex = lobby.mapHexes.find((tile) => tile.id === String(hexId));
        if (hex?.structure) {
          hex.structure.level = Number(level);
        }
        publishLobby(key);
      } catch (e) {
        console.error("StructureUpgraded listener failed", e.message);
      }
    });

    gameContract.on("StructureDestroyed", async (lobbyId, player, hexId) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        const hex = lobby.mapHexes.find((tile) => tile.id === String(hexId));
        if (hex) {
          hex.structure = null;
        }
        publishLobby(key);
      } catch (e) {
        console.error("StructureDestroyed listener failed", e.message);
      }
    });

    gameContract.on("ResourcesCollected", async (lobbyId, player, hexId, resourceKey, amount) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        engine.collect({ lobbyId: key, address: player, targetHexId: hexId });
        publishLobby(key);
      } catch (e) {
        console.error("ResourcesCollected listener failed", e.message);
      }
    });

    gameContract.on("TradeCreated", async (lobbyId, tradeId, maker, taker) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        const trade = await gameContract.getTrade(lobbyId, tradeId);
        const offer = {
          food: Number(trade[5]),
          wood: Number(trade[6]),
          stone: Number(trade[7]),
          ore: Number(trade[8]),
          energy: Number(trade[9])
        };
        const request = {
          food: Number(trade[10]),
          wood: Number(trade[11]),
          stone: Number(trade[12]),
          ore: Number(trade[13]),
          energy: Number(trade[14])
        };
        lobby.barterOffers.unshift({ id: String(tradeId), from: maker, to: taker, offer, request, status: "pending" });
        publishLobby(key);
      } catch (e) {
        console.error("TradeCreated listener failed", e.message);
      }
    });

    gameContract.on("TradeAccepted", async (lobbyId, tradeId, taker) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        const trade = lobby.barterOffers.find((entry) => entry.id === String(tradeId));
        if (trade) trade.status = "accepted";
        publishLobby(key);
      } catch (e) {
        console.error("TradeAccepted listener failed", e.message);
      }
    });

    gameContract.on("ProposalCreated", async (lobbyId, proposalId, title, effectKey) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        let effect = null;
        try {
          effect = JSON.parse(effectKey);
        } catch {
          effect = { label: effectKey };
        }
        lobby.globalVotes.unshift({ id: String(proposalId), title, effect, yesVotes: 0, noVotes: 0, closesAtRound: lobby.rounds.index + 3, resolved: false, passed: false });
        publishLobby(key);
      } catch (e) {
        console.error("ProposalCreated listener failed", e.message);
      }
    });

    gameContract.on("ProposalVoted", async (lobbyId, proposalId, voter, support) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        const proposal = lobby.globalVotes.find((entry) => entry.id === String(proposalId));
        if (proposal) {
          if (support) proposal.yesVotes += 1;
          else proposal.noVotes += 1;
        }
        publishLobby(key);
      } catch (e) {
        console.error("ProposalVoted listener failed", e.message);
      }
    });

    gameContract.on("ProposalResolved", async (lobbyId, proposalId, passed) => {
      try {
        const key = String(lobbyId);
        const lobby = await syncLobbyRuntimeState(key);
        if (!lobby) return;
        lobby.globalVotes = lobby.globalVotes.filter((entry) => entry.id !== String(proposalId));
        publishLobby(key);
      } catch (e) {
        console.error("ProposalResolved listener failed", e.message);
      }
    });
  }
};

await bootContractListeners();

const port = Number(process.env.PORT || 4000);
server.listen(port, () => {
  console.log(`Equilibrium backend on :${port}`);
});
