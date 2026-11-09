import {
  OnlineClient,
  decodeJson,
  encodeJson,
  type MatchTicket,
  type RoomHandle,
} from "@cysj/online-h5"

import {
  enterWithTicket,
  getOrCreateAdmissionKey,
  isAdmissionOutcomeUnknown,
} from "./match-flow"

import {
  OP_ACTION,
  OP_ACTION_ACCEPTED,
  OP_ROUND_FINISHED,
  OP_ROUND_RESET,
  OP_ROUND_STARTED,
  type GameSnapshot,
} from "./protocol"
import "./style.css"

type DemoConfiguration = {
  gatewayUrl: string
  gameId: string
  defaultQueueName: string
}

const playerSelect = document.querySelector<HTMLSelectElement>("#player-id")!
const modeSelect = document.querySelector<HTMLSelectElement>("#mode")!
const connectButton = document.querySelector<HTMLButtonElement>("#connect")!
const actionButton = document.querySelector<HTMLButtonElement>("#action")!
const status = document.querySelector<HTMLElement>("#status")!
const scoreboard = document.querySelector<HTMLElement>("#scoreboard")!
const eventLog = document.querySelector<HTMLElement>("#event-log")!

let room: RoomHandle | undefined
let socket: ReturnType<OnlineClient["createSocket"]> | undefined
let currentTicket: MatchTicket | undefined
let admissionKey: string | undefined
let admissionStarted = false
let admissionOutcomeUnknown = false
let sequence = 0
let leavingRoom = false
let authoritativeSnapshot: GameSnapshot | undefined

const parameters = new URLSearchParams(location.search)
const queryPlayer = parameters.get("player")
const queryMode = parameters.get("mode")
if (queryPlayer === "player-1" || queryPlayer === "player-2") playerSelect.value = queryPlayer
if (["cf-room", "shadow-world", "casual-2p"].includes(queryMode ?? "")) {
  modeSelect.value = queryMode!
}

/** Update connection status without mistaking an obtained Ticket for having joined the Room. */
function setStatus(message: string, state: "idle" | "connected" | "error" = "idle"): void {
  status.textContent = message
  status.dataset.state = state
}

/** Append a recent public protocol event. */
function log(message: string): void {
  const lines = `${new Date().toLocaleTimeString()}  ${message}\n${eventLog.textContent ?? ""}`
  eventLog.textContent = lines.split("\n").slice(0, 8).join("\n")
}

/** Render the full authoritative snapshot sent by the Room. */
function render(snapshot: GameSnapshot): void {
  const rows = Object.entries(snapshot.players)
    .map(([userId, player]) => `<li><b>${userId}</b><span>${player.teamId}</span><strong>${player.score}</strong></li>`)
    .join("")
  scoreboard.innerHTML = `
    <p><span>Mode</span><b>${snapshot.mode}</b></p>
    <p><span>Phase / Round</span><b>${snapshot.phase} / ${snapshot.round}</b></p>
    <p><span>World actions</span><b>${snapshot.worldActions}</b></p>
    <ul>${rows || "<li>Waiting for players to join…</li>"}</ul>
    ${snapshot.winnerId ? `<div class="winner">Winner: ${snapshot.winnerId}</div>` : ""}
  `
}

/** Recursively merge a public state patch; arrays and scalars are replaced wholesale by the patch. */
function mergePatch<T>(target: T, patch: unknown): T {
  if (!target || typeof target !== "object" || Array.isArray(target)) return patch as T
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch as T
  const result = { ...target } as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    result[key] = mergePatch(result[key], value)
  }
  return result as T
}

/** Load the non-secret public client config provided by the example. */
async function loadConfiguration(): Promise<DemoConfiguration> {
  const response = await fetch("/builda-online.json", { cache: "no-store" })
  if (!response.ok) throw new Error("Missing Builda Online client configuration")
  return response.json() as Promise<DemoConfiguration>
}

/** Call the public Admission API that matches the user's selection. */
async function joinMode(matchKey: string, operationKey: string): Promise<MatchTicket> {
  if (!socket) throw new Error("Socket has not been created")
  if (matchKey === "casual-2p") return socket.joinPool(matchKey, { idempotencyKey: operationKey })
  return socket.joinRoom(matchKey, { allowCreate: true, idempotencyKey: operationKey })
}

/** Clear the local Room only after the authoritative leave confirmation; stay blocked on failure. */
async function leaveFinishedRoom(): Promise<void> {
  if (!room || leavingRoom) return
  leavingRoom = true
  actionButton.disabled = true
  const activeRoom = room
  try {
    await activeRoom.leave()
    if (room === activeRoom) {
      room = undefined
      admissionKey = undefined
    }
    setStatus("Match finished")
    unlockAdmissionControls()
  } catch (error) {
    showError(error)
  } finally {
    leavingRoom = false
  }
}

/** Connect to the current language's Room Mock with a local synthetic identity. */
async function connect(): Promise<void> {
  connectButton.disabled = true
  playerSelect.disabled = true
  modeSelect.disabled = true
  setStatus("Connecting…")
  admissionOutcomeUnknown = false
  admissionStarted = false
  try {
    const configuration = await loadConfiguration()
    const client = new OnlineClient({
      gatewayUrl: configuration.gatewayUrl,
      gameId: configuration.gameId,
      defaultQueueName: configuration.defaultQueueName,
    })
    socket?.close()
    socket = client.createSocket()
    socket.on("matchTicketUpdated", (ticket) => {
      log(`Ticket ${ticket.status} v${ticket.ticket_version}`)
      if (currentTicket?.ticket_id !== ticket.ticket_id) return
      if (Number(ticket.ticket_version) >= Number(currentTicket.ticket_version)) currentTicket = ticket
    })
    socket.on("roomMessage", (message) => {
      const payload = decodeJson<GameSnapshot>(message.data)
      if (message.opCode === -1) authoritativeSnapshot = payload
      if (message.opCode === -2) authoritativeSnapshot = mergePatch(authoritativeSnapshot ?? ({} as GameSnapshot), payload)
      if ((message.opCode === -1 || message.opCode === -2) && authoritativeSnapshot) {
        render(authoritativeSnapshot)
      }
      if ([OP_ROUND_STARTED, OP_ACTION_ACCEPTED, OP_ROUND_RESET, OP_ROUND_FINISHED].includes(message.opCode)) {
        log(`op=${message.opCode} ${JSON.stringify(payload)}`)
      }
      if (message.opCode === OP_ROUND_FINISHED && modeSelect.value === "casual-2p") {
        // After a one-shot match settles, wait for the authoritative leave and end local state only once the old occupancy is released.
        void leaveFinishedRoom()
      }
    })
    socket.on("roomClosed", ({ roomId, reason }) => {
      if (room === undefined || room.roomId !== roomId) return
      setStatus(`Room closed: ${reason}`)
      room = undefined
      currentTicket = undefined
      admissionKey = undefined
      authoritativeSnapshot = undefined
      actionButton.disabled = true
      unlockAdmissionControls()
    })
    socket.on("error", (error) => showError(new Error(`${error.code}: ${error.message}`)))
    await socket.connect(client.restoreSession(`local:${playerSelect.value}`))
    admissionKey = getOrCreateAdmissionKey(
      admissionKey,
      () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    const operationKey = admissionKey
    const connectedRoom = await enterWithTicket(
      socket,
      operationKey,
      () => {
        admissionStarted = true
        return joinMode(modeSelect.value, operationKey)
      },
      (ticket) => { currentTicket = ticket },
    )
    room = connectedRoom
    currentTicket = undefined
    admissionKey = undefined
    const network = await socket.networkSnapshot(connectedRoom.roomId)
    setStatus(`${playerSelect.value} joined · ${network.room?.transport}`, "connected")
    actionButton.disabled = false
    log(`Room joined: ${connectedRoom.roomId}`)
  } catch (error) {
    showError(error)
    admissionOutcomeUnknown = admissionStarted && isAdmissionOutcomeUnknown(error) && !currentTicket
    if (admissionOutcomeUnknown) {
      setStatus("Matchmaking outcome unknown, click Resume matchmaking", "error")
      connectButton.textContent = "Resume matchmaking"
      connectButton.disabled = false
      playerSelect.disabled = true
      modeSelect.disabled = true
      return
    }
    if (currentTicket || room) {
      setStatus("The previous Ticket is still settling, wait for the authoritative outcome", "error")
      connectButton.disabled = true
      playerSelect.disabled = true
      modeSelect.disabled = true
      return
    }
    admissionKey = undefined
    unlockAdmissionControls()
  }
}

function unlockAdmissionControls(): void {
  if (admissionOutcomeUnknown || currentTicket || room) return
  connectButton.disabled = false
  playerSelect.disabled = false
  modeSelect.disabled = false
  connectButton.textContent = "Match and join"
}

/** Send only the action intent; score and outcome are computed by the authoritative Room. */
function grabStar(): void {
  room?.sendReliable(OP_ACTION, encodeJson({ sequence: ++sequence }))
}

/** Display client errors uniformly without credentials or full payloads. */
function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  setStatus(`Failed: ${message}`, "error")
  log(message)
}

connectButton.addEventListener("click", () => void connect())
actionButton.addEventListener("click", grabStar)
window.addEventListener("beforeunload", () => socket?.close())

// The Builda Skill requires notifying the host after the game initializes; binding runtime keeps the correct this semantics and stays compatible with the publish checker.
const buildaRuntime = window.Builda?.runtime
if (buildaRuntime) void buildaRuntime.ready.call(buildaRuntime)
