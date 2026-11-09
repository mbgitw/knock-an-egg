import { Client } from "./client.ts";
import {
  broadcast,
  broadcastJson,
  broadcastJsonOn,
  broadcastOn,
  closeRoom,
  decodeJson,
  encodeJson,
  lockRoom,
  log,
  patchState as hostPatchState,
  randomU64,
  releaseRoom,
  sendToUser,
  sendToUserJson,
  sendToUserJsonOn,
  sendToUserOn,
  setState as hostSetState,
  unixTimeMillis as hostUnixTimeMillis,
  cloudEnqueueState as hostCloudEnqueueState,
  cloudFlushBarrier as hostCloudFlushBarrier,
  cloudGetSnapshot as hostCloudGetSnapshot,
  cloudPollFlush as hostCloudPollFlush,
  cloudPollSnapshot as hostCloudPollSnapshot,
  cloudReadCurrent as hostCloudReadCurrent,
  cloudReadManyCurrent as hostCloudReadManyCurrent,
  doOrderFinish as hostDoOrderFinish,
  doOrderPoll as hostDoOrderPoll,
  doOrderStart as hostDoOrderStart,
  CloudStateError,
} from "./host.ts";
import type {
  CloudBufferedReceipt,
  CloudCurrentRead,
  CloudFlushResult,
  CloudSnapshotResult,
  CloudWriteRequest,
  OrderDeliveryCallback,
  OrderDeliveryStatus,
  VerifiedOrder,
} from "./host.ts";
import type {
  DisposeReason,
  JsonValue,
  ActivationReason,
  RoomContext,
  RoomSnapshot,
  RoomChannel,
  CheckpointReason,
} from "./types.ts";

export type MessageHandler = (client: Client, payload: Uint8Array) => void;

function orderDeliveryStatus(tag: string): Exclude<OrderDeliveryStatus, "allowed"> {
  switch (tag) {
    case "completed":
      return "already_delivered";
    case "manual-review":
      return "manual_review";
    case "unavailable":
    case "failed":
      return "unavailable";
    case "expired":
      return "expired";
    default:
      return "rejected";
  }
}

export abstract class Room<TState extends JsonValue = JsonValue> {
  state!: TState;
  context!: RoomContext;
  private readonly handlers = new Map<string, MessageHandler>();
  private readonly orderCallbacks = new Map<bigint, OrderDeliveryCallback | undefined>();
  private readonly flushCallbacks = new Map<bigint, ((result: CloudFlushResult) => void) | undefined>();
  private readonly snapshotCallbacks = new Map<bigint, ((result: CloudSnapshotResult) => void) | undefined>();
  private currentVerifiedOrder?: VerifiedOrder;

  /** Register a handler for the given message type; must be registered in the constructor so it is re-established on migration restore. */
  protected onMessage(messageType: string, handler: MessageHandler): void {
    if (!messageType || this.handlers.has(messageType)) {
      throw new Error(`Duplicate or invalid Room message type: ${messageType}`);
    }
    this.handlers.set(messageType, handler);
  }

  /** Set the full authoritative state and broadcast it to clients. */
  protected setState(state: TState): void {
    this.state = state;
    hostSetState(state);
  }

  /** Submit a state patch; you must still update this.state accordingly. */
  protected patchState(patch: Partial<TState>): void {
    hostPatchState(patch);
  }

  /** Broadcast a reliable binary message. */
  protected broadcast(messageType: string, payload: Uint8Array): void {
    broadcast(messageType, payload);
  }

  /** Broadcast a binary message over the given standard channel. */
  protected broadcastOn(channel: RoomChannel, messageType: string, payload: Uint8Array): void {
    broadcastOn(channel, messageType, payload);
  }

  /** Broadcast a reliable JSON convenience message. */
  protected broadcastJson(messageType: string, payload: unknown): void { broadcastJson(messageType, payload); }

  /** Broadcast a JSON convenience message over the given standard channel. */
  protected broadcastJsonOn(channel: RoomChannel, messageType: string, payload: unknown): void { broadcastJsonOn(channel, messageType, payload); }

  /** Send a binary message to the current connection of the given User ID over the reliable gameplay channel. */
  protected sendToUser(userId: string, messageType: string, payload: Uint8Array): void {
    sendToUser(userId, messageType, payload);
  }

  /** Send a binary message to the current connection of the given User ID over the given standard channel. */
  protected sendToUserOn(channel: RoomChannel, userId: string, messageType: string, payload: Uint8Array): void {
    sendToUserOn(channel, userId, messageType, payload);
  }

  /** Send a reliable JSON convenience message to the current connection of the given User ID. */
  protected sendToUserJson(userId: string, messageType: string, payload: unknown): void { sendToUserJson(userId, messageType, payload); }

  /** Send a JSON convenience message to the current connection of the given User ID over the given standard channel. */
  protected sendToUserJsonOn(channel: RoomChannel, userId: string, messageType: string, payload: unknown): void { sendToUserJsonOn(channel, userId, messageType, payload); }

  /** Write a bounded Room log that is visible locally and briefly queryable online. */
  protected log(level: "debug" | "info" | "warn" | "error", message: string): void {
    log(level, message);
  }

  /** Ask the platform to close the current Room. */
  protected disconnect(reason: string): void {
    closeRoom(reason);
  }

  /** Lock the Room, stopping new players from public matchmaking and Room invites. */
  protected lockRoom(): void {
    lockRoom();
  }

  /** Unlock the Room, allowing public matchmaking and Room invites again while it still has capacity. */
  protected releaseRoom(): void {
    releaseRoom();
  }

  /** Return a full host u64 random value; the random sequence migrates with the Room snapshot. */
  protected randomUint64(): bigint {
    return randomU64();
  }

  /** Return a 53-bit random fraction in [0, 1). */
  protected random(): number {
    return Number(this.randomUint64() >> 11n) / 9_007_199_254_740_992;
  }

  /** Return an unbiased integer in [minimum, maximumExclusive). */
  protected randomInt(minimum: number, maximumExclusive: number): number {
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximumExclusive) || maximumExclusive <= minimum) {
      throw new RangeError("randomInt requires a valid safe-integer range");
    }
    const width = BigInt(maximumExclusive) - BigInt(minimum);
    const limit = (1n << 64n) - ((1n << 64n) % width);
    let value = this.randomUint64();
    while (value >= limit) {
      value = this.randomUint64();
    }
    return Number(BigInt(minimum) + (value % width));
  }

  /** Get UTC Unix milliseconds sampled by the trusted host, never going backwards for the current Room. */
  protected unixTimeMillis(): bigint {
    return hostUnixTimeMillis();
  }

  /** Read-only verification of an existing ext-pay order. `allowed` only means the order may be fulfilled, not that it is Complete. Cross-Room claims are reserved by the Host. */
  protected doOrder(orderId: string, callback: OrderDeliveryCallback): void {
    const handle = hostDoOrderStart(orderId, 10_000);
    this.orderCallbacks.set(handle.id, callback);
  }

  /**
   * Write goods within the payment window. Only call this inside the `allowed` callback of `doOrder`; do not add the `builda.` prefix, and do not also call
   * `cloudEnqueue` / `cloudFlush`.
   */
  protected fulfill(writes: CloudWriteRequest[]): CloudBufferedReceipt[] {
    if (!this.currentVerifiedOrder) {
      throw new CloudStateError("not-ready", "fulfill is only allowed inside a doOrder allowed callback");
    }
    return writes.map((write) => {
      if (write.key.startsWith("builda.")) {
        throw new CloudStateError("schema-error", "platform cloud keys cannot be written by Guest");
      }
      return hostCloudEnqueueState(write);
    });
  }

  /** A successful cloudEnqueue means the write is queued; flush and wait for applied only when you need to confirm the batch has taken effect. Inside payment callbacks use fulfill only. */
  protected cloudEnqueue(request: CloudWriteRequest): CloudBufferedReceipt {
    if (this.currentVerifiedOrder) {
      throw new CloudStateError("not-ready", "cloudEnqueue is forbidden inside a doOrder callback; use fulfill");
    }
    if (request.key.startsWith("builda.")) {
      throw new CloudStateError("schema-error", "platform cloud keys cannot be written by Guest");
    }
    return hostCloudEnqueueState(request);
  }

  /** Read the current cloud variable of a single key. */
  protected cloudReadCurrent(roleId: string, key: string): CloudCurrentRead {
    return hostCloudReadCurrent(roleId, key);
  }

  /** Read the current cloud variables of multiple keys in one batch. */
  protected cloudReadManyCurrent(roleId: string, keys: string[]): CloudCurrentRead[] {
    return hostCloudReadManyCurrent(roleId, keys);
  }

  /** Wait for applied when you need to confirm the batch has taken effect; the result arrives via callback on a later tick. Must not be called inside payment callbacks. */
  protected cloudFlush(deadlineMs: number, callback: (result: CloudFlushResult) => void): void {
    if (this.currentVerifiedOrder) {
      throw new CloudStateError("not-ready", "cloudFlush is forbidden inside a doOrder callback");
    }
    const handleId = hostCloudFlushBarrier(deadlineMs);
    this.flushCallbacks.set(handleId, callback);
  }

  /** Read a role's cloud variable snapshot; the result arrives via callback on a later tick. */
  protected cloudLoadSnapshot(roleId: string, callback: (result: CloudSnapshotResult) => void): void {
    const handleId = hostCloudGetSnapshot(roleId);
    this.snapshotCallbacks.set(handleId, callback);
  }

  /** Only for the platform adapter to advance at a tick safe point; not to be called directly by game logic. */
  public driveCloudCallbacks(): void {
    for (const [id, callback] of [...this.flushCallbacks]) {
      const result = hostCloudPollFlush(id);
      if (result === "pending") continue;
      this.flushCallbacks.delete(id);
      callback?.(result);
    }
    for (const [id, callback] of [...this.snapshotCallbacks]) {
      const result = hostCloudPollSnapshot(id);
      if (result === "pending") continue;
      this.snapshotCallbacks.delete(id);
      callback?.(result);
    }
  }

  /** Only for the platform adapter to advance at a tick safe point; not to be called directly by game logic. */
  public driveOrderCallbacks(): void {
    for (const [id, callback] of [...this.orderCallbacks]) {
      const handle = { id };
      const result = hostDoOrderPoll(handle);
      if (result.tag === "pending") continue;
      if (result.tag === "allowed") {
        if (!callback) continue;
        this.orderCallbacks.set(id, undefined);
        this.currentVerifiedOrder = result.val;
        try {
          callback({ status: "allowed", order: result.val });
        } finally {
          this.currentVerifiedOrder = undefined;
        }
        try {
          hostDoOrderFinish(handle, 10_000);
        } catch {
          // The Host has moved the unconfirmable idempotency marker to manual review; a diagnostic result must not kill the Room.
        }
        continue;
      }
      this.orderCallbacks.delete(id);
      callback?.({ status: orderDeliveryStatus(result.tag) });
    }
  }

  /** Dispatch a user message already parsed by the platform adapter layer; only for the platform runtime adapter. */
  protected dispatchMessage(client: Client, messageType: string, payload: Uint8Array): void {
    this.handlers.get(messageType)?.(client, payload);
  }

  /** Initialize game state when a new Room is created. */
  abstract onCreate(context: RoomContext): void;

  /** Update game state when a player joins. */
  onJoin(_client: Client): void {}

  /** The player is temporarily disconnected; the Seat is kept, so do not run final leave cleanup here. */
  onDisconnect(_client: Client, _reason: string, _reconnectDeadlineAtMillis: bigint): void {}

  /** The player reconnected within the grace period. */
  onReconnect(_client: Client): void {}

  /** Update game state when a player leaves. */
  onLeave(_client: Client, _reason: string): void {}

  /** Advance authoritative logic on a fixed tick. */
  onTick(_deltaMs: number): void {}

  /** Produce the full Room state at a consistent tick boundary; implementations must not send messages or modify Host state. */
  onCheckpoint(_reason: CheckpointReason): RoomSnapshot {
    return { schemaVersion: 1, data: encodeJson(this.state) };
  }

  /** By default restore state from a JSON checkpoint; the restore path does not call onCreate. */
  onRestore(context: RoomContext, snapshot: RoomSnapshot, _reason: ActivationReason): void {
    if (snapshot.schemaVersion !== 1) {
      throw new Error(`Unsupported Room snapshot version: ${snapshot.schemaVersion}`);
    }
    this.context = context;
    this.state = decodeJson<TState>(snapshot.data);
  }

  /** Notify user logic after the Directory commits a new generation. */
  onActivated(_reason: ActivationReason): void {}

  /** Release user state before the Room is destroyed. */
  onDispose(_reason: DisposeReason): void {}
}
