export { Client } from "./client.ts";
export { Room, type MessageHandler } from "./room.ts";
export {
  cloudEnqueueState,
  cloudFlushBarrier,
  cloudGetSnapshot,
  cloudInt64Value,
  cloudPollFlush,
  cloudPollSnapshot,
  cloudReadCurrent,
  cloudReadManyCurrent,
  cloudStringValue,
  CloudStateError,
  configureRoomHost,
  decodeJson,
  encodeJson,
  type CloudBufferedReceipt,
  type CloudCurrentRead,
  type CloudFlushResult,
  type CloudSnapshotResult,
  type CloudWriteRequest,
  type OrderDeliveryCallback,
  type OrderDeliveryResult,
  type OrderDeliveryStatus,
  type RoomHost,
  type VerifiedOrder,
} from "./host.ts";
export type {
  ActivationReason,
  CheckpointReason,
  DisposeReason,
  JsonValue,
  RoomChannel,
  RoomConstructor,
  RoomContext,
  RoomRosterSeat,
  RoomSnapshot,
} from "./types.ts";

/** Keep the Room constructor type so the platform build adapter can generate the WIT guest. */
export function defineRoom<T>(room: T): T {
  return room;
}
