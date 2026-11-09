declare module "cysj:room/host@0.11.0" {
  export function log(level: string, message: string): void;
  export type Channel = "control-reliable" | "game-reliable" | "state-unreliable";

  export function broadcast(channel: Channel, messageType: string, payload: Uint8Array): void;
  export function send(channel: Channel, clientId: string, messageType: string, payload: Uint8Array): void;
  export function setState(payload: Uint8Array): void;
  export function patchState(payload: Uint8Array): void;
  export function lockRoom(): void;
  export function releaseRoom(): void;
  export function closeRoom(reason: string): void;
  export function randomU64(): bigint;
  export function unixTimeMillis(): bigint;
}

declare module "builda:cloud/cloud-state-api@1.0.0" {
  export type CloudOperation = "set" | "increment" | "delete";

  export type CloudValueV1 =
    | { tag: "bool-value"; val: boolean }
    | { tag: "int64-value"; val: bigint }
    | { tag: "float64-value"; val: number }
    | { tag: "string-value"; val: string }
    | { tag: "bytes-inline"; val: { data: Uint8Array } }
    | { tag: "object-cbor"; val: Uint8Array };

  export type CloudWriteRequestV1 = {
    roleId: string;
    key: string;
    operation: CloudOperation;
    value?: CloudValueV1;
    delta?: bigint;
    schemaId: string;
    schemaVersion: number;
  };

  export type BufferedReceiptV1 = {
    localSequence: bigint;
    mutationId: string;
    disposition: "buffered" | "buffered-after-transaction";
  };

  export type SnapshotEntryV1 = {
    key: string;
    state: "live" | "tombstone";
    valueRevision: bigint;
    schemaId: string;
    schemaVersion: number;
    value?: CloudValueV1;
  };

  export type CurrentReadV1 =
    | { tag: "found"; val: SnapshotEntryV1 }
    | { tag: "not-found" };

  export type FlushHandleV1 = { id: bigint };
  export type SnapshotHandleV1 = { id: bigint };

  export type FlushItemV1 = {
    mutationId: string;
    status: string;
    appliedGameVarsRevision?: bigint;
    appliedValueRevision?: bigint;
    transactionId?: string;
  };

  export type FlushReceiptV1 = {
    maxLocalSequence: bigint;
    items: FlushItemV1[];
  };

  export type FlushFailureV1 = {
    reason: string;
    items: FlushItemV1[];
  };

  export type FlushPollResultV1 =
    | { tag: "pending" }
    | { tag: "applied"; val: FlushReceiptV1 }
    | { tag: "failed"; val: FlushFailureV1 }
    | { tag: "expired" };

  export type SnapshotV1 = {
    gameVarsRevision: bigint;
    entries: SnapshotEntryV1[];
  };

  export type SnapshotPollResultV1 =
    | { tag: "pending" }
    | { tag: "ready"; val: SnapshotV1 }
    | { tag: "failed"; val: string }
    | { tag: "expired" };

  export function cloudEnqueueState(request: CloudWriteRequestV1): BufferedReceiptV1;
  export function cloudReadCurrent(roleId: string, key: string): CurrentReadV1;
  export function cloudReadManyCurrent(roleId: string, keys: string[]): CurrentReadV1[];
  export function cloudFlushBarrier(deadlineMs: number): FlushHandleV1;
  export function cloudPollFlush(handle: FlushHandleV1): FlushPollResultV1;
  export function cloudGetSnapshot(roleId: string): SnapshotHandleV1;
  export function cloudPollSnapshot(handle: SnapshotHandleV1): SnapshotPollResultV1;
}

declare module "builda:cloud/cloud-state-bits-api@1.0.0" {
  export type CloudValueBitsV1 =
    | { tag: "bool-value"; val: boolean }
    | { tag: "int64-bits"; val: bigint }
    | { tag: "float64-bits"; val: bigint }
    | { tag: "string-value"; val: string }
    | { tag: "bytes-inline"; val: { data: Uint8Array } }
    | { tag: "object-cbor"; val: Uint8Array };

  export type CloudWriteRequestBitsV1 = {
    roleId: string;
    key: string;
    operation: "set" | "increment" | "delete";
    value?: CloudValueBitsV1;
    deltaBits?: bigint;
    schemaId: string;
    schemaVersion: number;
  };

  export function cloudEnqueueStateBits(request: CloudWriteRequestBitsV1): {
    localSequence: bigint;
    mutationId: string;
    disposition: "buffered" | "buffered-after-transaction";
  };
}

declare module "builda:cloud/order-delivery-api@1.0.0" {
  export type OrderDeliveryHandleV1 = { id: bigint };
  export type VerifiedOrderV1 = { orderId: string; payId: string };
  export type OrderDeliveryPollResultV1 =
    | { tag: "pending" }
    | { tag: "allowed"; val: VerifiedOrderV1 }
    | { tag: "rejected" | "completed" | "unavailable" | "manual-review" | "expired" }
    | { tag: "failed"; val: string };
  export function doOrderStart(orderId: string, deadlineMs: number): OrderDeliveryHandleV1;
  export function doOrderPoll(handle: OrderDeliveryHandleV1): OrderDeliveryPollResultV1;
  export function doOrderFinish(handle: OrderDeliveryHandleV1, deadlineMs: number): void;
}

declare module "cysj:room/user-messaging@0.11.0" {
  import type { Channel } from "cysj:room/host@0.11.0";
  export function sendToUser(channel: Channel, userId: string, messageType: string, payload: Uint8Array): void;
}
