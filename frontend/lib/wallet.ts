import type { Connector } from "wagmi";

function getConnectorName(connector: Connector) {
  return (connector.name ?? "").toLowerCase();
}

function getConnectorId(connector: Connector) {
  return (connector.id ?? "").toLowerCase();
}

function isMetaMaskConnector(connector: Connector) {
  const id = getConnectorId(connector);
  const name = getConnectorName(connector);
  return id.includes("meta") || name.includes("metamask");
}

function isInjectedConnector(connector: Connector) {
  const id = getConnectorId(connector);
  const name = getConnectorName(connector);
  return id.includes("injected") || name.includes("injected");
}

export function pickPreferredWalletConnector(connectors: readonly Connector[]) {
  const metaMaskConnector = connectors.find(isMetaMaskConnector);
  if (metaMaskConnector) {
    return metaMaskConnector;
  }

  const injectedConnector = connectors.find(isInjectedConnector);
  if (injectedConnector) {
    return injectedConnector;
  }

  return connectors[0];
}

export function isAlreadyConnectedError(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const shortMessage =
    "shortMessage" in error && typeof error.shortMessage === "string"
      ? error.shortMessage
      : "";
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  const text = `${shortMessage} ${message}`.toLowerCase();

  return (
    text.includes("already connected") ||
    text.includes("connector already connected")
  );
}
