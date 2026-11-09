/** Browser event dispatch that does not depend on the Node.js EventEmitter. */
export class TypedEmitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(value: never) => void>>()

  /** Subscribe to an event and return an unsubscribe function. */
  on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set<(value: never) => void>()
    set.add(listener as (value: never) => void)
    this.listeners.set(event, set)
    return () => set.delete(listener as (value: never) => void)
  }

  /** Synchronously dispatch an event to the current subscribers. */
  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never)
  }

  /** Remove all subscriptions to release references after page switches. */
  clear(): void {
    this.listeners.clear()
  }
}
