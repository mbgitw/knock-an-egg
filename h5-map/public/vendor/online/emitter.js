/** Browser event dispatch that does not depend on the Node.js EventEmitter. */
export class TypedEmitter {
    listeners = new Map();
    /** Subscribe to an event and return an unsubscribe function. */
    on(event, listener) {
        const set = this.listeners.get(event) ?? new Set();
        set.add(listener);
        this.listeners.set(event, set);
        return () => set.delete(listener);
    }
    /** Synchronously dispatch an event to the current subscribers. */
    emit(event, value) {
        for (const listener of this.listeners.get(event) ?? [])
            listener(value);
    }
    /** Remove all subscriptions to release references after page switches. */
    clear() {
        this.listeners.clear();
    }
}
