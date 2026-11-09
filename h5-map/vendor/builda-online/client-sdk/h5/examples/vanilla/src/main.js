import { OnlineClient } from "./vendor/online/index.js";

/** Trust only the flag explicitly injected by builda dev; do not guess the runtime environment from a loopback hostname. */
function isBuildaDevShell() {
  return new URLSearchParams(window.location.search).get("builda_mock_shell") === "1";
}

/** Create a local or online Socket using in-memory runtime parameters. */
export async function connectBuildaOnline({
  gatewayUrl,
  gameId,
  runtimeToken,
  localPlayerId = "vanilla-player",
  defaultQueueName = "default",
}) {
  const local = isBuildaDevShell();
  if (!local && (!gatewayUrl || !runtimeToken)) {
    throw new Error("Builda App must provide gatewayUrl and an in-memory runtimeToken");
  }
  const client = new OnlineClient({
    gatewayUrl: local ? "ws://127.0.0.1:7350/ws" : gatewayUrl,
    gameId,
    defaultQueueName,
  });
  const session = client.restoreSession(local ? `local:${localPlayerId}` : runtimeToken);
  const socket = client.createSocket();
  await socket.connect(session);
  return { client, socket, environment: local ? "local" : "online" };
}

window.connectBuildaOnline = connectBuildaOnline;
