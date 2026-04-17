# Gameplay skill (tactics & I/O)

This file is **tactics and contracts**, not personality. Identity is a markdown file under `personas/` (default **`personas/equinox.md`** if `PLAYER_IDENTITY_PATH` is unset). Override this file with `PLAYER_STRATEGY_PATH` (legacy: `EQUINOX_STRATEGY_PATH`).

## Snapshot fields you must use

- **`economyHints`** (trust these numbers over guessing):
  - **`buildCost`**, **`upgradeCost`**, **`craftAlloyCost`**, **`discoverCostNext`** — exact on-chain costs.
  - **`discoverableHexIds`** — the **only** valid targets for **`discover`**: undiscovered hexes that share an edge with a hex you already own. Never pick a hex outside this list for discovery.
  - **`canAffordBuildSomewhere`**, **`canAffordUpgradeSomewhere`**, **`canAffordDiscover`**, **`canCraftAlloy`**.
  - **`hasAnyStructure`** — you already placed at least one building.
  - **`craftAlloyReasonable`** — only prefer smelting when this is **true** (expensive 10/10/10/10 basics; smelting before you have structures burns stock with no income).
  - **`alloyNeededToWin`**, **`victoryGoodsThreshold`**.
  - **Winning needs balanced basics, not one huge pile:** each **`craftAlloy`** spends **`craftAlloyCost`** (see **`craftAlloyCost`** in the snapshot — do not assume numbers if hints differ). **Current default deploy spec:** cost is **10** of each basic per craft, **1** alloy per craft, win at **5** alloy (`victoryGoodsThreshold` = 5). Then **50 / 50 / 50 / 50** food+wood+stone+ore (with **`craftedGoods`** at 0) is **exactly** enough to **`craftAlloy`** **five times in a row** and end the game — do **not** keep farming to 200+ if you could already close; when **`canCraftAlloy`** and **`craftAlloyReasonable`** allow it, **chain multiple `craftAlloy`** in one `actions` array until you hit the threshold or run out. If **`alloyNeededToWin`** is lower because you already have alloy, you need fewer than 50 per line — always trust **`economyHints`** over round numbers.
  - **Hoarding e.g. 900 food and 3 ore is a losing plan** — you cannot craft, and you waste turns. Aim to **diversify income** (more hexes + structures + biomes), then **rebalance** via trades or bank.
  - **Soft hoarding cap (prompt rule — follow in `thought` and actions):** treat **100** as the maximum you should hold of **each** of **food, wood, stone, ore** (check **`resources`** in the snapshot). If any basic is **≥ 100**, **do not** keep collecting from hexes that only add that same basic until you have **rebalanced** — prioritize **`craftAlloy`** (if affordable and reasonable), **`createTrade`** / **`acceptTrade`**, **`bankTrade`**, or **expand** (discover / build / upgrade) so other lines catch up. Going to 200+ on one basic while others stay low is **failure mode** (hamster wheel).
- **`peerAddresses`** — other players in this lobby (lowercase); use for **`createTrade`** diplomacy.
- **`openTrades`** — offers you may **`acceptTrade`** (you are named taker or the offer is open); each lists **`request`** / **`offer`** resources and **`expiresAtRound`**.
- **`rebalanceTradeDraft`** (inside **`economyHints`**, when not null) — precomputed barter (**`surplus`** → **`shortage`**) with concrete **`offer`** / **`request`** pouches. Use it as the **default shape** for a **single** open offer (`taker` `0x0`) **or** as a sanity check against **`bankTrade`**: if the draft only moves a few units and **bank** fixes the same shortage **this turn** with fewer moving parts, prefer **bank**; if the draft saves you net basics vs 4:1, prefer **player** side (accept or one create).
- **`playerAddress`** — lowercase; a tile is yours when `tiles[].owner` matches (case-insensitive).
- **`resources`**, **`craftedGoods`**, **`tiles`** (each tile: `structure.exists`, `structure.level`, `structure.builtAtRound`, `structure.collectedThisRound`), **`proposals`**, **`round.status`** (running = **2**).
- **`round.clock`** (running matches only): **`logicalRoundIndex`** and **`secondsLeftInTick`** — wall-clock projection of how many rounds have passed while the chain still shows a stale **`round.roundIndex`** until someone sends a transaction. Use **`round.clock.logicalRoundIndex`** (not only `round.roundIndex`) when reasoning about **`collect`** / “this round” vs **`builtAtRound`**. **`round.clock.chainRoundIndex`** is the on-chain index before sync.
- If **`snapshotNote`** appears, only use **`tiles[].id`** values that appear in the list.

## Map & ownership (hard rules)

- **Expansion (`discover`)** — you may annex **only** hexes that are **edge-adjacent** to a hex you **already own** (standard axial hex neighbors: 6 directions). The snapshot lists exactly which targets are legal in **`economyHints.discoverableHexIds`**. Choosing any other undiscovered hex **reverts on-chain**.
- **Build (`buildStructure`)** — only on **your** hexes that are **discovered** and **empty** (no structure yet).
- **Upgrade (`upgradeStructure`)** — only on **your** hexes where a **level-1** structure already exists (→ level 2). You cannot upgrade someone else’s land.

## Production rules (on-chain)

- **Collect** only if the hex is yours, a **structure exists**, **`builtAtRound` < `round.clock.logicalRoundIndex`** when **`round.clock`** is present (else **`round.roundIndex`**), not already collected this logical round (see `structure.collectedThisRound`), and you have enough **energy** — costs are **`economyHints.collectEnergyLevel1`** / **`collectEnergyLevel2`** (same as `GameCore.previewCollectionEnergyCost`; tune in `GameConfig.sol` and redeploy). **Yield** (how many basic units you gain, biome picks which kind) is **`economyHints.collectResourceYieldLevel1`** / **`collectResourceYieldLevel2`** (`GameConfig.collectionResourceYield` / `previewCollectionResourceYield`).
- **Build** on your own discovered hex with **no** structure yet; costs **`economyHints.buildCost`**.
- **Upgrade** level-1 → 2 on **your** hexes; costs **`economyHints.upgradeCost`**.
- **Discover** pays **`discoverCostNext`**, scales with empire size (capped on-chain), and **must** use **`hexId` ∈ `discoverableHexIds`**.

## Zero round (status **1**) — starting hex

When the payload has **`phase`: `"zeroRoundPick"`** (not the normal game snapshot):

- You **choose one** starting hex from **`candidateHexes`** (each has **`id`**, **`q`**, **`r`**, **`biome`**).
- If **`pickRule`** says only `candidateHexes`, you must not invent ids outside that list.
- If **`excludedHexIds`** is present, never pick those — another player may have taken them.
- Reply with **one JSON object**: `{"thought":"…","hexId":"q,r"}` — **`hexId`** must match **`candidateHexes[].id`** exactly (same string as `id`).
- Prefer a hex that fits **your identity** (e.g. Plains for safe food, Forest for wood, edge vs center).

## Action policy (critical)

**Strategic spine — do not only collect forever.** Collection refills one biome’s basic per structure; it does **not** replace **map growth**. If you only collect, you skew one resource and stall the alloy race.

### Bank vs players — compare, then commit (one barter path)

- **`bankTrade`** is **immediate** (no peer has to accept). Rate is **4:1** (four units sold of **`sellKind`** → one unit bought of **`buyKind`**; kinds **0–3** = food, wood, stone, ore). Treat the bank as **first-class**: use it whenever it is the **clearest or best** way to fix a shortage **this same plan** (e.g. you need ore to **discover**/ **build** / **craftAlloy** soon and holding excess food — bank food→ore can be smarter than waiting on humans).
- **Before emitting any trade actions**, scan **`openTrades`**: if an **`acceptTrade`** gives you a **strictly better** ratio than 4:1 for what you need, **accept** that one best offer (do not accept a mediocre deal when bank is cheaper).
- **Do not shotgun `createTrade`:** in a **single** `actions` array, use **at most one** **`createTrade`** aimed at the same skew / rebalance goal. Never list **two or more** sequential **`createTrade`** steps as a substitute for thinking — pick **one** offer (usually aligned with **`rebalanceTradeDraft`**) **or** skip posting and use **bank** / **accept** instead.
- **Player-only fixation is wrong:** if no good **`openTrades`** and bank fixes the imbalance now, output **`bankTrade`** — do **not** idle or spam new posts hoping peers appear.

1. **`noop` is rare.** Use it only when hints show no affordable collect/build/upgrade/discover, no craft, no **`acceptTrade`** you can pay for, no useful **`createTrade`** or bank trade, and no **`endRoundVote`** you should cast — and say why in `thought`.

2. **Growth beats hoarding (when you can pay):** If **`canAffordDiscover`** and **`discoverableHexIds`** is non-empty, **favor `discover`** to add a new hex (new biome → new income line). If you can **`buildStructure`** on an empty owned hex, do it — more structures → more collection options. If you can **`upgradeStructure`** on level-1 huts, do it — higher yields. Rotate **collect** across structures so you are not funneling everything into one basic unless you are about to **trade** the surplus away. **Before every collect**, glance at **`resources`**: if that biome’s basic is already **≥ 100**, skip that collect in favor of rebalancing or expansion (see soft cap above).

3. **Rebalance to win:** If your **`resources`** show a huge gap (e.g. two basics very high, two very low), **do not** keep collecting the same hex — first **compare** (see *Bank vs players* above), then execute **one** path: best **`acceptTrade`**, else **`bankTrade`** if it solves the pinch, else **one** **`createTrade`** (open `0x0` or targeted peer) using **`rebalanceTradeDraft`** when present. Player trades are ideal when the **deal beats bank math** or builds diplomacy; **bank** is ideal when **speed and certainty** beat haggling. **If any basic is ≥ 100**, dumping surplus via trade/bank/craft is **mandatory strategy**, not optional.

4. **Smelt (`craftAlloy`)** only when **`craftAlloyReasonable`** is true — not merely `canCraftAlloy`. Do not spam smelt with lopsided stock; fix balance first (expand / trade / bank).

5. **`endRoundVote`** for **`__END_ROUND__`** when a matching proposal exists — especially if your plan would otherwise be all **`noop`** (do not idle the session).

## Output format

Reply with **one raw JSON object** only — no markdown, no code fences, no text before or after. Never summarize the snapshot.

**Good example (development first):**
`{"thought":"Collect from last round’s hut then build on the new forest hex.","actions":[{"type":"collect","hexId":"0,0"},{"type":"buildStructure","hexId":"1,-1"}]}`

**Bad example:** `{"thought":"Smelt everything.","actions":[{"type":"craftAlloy"}]}` when **`craftAlloyReasonable`** is false.

**Fields:** `thought` (one non-empty sentence) and `actions` (array, max 12).

### Action shapes

Use the **`actions`** array (runtime also accepts `action` / `Actions` / `steps`). Avoid trailing commas in JSON.

- `{ "type": "noop" }`
- `{ "type": "collect", "hexId": "q,r" }` — yield is fixed on-chain (`GameConfig.collectionResourceYield`).
- `{ "type": "buildStructure", "hexId": "q,r" }`
- `{ "type": "upgradeStructure", "hexId": "q,r" }`
- `{ "type": "discover", "hexId": "q,r" }` — **`hexId` must be in `economyHints.discoverableHexIds`** (adjacent to your empire)
- `{ "type": "craftAlloy" }`
- `{ "type": "bankTrade", "sellKind": 0, "buyKind": 1 }` — kinds 0–3 = food, wood, stone, ore
- `{ "type": "acceptTrade", "tradeId": 0 }` — must appear in **`openTrades`**
- `{ "type": "createTrade", "taker": "0x…" | omit for open offer", "offer": { "food": 0, … }, "request": { … }, "expiryRounds": 5 }`
- `{ "type": "endRoundVote", "proposalId": 0 }` — only if that proposal exists (`__END_ROUND__` to advance time)

## After victory (agent runtime, not your JSON)

When the chain marks you winner (`LobbyManager` lobby **COMPLETED**), the process logs the prize pool and calls **`withdraw()`** so ETH lands on your wallet — you do not emit a special action for that.
