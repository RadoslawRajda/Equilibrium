# Gameplay skill (tactics & I/O)

This file is **tactics and contracts**, not personality. Identity lives in `persona/identity.md`. Override via `EQUINOX_STRATEGY_PATH`.

## Snapshot fields you must use

- **`economyHints`**: precomputed booleans — **`canCraftAlloy`**, **`canAffordDiscover`**, costs, **`alloyNeededToWin`**. Trust these over guessing from prose.
- **`resources`**, **`craftedGoods`**, **`tiles`**, **`proposals`**, **`round.status`** (running play is status **2**).
- If **`snapshotNote`** appears, only use **`tiles[].id`** values that appear in the list.

## Action policy (critical)

1. **`noop` is rare.** Use it only when **`economyHints`** shows you cannot craft, cannot afford any listed discover, have no collectable structure you can pay energy for, no useful bank trade, and no relevant vote — *and* you say so in `thought`.
2. If **`canCraftAlloy`** is **true** and you are not already at the win threshold, **prefer** `{ "type": "craftAlloy" }` (possibly with other actions after it). Craft costs are tiny vs starting stock; “waiting for ore” while `canCraftAlloy` is true is **wrong**.
3. If you cannot craft but **`canAffordDiscover`** is true, pick one **undiscovered** `hexId` from `tiles` and use `{ "type": "discover", "hexId": "q,r" }`.
4. Then: **collect** on your structures if energy allows; **bankTrade** to unblock craft/discover; **endRoundVote** only when a matching proposal exists in `proposals`.

## Output format

Reply with **one raw JSON object** only — no markdown, no code fences, no text before or after. Never summarize the snapshot.

**Good example (productive):**
`{"thought":"Crafting is cheap and advances the win condition.","actions":[{"type":"craftAlloy"}]}`

**Bad example (do not mimic):**
`{"thought":"Waiting for more ore.","actions":[{"type":"noop"}]}` when `canCraftAlloy` is true.

**Fields:** `thought` (one non-empty sentence) and `actions` (array, max 12).

### Action shapes

- `{ "type": "noop" }`
- `{ "type": "craftAlloy" }`
- `{ "type": "discover", "hexId": "q,r" }` — must match a tile `id` in the snapshot
- `{ "type": "collect", "hexId": "q,r", "amount": 1 }`
- `{ "type": "bankTrade", "sellKind": 0, "buyKind": 1 }` — kinds 0–3 = food, wood, stone, ore
- `{ "type": "endRoundVote", "proposalId": 0 }` — only if that proposal exists

## After victory (agent runtime, not your JSON)

When the chain marks you winner (`LobbyManager` lobby **COMPLETED**), the process logs the prize pool and calls **`withdraw()`** so ETH lands on your wallet — you do not emit a special action for that.
