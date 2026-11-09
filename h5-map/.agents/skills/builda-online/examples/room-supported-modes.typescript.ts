import { Client, Room, decodeJson, defineRoom, type RoomContext } from "@cysj/room";

const OP_ACTION = "1";
const OP_READY = "2";
const OP_CHAT = "3";
const OP_ROLL = "4";
const OP_MOVE = "5";
const OP_ROUND_STARTED = "101";
const OP_ACTION_ACCEPTED = "102";
const OP_ROUND_RESET = "103";
const OP_READY_ACCEPTED = "110";
const OP_CHAT_ACCEPTED = "111";
const OP_ROLL_RESULT = "112";
const OP_ROUND_FINISHED = "199";
const TARGET_SCORE = 2;
const CF_RESET_DELAY_MS = 250;
const MATCH_CLOSE_DELAY_MS = 1_000;
const BOT_ACTION_INTERVAL_MS = 1_000;
const MAX_CHAT_CHARS = 128;

type DemoMode = "cf_room" | "shadow_world" | "casual";
type DemoPhase = "waiting" | "playing" | "settled";

type PlayerState = {
  score: number;
  lastSequence: number;
  lastReadySequence: number;
  lastChatSequence: number;
  lastMoveSequence: number;
  online: boolean;
  ready: boolean;
  occupantKind: "human" | "bot";
  teamId: string;
  x: number;
  y: number;
};

type DemoState = {
  mode: DemoMode;
  phase: DemoPhase;
  round: number;
  targetScore: number;
  worldActions: number;
  winnerId: string;
  settlementId: string;
  transitionRemainingMs: number;
  botActionRemainingMs: number;
  players: Record<string, PlayerState>;
};

type ActionIntent = {
  sequence?: unknown;
};

type ReadyIntent = ActionIntent & { ready?: unknown };
type ChatIntent = ActionIntent & { text?: unknown };
type MoveIntent = ActionIntent & { x?: unknown; y?: unknown };

/**
 * A tiny authoritative mini-game that still expresses four product lifecycles.
 * Clients only submit a "grab the star" intent; score, outcome, Room locking, reuse, and closing are all decided by the Room.
 */
class StarGrabRoom extends Room<DemoState> {
  /** Register the client action protocol. */
  constructor() {
    super();
    this.onMessage(OP_ACTION, (client, payload) => this.handleAction(client, decodeJson(payload)));
    this.onMessage(OP_READY, (client, payload) => this.handleReady(client, decodeJson(payload)));
    this.onMessage(OP_CHAT, (client, payload) => this.handleChat(client, decodeJson(payload)));
    this.onMessage(OP_ROLL, (client) => this.handleRoll(client));
    this.onMessage(OP_MOVE, (client, payload) => this.handleMove(client, decodeJson(payload)));
  }

  /** Initialize one of the three modes from the Match Activity launch context. */
  onCreate(context: RoomContext): void {
    this.context = context;
    const mode = modeFromContext(context);
    this.setState({
      mode,
      phase: mode === "cf_room" ? "waiting" : "playing",
      round: 1,
      targetScore: TARGET_SCORE,
      worldActions: 0,
      winnerId: "",
      settlementId: "",
      transitionRemainingMs: 0,
      botActionRemainingMs: BOT_ACTION_INTERVAL_MS,
      players: {},
    });

    for (const seat of context.roster) {
      if (seat.occupantKind !== "bot" || !seat.botId) continue;
      this.state.players[`bot:${seat.botId}`] = this.newPlayer("bot", seat.teamId);
    }
    this.publishState();
    this.log("info", `room_created mode=${mode} roster=${context.roster.length}`);

    // Room/shadow world joinability is decided by user code; Pool is locked automatically by the platform.
    if (mode === "cf_room" || mode === "shadow_world") this.releaseRoom();
  }

  /** Add the player to authoritative state after they actually enter the Room. */
  onJoin(client: Client): void {
    this.state.players[client.userId] = {
      ...(this.state.players[client.userId] ?? this.newPlayer("human", this.teamIdFor(client.userId))),
      online: true,
    };
    this.publishState();
  }

  /** A temporary disconnect only marks the player offline, keeping the Seat and game progress for reconnect. */
  onDisconnect(client: Client): void {
    const player = this.state.players[client.userId];
    if (!player) return;
    player.online = false;
    this.publishState();
  }

  /** Restore the same authoritative player after reconnect. */
  onReconnect(client: Client): void {
    const player = this.state.players[client.userId];
    if (!player) return this.onJoin(client);
    player.online = true;
    this.publishState();
  }

  /** Remove the player on final leave; a one-shot match ends the Room as soon as it is empty. */
  onLeave(client: Client): void {
    delete this.state.players[client.userId];
    this.publishState();
    if (this.isOneShotMatch() && Object.keys(this.state.players).length === 0) {
      this.disconnect("all_players_left");
    }
  }

  /** Advance CF round reuse and the bounded fallback close for Pool. */
  onTick(deltaMs: number): void {
    if (this.state.phase !== "settled") {
      this.tickBots(deltaMs);
      return;
    }
    if (this.state.transitionRemainingMs <= 0) return;
    this.state.transitionRemainingMs -= deltaMs;
    if (this.state.transitionRemainingMs > 0) return;

    if (this.state.mode === "cf_room") {
      this.resetCfRound();
      return;
    }
    this.disconnect("round_completed");
  }

  /** Validate the monotonic sequence and perform one server-authoritative star grab. */
  private handleAction(client: Client, payload: unknown): void {
    const player = this.state.players[client.userId];
    if (!player || !player.online || this.state.phase === "settled") return;
    const sequence = Number((payload as ActionIntent | null)?.sequence);
    if (!Number.isSafeInteger(sequence) || sequence <= player.lastSequence) return;

    player.lastSequence = sequence;
    this.applyAuthoritativeAction(client.userId);
  }

  /** Store ready state and sync the single player via a patch instead of broadcasting the full world. */
  private handleReady(client: Client, payload: unknown): void {
    const intent = payload as ReadyIntent | null;
    const sequence = Number(intent?.sequence);
    const player = this.state.players[client.userId];
    if (!player || !Number.isSafeInteger(sequence) || sequence <= player.lastReadySequence || typeof intent?.ready !== "boolean") return;
    player.lastReadySequence = sequence;
    player.ready = intent.ready;
    this.patchState({ players: { [client.userId]: player } });
    client.sendJson(OP_READY_ACCEPTED, { ready: player.ready, sequence });
  }

  /** Broadcast bounded chat text normalized for length and whitespace. */
  private handleChat(client: Client, payload: unknown): void {
    const intent = payload as ChatIntent | null;
    const sequence = Number(intent?.sequence);
    const player = this.state.players[client.userId];
    const text = typeof intent?.text === "string" ? intent.text.trim().replace(/\s+/g, " ") : "";
    if (!player || !Number.isSafeInteger(sequence) || sequence <= player.lastChatSequence || !text || [...text].length > MAX_CHAT_CHARS) return;
    player.lastChatSequence = sequence;
    this.broadcastJson(OP_CHAT_ACCEPTED, { userId: client.userId, text, sequence });
  }

  /** Return a controlled random result only to the requester; clients never submit the result. */
  private handleRoll(client: Client): void {
    if (!this.state.players[client.userId]?.online) return;
    client.sendJson(OP_ROLL_RESULT, { value: this.randomInt(1, 7) });
  }

  /** Accept droppable position input, validate bounds, then sync via a state patch. */
  private handleMove(client: Client, payload: unknown): void {
    const intent = payload as MoveIntent | null;
    const sequence = Number(intent?.sequence);
    const x = Number(intent?.x);
    const y = Number(intent?.y);
    const player = this.state.players[client.userId];
    if (!player || !Number.isSafeInteger(sequence) || sequence <= player.lastMoveSequence || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (Math.abs(x) > 10_000 || Math.abs(y) > 10_000) return;
    player.lastMoveSequence = sequence;
    player.x = x;
    player.y = y;
    this.patchState({ players: { [client.userId]: player } });
  }

  /** Produce a unique settlement id and enter the reuse or close countdown. */
  private finishRound(winnerId: string): void {
    this.state.phase = "settled";
    this.state.winnerId = winnerId;
    this.state.settlementId = `${this.context.matchId}:${this.state.round}`;
    this.state.transitionRemainingMs =
      this.state.mode === "cf_room" ? CF_RESET_DELAY_MS : MATCH_CLOSE_DELAY_MS;
    this.publishState();
    this.broadcastJson(OP_ROUND_FINISHED, {
      winnerId,
      settlementId: this.state.settlementId,
      closePolicy: this.state.mode === "cf_room" ? "reset_and_release" : "leave_then_close",
    });
    this.log("info", `round_finished round=${this.state.round} winner=${winnerId}`);
  }

  /** Clear the previous round's scores and release the same CF Room again. */
  private resetCfRound(): void {
    this.state.round += 1;
    this.state.phase = "waiting";
    this.state.winnerId = "";
    this.state.settlementId = "";
    this.state.transitionRemainingMs = 0;
    for (const player of Object.values(this.state.players)) {
      player.score = 0;
      player.ready = false;
    }
    this.publishState();
    this.releaseRoom();
    this.broadcastJson(OP_ROUND_RESET, { round: this.state.round });
  }

  /** Broadcast a full authoritative snapshot so different clients can use the same protocol. */
  private publishState(): void {
    this.setState(this.state);
  }

  /** Read the platform-provided team info from the launch Roster; how gameplay uses it is up to user code. */
  private teamIdFor(userId: string): string {
    return this.context.roster.find((seat) => seat.userId === userId)?.teamId ?? "team-unassigned";
  }

  /** Count the human players who can currently act. */
  private onlinePlayerCount(): number {
    return Object.values(this.state.players).filter((player) => player.online).length;
  }

  /** Use the same authoritative action function for human input and Bots in the platform Roster. */
  private applyAuthoritativeAction(actorId: string): void {
    const player = this.state.players[actorId];
    if (!player?.online || this.state.phase === "settled") return;
    if (this.state.mode === "cf_room" && this.state.phase === "waiting") {
      if (this.onlinePlayerCount() < 2) return;
      this.state.phase = "playing";
      this.lockRoom();
      this.broadcastJson(OP_ROUND_STARTED, { round: this.state.round });
    }
    player.score += 1;
    this.state.worldActions += 1;
    this.publishState();
    this.broadcastJson(OP_ACTION_ACCEPTED, {
      userId: actorId,
      score: player.score,
      worldActions: this.state.worldActions,
    });
    if (this.state.mode !== "shadow_world" && player.score >= TARGET_SCORE) {
      this.finishRound(actorId);
    }
  }

  /** Drive at most one Bot per interval so the Bot count does not inflate the cost of a single tick. */
  private tickBots(deltaMs: number): void {
    const botId = Object.keys(this.state.players).find((id) => this.state.players[id]?.occupantKind === "bot");
    if (!botId) return;
    this.state.botActionRemainingMs = Math.max(0, this.state.botActionRemainingMs - deltaMs);
    if (this.state.botActionRemainingMs > 0) return;
    this.state.botActionRemainingMs = BOT_ACTION_INTERVAL_MS;
    this.applyAuthoritativeAction(botId);
  }

  /** Create a player or Bot with its own message sequence and position state. */
  private newPlayer(occupantKind: "human" | "bot", teamId: string): PlayerState {
    return {
      score: 0,
      lastSequence: 0,
      lastReadySequence: 0,
      lastChatSequence: 0,
      lastMoveSequence: 0,
      online: true,
      ready: false,
      occupantKind,
      teamId,
      x: 0,
      y: 0,
    };
  }

  /** Whether the current Activity is a one-shot match destroyed once played. */
  private isOneShotMatch(): boolean {
    return this.state.mode === "casual";
  }
}

/** Map the stable matchKey/mode to the example gameplay without relying on internal platform fields. */
function modeFromContext(context: RoomContext): DemoMode {
  if (context.matchKey === "cf-room") return "cf_room";
  if (context.matchKey === "shadow-world") return "shadow_world";
  return "casual";
}

export default defineRoom(StarGrabRoom);
