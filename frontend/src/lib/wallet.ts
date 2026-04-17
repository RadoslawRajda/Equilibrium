import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

const chainId = Number(import.meta.env.VITE_CHAIN_ID || 1337);
const rpcUrl = import.meta.env.VITE_RPC_URL || "http://localhost:8545";

export const localGanache = defineChain({
  id: chainId,
  name: "Ganache Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl] }
  }
});

export const wagmiConfig = createConfig({
  chains: [localGanache],
  connectors: [
    injected()
  ],
  transports: {
    [localGanache.id]: http(rpcUrl)
  }
});
