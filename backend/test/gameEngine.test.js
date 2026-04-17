import test from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../src/gameEngine.js";

const aiDirector = {
  async decideEvent() {
    return { effectId: "richDeposit", source: "fallback" };
  }
};

function createEngine() {
  return new GameEngine({ roundDurationMs: 600000, zeroRoundDurationMs: 300000, aiDirector });
}

test("round maintenance caps energy at 100", async () => {
  const engine = createEngine();
  const lobby = engine.createLobby({
    id: "1",
    name: "Alpha",
    host: { address: "0x1000000000000000000000000000000000000001", nickname: "Host" },
    mapSeed: 123n,
    mapRadius: 4
  });

  lobby.status = "running";
  lobby.rounds.index = 1;
  lobby.players[0].resources.energy = 40;

  await engine.advanceRound("1");

  assert.equal(lobby.players[0].resources.energy, 100);
});

test("bankruptcy destroys structures and frees the hex", async () => {
  const engine = createEngine();
  const lobby = engine.createLobby({
    id: "2",
    name: "Beta",
    host: { address: "0x2000000000000000000000000000000000000002", nickname: "Host" },
    mapSeed: 456n,
    mapRadius: 4
  });

  lobby.status = "running";
  lobby.rounds.index = 1;
  const player = lobby.players[0];
  player.resources.food = 0;
  player.resources.energy = 100;

  const ownedHex = lobby.mapHexes.find((hex) => hex.owner === null && hex.biome);
  assert.ok(ownedHex);
  ownedHex.owner = player.address;
  ownedHex.structure = {
    level: 1,
    collectedAtRound: null,
    builtAtRound: 0,
    exists: true
  };

  await engine.advanceRound("2");
  assert.equal(player.bankruptRounds, 1);
  assert.equal(player.alive, true);
  assert.equal(ownedHex.owner, player.address);
  assert.equal(ownedHex.structure?.exists, true);

  player.resources.food = 0;
  await engine.advanceRound("2");

  assert.equal(player.alive, false);
  assert.equal(player.bankruptRounds >= 2, true);
  assert.equal(ownedHex.owner, null);
  assert.equal(ownedHex.structure, null);
});
