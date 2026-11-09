/**
 * In-process Cloud State + fake order delivery for the local TypeScript Room Mock.
 * This is a local Host simulation for closed-loop verification, not production storage/ext-pay.
 */

function cloudError(code, message = code) {
  const error = new Error(message);
  error.payload = { tag: code };
  error.code = code;
  return error;
}

/**
 * @param {{ orders?: Array<{ orderId: string, userId: string, payId: string }> }} [options]
 */
export function createMockEconomy(options = {}) {
  /** @type {Map<string, Map<string, { value: any, revision: bigint, schemaId: string, schemaVersion: number }>>} */
  const store = new Map();
  /** @type {Array<{ mutationId: string, roleId: string, key: string, apply: () => void }>} */
  let pending = [];
  /** @type {Map<bigint, { status: string, maxLocalSequence?: bigint, items?: any[], reason?: string }>} */
  const flushHandles = new Map();
  /** @type {Map<bigint, { status: string, roleId?: string, entries?: any[], reason?: string }>} */
  const snapshotHandles = new Map();
  /** @type {Map<bigint, { orderId: string, userId: string, payId?: string, phase: string }>} */
  const orderHandles = new Map();
  /** @type {Map<string, { userId: string, payId: string, completed: boolean }>} */
  const orders = new Map();
  let nextSequence = 1n;
  let nextHandle = 1n;
  let nextMutation = 1;
  let activeUserId = "";

  for (const entry of options.orders ?? []) {
    if (!entry?.orderId || !entry?.userId || !entry?.payId) continue;
    orders.set(String(entry.orderId), {
      userId: String(entry.userId),
      payId: String(entry.payId),
      completed: false,
    });
  }

  function roleMap(roleId) {
    let map = store.get(roleId);
    if (!map) {
      map = new Map();
      store.set(roleId, map);
    }
    return map;
  }

  function snapshotEntry(key, record) {
    return {
      key,
      state: "live",
      valueRevision: record.revision,
      schemaId: record.schemaId,
      schemaVersion: record.schemaVersion,
      value: record.value,
    };
  }

  function setActiveUserId(userId) {
    activeUserId = userId ? String(userId) : "";
  }

  function registerOrder(orderId, userId, payId) {
    orders.set(String(orderId), {
      userId: String(userId),
      payId: String(payId),
      completed: orders.get(String(orderId))?.completed ?? false,
    });
  }

  function resolveOrder(orderId) {
    const existing = orders.get(orderId);
    if (existing) return existing;
    // DX default: unknown orderId is allowed for the active user with payId=orderId.
    if (!activeUserId) return null;
    const created = { userId: activeUserId, payId: orderId, completed: false };
    orders.set(orderId, created);
    return created;
  }

  function cloudEnqueueState(request) {
    const roleId = String(request.roleId ?? "");
    const key = String(request.key ?? "");
    const operation = request.operation;
    if (!roleId || !key) throw cloudError("schema-error", "roleId and key are required");
    if (key.startsWith("builda.")) {
      throw cloudError("schema-error", "platform cloud keys cannot be written by Guest");
    }
    const localSequence = nextSequence++;
    const mutationId = `mut-${nextMutation++}`;
    const schemaId = String(request.schemaId ?? "");
    const schemaVersion = Number(request.schemaVersion ?? 0);
    pending.push({
      mutationId,
      roleId,
      key,
      apply() {
        const map = roleMap(roleId);
        if (operation === "delete") {
          map.delete(key);
          return;
        }
        if (operation === "set") {
          if (!request.value) throw cloudError("schema-error", "set requires a value");
          map.set(key, {
            value: request.value,
            revision: localSequence,
            schemaId,
            schemaVersion,
          });
          return;
        }
        if (operation === "increment") {
          const delta = request.delta ?? 0n;
          const current = map.get(key);
          if (current && current.value?.tag !== "int64-value") {
            throw cloudError("schema-error", "increment requires int64");
          }
          const base = current?.value?.tag === "int64-value" ? current.value.val : 0n;
          map.set(key, {
            value: { tag: "int64-value", val: base + BigInt(delta) },
            revision: localSequence,
            schemaId: current?.schemaId ?? schemaId,
            schemaVersion: current?.schemaVersion ?? schemaVersion,
          });
          return;
        }
        throw cloudError("schema-error", `unsupported operation: ${operation}`);
      },
    });
    return {
      localSequence,
      mutationId,
      disposition: "buffered",
    };
  }

  /** Decode bit-pattern values exactly like the Worker Host before reusing the ordinary enqueue path. */
  function fromBitsValue(value) {
    if (value?.tag === "int64-bits") {
      return { tag: "int64-value", val: BigInt.asIntN(64, BigInt(value.val)) };
    }
    if (value?.tag === "float64-bits") {
      const view = new DataView(new ArrayBuffer(8));
      view.setBigUint64(0, BigInt.asUintN(64, BigInt(value.val)));
      return { tag: "float64-value", val: view.getFloat64(0) };
    }
    return value;
  }

  function cloudEnqueueStateBits(request) {
    const { deltaBits, ...rest } = request;
    return cloudEnqueueState({
      ...rest,
      value: fromBitsValue(request.value),
      delta: deltaBits === undefined ? undefined : BigInt.asIntN(64, BigInt(deltaBits)),
    });
  }

  function applyPending() {
    const items = [];
    let maxLocalSequence = 0n;
    const batch = pending;
    pending = [];
    for (const item of batch) {
      item.apply();
      items.push({
        mutationId: item.mutationId,
        status: "applied",
        appliedGameVarsRevision: 0n,
        appliedValueRevision: 0n,
      });
    }
    if (items.length > 0) maxLocalSequence = nextSequence - 1n;
    return { maxLocalSequence, items };
  }

  function cloudReadCurrent(roleId, key) {
    const record = store.get(String(roleId))?.get(String(key));
    if (!record) return { tag: "not-found" };
    return { tag: "found", val: snapshotEntry(String(key), record) };
  }

  function cloudReadManyCurrent(roleId, keys) {
    return (keys ?? []).map((key) => cloudReadCurrent(roleId, key));
  }

  function cloudFlushBarrier(_deadlineMs) {
    const id = nextHandle++;
    // Apply on the next poll so Guest driveCloudCallbacks sees a poll cycle.
    flushHandles.set(id, { status: "ready-to-apply" });
    return { id };
  }

  function cloudPollFlush(handle) {
    const id = typeof handle === "object" ? handle.id : handle;
    const record = flushHandles.get(id);
    if (!record) return { tag: "failed", val: { reason: "unknown-handle", items: [] } };
    if (record.status === "pending") return { tag: "pending" };
    if (record.status === "ready-to-apply") {
      try {
        const applied = applyPending();
        flushHandles.set(id, { status: "applied", ...applied });
      } catch (error) {
        flushHandles.set(id, {
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
          items: [],
        });
      }
    }
    const done = flushHandles.get(id);
    if (done.status === "applied") {
      return {
        tag: "applied",
        val: { maxLocalSequence: done.maxLocalSequence, items: done.items },
      };
    }
    if (done.status === "failed") {
      return { tag: "failed", val: { reason: done.reason ?? "failed", items: done.items ?? [] } };
    }
    return { tag: "pending" };
  }

  function cloudGetSnapshot(roleId) {
    const id = nextHandle++;
    snapshotHandles.set(id, { status: "ready", roleId: String(roleId) });
    return { id };
  }

  function cloudPollSnapshot(handle) {
    const id = typeof handle === "object" ? handle.id : handle;
    const record = snapshotHandles.get(id);
    if (!record) return { tag: "failed", val: { tag: "failed", val: "unknown-handle" } };
    if (record.status === "pending") return { tag: "pending" };
    const map = store.get(record.roleId) ?? new Map();
    const entries = [...map.entries()].map(([key, value]) => snapshotEntry(key, value));
    return {
      tag: "ready",
      val: { gameVarsRevision: nextSequence - 1n, entries },
    };
  }

  function doOrderStart(orderId, _deadlineMs) {
    const id = nextHandle++;
    const resolved = resolveOrder(String(orderId));
    if (!resolved || !activeUserId) {
      orderHandles.set(id, { orderId: String(orderId), userId: activeUserId, phase: "rejected" });
      return { id };
    }
    if (resolved.userId !== activeUserId) {
      orderHandles.set(id, { orderId: String(orderId), userId: activeUserId, phase: "rejected" });
      return { id };
    }
    if (resolved.completed) {
      orderHandles.set(id, {
        orderId: String(orderId),
        userId: activeUserId,
        payId: resolved.payId,
        phase: "completed",
      });
      return { id };
    }
    orderHandles.set(id, {
      orderId: String(orderId),
      userId: activeUserId,
      payId: resolved.payId,
      phase: "allowed",
    });
    return { id };
  }

  function doOrderPoll(handle) {
    const id = typeof handle === "object" ? handle.id : handle;
    const record = orderHandles.get(id);
    if (!record) return { tag: "unavailable" };
    if (record.phase === "pending") return { tag: "pending" };
    if (record.phase === "rejected") return { tag: "rejected" };
    if (record.phase === "completed") return { tag: "completed" };
    if (record.phase === "allowed") {
      return {
        tag: "allowed",
        val: { orderId: record.orderId, payId: record.payId },
      };
    }
    if (record.phase === "finished") return { tag: "completed" };
    return { tag: "unavailable" };
  }

  function doOrderFinish(handle, _deadlineMs) {
    const id = typeof handle === "object" ? handle.id : handle;
    const record = orderHandles.get(id);
    if (!record || record.phase !== "allowed") {
      throw cloudError("not-ready", "order finish requires an allowed delivery window");
    }
    // Payment path: apply fulfill enqueues without an explicit cloudFlush.
    applyPending();
    const order = orders.get(record.orderId);
    if (order) order.completed = true;
    record.phase = "finished";
  }

  function hostBindings() {
    return {
      cloudEnqueueState,
      cloudEnqueueStateBits,
      cloudReadCurrent,
      cloudReadManyCurrent,
      cloudFlushBarrier,
      cloudPollFlush,
      cloudGetSnapshot,
      cloudPollSnapshot,
      doOrderStart,
      doOrderPoll,
      doOrderFinish,
    };
  }

  return {
    setActiveUserId,
    registerOrder,
    hostBindings,
    /** Test helper: read applied cloud value. */
    debugRead(roleId, key) {
      return cloudReadCurrent(roleId, key);
    },
    /** Test helper: whether an order is completed. */
    debugOrderCompleted(orderId) {
      return orders.get(String(orderId))?.completed === true;
    },
  };
}
