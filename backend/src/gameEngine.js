import { BASE_ENERGY_REGEN, BIOMES, BIOME_RESOURCE, ROUND_EFFECTS, STARTING_RESOURCES } from "./constants.js";
import { AbiCoder, keccak256 } from "ethers";

const BIOME_VALUES = Object.values(BIOMES);

const DIRECTIONS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1]
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const sample = (arr) => arr[Math.floor(Math.random() * arr.length)];

const hashCoord = (seed, q, r) => {
  const encoded = AbiCoder.defaultAbiCoder().encode(["uint256", "int256", "int256"], [BigInt(seed), q, r]);
  return BigInt(keccak256(encoded));
};

const biomeForCoord = (seed, q, r) => {
  const value = hashCoord(seed, q, r);
  return BIOME_VALUES[Number(value % BigInt(BIOME_VALUES.length))];
};

const hexId = (q, r) => `${q},${r}`;

const parseHexId = (id) => {
  const [q, r] = id.split(",").map(Number);
  return { q, r };
};

const neighborsOf = (q, r) => DIRECTIONS.map(([dq, dr]) => ({ q: q + dq, r: r + dr, id: hexId(q + dq, r + dr) }));

const createMap = (seed, radius) => {
  const hexes = [];
  for (let q = -radius; q <= radius; q += 1) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r += 1) {
      hexes.push({
        id: hexId(q, r),
        q,
        r,
        biome: biomeForCoord(seed, q, r),
        owner: null,
        discoveredBy: [],
        structure: null
      });
    }
  }
  return hexes;
};

const hasAdjacency = (player, hexes, targetHex) => {
  const owned = hexes.filter((h) => h.owner === player.address);
  if (!owned.length) return false;

  const ownedSet = new Set(owned.map((h) => h.id));
  const neigh = neighborsOf(targetHex.q, targetHex.r);
  return neigh.some((n) => ownedSet.has(n.id));
};

const getExploreCost = (ownedCount) => {
  if (ownedCount <= 1) return { food: 40, wood: 40, stone: 40, ore: 40 };
  const multiplier = Math.pow(1.5, ownedCount - 1);
  return {
    food: Math.round(40 * multiplier),
    wood: Math.round(40 * multiplier),
    stone: Math.round(40 * multiplier),
    ore: Math.round(40 * multiplier)
  };
};

const enoughResources = (resources, cost) => Object.entries(cost).every(([key, value]) => resources[key] >= value);

const subtractResources = (resources, cost) => {
  Object.entries(cost).forEach(([key, value]) => {
    resources[key] -= value;
  });
};

const addResources = (resources, bonus) => {
  Object.entries(bonus).forEach(([key, value]) => {
    resources[key] = (resources[key] ?? 0) + value;
  });
};

export class GameEngine {
  constructor({ roundDurationMs, zeroRoundDurationMs, aiDirector }) {
    this.roundDurationMs = roundDurationMs;
    this.zeroRoundDurationMs = zeroRoundDurationMs;
    this.aiDirector = aiDirector;
    this.lobbies = new Map();
  }

  buildMapLayout(mapSeed, mapRadius) {
    return createMap(mapSeed, mapRadius);
  }

  createLobby({ id, name, host, prizePool = "0", mapSeed = 0, mapRadius = 4 }) {
    // Jeśli ID nie podane (z Socket.IO), generuj; jeśli podane (z LobbyManager), używaj
    const lobbyId = id || `lobby-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const lobby = {
      id: lobbyId,
      name,
      host: host.address || host, // host może być string (z kontraktu) lub object (z Socket.IO)
      hostNickname: host.nickname || "Host",
      createdAt: Date.now(),
      status: "waiting",
      mapSeed,
      mapRadius,
      players: [],
      rounds: {
        index: 0,
        startedAt: null,
        nextRoundAt: null,
        zeroRoundEndsAt: null
      },
      pollution: 0,
      prizePool,
      mapHexes: createMap(mapSeed, mapRadius),
      activeEffects: [],
      globalVotes: [],
      barterOffers: [],
      logs: [],
      pendingEarthquake: null,
      pendingTimeout: null
    };

    this.lobbies.set(lobbyId, lobby);
    const playerObj = typeof host === 'object'
      ? { ...host, hasTicket: true }
      : { address: host, nickname: "Host", hasTicket: true };
    this.joinLobby({ lobbyId, player: playerObj });
    const hostPlayer = this.getPlayer(lobby, playerObj.address);
    if (hostPlayer) {
      hostPlayer.hasTicket = true;
    }
    return lobby;
  }

  setMapConfig(lobbyId, mapSeed, mapRadius) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");
    const nextSeed = Number(mapSeed) || 0;
    const nextRadius = Number(mapRadius) || 4;
    if (lobby.mapSeed === nextSeed && lobby.mapRadius === nextRadius) {
      return lobby;
    }

    lobby.mapSeed = nextSeed;
    lobby.mapRadius = nextRadius;
    lobby.mapHexes = createMap(nextSeed, nextRadius);
    return lobby;
  }

  listLobbies() {
    return [...this.lobbies.values()].map((lobby) => ({
      id: lobby.id,
      name: lobby.name,
      status: lobby.status,
      playerCount: lobby.players.length,
      host: lobby.host,
      prizePool: lobby.prizePool,
      createdAt: lobby.createdAt
    }));
  }

  getLobby(lobbyId) {
    return this.lobbies.get(lobbyId);
  }

  getPlayer(lobby, address) {
    return lobby.players.find((p) => p.address.toLowerCase() === address.toLowerCase());
  }

  joinLobby({ lobbyId, player }) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) throw new Error("Lobby not found");
    if (lobby.status !== "waiting" && lobby.status !== "zero-round") throw new Error("Lobby already started");

    const exists = this.getPlayer(lobby, player.address);
    if (!exists) {
      lobby.players.push({
        address: player.address,
        nickname: player.nickname,
        hasTicket: Boolean(player.hasTicket),
        bankruptRounds: 0,
        alive: true,
        resources: { ...STARTING_RESOURCES },
        votesCast: {},
        collectedThisRound: {},
        shake: false
      });
    }

    return lobby;
  }

  syncTicketStatus({ lobbyId, address, hasTicket }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");
    const player = this.getPlayer(lobby, address);
    if (!player) throw new Error("Player not found");
    player.hasTicket = !!hasTicket;
    return player;
  }

  startGame({ lobbyId, by }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");
    if (lobby.host.toLowerCase() !== by.toLowerCase()) throw new Error("Only host can start");
    if (lobby.players.length < 1) throw new Error("Need at least 1 player");
    if (lobby.status !== "waiting") throw new Error("Game already started");

    lobby.status = "zero-round";
    lobby.rounds.startedAt = Date.now();
    lobby.rounds.zeroRoundEndsAt = Date.now() + this.zeroRoundDurationMs;

    const playerOrder = [...lobby.players].sort(() => Math.random() - 0.5).map((p) => p.address);
    lobby.logs.unshift({
      id: `log-${Date.now()}`,
      type: "info",
      text: `Round 0: starting order: ${playerOrder.join(" -> ")}`,
      timestamp: Date.now()
    });
    lobby.zeroRoundQueue = playerOrder;
    lobby.zeroRoundIndex = 0;
    return lobby;
  }

  selectStartingHex({ lobbyId, address, hexIdValue }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");
    if (lobby.status !== "zero-round") throw new Error("Not in zero round");

    const player = this.getPlayer(lobby, address);
    if (!player || !player.alive) throw new Error("Player not active");

    const expected = lobby.zeroRoundQueue[lobby.zeroRoundIndex];
    if (!expected || expected.toLowerCase() !== address.toLowerCase()) {
      throw new Error("Not your turn in round zero");
    }

    const hex = lobby.mapHexes.find((h) => h.id === hexIdValue);
    if (!hex) throw new Error("Hex not found");
    if (hex.owner) throw new Error("Hex already claimed");

    const alreadyOwned = lobby.mapHexes.some((h) => h.owner?.toLowerCase() === address.toLowerCase());
    if (alreadyOwned) throw new Error("Starting hex already chosen");

    hex.owner = address;
    if (!hex.discoveredBy.includes(address)) hex.discoveredBy.push(address);

    lobby.zeroRoundIndex += 1;
    lobby.logs.unshift({
      id: `log-${Date.now()}`,
      type: "action",
      text: `${address} picked starting hex ${hex.id}`,
      timestamp: Date.now()
    });

    if (lobby.zeroRoundIndex >= lobby.zeroRoundQueue.length) {
      this.beginMainRounds(lobby);
    }

    return lobby;
  }

  beginMainRounds(lobby) {
    lobby.status = "running";
    lobby.rounds.index = 1;
    lobby.logs.unshift({
      id: `log-${Date.now()}`,
      type: "system",
      text: "Start rund glownych",
      timestamp: Date.now()
    });
  }

  scheduleRoundAdvance(lobby, delay) {
    if (lobby.pendingTimeout) clearTimeout(lobby.pendingTimeout);
    lobby.pendingTimeout = setTimeout(async () => {
      if (lobby.status === "zero-round") {
        this.forcePickForIdlePlayers(lobby);
        this.beginMainRounds(lobby);
      } else if (lobby.status === "running") {
        await this.advanceRound(lobby.id);
      }
    }, delay);
  }

  forcePickForIdlePlayers(lobby) {
    while (lobby.zeroRoundIndex < lobby.zeroRoundQueue.length) {
      const address = lobby.zeroRoundQueue[lobby.zeroRoundIndex];
      const freeHexes = lobby.mapHexes.filter((h) => !h.owner);
      const randomHex = sample(freeHexes);
      randomHex.owner = address;
      randomHex.discoveredBy.push(address);
      lobby.zeroRoundIndex += 1;
      lobby.logs.unshift({
        id: `log-${Date.now()}`,
        type: "system",
        text: `Auto-przydzial startowego heksa ${randomHex.id} dla ${address}`,
        timestamp: Date.now()
      });
    }
  }

  currentYieldMultiplier(lobby, biome, resourceName) {
    let multiplier = 1;

    for (const effect of lobby.activeEffects) {
      if (effect.multipliers?.[resourceName]) {
        multiplier *= effect.multipliers[resourceName];
      }
      if (effect.biomeMultipliers?.[biome]) {
        multiplier *= effect.biomeMultipliers[biome];
      }
    }

    for (const proposal of lobby.globalVotes) {
      if (proposal.applied && proposal.effect?.multipliers?.[resourceName]) {
        multiplier *= proposal.effect.multipliers[resourceName];
      }
      if (proposal.applied && proposal.effect?.biomeMultipliers?.[biome]) {
        multiplier *= proposal.effect.biomeMultipliers[biome];
      }
    }

    return multiplier;
  }

  createBarter({ lobbyId, from, to, offer, request }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");
    if (lobby.status !== "running") throw new Error("Game not running");
    if (!offer || !Object.keys(offer).length) throw new Error("Trade offer required");
    if (!request || !Object.keys(request).length) throw new Error("Trade request required");

    const fromPlayer = this.getPlayer(lobby, from);
    const toPlayer = this.getPlayer(lobby, to);

    if (!fromPlayer || !toPlayer) throw new Error("Players not found");
    if (!fromPlayer.alive || !toPlayer.alive) throw new Error("One of players is bankrupt");
    if (!enoughResources(fromPlayer.resources, offer)) throw new Error("Insufficient offered resources");

    const barter = {
      id: `barter-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      from,
      offer,
      request,
      status: "pending",
      createdAt: Date.now(),
      expiresAtRound: lobby.rounds.index + 2
    };

    lobby.barterOffers.unshift(barter);
    return barter;
  }

  acceptBarter({ lobbyId, barterId, by }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");

    const barter = lobby.barterOffers.find((b) => b.id === barterId);
    if (!barter) throw new Error("Barter not found");
    if (barter.status !== "pending") throw new Error("Barter already resolved");
    if (lobby.rounds.index > barter.expiresAtRound) throw new Error("Barter expired");
    if (barter.from.toLowerCase() === by.toLowerCase()) throw new Error("Maker cannot accept own trade");

    const fromPlayer = this.getPlayer(lobby, barter.from);
    const toPlayer = this.getPlayer(lobby, by);

    if (!enoughResources(fromPlayer.resources, barter.offer)) throw new Error("Offer no longer available");
    if (!enoughResources(toPlayer.resources, barter.request)) throw new Error("Request no longer available");

    subtractResources(fromPlayer.resources, barter.offer);
    subtractResources(toPlayer.resources, barter.request);

    addResources(fromPlayer.resources, barter.request);
    addResources(toPlayer.resources, barter.offer);

    barter.status = "accepted";
    barter.acceptedBy = by;
    barter.acceptedAt = Date.now();

    lobby.logs.unshift({
      id: `log-${Date.now()}`,
      type: "trade",
      text: `Trade accepted: ${barter.from} <-> ${by}`,
      timestamp: Date.now()
    });

    return barter;
  }

  createVote({ lobbyId, by, title, effect }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");

    const player = this.getPlayer(lobby, by);
    if (!player || !player.hasTicket) throw new Error("Ticket required");

    const vote = {
      id: `vote-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      title,
      by,
      votesYes: 0,
      votesNo: 0,
      voters: {},
      effect,
      closesAtRound: lobby.rounds.index + 3,
      applied: false,
      resolved: false
    };

    lobby.globalVotes.unshift(vote);
    return vote;
  }

  castVote({ lobbyId, voteId, by, support }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");

    const player = this.getPlayer(lobby, by);
    if (!player || !player.hasTicket) throw new Error("Ticket required");

    const vote = lobby.globalVotes.find((v) => v.id === voteId);
    if (!vote) throw new Error("Vote not found");
    if (vote.voters[by]) throw new Error("Already voted");

    vote.voters[by] = true;
    if (support) vote.votesYes += 1;
    else vote.votesNo += 1;

    return vote;
  }

  resolveVotes(lobby) {
    for (const vote of lobby.globalVotes) {
      if (vote.resolved) continue;
      if (lobby.rounds.index < vote.closesAtRound) continue;
      vote.resolved = true;
      vote.applied = vote.votesYes > vote.votesNo;
      if (vote.applied && vote.effect) {
        lobby.activeEffects.push({
          ...vote.effect,
          remainingRounds: vote.effect.rounds ?? 2
        });
        lobby.logs.unshift({
          id: `log-${Date.now()}`,
          type: "vote",
          text: `Vote passed: ${vote.title}`,
          timestamp: Date.now()
        });
      } else {
        lobby.logs.unshift({
          id: `log-${Date.now()}`,
          type: "vote",
          text: `Vote failed: ${vote.title}`,
          timestamp: Date.now()
        });
      }
    }

    lobby.globalVotes = lobby.globalVotes.filter((vote) => !vote.resolved);
  }

  cleanupExpiredBarters(lobby) {
    lobby.barterOffers = lobby.barterOffers.filter((barter) => {
      if (barter.status !== "pending") return true;
      return lobby.rounds.index <= barter.expiresAtRound;
    });
  }

  discoverHex({ lobbyId, address, targetHexId }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");
    if (lobby.status !== "running") throw new Error("Game not running");

    const player = this.getPlayer(lobby, address);
    if (!player || !player.alive) throw new Error("Player not active");

    const hex = lobby.mapHexes.find((h) => h.id === targetHexId);
    if (!hex) throw new Error("Hex not found");
    if (hex.owner && hex.owner.toLowerCase() !== address.toLowerCase()) throw new Error("Hex occupied");
    if (hex.owner && hex.owner.toLowerCase() === address.toLowerCase()) throw new Error("Already yours");

    if (!hasAdjacency(player, lobby.mapHexes, hex)) throw new Error("Must be adjacent");

    const ownedCount = lobby.mapHexes.filter((h) => h.owner?.toLowerCase() === address.toLowerCase()).length;
    const cost = getExploreCost(ownedCount);

    if (!enoughResources(player.resources, cost)) throw new Error("Not enough resources for discovery");

    subtractResources(player.resources, cost);

    hex.owner = address;
    if (!hex.discoveredBy.includes(address)) hex.discoveredBy.push(address);

    lobby.logs.unshift({
      id: `log-${Date.now()}`,
      type: "action",
      text: `${address} odkryl i zajal hex ${hex.id}`,
      timestamp: Date.now()
    });

    return { hex, cost };
  }

  buildStructure({ lobbyId, address, targetHexId }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");

    const player = this.getPlayer(lobby, address);
    if (!player || !player.alive) throw new Error("Player not active");

    const hex = lobby.mapHexes.find((h) => h.id === targetHexId);
    if (!hex) throw new Error("Hex not found");
    if (hex.owner?.toLowerCase() !== address.toLowerCase()) throw new Error("You do not own this hex");
    if (hex.structure) throw new Error("Structure already exists");

    const cost = { food: 10, wood: 10, stone: 10 };
    if (!enoughResources(player.resources, cost)) throw new Error("Not enough resources");

    subtractResources(player.resources, cost);
    hex.structure = {
      level: 1,
      collectedAtRound: null,
      builtAtRound: lobby.rounds.index
    };

    lobby.logs.unshift({
      id: `log-${Date.now()}`,
      type: "build",
      text: `${address} zbudowal strukture lvl1 na ${hex.id}`,
      timestamp: Date.now()
    });

    return hex;
  }

  upgradeStructure({ lobbyId, address, targetHexId }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");

    const player = this.getPlayer(lobby, address);
    if (!player || !player.alive) throw new Error("Player not active");

    const hex = lobby.mapHexes.find((h) => h.id === targetHexId);
    if (!hex?.structure) throw new Error("No structure here");
    if (hex.owner?.toLowerCase() !== address.toLowerCase()) throw new Error("You do not own this hex");
    if (hex.structure.level !== 1) throw new Error("Already upgraded");

    const cost = { food: 30, stone: 30, ore: 30 };
    if (!enoughResources(player.resources, cost)) throw new Error("Not enough resources");

    subtractResources(player.resources, cost);
    hex.structure.level = 2;

    lobby.logs.unshift({
      id: `log-${Date.now()}`,
      type: "build",
      text: `${address} ulepszyl strukture do lvl2 na ${hex.id}`,
      timestamp: Date.now()
    });

    return hex;
  }

  collect({ lobbyId, address, targetHexId }) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) throw new Error("Lobby not found");

    const player = this.getPlayer(lobby, address);
    if (!player || !player.alive) throw new Error("Player not active");

    const hex = lobby.mapHexes.find((h) => h.id === targetHexId);
    if (!hex?.structure) throw new Error("No structure here");
    if (hex.owner?.toLowerCase() !== address.toLowerCase()) throw new Error("You do not own this hex");

    if (hex.structure.builtAtRound >= lobby.rounds.index) throw new Error("Production starts next round");
    if (hex.structure.collectedAtRound === lobby.rounds.index) throw new Error("Already collected this round");

    const energyCost = hex.structure.level === 1 ? 10 : 20;
    if (player.resources.energy < energyCost) throw new Error("Not enough energy");

    player.resources.energy -= energyCost;

    const resourceKey = BIOME_RESOURCE[hex.biome];
    const baseGain = hex.structure.level === 1 ? 30 : 60;
    const multiplier = this.currentYieldMultiplier(lobby, hex.biome, resourceKey);
    const gained = Math.round(baseGain * multiplier);

    player.resources[resourceKey] += gained;
    hex.structure.collectedAtRound = lobby.rounds.index;

    if (hex.biome === BIOMES.DESERT) lobby.pollution += hex.structure.level === 1 ? 5 : 8;
    if (hex.structure.level === 2) lobby.pollution += 2;

    lobby.logs.unshift({
      id: `log-${Date.now()}`,
      type: "collect",
      text: `${address} collected ${gained} ${resourceKey} from ${hex.id}`,
      timestamp: Date.now()
    });

    return { resourceKey, gained, energyCost };
  }

  applyMaintenance(lobby) {
    for (const player of lobby.players) {
      if (!player.alive) continue;

      const structures = lobby.mapHexes.filter((h) => h.owner?.toLowerCase() === player.address.toLowerCase() && h.structure);
      let foodCost = 0;
      let energyCost = 0;

      for (const hex of structures) {
        if (hex.structure.level === 1) {
          foodCost += 5;
          energyCost += 5;
        } else {
          foodCost += 10;
          energyCost += 10;
        }
      }

      const energyBonus = structures.reduce((acc, h) => acc + (h.structure.level === 2 ? 5 : 0), 0);
      const energyMultiplier = lobby.activeEffects.reduce((acc, effect) => acc * (effect.energyMultiplier ?? 1), 1);
      player.resources.energy = Math.min(100, Math.round((player.resources.energy + BASE_ENERGY_REGEN + energyBonus) * energyMultiplier));

      if (player.resources.food < foodCost) {
        player.bankruptRounds += 1;
      } else {
        player.resources.food -= foodCost;
        player.bankruptRounds = 0;
      }

      player.resources.energy = Math.max(0, player.resources.energy - energyCost);

      if (player.bankruptRounds >= 2) {
        player.alive = false;
        for (const hex of structures) {
          hex.structure = null;
          hex.owner = null;
        }

        lobby.logs.unshift({
          id: `log-${Date.now()}`,
          type: "collapse",
          text: `${player.address} went bankrupt. Structures destroyed and hexes are free to claim.`,
          timestamp: Date.now()
        });
      }
    }
  }

  applyActiveEffectTick(lobby) {
    for (const effect of lobby.activeEffects) {
      effect.remainingRounds -= 1;
    }
    lobby.activeEffects = lobby.activeEffects.filter((effect) => effect.remainingRounds > 0);

    lobby.pollution = clamp(lobby.pollution - 3, 0, 100);
  }

  async applyAiEvent(lobby) {
    const aiDecision = await this.aiDirector.decideEvent({
      round: lobby.rounds.index,
      pollution: lobby.pollution,
      totalStructures: lobby.mapHexes.filter((h) => h.structure).length,
      alivePlayers: lobby.players.filter((p) => p.alive).length,
      resourceTotals: lobby.players.reduce(
        (acc, p) => {
          acc.food += p.resources.food;
          acc.wood += p.resources.wood;
          acc.stone += p.resources.stone;
          acc.ore += p.resources.ore;
          acc.energy += p.resources.energy;
          return acc;
        },
        { food: 0, wood: 0, stone: 0, ore: 0, energy: 0 }
      )
    });

    let effect = ROUND_EFFECTS[aiDecision?.effectId] ?? ROUND_EFFECTS[sample(Object.keys(ROUND_EFFECTS))];
    const sourceLabel = aiDecision?.source === "ollama" ? "AI" : "fallback";

    if (effect.id === "richDeposit") {
      const biome = sample(BIOME_VALUES);
      effect = {
        ...effect,
        biomeMultipliers: { [biome]: 1.35 }
      };
    }

    if (effect.id === "quake") {
      const eligible = lobby.mapHexes.filter((h) => h.structure?.level === 1);
      const count = Math.min(eligible.length, Math.random() > 0.5 ? 2 : 1);
      const targets = [];
      for (let i = 0; i < count; i += 1) {
        const selected = eligible.splice(Math.floor(Math.random() * eligible.length), 1)[0];
        if (!selected) continue;
        selected.structure = null;
        targets.push(selected.id);
      }
      lobby.pendingEarthquake = { atRound: lobby.rounds.index, targets };
      lobby.logs.unshift({
        id: `log-${Date.now()}`,
        type: "ai",
        text: `${sourceLabel === "AI" ? "AI Event" : "Fallback Event"}: ${effect.label}. Destroyed hexes: ${targets.join(", ") || "none"}`,
        timestamp: Date.now()
      });
    } else {
      lobby.pendingEarthquake = null;
      lobby.activeEffects.push({
        ...effect,
        remainingRounds: effect.rounds
      });

      lobby.logs.unshift({
        id: `log-${Date.now()}`,
        type: "ai",
        text: `${sourceLabel === "AI" ? "AI Event" : "Fallback Event"}: ${effect.label}`,
        timestamp: Date.now()
      });
    }

    if (lobby.pollution > 85 && lobby.players.filter((p) => p.hasTicket).length < Math.ceil(lobby.players.length / 2)) {
      lobby.activeEffects.push({ ...ROUND_EFFECTS.energyCrisis, remainingRounds: 1 });
      lobby.logs.unshift({
        id: `log-${Date.now()}`,
        type: "ai",
        text: `${sourceLabel === "AI" ? "AI Event" : "Fallback Event"}: Energy crisis / wipeout caused by high pollution and low cooperation.`,
        timestamp: Date.now()
      });
    }
  }

  async advanceRound(lobbyId) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby || lobby.status !== "running") return lobby;

    this.applyMaintenance(lobby);
    this.resolveVotes(lobby);
    this.cleanupExpiredBarters(lobby);
    await this.applyAiEvent(lobby);
    this.applyActiveEffectTick(lobby);

    lobby.rounds.index += 1;

    for (const hex of lobby.mapHexes) {
      if (hex.structure) {
        if (hex.structure.collectedAtRound && hex.structure.collectedAtRound < lobby.rounds.index) {
          hex.structure.collectedAtRound = null;
        }
      }
    }
    return lobby;
  }

  serializeLobby(lobbyId, viewerAddress) {
    const lobby = this.getLobby(lobbyId);
    if (!lobby) return null;

    const me = viewerAddress ? this.getPlayer(lobby, viewerAddress) : null;

    return {
      id: lobby.id,
      name: lobby.name,
      host: lobby.host,
      status: lobby.status,
      rounds: lobby.rounds,
      pollution: lobby.pollution,
      prizePool: lobby.prizePool,
      players: lobby.players,
      me,
      mapHexes: lobby.mapHexes,
      activeEffects: lobby.activeEffects,
      globalVotes: lobby.globalVotes,
      barterOffers: lobby.barterOffers.slice(0, 12),
      logs: lobby.logs.slice(0, 30),
      pendingEarthquake: lobby.pendingEarthquake
    };
  }
}
