/**
 * Normalize `struct Resources` / tuple from ethers (numeric indices and/or named fields).
 * Keeps tests stable across ethers decode shapes and matches how viem often returns structs.
 */
function asResourceTuple(v) {
  if (v == null) {
    throw new Error("asResourceTuple: missing value");
  }
  const food = v.food ?? v[0];
  const wood = v.wood ?? v[1];
  const stone = v.stone ?? v[2];
  const ore = v.ore ?? v[3];
  const energy = v.energy ?? v[4];
  return [BigInt(food ?? 0), BigInt(wood ?? 0), BigInt(stone ?? 0), BigInt(ore ?? 0), BigInt(energy ?? 0)];
}

module.exports = { asResourceTuple };
