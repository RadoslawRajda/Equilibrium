export const ownerPalette = ["#56f0ff", "#ffd369", "#5bff9d", "#ff7d7d", "#9c7dff", "#ffad69"];

export const colorFromAddress = (address?: string | null) => {
  if (!address) return "#f3f7ff";
  const hash = address.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return ownerPalette[hash % ownerPalette.length];
};