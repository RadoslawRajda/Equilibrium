export const BIOMES = {
  PLAINS: "Plains",
  FOREST: "Forest",
  MOUNTAINS: "Mountains",
  DESERT: "Desert"
};

export const BIOME_RESOURCE = {
  [BIOMES.PLAINS]: "food",
  [BIOMES.FOREST]: "wood",
  [BIOMES.MOUNTAINS]: "stone",
  [BIOMES.DESERT]: "ore"
};

export const STARTING_RESOURCES = {
  food: 50,
  wood: 50,
  stone: 50,
  ore: 50,
  energy: 100
};

export const BASE_ENERGY_REGEN = 100;

export const ROUND_EFFECTS = {
  drought: {
    id: "drought",
    label: "Drought",
    rounds: 2,
    multipliers: { food: 0.7 }
  },
  quake: {
    id: "quake",
    label: "Earthquake",
    rounds: 1,
    multipliers: {}
  },
  techBoom: {
    id: "techBoom",
    label: "Tech boom",
    rounds: 2,
    biomeMultipliers: { Mountains: 1.25, Desert: 1.25 }
  },
  pests: {
    id: "pests",
    label: "Pest invasion",
    rounds: 2,
    multipliers: { wood: 0.8 }
  },
  richDeposit: {
    id: "richDeposit",
    label: "Rich deposit",
    rounds: 2,
    biomeMultipliers: {}
  },
  energyCrisis: {
    id: "energyCrisis",
    label: "Energy crisis",
    rounds: 1,
    energyMultiplier: 0.5
  }
};
