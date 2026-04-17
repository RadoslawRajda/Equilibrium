const hashAddress = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const colorFromAddress = (address?: string | null) => {
  if (!address) return "#f3f7ff";

  const normalized = address.toLowerCase();
  const hash = hashAddress(normalized);
  const hue = hash % 360;
  const saturation = 68 + ((hash >>> 9) % 16);
  const lightness = 52 + ((hash >>> 17) % 10);

  // Use legacy comma-separated hsl() syntax for broader Three.js parser compatibility.
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};