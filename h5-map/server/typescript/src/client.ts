import { send, sendJson, sendJsonOn, sendOn } from "./host.ts";
import type { RoomChannel } from "./types.ts";

export class Client {
  readonly sessionId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly seatId: string;
  readonly presenceEpoch: bigint;

  /** Create a client handle built from the platform-authenticated identity. */
  constructor(
    sessionId: string,
    userId: string,
    roleId: string,
    seatId: string,
    presenceEpoch: bigint,
  ) {
    this.sessionId = sessionId;
    this.userId = userId;
    this.roleId = roleId;
    this.seatId = seatId;
    this.presenceEpoch = presenceEpoch;
  }

  /** Send a reliable binary message to the current client. */
  send(messageType: string, payload: Uint8Array): void {
    send(this.sessionId, messageType, payload);
  }

  /** Send a binary message to the current client over the given standard channel. */
  sendOn(channel: RoomChannel, messageType: string, payload: Uint8Array): void {
    sendOn(channel, this.sessionId, messageType, payload);
  }

  /** Send a reliable JSON convenience message to the current client. */
  sendJson(messageType: string, payload: unknown): void { sendJson(this.sessionId, messageType, payload); }

  /** Send a JSON convenience message to the current client over the given standard channel. */
  sendJsonOn(channel: RoomChannel, messageType: string, payload: unknown): void { sendJsonOn(channel, this.sessionId, messageType, payload); }
}
