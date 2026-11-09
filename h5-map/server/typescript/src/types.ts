import type { Room } from "./room.ts";

export type RoomContext = {
  roomId: string;
  roomName: string;
  tickRate: number;
  maxPlayers: number;
  schemaVersion: number;
  entryKind: "matchmaking" | "lobby" | "direct" | "private" | "tournament";
  gameId: string;
  serverReleaseId: string;
  activityId: string;
  activityRevision: bigint;
  matchId: string;
  lobbyId?: string;
  lobbyVersion?: bigint;
  matchKey: string;
  matchMode: "room" | "pool" | "rank_pool";
  roomRoute: string;
  roomType: string;
  artifactId: string;
  roster: RoomRosterSeat[];
  launchContextJson: string;
};

export type RoomRosterSeat = {
  seatId: string;
  teamId: string;
  occupantKind: "human" | "bot";
  userId?: string;
  botId?: string;
};

export type ClientJoin = {
  clientId: string;
  userId: string;
  roleId: string;
  seatId: string;
  presenceEpoch: bigint;
};

export type ClientDisconnect = ClientJoin & {
  reason: string;
  reconnectDeadlineAtMillis: bigint;
};

export type ClientReconnect = ClientJoin;

export type ClientLeave = ClientJoin & {
  reason: string;
};

export type ClientMessage = ClientJoin & {
  channel: "control-reliable" | "game-reliable" | "state-unreliable";
  messageType: string;
  payload: Uint8Array;
  sequence: bigint;
};

export type RoomSnapshot = {
  schemaVersion: number;
  data: Uint8Array;
};

export type CheckpointReason = "transfer" | "periodic";
export type ActivationReason = "transfer" | "recovery";
export type DisposeReason = "completed" | "migrated" | "shutdown" | "runtime-error";
export type RoomChannel = "control-reliable" | "game-reliable" | "state-unreliable";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type RoomConstructor<T extends JsonValue> = new () => Room<T>;
