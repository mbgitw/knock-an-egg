import {
  cloudEnqueueState as enqueueCloudStateOnHost,
  cloudFlushBarrier as cloudFlushBarrierOnHost,
  cloudGetSnapshot as cloudGetSnapshotOnHost,
  cloudPollFlush as cloudPollFlushOnHost,
  cloudPollSnapshot as cloudPollSnapshotOnHost,
  cloudReadCurrent as cloudReadCurrentOnHost,
  cloudReadManyCurrent as cloudReadManyCurrentOnHost,
  CloudStateError,
  cloudInt64Value,
  cloudStringValue,
} from "./cloud-state.ts";
import type {
  CloudBufferedReceipt,
  CloudCurrentRead,
  CloudFlushResult,
  CloudSnapshotResult,
  CloudWriteRequest,
} from "./cloud-state.ts";
import type { RoomChannel } from "./types.ts";

export type {
  CloudBufferedReceipt,
  CloudCurrentRead,
  CloudFlushResult,
  CloudSnapshotResult,
  CloudWriteRequest,
};
export { CloudStateError, cloudInt64Value, cloudStringValue };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type RoomHost = {
  log(level: string, message: string): void;
  broadcast(channel: RoomChannel, messageType: string, payload: Uint8Array): void;
  send(channel: RoomChannel, clientId: string, messageType: string, payload: Uint8Array): void;
  /** Optional for compatibility with local adapters that only implement the legacy Host API. */
  sendToUser?(channel: RoomChannel, userId: string, messageType: string, payload: Uint8Array): void;
  setState(payload: Uint8Array): void;
  patchState(payload: Uint8Array): void;
  lockRoom(): void;
  releaseRoom(): void;
  closeRoom(reason: string): void;
  randomU64(): bigint;
  /** Return UTC Unix milliseconds sampled by the trusted host, never going backwards for the current Room. */
  unixTimeMillis(): bigint;
  doOrderStart?(orderId: string, deadlineMs: number): { id: bigint };
  doOrderPoll?(handle: { id: bigint }): OrderDeliveryPollResult;
  doOrderFinish?(handle: { id: bigint }, deadlineMs: number): void;
  cloudEnqueueState?(request: {
    roleId: string;
    key: string;
    operation: "set" | "increment" | "delete";
    value?: {
      tag: "bool-value" | "int64-value" | "float64-value" | "string-value" | "bytes-inline" | "object-cbor";
      val: boolean | bigint | number | string | { data: Uint8Array } | Uint8Array;
    };
    delta?: bigint;
    schemaId: string;
    schemaVersion: number;
  }): {
    localSequence: bigint;
    mutationId: string;
    disposition: "buffered" | "buffered-after-transaction";
  };
  /** Write channel that passes 64-bit values as unsigned bit patterns; when present, every SDK write goes through it. */
  cloudEnqueueStateBits?(request: {
    roleId: string;
    key: string;
    operation: "set" | "increment" | "delete";
    value?: {
      tag: "bool-value" | "int64-bits" | "float64-bits" | "string-value" | "bytes-inline" | "object-cbor";
      val: boolean | bigint | string | { data: Uint8Array } | Uint8Array;
    };
    deltaBits?: bigint;
    schemaId: string;
    schemaVersion: number;
  }): {
    localSequence: bigint;
    mutationId: string;
    disposition: "buffered" | "buffered-after-transaction";
  };
  cloudReadCurrent?(roleId: string, key: string): { tag: "found"; val: unknown } | { tag: "not-found" };
  cloudReadManyCurrent?(roleId: string, keys: string[]): Array<{ tag: "found"; val: unknown } | { tag: "not-found" }>;
  cloudFlushBarrier?(deadlineMs: number): { id: bigint };
  cloudPollFlush?(handle: { id: bigint }): {
    tag: "pending" | "applied" | "failed" | "expired";
    val?: unknown;
  };
  cloudGetSnapshot?(roleId: string): { id: bigint };
  cloudPollSnapshot?(handle: { id: bigint }): {
    tag: "pending" | "ready" | "failed" | "expired";
    val?: unknown;
  };
};

export type VerifiedOrder = {
  orderId: string;
  payId: string;
};

/** Terminal doOrder state. `allowed` only means the order may be fulfilled, not that it is Complete. */
export type OrderDeliveryStatus =
  | "allowed"
  | "rejected"
  | "already_delivered"
  | "manual_review"
  | "unavailable"
  | "expired";

export type OrderDeliveryResult =
  | { status: "allowed"; order: VerifiedOrder }
  | { status: Exclude<OrderDeliveryStatus, "allowed"> };

export type OrderDeliveryCallback = (result: OrderDeliveryResult) => void;

export type OrderDeliveryPollResult =
  | { tag: "pending" }
  | { tag: "allowed"; val: VerifiedOrder }
  | { tag: "rejected" | "completed" | "unavailable" | "manual-review" | "expired" }
  | { tag: "failed"; val: string };

let activeHost: RoomHost | undefined;

/** Inject the public Room Host for the current execution environment; the online adapter and the local Mock share this boundary. */
export function configureRoomHost(host: RoomHost): void {
  activeHost = host;
}

/** Get the injected Room Host, with a clear diagnostic when a Room is mistakenly run as a plain script. */
function host(): RoomHost {
  if (!activeHost) {
    throw new Error("Room Host is not initialized; run the Room through the Builda Online Mock or online Runtime");
  }
  return activeHost;
}

/** Encode user data as stable UTF-8 JSON. */
export function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

/** Decode UTF-8 JSON into the user-specified static type; the type is not validated at runtime. */
export function decodeJson<T = unknown>(payload: Uint8Array): T {
  return JSON.parse(decoder.decode(payload)) as T;
}

/** Call the platform full-state interface. */
export function setState(value: unknown): void {
  host().setState(encodeJson(value));
}

/** Call the platform state-patch interface. */
export function patchState(value: unknown): void {
  host().patchState(encodeJson(value));
}

/** Broadcast a raw binary message over the reliable gameplay channel. */
export function broadcast(messageType: string, payload: Uint8Array): void {
  broadcastOn("game-reliable", messageType, payload);
}

/** Broadcast a raw binary message over the given standard channel. */
export function broadcastOn(channel: RoomChannel, messageType: string, payload: Uint8Array): void {
  host().broadcast(channel, messageType, payload);
}

/** Broadcast a JSON convenience message over the reliable gameplay channel. */
export function broadcastJson(messageType: string, value: unknown): void { broadcast(messageType, encodeJson(value)); }

/** Broadcast a JSON convenience message over the given standard channel. */
export function broadcastJsonOn(channel: RoomChannel, messageType: string, value: unknown): void { broadcastOn(channel, messageType, encodeJson(value)); }

/** Send a raw binary message to the given Session over the reliable gameplay channel. */
export function send(clientId: string, messageType: string, payload: Uint8Array): void {
  sendOn("game-reliable", clientId, messageType, payload);
}

/** Send a raw binary message to a Session over the given standard channel. */
export function sendOn(
  channel: RoomChannel,
  clientId: string,
  messageType: string,
  payload: Uint8Array,
): void {
  host().send(channel, clientId, messageType, payload);
}

/** Send a JSON convenience message to the given Session over the reliable gameplay channel. */
export function sendJson(clientId: string, messageType: string, value: unknown): void { send(clientId, messageType, encodeJson(value)); }

/** Send a JSON convenience message to a Session over the given standard channel. */
export function sendJsonOn(channel: RoomChannel, clientId: string, messageType: string, value: unknown): void { sendOn(channel, clientId, messageType, encodeJson(value)); }

/** Send a raw binary message to the current connection of the given User ID over the reliable gameplay channel. */
export function sendToUser(userId: string, messageType: string, payload: Uint8Array): void {
  sendToUserOn("game-reliable", userId, messageType, payload);
}

/** Send a raw binary message to the current connection of the given User ID over the given standard channel. */
export function sendToUserOn(
  channel: RoomChannel,
  userId: string,
  messageType: string,
  payload: Uint8Array,
): void {
  const targetHost = host();
  if (!targetHost.sendToUser) {
    throw new Error("Room Host does not support sendToUser");
  }
  targetHost.sendToUser(channel, userId, messageType, payload);
}

/** Send a JSON convenience message to the current connection of the given User ID over the reliable gameplay channel. */
export function sendToUserJson(userId: string, messageType: string, value: unknown): void {
  sendToUser(userId, messageType, encodeJson(value));
}

/** Send a JSON convenience message to the current connection of the given User ID over the given standard channel. */
export function sendToUserJsonOn(channel: RoomChannel, userId: string, messageType: string, value: unknown): void {
  sendToUserOn(channel, userId, messageType, encodeJson(value));
}

/** Write a bounded Room debug log that is visible locally and briefly queryable by the author online. */
export function log(level: string, message: string): void {
  host().log(level, message);
}

/** Ask the platform to close the Room. */
export function closeRoom(reason: string): void {
  host().closeRoom(reason);
}

/** Ask the current public Room to stop accepting new players from matchmaking and invites. */
export function lockRoom(): void {
  host().lockRoom();
}

/** Ask the current public Room to accept new players again while it still has capacity. */
export function releaseRoom(): void {
  host().releaseRoom();
}

/** Get the next u64 from the host random sequence, which migrates with the Room. */
export function randomU64(): bigint {
  return host().randomU64();
}

/** Get UTC Unix milliseconds sampled by the trusted host, never going backwards for the current Room. */
export function unixTimeMillis(): bigint {
  return host().unixTimeMillis();
}

export function doOrderStart(orderId: string, deadlineMs: number): { id: bigint } {
  const target = host();
  if (!target.doOrderStart) throw new Error("Order delivery capability is unavailable");
  return target.doOrderStart(orderId, deadlineMs);
}

export function doOrderPoll(handle: { id: bigint }): OrderDeliveryPollResult {
  const target = host();
  return target.doOrderPoll?.(handle) ?? { tag: "unavailable" };
}

export function doOrderFinish(handle: { id: bigint }, deadlineMs: number): void {
  const target = host();
  if (!target.doOrderFinish) throw new Error("Order delivery capability is unavailable");
  target.doOrderFinish(handle, deadlineMs);
}

function cloudHost() {
  return host() as Parameters<typeof enqueueCloudStateOnHost>[0];
}

export function cloudEnqueueState(request: CloudWriteRequest): CloudBufferedReceipt {
  return enqueueCloudStateOnHost(cloudHost(), request);
}

export function cloudReadCurrent(roleId: string, key: string): CloudCurrentRead {
  return cloudReadCurrentOnHost(cloudHost(), roleId, key);
}

export function cloudReadManyCurrent(roleId: string, keys: string[]): CloudCurrentRead[] {
  return cloudReadManyCurrentOnHost(cloudHost(), roleId, keys);
}

export function cloudFlushBarrier(deadlineMs: number): bigint {
  return cloudFlushBarrierOnHost(cloudHost(), deadlineMs);
}

export function cloudPollFlush(handleId: bigint): CloudFlushResult | "pending" {
  return cloudPollFlushOnHost(cloudHost(), handleId);
}

export function cloudGetSnapshot(roleId: string): bigint {
  return cloudGetSnapshotOnHost(cloudHost(), roleId);
}

export function cloudPollSnapshot(handleId: bigint): CloudSnapshotResult | "pending" {
  return cloudPollSnapshotOnHost(cloudHost(), handleId);
}
