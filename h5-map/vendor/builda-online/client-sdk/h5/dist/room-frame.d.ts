export interface RoomFrame {
    type: string;
    sequence: number;
    payload: Uint8Array;
}
/** Encode a compact Room binary frame; the channel is determined by the actual DataChannel. */
export declare function encodeRoomFrame(type: string, sequence: number, payload: Uint8Array): Uint8Array;
/** Decode a Room binary frame and return the payload as is. */
export declare function decodeRoomFrame(data: ArrayBuffer | Uint8Array): RoomFrame;
/** Convert a string convenience argument to UTF-8 bytes. */
export declare function roomPayload(data: string | Uint8Array): Uint8Array;
/** Encode user data as UTF-8 JSON bytes. */
export declare function encodeJson(value: unknown): Uint8Array;
/** Decode UTF-8 JSON bytes into the user-specified static type; the type is not validated at runtime. */
export declare function decodeJson<T = unknown>(payload: Uint8Array): T;
/** Encode an SDK-internal platform control object as UTF-8 JSON bytes. */
export declare function encodeJsonPayload(payload: unknown): Uint8Array;
/** Parse a JSON payload; only for SDK-internal platform control messages. */
export declare function decodeJsonPayload(payload: Uint8Array): Record<string, unknown>;
