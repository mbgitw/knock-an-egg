/** Browser event dispatch that does not depend on the Node.js EventEmitter. */
export declare class TypedEmitter<Events extends object> {
    private readonly listeners;
    /** Subscribe to an event and return an unsubscribe function. */
    on<K extends keyof Events>(event: K, listener: (value: Events[K]) => void): () => void;
    /** Synchronously dispatch an event to the current subscribers. */
    emit<K extends keyof Events>(event: K, value: Events[K]): void;
    /** Remove all subscriptions to release references after page switches. */
    clear(): void;
}
