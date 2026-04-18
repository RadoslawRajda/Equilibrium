# Gameplay skill (tactics & I/O)

This file is **tactics and contracts**, not personality. Identity is a markdown file under `personas/` (default **`personas/equinox.md`** if `PLAYER_IDENTITY_PATH` is unset). Override this file with `PLAYER_STRATEGY_PATH` (legacy: `EQUINOX_STRATEGY_PATH`).

## Snapshot fields you must use

- **Match pacing (`GameConfig.sol`):** default **200** seconds for zero-round pick, running-round tick, and `endRoundAdvanceSeconds` — wall-clock pressure comes from **`round.clock`** / host overrides; do not assume shorter timers unless the snapshot says so.
- **Starting stock:** `GameConfig.startingResources` = **2** food, **2** wood, **2** stone, **2** ore, **100** energy at bootstrap — live **`resources`** in the snapshot override these after play.
- **Basic resource ceiling (`GameConfig.basicResourceMax` / `economyHints.basicResourceMax`):** each of **food, wood, stone, ore** is capped on-chain (default **20**). Gains that would exceed the cap are **discarded** — you will see totals **stop growing** at the cap until you **spend** (build / discover / craft / trade / bank). Plan **`craftAlloy`**, **`bankTrade`**, and **`createTrade`** so surplus does not evaporate into the void.
- **`economyHints`** (trust these numbers over guessing):
  - **`basicResourceMax`** — hard cap for each basic resource line (same for all four).
  - **`buildCost`**, **`upgradeCost`**, **`craftAlloyCost`**, **`discoverCostNext`** — exact on-chain costs.
  - **`discoverableHexIds`** — the **only** valid targets for **`discover`**: undiscovered hexes that share an edge with a hex you already own. Never pick a hex outside this list for discovery.
  - **`canAffordBuildSomewhere`**, **`canAffordUpgradeSomewhere`**, **`canAffordDiscover`**, **`canCraftAlloy`**.
  - **`hasAnyStructure`** — you already placed at least one building.
  - **`craftAlloyReasonable`** — only prefer smelting when this is **true** (each craft spends **5** of **each** basic plus **energy** per `GameConfig.craftAlloyCost`; smelting before you have structures burns stock with no income).
  - **`alloyNeededToWin`**, **`victoryGoodsThreshold`**.
  - **Winning needs balanced basics, not one huge pile:** each **`craftAlloy`** spends **`craftAlloyCost`** (see **`craftAlloyCost`** in the snapshot — do not assume numbers if hints differ). **`GameConfig.sol` defaults:** **5** food, **5** wood, **5** stone, **5** ore, **10** energy per craft; **1** alloy per craft; win at **5** alloy (`victoryGoodsThreshold` = 5). From **0** alloy, **25 / 25 / 25 / 25** food+wood+stone+ore (plus **50** energy total for five crafts) is enough to **`craftAlloy`** five times and end — do **not** keep farming to huge piles if you could already close; when **`canCraftAlloy`** and **`craftAlloyReasonable`** allow it, **chain multiple `craftAlloy`** in one `actions` array until you hit the threshold or run out. If **`alloyNeededToWin`** is lower because you already have alloy, you need less per line — always trust **`economyHints`** over round numbers.
  - **Hoarding e.g. maxed food and zero ore is a losing plan** — you cannot craft, and you waste turns. Aim to **diversify income** (more hexes + structures + biomes), then **rebalance** via trades or bank.
  - **At-cap basics (prompt rule):** when any basic is **≥ `economyHints.basicResourceMax` − 1** (about to clip), **do not** keep **`collect`** on hexes that only push that same line — spend down via **`craftAlloy`** (if reasonable), **`createTrade`** / **`acceptTrade`**, **`bankTrade`**, or **expand** so other lines and alloy progress move. Treat the on-chain cap as the real “soft ceiling” for planning.
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

## Energy system (full mechanics & how to budget)

Energy is the **fifth resource** (`resources.energy` in the snapshot). It is **not** produced by **`collect`** (collect only adds the biome’s **basic** good). On-chain, energy **only goes up** from **round-based regeneration**, and **goes down** when you pay action or trading costs.

### Constants (`GameConfig.sol` — trust redeploy / hints if they differ)

| Constant | Default | Meaning |
|----------|---------|---------|
| `energyMax` | **100** | Hard cap; regen never pushes you above this. |
| `energyRegenPerRound` | **50** | Added **once per lobby round advanced** (see below), for **every** ticketed player in the lobby, **capped** at `energyMax`. |
| `buildEnergyCost` | **0** | `buildStructure` spends **no** energy (only food/wood/stone). |
| `discoverEnergyCost` | **0** | `discover` spends **no** energy (only wood/ore in current config). |
| `upgradeEnergyCost` | **25** | Paid on **`upgradeStructure`**. |
| `collectionEnergyCost` | **10** per collect (L1 and L2 **same** in current config) | Paid on **`collect`**. |
| `craftAlloyEnergyCost` | **10** | Part of **`craftAlloy`** cost together with basics. |
| `tradingEnergyCost` | **0** | Charged on **`createTrade`**, **`acceptTrade`**, and **`bankTrade`** via the same helper — **no energy burn today**, but the code path exists if tuning changes. |

### When energy regenerates (chain truth)

1. **`GameCore._advanceRound`** runs when the host (or flow) advances the lobby clock: **zero round → running** (after the **last** player picks a starting hex), or **each later `advanceRound`**, or when **`__END_ROUND__`** matures and the game advances the round that way. Each such advance applies **`_applyEnergyRegenForAdvancedRounds(lobby, 1)`** → **+50** to each alive player, **not above 100**.
2. **Wall-clock catch-up:** before many mutating calls, **`_syncRoundFromTimestamp`** may advance **`roundIndex`** by several skipped ticks if real time overshot `roundDurationSeconds`. For each **skipped** round it applies regen with **`skippedRounds`** as multiplier → gain **`50 × skippedRounds`** (still **per player**, **capped**). So a long silence then one transaction can “dump” several rounds of regen at once **on-chain**.
3. **Already at cap:** if `energy >= energyMax` **before** regen, **`_regenPlayerEnergy` adds nothing** (no overflow, no waste). New players start at **100** energy (`startingResources`) — the **first** round advance often gives **0** extra energy because they were already full.

### When energy is spent (defaults)

| Action | Energy change (defaults) | Notes |
|--------|-------------------------|--------|
| **`collect`** | **−10** | Same for structure level 1 and 2 today. |
| **`upgradeStructure`** | **−25** | Plus food/stone/ore from `upgradeCost`. |
| **`craftAlloy`** | **−10** | Plus **5** of each basic per craft. |
| **`buildStructure`** | **0** | Only basics. |
| **`discover`** | **0** | Only basics (wood/ore in current `discoverCost`). |
| **`createTrade`** / **`acceptTrade`** / **`bankTrade`** | **`−tradingEnergyCost`** (= **0** now) | Still call the same gate: if tuning raises the cost, trades **will** require energy. |
| **`destroyStructure`** | **0** | No energy line in that path. |

### How you (the agent) should manage energy

1. **Read `resources.energy` every plan** — it is the single source for “can I afford the next step on-chain”.
2. **Order expensive actions inside one `actions` array carefully:** all steps run in **one** user/tx ordering; **regen applies between on-chain transactions / round advances**, not between JSON array slots. You cannot “collect → regen → collect” in one chain tx unless the **first** collect somehow advanced a round (it does not by itself).
3. **Budget collects:** at **10** energy each, from **100** you can afford at most **10** collects **before any regen**; mixing in **one upgrade (−25)** leaves room for **7** collects, etc.
4. **Plan around round advances:** on-chain regen runs inside **`GameCore._advanceRound`** (host `advanceRound`, zero-round completion, or **unanimous yes** on **`__END_ROUND__`** inside **`vote`** when the last required player votes). **`resolveProposal`** resolves votes but does **not** by itself advance the round for **`__END_ROUND__`** the way that last unanimous **`vote`** does — so prefer actually **voting** when the proposal is the time-advance one. If **`resources.energy`** is low, **`round.clock`** may show wall-clock pressure; passing **`__END_ROUND__`** (when appropriate) can trigger **+50** energy (capped) for everyone once the round advances.
5. **Do not confuse energy with basics:** basics use **`economyHints.basicResourceMax`** (default **20** each); energy has its **own** cap **`energyMax`** (**100**). You can be energy-poor while basics are high — then **bank / trade / craft** (craft costs energy!) must be ordered so you do not strand yourself at **0** energy with no way to **`collect`**.
6. **Trust hints for live deploys:** `economyHints` carries **`buildCost`**, **`upgradeCost`**, **`craftAlloyCost`**, **`discoverCostNext`**, and collect energy per level from **`GameCore`** previews — use those if they disagree with the table above.

## Production rules (on-chain)

- **Energy:** see **Energy system** above; live pool is **`resources.energy`**.
- **Collect** only if the hex is yours, a **structure exists**, **`builtAtRound` < `round.clock.logicalRoundIndex`** when **`round.clock`** is present (else **`round.roundIndex`**), not already collected this logical round (see `structure.collectedThisRound`), and you have enough **energy** — defaults: **`collectionEnergyCost`** = **10** for both structure levels; **yield** **`collectionResourceYield`**: **1** basic unit at structure **level 1**, **2** at **level 2** (biome picks which kind). Hints expose these as **`economyHints.collectEnergyLevel1`** / **`collectEnergyLevel2`** and yield fields (`GameCore` previews may wrap `GameConfig`).
- **Build** on your own discovered hex with **no** structure yet; default **`buildCost`**: **1** food, **1** wood, **1** stone, **0** ore, **0** energy — still use **`economyHints.buildCost`** in the snapshot.
- **Upgrade** level-1 → 2 on **your** hexes; default **`upgradeCost`**: **2** food, **0** wood, **3** stone, **0** ore, **25** energy — use **`economyHints.upgradeCost`**.
- **Discover** pays **`discoverCostNext`** (defaults from `GameConfig.discoverCost`: **0** food, **1** wood, **0** stone, **1** ore, **0** energy — always trust the snapshot if it differs) and **must** use **`hexId` ∈ `discoverableHexIds`**.

## Zero round (status **1**) — starting hex

When the payload has **`phase`: `"zeroRoundPick"`** (not the normal game snapshot):

- You **choose one** starting hex from **`candidateHexes`** (each has **`id`**, **`q`**, **`r`**, **`biome`**).
- If **`pickRule`** says only `candidateHexes`, you must not invent ids outside that list.
- If **`excludedHexIds`** is present, never pick those — another player may have taken them.
- Reply with **one JSON object**: `{"thought":"…","hexId":"q,r"}` — **`hexId`** must match **`candidateHexes[].id`** exactly (same string as `id`).
- Prefer a hex that fits **your identity** (e.g. Plains for safe food, Forest for wood, edge vs center).

## Action policy (critical)

**Strategic spine — do not only collect forever.** Collection refills one biome’s basic per structure; it does **not** replace **map growth**. If you only collect, you skew one resource, **hit the basic cap**, waste yields, and stall the alloy race.

### Agent priorities (default session — no off-chain “game master”)

1. **Rozbudowuj się (expand):** **`discover`** legal hexes, **`buildStructure`** on empty owned tiles, **`upgradeStructure`** on level‑1 huts — map + structures are the engine of long-term income.
2. **Rozwijaj działalność:** each plan should mix **production** (`collect`) with **expansion or economy moves** — avoid plans that are only many **`collect`** steps while the map stays static.
3. **Wymieniaj się strategicznie z graczami:** prefer **`acceptTrade`** when **`openTrades`** beats bank math, or **one** well-shaped **`createTrade`** (see **`rebalanceTradeDraft`**) toward **`peerAddresses`** when diplomacy can improve ratios.
4. **Jeśli nikt nie chce się wymieniać:** when there is **no** attractive **`openTrades`** line, use **`bankTrade`** in the same plan — **4:1** is the honest fallback; waiting idle is wrong.
5. **Pamiętaj o limicie zasobów:** never plan as if basics can grow without bound — cap is **`economyHints.basicResourceMax`** (on-chain default **20** per basic line).

### Bank vs players — compare, then commit (one barter path)

- **`bankTrade`** is **immediate** (no peer has to accept). Rate is **`bankTradeGiveAmount` : `bankTradeReceiveAmount`** = **4:1** (four units sold of **`sellKind`** → one unit bought of **`buyKind`** per lot; kinds **0–3** = food, wood, stone, ore). Up to **`bankTradeBulkMaxLots` = 48** lots per bulk call on-chain — the agent usually emits single-lot **`bankTrade`** unless the snapshot suggests bulk. Treat the bank as **first-class**: use it whenever it is the **clearest or best** way to fix a shortage **this same plan** (e.g. you need ore to **discover**/ **build** / **craftAlloy** soon and holding excess food — bank food→ore can be smarter than waiting on humans). **Note:** if a basic is **already at cap**, bank inflows on that line **do not increase it** — spend first or trade into another line.
- **Before emitting any trade actions**, scan **`openTrades`**: if an **`acceptTrade`** gives you a **strictly better** ratio than 4:1 for what you need, **accept** that one best offer (do not accept a mediocre deal when bank is cheaper).
- **Do not shotgun `createTrade`:** in a **single** `actions` array, use **at most one** **`createTrade`** aimed at the same skew / rebalance goal. Never list **two or more** sequential **`createTrade`** steps as a substitute for thinking — pick **one** offer (usually aligned with **`rebalanceTradeDraft`**) **or** skip posting and use **bank** / **accept** instead.
- **Player-only fixation is wrong:** if no good **`openTrades`** and bank fixes the imbalance now, output **`bankTrade`** — do **not** idle or spam new posts hoping peers appear.

1. **`noop` is rare.** Use it only when hints show no affordable collect/build/upgrade/discover, no craft, no **`acceptTrade`** you can pay for, no useful **`createTrade`** or bank trade, and no **`endRoundVote`** you should cast — and say why in `thought`.

2. **Growth beats hoarding (when you can pay):** If **`canAffordDiscover`** and **`discoverableHexIds`** is non-empty, **favor `discover`** to add a new hex (new biome → new income line). If you can **`buildStructure`** on an empty owned hex, do it — more structures → more collection options. If you can **`upgradeStructure`** on level-1 huts, do it — higher yields. Rotate **collect** across structures so you are not funneling everything into one basic unless you are about to **trade** the surplus away. **Before every collect**, glance at **`resources`** vs **`economyHints.basicResourceMax`**: if that biome’s basic is **at or one step from the cap**, skip that collect in favor of rebalancing or expansion.

3. **Rebalance to win:** If your **`resources`** show a huge gap (e.g. two basics very high, two very low), **do not** keep collecting the same hex — first **compare** (see *Bank vs players* above), then execute **one** path: best **`acceptTrade`**, else **`bankTrade`** if it solves the pinch, else **one** **`createTrade`** (open `0x0` or targeted peer) using **`rebalanceTradeDraft`** when present. Player trades are ideal when the **deal beats bank math** or builds diplomacy; **bank** is ideal when **speed and certainty** beat haggling. **If any basic sits at the cap**, dumping surplus via trade/bank/craft is **mandatory strategy**, not optional.

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
