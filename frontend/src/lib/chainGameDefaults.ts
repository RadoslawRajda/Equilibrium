/**
 * Last-resort fallbacks when RPC/`GameCore.getDefaultLobbyPhaseDurations` is unavailable
 * (stale ABI, wrong address). Keep aligned with `contracts/contracts/GameConfig.sol`.
 */
export const FALLBACK_LOBBY_ZERO_ROUND_SECONDS = 200;
export const FALLBACK_LOBBY_RUNNING_ROUND_SECONDS = 200;
export const FALLBACK_MAX_ENERGY = 100;
export const FALLBACK_ENERGY_REGEN_PER_ROUND = 50;
/** `GameCore.getBasicResourceMax` — max food/wood/stone/ore per player. */
export const FALLBACK_BASIC_RESOURCE_MAX = 20;
