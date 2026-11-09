type CloudStateHost = {
  cloudEnqueueState(request: {
    roleId: string;
    key: string;
    operation: CloudOperation;
    value?: WitCloudValueV1;
    delta?: bigint;
    schemaId: string;
    schemaVersion: number;
  }): {
    localSequence: bigint;
    mutationId: string;
    disposition: "buffered" | "buffered-after-transaction";
  };
  /** Bit-pattern write channel; when absent, only non-negative 64-bit values can be written through the legacy interface. */
  cloudEnqueueStateBits?(request: {
    roleId: string;
    key: string;
    operation: CloudOperation;
    value?: WitCloudValueBitsV1;
    deltaBits?: bigint;
    schemaId: string;
    schemaVersion: number;
  }): {
    localSequence: bigint;
    mutationId: string;
    disposition: "buffered" | "buffered-after-transaction";
  };
  cloudReadCurrent(roleId: string, key: string): { tag: "found"; val: WitSnapshotEntryV1 } | { tag: "not-found" };
  cloudReadManyCurrent(roleId: string, keys: string[]): Array<{ tag: "found"; val: WitSnapshotEntryV1 } | { tag: "not-found" }>;
  cloudFlushBarrier(deadlineMs: number): { id: bigint };
  cloudPollFlush(handle: { id: bigint }): {
    tag: "pending" | "applied" | "failed" | "expired";
    val?: {
      maxLocalSequence?: bigint;
      items?: Array<{
        mutationId: string;
        status: string;
        appliedGameVarsRevision?: bigint;
        appliedValueRevision?: bigint;
        transactionId?: string;
      }>;
      reason?: string;
    };
  };
  cloudGetSnapshot(roleId: string): { id: bigint };
  cloudPollSnapshot(handle: { id: bigint }): {
    tag: "pending" | "ready" | "failed" | "expired";
    val?: {
      gameVarsRevision?: bigint;
      entries?: WitSnapshotEntryV1[];
      tag?: "failed";
      val?: string;
    };
  };
};

/** Cloud variable write operation kind. */
export type CloudOperation = "set" | "increment" | "delete";

/** Cloud variable value; corresponds to the public WIT `cloud-value-v1`. */
export type CloudValue =
  | { kind: "bool"; value: boolean }
  | { kind: "int64"; value: bigint }
  | { kind: "float64"; value: number }
  | { kind: "string"; value: string }
  | { kind: "bytes"; value: Uint8Array }
  | { kind: "objectCbor"; value: Uint8Array };

/** A single enqueue request. */
export type CloudWriteRequest = {
  roleId: string;
  key: string;
  operation: CloudOperation;
  schemaId?: string;
  schemaVersion?: number;
  value?: CloudValue;
  delta?: bigint;
};

/** Local buffer receipt after a successful enqueue. */
export type CloudBufferedReceipt = {
  localSequence: bigint;
  mutationId: string;
  disposition: "buffered" | "bufferedAfterTransaction";
};

/** Current-value read result. */
export type CloudCurrentRead =
  | { status: "found"; entry: CloudSnapshotEntry }
  | { status: "notFound" };

/** Snapshot entry. */
export type CloudSnapshotEntry = {
  key: string;
  live: boolean;
  valueRevision: bigint;
  schemaId: string;
  schemaVersion: number;
  value?: CloudValue;
};

/** Terminal flush state. */
export type CloudFlushResult =
  | { status: "applied"; maxLocalSequence: bigint; items: CloudFlushItem[] }
  | { status: "failed"; reason: string; items: CloudFlushItem[] }
  | { status: "expired" };

export type CloudFlushItem = {
  mutationId: string;
  terminal: string;
  appliedGameVarsRevision?: bigint;
  appliedValueRevision?: bigint;
  transactionId?: string;
};

/** Terminal snapshot read state. */
export type CloudSnapshotResult =
  | { status: "ready"; gameVarsRevision: bigint; entries: CloudSnapshotEntry[] }
  | { status: "failed"; reason: string }
  | { status: "expired" };

/** Stable error thrown when a cloud variable operation fails; `code` is the WIT kebab-case code and must never bubble up as unknown_error. */
export class CloudStateError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "CloudStateError";
    this.code = code;
  }
}

const KNOWN_CLOUD_CODES = new Set([
  "schema-error",
  "not-ready",
  "buffer-full",
  "value-too-large",
  "role-forbidden",
  "capability-unavailable",
  "too-many-handles",
  "invalid-deadline",
  "guest-abi",
]);

const LEGACY_CLOUD_CODES: Record<string, string> = {
  capability_unavailable: "capability-unavailable",
  schema_error: "schema-error",
  schemaError: "schema-error",
  not_ready: "not-ready",
  notReady: "not-ready",
  buffer_full: "buffer-full",
  bufferFull: "buffer-full",
  value_too_large: "value-too-large",
  valueTooLarge: "value-too-large",
  role_forbidden: "role-forbidden",
  roleForbidden: "role-forbidden",
  too_many_handles: "too-many-handles",
  tooManyHandles: "too-many-handles",
  invalid_deadline: "invalid-deadline",
  invalidDeadline: "invalid-deadline",
  guestAbi: "guest-abi",
};

function camelToKebab(raw: string): string {
  return raw
    .replace(/_/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

function extractCloudErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof CloudStateError) return error.code;
  if (error instanceof Error) return error.message;
  return "";
}

function extractCloudErrorPayload(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("payload" in error)) return undefined;
  return (error as { payload?: unknown }).payload;
}

function normalizeCloudCode(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (KNOWN_CLOUD_CODES.has(trimmed)) return trimmed;
  if (LEGACY_CLOUD_CODES[trimmed]) return LEGACY_CLOUD_CODES[trimmed];
  const kebab = camelToKebab(trimmed);
  if (KNOWN_CLOUD_CODES.has(kebab)) return kebab;
  if (LEGACY_CLOUD_CODES[kebab]) return LEGACY_CLOUD_CODES[kebab];
  const withoutPrefix = trimmed.replace(/^error:\s*/i, "").trim();
  if (KNOWN_CLOUD_CODES.has(withoutPrefix)) return withoutPrefix;
  if (LEGACY_CLOUD_CODES[withoutPrefix]) return LEGACY_CLOUD_CODES[withoutPrefix];
  const withoutPrefixKebab = camelToKebab(withoutPrefix);
  if (KNOWN_CLOUD_CODES.has(withoutPrefixKebab)) return withoutPrefixKebab;
  if (LEGACY_CLOUD_CODES[withoutPrefixKebab]) return LEGACY_CLOUD_CODES[withoutPrefixKebab];
  return undefined;
}

function extractStructuredCloudCode(value: unknown): string | undefined {
  if (typeof value === "string") return normalizeCloudCode(value);
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["tag", "code", "variant"] as const) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      const normalized = normalizeCloudCode(candidate);
      if (normalized) return normalized;
    }
  }
  return undefined;
}

function extractEmbeddedCloudCode(text: string): string | undefined {
  for (const code of KNOWN_CLOUD_CODES) {
    if (code === "guest-abi") continue;
    const escaped = code.replace(/-/g, "[-_]");
    const pattern = new RegExp(`(?:^|[^a-z0-9_-])${escaped}(?:[^a-z0-9_-]|$)`, "i");
    if (pattern.test(text)) return code;
  }
  for (const [legacy, normalized] of Object.entries(LEGACY_CLOUD_CODES)) {
    if (normalized === "guest-abi") continue;
    const pattern = new RegExp(`(?:^|[^a-z0-9_-])${legacy.replace(/_/g, "[-_]")}(?:[^a-z0-9_-]|$)`, "i");
    if (pattern.test(text)) return normalized;
  }
  return undefined;
}

function resolveCloudCode(error: unknown): string {
  if (error instanceof CloudStateError) {
    return normalizeCloudCode(error.code) ?? "guest-abi";
  }
  const payloadCode = extractStructuredCloudCode(extractCloudErrorPayload(error));
  if (payloadCode) return payloadCode;
  const directCode = extractStructuredCloudCode(error);
  if (directCode) return directCode;
  const text = extractCloudErrorText(error);
  return normalizeCloudCode(text) ?? extractEmbeddedCloudCode(text) ?? "guest-abi";
}

function mapCloudError(error: unknown): CloudStateError {
  if (error instanceof CloudStateError) {
    const code = resolveCloudCode(error);
    return code === error.code ? error : new CloudStateError(code, error.message);
  }
  const text = extractCloudErrorText(error);
  const code = resolveCloudCode(error);
  return new CloudStateError(code, text || code);
}

function throwMappedCloudError(error: unknown): never {
  throw mapCloudError(error);
}

type WitCloudValueV1 =
  | { tag: "bool-value"; val: boolean }
  | { tag: "int64-value"; val: bigint }
  | { tag: "float64-value"; val: number }
  | { tag: "string-value"; val: string }
  | { tag: "bytes-inline"; val: { data: Uint8Array } }
  | { tag: "object-cbor"; val: Uint8Array };

type WitCloudValueBitsV1 =
  | { tag: "bool-value"; val: boolean }
  | { tag: "int64-bits"; val: bigint }
  | { tag: "float64-bits"; val: bigint }
  | { tag: "string-value"; val: string }
  | { tag: "bytes-inline"; val: { data: Uint8Array } }
  | { tag: "object-cbor"; val: Uint8Array };

type WitSnapshotEntryV1 = {
  key: string;
  state: "live" | "tombstone";
  valueRevision: bigint;
  schemaId: string;
  schemaVersion: number;
  value?: WitCloudValueV1;
};

/** Build an int64 cloud variable value. */
export function cloudInt64Value(value: bigint): CloudValue {
  return { kind: "int64", value };
}

/** Build a string cloud variable value. */
export function cloudStringValue(value: string): CloudValue {
  return { kind: "string", value };
}

function requireCloudHost(host: Partial<CloudStateHost>): CloudStateHost {
  if (
    !host.cloudEnqueueState
    || !host.cloudReadCurrent
    || !host.cloudReadManyCurrent
    || !host.cloudFlushBarrier
    || !host.cloudPollFlush
    || !host.cloudGetSnapshot
    || !host.cloudPollSnapshot
  ) {
    throw new CloudStateError("capability-unavailable", "Cloud State capability is unavailable");
  }
  return host as CloudStateHost;
}

function toWitValue(value: CloudValue): WitCloudValueV1 {
  switch (value.kind) {
    case "bool":
      return { tag: "bool-value", val: value.value };
    case "int64":
      return { tag: "int64-value", val: value.value };
    case "float64":
      return { tag: "float64-value", val: value.value };
    case "string":
      return { tag: "string-value", val: value.value };
    case "bytes":
      return { tag: "bytes-inline", val: { data: value.value } };
    case "objectCbor":
      return { tag: "object-cbor", val: value.value };
  }
}

function fromWitValue(value: WitCloudValueV1): CloudValue {
  switch (value.tag) {
    case "bool-value":
      return { kind: "bool", value: value.val };
    case "int64-value":
      return { kind: "int64", value: value.val };
    case "float64-value":
      return { kind: "float64", value: value.val };
    case "string-value":
      return { kind: "string", value: value.val };
    case "bytes-inline":
      return { kind: "bytes", value: value.val.data };
    case "object-cbor":
      return { kind: "objectCbor", value: value.val };
  }
}

function fromWitSnapshotEntry(entry: WitSnapshotEntryV1): CloudSnapshotEntry {
  return {
    key: entry.key,
    live: entry.state === "live",
    valueRevision: entry.valueRevision,
    schemaId: entry.schemaId,
    schemaVersion: entry.schemaVersion,
    value: entry.value ? fromWitValue(entry.value) : undefined,
  };
}

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const SIGN_BIT = 1n << 63n;
const float64Scratch = new DataView(new ArrayBuffer(8));

/** Normalize an int64 and check its range; out-of-range values are rejected as schema-error instead of letting the binding layer silently wrap. */
function checkedInt64(value: bigint): bigint {
  let normalized: bigint;
  try {
    normalized = BigInt(value);
  } catch {
    throw new CloudStateError("schema-error", "int64 value must be an integer");
  }
  if (normalized < INT64_MIN || normalized > INT64_MAX) {
    throw new CloudStateError("schema-error", "int64 value is out of range");
  }
  return normalized;
}

/** Two's-complement bit pattern of an int64. */
function int64Bits(value: bigint): bigint {
  return BigInt.asUintN(64, checkedInt64(value));
}

/** IEEE-754 bit pattern of a float64; -0.0 and NaN payloads are preserved bit for bit. */
function float64Bits(value: number): bigint {
  float64Scratch.setFloat64(0, Number(value));
  return float64Scratch.getBigUint64(0);
}

function toWitBitsValue(value: CloudValue): WitCloudValueBitsV1 {
  switch (value.kind) {
    case "int64":
      return { tag: "int64-bits", val: int64Bits(value.value) };
    case "float64":
      return { tag: "float64-bits", val: float64Bits(value.value) };
    default:
      return toWitValue(value) as WitCloudValueBitsV1;
  }
}

/**
 * The legacy interface hands negative s64 and negative f64 to a Guest engine that cannot lower them, trapping the whole Room,
 * so it is only used when the value's sign bit is 0; otherwise a catchable capability-unavailable is thrown.
 */
function assertLegacyLowerable(request: CloudWriteRequest): void {
  const value = request.value;
  const negative =
    (value?.kind === "int64" && checkedInt64(value.value) < 0n)
    || (value?.kind === "float64" && float64Bits(value.value) >= SIGN_BIT)
    || (request.delta !== undefined && checkedInt64(request.delta) < 0n);
  if (negative) {
    throw new CloudStateError(
      "capability-unavailable",
      "Negative 64-bit Cloud State numbers require the bit-pattern host channel",
    );
  }
}

function toWitWriteRequest(request: CloudWriteRequest) {
  assertLegacyLowerable(request);
  return {
    roleId: request.roleId,
    key: request.key,
    operation: request.operation,
    schemaId: request.schemaId ?? "",
    schemaVersion: request.schemaVersion ?? 0,
    value: request.value ? toWitValue(request.value) : undefined,
    delta: request.delta,
  };
}

function toWitBitsWriteRequest(request: CloudWriteRequest) {
  return {
    roleId: request.roleId,
    key: request.key,
    operation: request.operation,
    schemaId: request.schemaId ?? "",
    schemaVersion: request.schemaVersion ?? 0,
    value: request.value ? toWitBitsValue(request.value) : undefined,
    deltaBits: request.delta === undefined ? undefined : int64Bits(request.delta),
  };
}

/** A successful cloudEnqueue means the write is queued; to confirm that the batch has taken effect, call cloudFlush and wait for applied. */
export function cloudEnqueueState(host: Partial<CloudStateHost>, request: CloudWriteRequest): CloudBufferedReceipt {
  const target = requireCloudHost(host);
  try {
    // The bit-pattern channel carries 64-bit values of either sign; after the Host restores them they follow the same enqueue path as the legacy interface.
    const receipt = target.cloudEnqueueStateBits
      ? target.cloudEnqueueStateBits(toWitBitsWriteRequest(request))
      : target.cloudEnqueueState!(toWitWriteRequest(request));
    return {
      localSequence: receipt.localSequence,
      mutationId: receipt.mutationId,
      disposition: receipt.disposition === "buffered-after-transaction" ? "bufferedAfterTransaction" : "buffered",
    };
  } catch (error) {
    throwMappedCloudError(error);
  }
}

/** Read the current value of a single key. */
export function cloudReadCurrent(host: Partial<CloudStateHost>, roleId: string, key: string): CloudCurrentRead {
  const target = requireCloudHost(host);
  try {
    const result = target.cloudReadCurrent!(roleId, key);
    if (result.tag === "not-found") return { status: "notFound" };
    return { status: "found", entry: fromWitSnapshotEntry(result.val) };
  } catch (error) {
    throwMappedCloudError(error);
  }
}

/** Read the current values of multiple keys in one batch. */
export function cloudReadManyCurrent(host: Partial<CloudStateHost>, roleId: string, keys: string[]): CloudCurrentRead[] {
  const target = requireCloudHost(host);
  try {
    return target.cloudReadManyCurrent!(roleId, keys).map((result) =>
      result.tag === "not-found" ? { status: "notFound" } : { status: "found", entry: fromWitSnapshotEntry(result.val) },
    );
  } catch (error) {
    throwMappedCloudError(error);
  }
}

/** Start a flush barrier; the result must be fetched by polling. */
export function cloudFlushBarrier(host: Partial<CloudStateHost>, deadlineMs: number): bigint {
  const target = requireCloudHost(host);
  try {
    return target.cloudFlushBarrier!(deadlineMs).id;
  } catch (error) {
    throwMappedCloudError(error);
  }
}

/** Poll the flush result. */
export function cloudPollFlush(host: Partial<CloudStateHost>, handleId: bigint): CloudFlushResult | "pending" {
  const target = requireCloudHost(host);
  let result: ReturnType<CloudStateHost["cloudPollFlush"]>;
  try {
    result = target.cloudPollFlush!({ id: handleId });
  } catch (error) {
    throwMappedCloudError(error);
  }
  if (result.tag === "pending") return "pending";
  if (result.tag === "expired") return { status: "expired" };
  const mapItems = (items: NonNullable<typeof result.val>["items"]) =>
    (items ?? []).map((item) => ({
      mutationId: item.mutationId,
      terminal: item.status,
      appliedGameVarsRevision: item.appliedGameVarsRevision,
      appliedValueRevision: item.appliedValueRevision,
      transactionId: item.transactionId,
    }));
  if (result.tag === "applied") {
    return {
      status: "applied",
      maxLocalSequence: result.val?.maxLocalSequence ?? 0n,
      items: mapItems(result.val?.items),
    };
  }
  return {
    status: "failed",
    reason: result.val?.reason ?? "failed",
    items: mapItems(result.val?.items),
  };
}

/** Start a role snapshot read; the result must be fetched by polling. */
export function cloudGetSnapshot(host: Partial<CloudStateHost>, roleId: string): bigint {
  const target = requireCloudHost(host);
  try {
    return target.cloudGetSnapshot!(roleId).id;
  } catch (error) {
    throwMappedCloudError(error);
  }
}

/** Poll the snapshot result. */
export function cloudPollSnapshot(host: Partial<CloudStateHost>, handleId: bigint): CloudSnapshotResult | "pending" {
  const target = requireCloudHost(host);
  let result: ReturnType<CloudStateHost["cloudPollSnapshot"]>;
  try {
    result = target.cloudPollSnapshot!({ id: handleId });
  } catch (error) {
    throwMappedCloudError(error);
  }
  if (result.tag === "pending") return "pending";
  if (result.tag === "expired") return { status: "expired" };
  if (result.tag === "ready" && result.val?.entries && result.val.gameVarsRevision !== undefined) {
    return {
      status: "ready",
      gameVarsRevision: result.val.gameVarsRevision,
      entries: result.val.entries.map(fromWitSnapshotEntry),
    };
  }
  const reason = typeof result.val === "string" ? result.val : "failed";
  return { status: "failed", reason };
}
