import { createConfig, fallback, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { anvil, sepolia } from "wagmi/chains";
import { RPC_URL, SEPOLIA_RPC_URLS } from "@/lib/chain";

const sepoliaTransports = SEPOLIA_RPC_URLS.map((url) => http(url));

export const wagmiConfig = createConfig({
  ssr: true,
  chains: [anvil, sepolia],
  connectors: [injected()],
  transports: {
    [anvil.id]: http("http://127.0.0.1:8545"),
    [sepolia.id]:
      sepoliaTransports.length > 1
        ? fallback(sepoliaTransports)
        : http(RPC_URL),
  },
});
