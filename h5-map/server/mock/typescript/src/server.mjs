import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { build } from "esbuild";
import { WebSocketServer } from "ws";

import { createMockEconomy } from "./mock-economy.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const LOCAL_LOG_MAX_EVENTS_PER_SECOND = 20;
const LOCAL_LOG_MAX_BYTES_PER_SECOND = 16 * 1024;
const LOCAL_LOG_MAX_MESSAGE_BYTES = 2 * 1024;
const TRUNCATED_SUFFIX = "...[truncated]";
const DEFAULT_RECONNECT_GRACE_MS = 15_000;
const DEFAULT_TICKET_GRACE_MS = 15_000;
const DEFAULT_EMPTY_ROOM_GRACE_MS = 1_000;

/** Bound local user logs on UTF-8 boundaries so debug output does not flood the terminal. */
function boundedLocalLogMessage(value) {
  const bytes = encoder.encode(String(value));
  if (bytes.length <= LOCAL_LOG_MAX_MESSAGE_BYTES) return String(value);
  const suffix = encoder.encode(TRUNCATED_SUFFIX);
  let boundary = LOCAL_LOG_MAX_MESSAGE_BYTES - suffix.length;
  while (boundary > 0 && (bytes[boundary] & 0xc0) === 0x80) boundary -= 1;
  return `${decoder.decode(bytes.subarray(0, boundary))}${TRUNCATED_SUFFIX}`;
}

/** Create a bounded user Room logger that writes only to local stdout. */
export function createLocalRoomLogger(roomId, write = (line) => process.stdout.write(line)) {
  let windowStartedAt = Date.now();
  let eventsInWindow = 0;
  let bytesInWindow = 0;
  return (requestedLevel, requestedMessage) => {
    const now = Date.now();
    if (now - windowStartedAt >= 1_000) {
      windowStartedAt = now;
      eventsInWindow = 0;
      bytesInWindow = 0;
    }
    const level = ["debug", "info", "warn", "error"].includes(requestedLevel) ? requestedLevel : "info";
    const roomLogMessage = boundedLocalLogMessage(requestedMessage);
    const eventBytes = encoder.encode(level).length + encoder.encode(roomLogMessage).length;
    if (eventsInWindow >= LOCAL_LOG_MAX_EVENTS_PER_SECOND || bytesInWindow + eventBytes > LOCAL_LOG_MAX_BYTES_PER_SECOND) return;
    eventsInWindow += 1;
    bytesInWindow += eventBytes;
    const message = level === "error"
      ? "User Room reported an error"
      : level === "warn"
        ? "User Room reported a warning"
        : level === "debug"
          ? "User Room local debug log"
          : "User Room local log";
    const errorCode = level === "error"
      ? "USER_ROOM_REPORTED_ERROR"
      : level === "warn"
        ? "USER_ROOM_REPORTED_WARNING"
        : undefined;
    write(`${JSON.stringify({ level, operation: "user_room_log", room_id: roomId, room_log_message: roomLogMessage, ...(errorCode ? { error_code: errorCode } : {}), message })}\n`);
  };
}

/** Bundle the user Room and public SDK in a temp directory and return an isolated module Node can load. */
export async function loadRoomModule(entry, sdkDirectory, sourceRootDirectory = dirname(entry)) {
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "builda-room-mock-"));
  const output = resolve(temporaryDirectory, "room.mjs");
  const sourceRoot = resolve(sourceRootDirectory);
  const sdkRoot = resolve(sdkDirectory, "src");
  const inside = (path, root) => {
    const value = relative(root, path);
    return value === "" || (!value.startsWith("..") && !isAbsolute(value));
  };
  if (!inside(resolve(entry), sourceRoot)) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw new Error("Room entry must be inside the Room source root");
  }
  try {
    await build({
      stdin: {
        contents: `export { default as RoomType } from ${JSON.stringify(entry)}; export { Client, configureRoomHost } from ${JSON.stringify(resolve(sdkRoot, "index.ts"))};`,
        resolveDir: sourceRoot,
        sourcefile: "builda-room-mock-entry.ts",
        loader: "ts",
      },
      outfile: output,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      plugins: [{
        name: "builda-room-public-imports",
        setup(context) {
          context.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === "entry-point") return undefined;
            if (args.path === "@cysj/room") return { path: resolve(sdkRoot, "index.ts") };
            if (!args.path.startsWith(".") && !isAbsolute(args.path)) {
              return { errors: [{ text: `Local Mock cannot import non-public packages: ${args.path}` }] };
            }
            const candidate = resolve(args.resolveDir, args.path);
            if (!inside(candidate, sourceRoot) && !inside(candidate, sdkRoot)) {
              return { errors: [{ text: `Module path crosses the Room or SDK boundary: ${args.path}` }] };
            }
            return { path: candidate };
          });
        },
      }],
    });
    const module = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
    return { ...module, cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

/** Read and normalize the user-editable local Scenario. */
async function loadScenario(path) {
  const value = path ? JSON.parse(await readFile(path, "utf8")) : {};
  const room = value.room ?? {};
  return {
    room: {
      roomId: room.room_id ?? "local-room",
      roomName: room.room_name ?? "local-room",
      tickRate: Number(room.tick_rate ?? 20),
      maxPlayers: Number(room.max_players ?? 8),
      schemaVersion: 1,
      entryKind: room.entry_kind ?? "direct",
      gameId: room.game_id ?? "local-game",
      serverReleaseId: "local-mock",
      activityId: room.activity_id ?? "local-activity",
      activityRevision: 1n,
      matchId: "local-match",
      matchKey: room.match_key ?? "local",
      matchMode: room.match_mode ?? "room",
      roomRoute: room.room_route ?? "default",
      roomType: room.room_type ?? "default",
      artifactId: "local-source",
      roster: [
        ...(value.actors ?? []).map((actor, index) => ({
          seatId: actor.seat_id ?? `seat-${index + 1}`,
          teamId: actor.team_id ?? "team-1",
          occupantKind: "human",
          userId: actor.player_id ?? `player-${index + 1}`,
        })),
        ...(value.bots ?? []).map((bot, index) => ({
          seatId: bot.seat_id ?? `bot-seat-${index + 1}`,
          teamId: bot.team_id ?? "team-bot",
          occupantKind: "bot",
          botId: bot.bot_id ?? `bot-${index + 1}`,
        })),
      ],
      launchContextJson: JSON.stringify(value.launch_context ?? {}),
    },
    mockEconomy: value.mock_economy ?? {},
  };
}

/** Recursively merge JSON objects, consistent with the client state-patch contract. */
function mergePatch(target, patch) {
  if (!target || typeof target !== "object" || Array.isArray(target)) return patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) result[key] = mergePatch(result[key], value);
  return result;
}

/** Encode a CYR1 Room binary frame carried over the local WebSocket tunnel. */
function encodeRoomFrame(type, sequence, payload) {
  const typeBytes = Buffer.from(type, "utf8");
  const frame = Buffer.allocUnsafe(14 + typeBytes.length + payload.length);
  frame.write("CYR1", 0, "ascii");
  frame.writeUInt16BE(typeBytes.length, 4);
  frame.writeBigUInt64BE(BigInt(sequence), 6);
  typeBytes.copy(frame, 14);
  Buffer.from(payload).copy(frame, 14 + typeBytes.length);
  return frame;
}

/** Decode a CYR1 Room binary frame sent by a client. */
function decodeRoomFrame(frameBase64) {
  const frame = Buffer.from(frameBase64, "base64");
  if (frame.length < 14 || frame.toString("ascii", 0, 4) !== "CYR1") throw new Error("Room binary frame header is invalid");
  const typeLength = frame.readUInt16BE(4);
  const payloadOffset = 14 + typeLength;
  if (typeLength === 0 || payloadOffset > frame.length) throw new Error("Room binary frame length is invalid");
  return { type: frame.toString("utf8", 14, payloadOffset), sequence: frame.readBigUInt64BE(6), payload: new Uint8Array(frame.subarray(payloadOffset)) };
}

/** Start a local Mock that binds only to the loopback address and runs only one user Room. */
export async function startMockServer(options) {
  if (!["127.0.0.1", "::1", "localhost"].includes(options.host)) {
    throw new Error("Room Mock may only bind to a loopback address");
  }
  const scenario = await loadScenario(options.scenario);
  const economy = createMockEconomy({
    orders: scenario.mockEconomy?.orders ?? [],
  });
  const { RoomType, Client, configureRoomHost } = options.module;
  if (typeof RoomType !== "function") throw new Error("Room module must default-export defineRoom(RoomClass)");
  const sessions = new Map();
  const disconnectedActors = new Map();
  const tickets = new Map();
  const roomLimit = options.rooms ?? 1_000;
  const reconnectGraceMs = options.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
  const ticketGraceMs = options.ticketGraceMs ?? DEFAULT_TICKET_GRACE_MS;
  const emptyRoomGraceMs = options.emptyRoomGraceMs ?? DEFAULT_EMPTY_ROOM_GRACE_MS;
  if (!Number.isInteger(roomLimit) || roomLimit < 1 || roomLimit > 1000) {
    throw new Error("rooms must be an integer from 1 to 1000");
  }
  for (const [name, value] of Object.entries({ reconnectGraceMs, ticketGraceMs, emptyRoomGraceMs })) {
    if (!Number.isInteger(value) || value < 1 || value > 60_000) throw new Error(`${name} must be an integer from 1 to 60000`);
  }
  let room;
  let state = null;
  let closed = true;
  let roomDisposed = true;
  let roomsStarted = 0;
  let roomGeneration = 0;
  let emptySince = null;
  let randomState = 0x9e3779b97f4a7c15n;
  let callbackUnixTimeMillis = 0n;
  let lastUnixTimeMillis = 0n;
  const prepareRoomCallback = () => {
    const sampled = BigInt(Date.now());
    if (sampled > lastUnixTimeMillis) lastUnixTimeMillis = sampled;
    callbackUnixTimeMillis = lastUnixTimeMillis;
  };
  const logLocalRoomMessage = createLocalRoomLogger(scenario.room.roomId);
  const sendControl = (socket, type, payload, requestId = "") => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type, payload, request_id: requestId }));
  };
  const pushEnvelope = (socket, channel, type, payload) => sendControl(socket, "local_room_message", {
    room_id: scenario.room.roomId,
    match_id: scenario.room.roomId,
    channel: channel.replaceAll("-", "_"),
    frame_base64: encodeRoomFrame(type, 0, payload).toString("base64"),
  });
  const decode = (bytes) => JSON.parse(decoder.decode(bytes));
  const encodeJson = (value) => new TextEncoder().encode(JSON.stringify(value));
  configureRoomHost({
    log(level, message) {
      logLocalRoomMessage(level, message);
    },
    broadcast(channel, messageType, payload) {
      for (const session of sessions.values()) if (session.joined) pushEnvelope(session.socket, channel, messageType, payload);
    },
    send(channel, clientId, messageType, payload) {
      const session = sessions.get(clientId);
      if (session?.joined) pushEnvelope(session.socket, channel, messageType, payload);
    },
    sendToUser(channel, userId, messageType, payload) {
      for (const session of sessions.values()) {
        if (session.joined && session.playerId === userId) {
          pushEnvelope(session.socket, channel, messageType, payload);
        }
      }
    },
    setState(payload) {
      state = decode(payload);
      for (const session of sessions.values()) if (session.joined) pushEnvelope(session.socket, "control-reliable", "state", payload);
    },
    patchState(payload) {
      const patch = decode(payload);
      state = mergePatch(state, patch);
      for (const session of sessions.values()) if (session.joined) pushEnvelope(session.socket, "control-reliable", "state_patch", payload);
    },
    lockRoom() {
      for (const session of sessions.values()) if (session.joined) pushEnvelope(session.socket, "control-reliable", "host_command", encodeJson({ kind: "lock_room" }));
    },
    releaseRoom() {
      for (const session of sessions.values()) if (session.joined) pushEnvelope(session.socket, "control-reliable", "host_command", encodeJson({ kind: "release_room" }));
    },
    closeRoom(_reason) {
      if (closed) return;
      closed = true;
      for (const session of sessions.values()) if (session.joined) pushEnvelope(session.socket, "control-reliable", "room_closed", encodeJson({
        reason: "game_completed",
        error_code: "ROOM_CLOSED",
        message: "Room closed normally",
      }));
      for (const session of sessions.values()) session.joined = false;
      disconnectedActors.clear();
      tickets.clear();
      room.onDispose("completed");
      roomDisposed = true;
      room = undefined;
      state = null;
      emptySince = null;
    },
    randomU64() {
      randomState ^= randomState << 13n;
      randomState ^= randomState >> 7n;
      randomState ^= randomState << 17n;
      return BigInt.asUintN(64, randomState);
    },
    unixTimeMillis() {
      return callbackUnixTimeMillis;
    },
    ...economy.hostBindings(),
  });

  /** Create the next match on demand after the previous one ends, always keeping only one concurrent Room. */
  function startNextRoom() {
    if (!closed || roomsStarted >= roomLimit) return !closed;
    room = new RoomType();
    state = null;
    closed = false;
    roomDisposed = false;
    roomsStarted += 1;
    roomGeneration += 1;
    emptySince = null;
    randomState = BigInt.asUintN(64, 0x9e3779b97f4a7c15n + BigInt(roomsStarted - 1));
    room.context = scenario.room;
    prepareRoomCallback();
    room.onCreate(scenario.room);
    process.stdout.write(`${JSON.stringify({ level: "info", operation: "room_mock_room_start", room_id: scenario.room.roomId, room_generation: roomGeneration })}\n`);
    return true;
  }

  /** Destroy a Room the local scheduler has deemed empty, without pretending the author completed it. */
  function reapEmptyRoom() {
    if (closed || roomDisposed || !room) return;
    prepareRoomCallback();
    room.onDispose("shutdown");
    roomDisposed = true;
    room = undefined;
    state = null;
    closed = true;
    emptySince = null;
    process.stdout.write(`${JSON.stringify({ level: "info", operation: "room_mock_room_dispose", room_id: scenario.room.roomId, room_generation: roomGeneration, reason: "empty_room" })}\n`);
  }

  /** Advance reservation, reconnect, and empty-Room grace periods so empty Rooms are eventually reclaimed by the Mock scheduler. */
  function sweepRoomLifecycle(now = Date.now()) {
    if (closed || !room) return;
    for (const [ticketId, record] of tickets) {
      if (record.expiresAt <= now) tickets.delete(ticketId);
    }
    for (const [playerId, actor] of disconnectedActors) {
      if (actor.deadlineAt > now) continue;
      disconnectedActors.delete(playerId);
      tickets.delete(`local-ticket-${playerId}`);
      prepareRoomCallback();
      room.onLeave(actor.client, "reconnect_timeout");
      if (closed || !room) return;
    }
    const joined = [...sessions.values()].some((session) => session.joined);
    if (joined || disconnectedActors.size > 0 || tickets.size > 0) {
      emptySince = null;
      return;
    }
    if (emptySince === null) {
      emptySince = now;
      return;
    }
    if (now - emptySince >= emptyRoomGraceMs) reapEmptyRoom();
  }

  const httpServer = createServer((request, response) => {
    const body = request.url === "/health" ? {
      status: "ok", implementation: "typescript-room-mock", room_runtime: "language_mock", transport: "local_mock_websocket", lifecycle: closed ? "idle" : "active", active_rooms: closed ? 0 : 1, room_generation: roomGeneration, remaining_rooms: roomLimit - roomsStarted, connected_clients: sessions.size,
    } : request.url === "/config" ? {
      environment: "local", mode: "room_mock", implementation: "typescript-room-mock", room_id: scenario.room.roomId, game_id: scenario.room.gameId, executes_room_source: true, builds_wasm: false, room_runtime: "language_mock", transport: "local_mock_websocket", uses_webrtc: false, simulates_real_auth: false, simulates_matchmaking: false, simulates_party: false, simulates_lobby: false, simulates_invites: false, provides_security_isolation: false, simulates_cloud_state: true, simulates_ext_pay: true, lazy_room_initialization: true, automatic_empty_room_reaping: true, reconnect_grace_ms: reconnectGraceMs, ticket_grace_ms: ticketGraceMs, empty_room_grace_ms: emptyRoomGraceMs, max_sequential_rooms: roomLimit,
    } : null;
    if (!body) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
  });
  const websocketServer = new WebSocketServer({ server: httpServer, path: "/ws" });
  websocketServer.on("connection", (socket) => {
    const sessionId = `local-session-${crypto.randomUUID()}`;
    const session = { socket, sessionId, playerId: "", joined: false, presenceEpoch: 0n };
    sessions.set(sessionId, session);
    socket.on("message", (data) => {
      try {
        const request = JSON.parse(data.toString());
        handleRequest(request, session, sendControl);
      } catch (error) {
        sendControl(socket, "error", { code: 3, message: error instanceof Error ? error.message : String(error) });
      }
    });
    socket.on("close", () => {
      if (session.joined) {
        const deadlineAt = Date.now() + reconnectGraceMs;
        const client = clientFor(session);
        prepareRoomCallback();
        room.onDisconnect(client, "control_disconnected", BigInt(deadlineAt));
        disconnectedActors.set(session.playerId, { client, presenceEpoch: session.presenceEpoch, deadlineAt });
      }
      sessions.delete(sessionId);
      sweepRoomLifecycle();
    });
  });

  /** Convert a Mock Session into a public SDK Client. */
  function clientFor(session) {
    return new Client(session.sessionId, session.playerId, session.playerId, `seat-${session.playerId}`, session.presenceEpoch);
  }

  /** Build a local Ticket that all three client SDKs can confirm through the public flow. */
  function ticketFor(session, mode, status = "room_ready", version = 1) {
    return {
      ticket_id: `local-ticket-${session.playerId}`,
      ticket_version: version,
      mode,
      status,
      activity_id: scenario.room.activityId,
      created_at_millis: Date.now(),
      assignment: {
        assignment_id: `local-assignment-${session.playerId}`,
        transport: "local",
        match_id: "local-match",
        round_id: "local-round",
        room_id: scenario.room.roomId,
        room_generation: roomGeneration,
        generation: roomGeneration,
        presence_epoch: Number(session.presenceEpoch),
      },
    };
  }

  /** Handle the minimal local control protocol the client SDKs already speak. */
  function handleRequest(request, session, respond) {
    const type = request.type;
    const payload = request.payload ?? {};
    const requestId = request.request_id ?? "";
    if (type === "ping") return respond(session.socket, "pong", {}, requestId);
    if (type === "auth") {
      const token = String(payload.token ?? "");
      const playerId = token.startsWith("local:") ? token.slice("local:".length) : "";
      if (!playerId || payload.game_id !== scenario.room.gameId) return respond(session.socket, "error", { code: 16, message: "Local identity or game_id is invalid" }, requestId);
      if ([...sessions.values()].some((value) => value !== session && value.playerId === playerId)) return respond(session.socket, "error", { code: 16, message: "The same local identity is already online" }, requestId);
      session.playerId = playerId;
      return respond(session.socket, "auth", { user_id: playerId, session_id: session.sessionId, game_id: scenario.room.gameId, online_compatibility_revision: 1, expires_at_unix_seconds: 0, environment: "local" }, requestId);
    }
    if (!session.playerId) return respond(session.socket, "error", { code: 16, message: "Local authentication is required" }, requestId);
    if (["match_join_room", "match_join_pool", "match_join_rank_pool"].includes(type)) {
      if (!startNextRoom()) return respond(session.socket, "error", { code: 17, message: "Local Room limit reached; restart the Mock or increase --rooms" }, requestId);
      const ticket = ticketFor(session, type.slice(11));
      tickets.set(ticket.ticket_id, { ticket, expiresAt: Date.now() + ticketGraceMs });
      respond(session.socket, "match_ticket_updated", ticket);
      return respond(session.socket, "match_ticket", ticket, requestId);
    }
    if (type === "match_ticket_get") {
      const ticketId = String(payload.ticket_id ?? "");
      const ticket = ticketId === `local-ticket-${session.playerId}` ? tickets.get(ticketId)?.ticket : undefined;
      return ticket
        ? respond(session.socket, "match_ticket", ticket, requestId)
        : respond(session.socket, "error", { code: 17, message: "Local Ticket does not exist" }, requestId);
    }
    if (type === "room_get") return respond(session.socket, "room", { room_id: scenario.room.roomId, room_generation: roomGeneration, phase: closed ? "closed" : "open", activity_id: scenario.room.activityId, activity_revision: 1, room_revision: 1, capacity: scenario.room.maxPlayers, occupied: [...sessions.values()].filter((value) => value.joined).length, transport: "local" }, requestId);
    if (type === "room_credential") return respond(session.socket, "room_credential", { credential: { room_id: scenario.room.roomId, room_generation: roomGeneration, seat_id: `seat-${session.playerId}`, role_id: session.playerId, session_id: session.sessionId, expires_at_millis: Date.now() + ticketGraceMs, presence_epoch: Number(session.presenceEpoch), transport: "local" }, transport: "local" }, requestId);
    if (type === "local_room_join") {
      if (closed && !startNextRoom()) return respond(session.socket, "error", { code: 17, message: "Local Room limit reached; restart the Mock or increase --rooms" }, requestId);
      if (!session.joined) {
        session.joined = true;
        const previousEpoch = disconnectedActors.get(session.playerId);
        if (previousEpoch === undefined) {
          prepareRoomCallback();
          economy.setActiveUserId(session.playerId);
          room.onJoin(clientFor(session));
          if (room) {
            room.driveOrderCallbacks();
            room.driveCloudCallbacks();
          }
        }
        else {
          session.presenceEpoch = previousEpoch.presenceEpoch + 1n;
          disconnectedActors.delete(session.playerId);
          prepareRoomCallback();
          economy.setActiveUserId(session.playerId);
          room.onReconnect(clientFor(session));
          if (room) {
            room.driveOrderCallbacks();
            room.driveCloudCallbacks();
          }
        }
      }
      emptySince = null;
      const ticketRecord = tickets.get(`local-ticket-${session.playerId}`);
      const ticket = ticketRecord?.ticket;
      if (ticket?.status === "room_ready") {
        const confirmed = { ...ticket, status: "confirmed" };
        tickets.set(confirmed.ticket_id, { ticket: confirmed, expiresAt: Number.POSITIVE_INFINITY });
        respond(session.socket, "match_ticket_updated", confirmed);
      }
      if (state !== null) pushEnvelope(session.socket, "control-reliable", "state", new TextEncoder().encode(JSON.stringify(state)));
      return respond(session.socket, "local_room_joined", { match_id: "local-match", room_id: scenario.room.roomId, generation: roomGeneration, session_id: session.sessionId, presence_epoch: Number(session.presenceEpoch), presences: [...sessions.values()].filter((value) => value.joined).map((value) => ({ user_id: value.playerId, session_id: value.sessionId, username: value.playerId, status: "online" })), transport: "local" }, requestId);
    }
    if (type === "local_room_data") {
      const envelope = decodeRoomFrame(String(payload.frame_base64 ?? ""));
      if (!session.joined) return respond(session.socket, "error", { code: 17, message: "Current player has not joined the local Room" }, requestId);
      if (envelope.type === "__cysj_transport_ping") pushEnvelope(session.socket, "control-reliable", "__cysj_transport_pong", envelope.payload);
      else {
        prepareRoomCallback();
        economy.setActiveUserId(session.playerId);
        room.dispatchMessage(clientFor(session), String(envelope.type ?? ""), envelope.payload);
        if (room) {
          room.driveOrderCallbacks();
          room.driveCloudCallbacks();
        }
      }
      return respond(session.socket, "local_room_data_sent", { room_id: scenario.room.roomId }, requestId);
    }
    if (type === "local_room_leave") {
      if (session.joined) { session.joined = false; disconnectedActors.delete(session.playerId); tickets.delete(`local-ticket-${session.playerId}`); prepareRoomCallback(); room.onLeave(clientFor(session), "client_leave"); }
      sweepRoomLifecycle();
      return respond(session.socket, "local_room_left", { room_id: scenario.room.roomId }, requestId);
    }
    if (type.startsWith("party_") || type.startsWith("lobby_") || type.startsWith("room_invite_")) return respond(session.socket, "error", { code: 18, message: "LOCAL_PLATFORM_API_NOT_SIMULATED: the local Mock simulates user Room logic only" }, requestId);
    return respond(session.socket, "error", { code: 3, message: `Room Mock does not support message: ${type}` }, requestId);
  }

  const tickDeltaMs = Math.round(1000 / scenario.room.tickRate);
  const interval = setInterval(() => {
    if (!closed && room) {
      prepareRoomCallback();
      room.onTick(tickDeltaMs);
      room.driveOrderCallbacks();
      room.driveCloudCallbacks();
    }
    sweepRoomLifecycle();
  }, tickDeltaMs);
  await new Promise((resolvePromise, reject) => httpServer.listen(options.port, options.host, (error) => error ? reject(error) : resolvePromise()));
  const boundPort = httpServer.address().port;
  process.stdout.write(`${JSON.stringify({ level: "info", operation: "room_mock_start", room_id: scenario.room.roomId, bind: `${options.host}:${boundPort}`, room_runtime: "language_mock", transport: "local_mock_websocket" })}\n`);
  const close = async () => {
    clearInterval(interval);
    if (!roomDisposed && room) { prepareRoomCallback(); room.onDispose("shutdown"); }
    websocketServer.close();
    await new Promise((resolvePromise) => httpServer.close(resolvePromise));
    await options.module.cleanup();
  };
  process.once("SIGINT", () => close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => close().finally(() => process.exit(0)));
  return { close, port: boundPort };
}
