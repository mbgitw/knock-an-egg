const MAGIC = new Uint8Array([0x43, 0x59, 0x52, 0x31])
const HEADER_LENGTH = 14
const MAX_FRAME_LENGTH = 65_535
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export interface RoomFrame {
  type: string
  sequence: number
  payload: Uint8Array
}

/** Encode a compact Room binary frame; the channel is determined by the actual DataChannel. */
export function encodeRoomFrame(type: string, sequence: number, payload: Uint8Array): Uint8Array {
  const typeBytes = encoder.encode(type)
  if (typeBytes.length === 0 || typeBytes.length > 0xffff) throw new TypeError('Room message type length is invalid')
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('Room message sequence is invalid')
  if (HEADER_LENGTH + typeBytes.length + payload.length > MAX_FRAME_LENGTH) {
    throw new RangeError('Room binary frame exceeds 65535 bytes')
  }
  const frame = new Uint8Array(HEADER_LENGTH + typeBytes.length + payload.length)
  frame.set(MAGIC)
  const view = new DataView(frame.buffer)
  view.setUint16(4, typeBytes.length)
  view.setBigUint64(6, BigInt(sequence))
  frame.set(typeBytes, HEADER_LENGTH)
  frame.set(payload, HEADER_LENGTH + typeBytes.length)
  return frame
}

/** Decode a Room binary frame and return the payload as is. */
export function decodeRoomFrame(data: ArrayBuffer | Uint8Array): RoomFrame {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length < HEADER_LENGTH || !MAGIC.every((value, index) => bytes[index] === value)) {
    throw new TypeError('Room binary frame header is invalid')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const typeLength = view.getUint16(4)
  const payloadOffset = HEADER_LENGTH + typeLength
  if (payloadOffset > bytes.length) throw new TypeError('Room binary frame length is invalid')
  const sequence = Number(view.getBigUint64(6))
  if (!Number.isSafeInteger(sequence)) throw new TypeError('Room message sequence exceeds the safe integer range')
  const type = decoder.decode(bytes.subarray(HEADER_LENGTH, payloadOffset))
  if (!type.trim()) throw new TypeError('Room message type must not be empty')
  return { type, sequence, payload: bytes.slice(payloadOffset) }
}

/** Convert a string convenience argument to UTF-8 bytes. */
export function roomPayload(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : data
}

/** Encode user data as UTF-8 JSON bytes. */
export function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

/** Decode UTF-8 JSON bytes into the user-specified static type; the type is not validated at runtime. */
export function decodeJson<T = unknown>(payload: Uint8Array): T {
  return JSON.parse(decoder.decode(payload)) as T
}

/** Encode an SDK-internal platform control object as UTF-8 JSON bytes. */
export function encodeJsonPayload(payload: unknown): Uint8Array {
  return encodeJson(payload)
}

/** Parse a JSON payload; only for SDK-internal platform control messages. */
export function decodeJsonPayload(payload: Uint8Array): Record<string, unknown> {
  if (payload.length === 0) return {}
  return decodeJson<Record<string, unknown>>(payload)
}
