# H5 and Cocos Lifecycle Example

This page is for H5 and Cocos Web projects only.
[End-to-End Lifecycle and Room Protocol](client-lifecycle.md) is the sole authority for the state machine, recovery rules, and error codes; this page only provides the TypeScript implementation. Cocos uses the public APIs with the same names,
imported from `@cysj/online-cocos`; like `beforeunload`, Component `onDestroy` must not be responsible for a normal exit.

```ts
import {
  OnlineError,
  type MatchTicket,
  type OnlineSocket,
  type RoomHandle,
} from '@cysj/online-h5'

const TERMINAL = new Set([
  'cancelled', 'timeout', 'confirm_timeout', 'failed',
])

class OnlineFlow {
  private ticket: MatchTicket | null = null
  private room: RoomHandle | null = null
  private admission: Promise<MatchTicket> | null = null
  private admissionKey: string | null = null
  private connecting: Promise<RoomHandle> | null = null
  private waitAbort: AbortController | null = null
  private exitRequested = false
  private cleaning = false

  constructor(private readonly socket: OnlineSocket) {}

  /** Create a Room Ticket and keep saving the latest snapshot returned by the server. */
  async startRoom(matchKey: string): Promise<void> {
    if (this.cleaning || this.exitRequested) return
    this.admissionKey ??= crypto.randomUUID()
    this.admission = this.socket.joinRoom(matchKey, {
      allowCreate: true,
      idempotencyKey: this.admissionKey,
    })
    try {
      this.ticket = await this.admission
    } catch (error) {
      this.showError('admission', error)
      return
    } finally {
      this.admission = null
    }
    if (this.exitRequested) return

    const activeTicket = this.ticket
    this.waitAbort = new AbortController()
    try {
      // When a peer's Confirm failure causes a requeue, the SDK automatically returns to waiting on the same Ticket; a terminal state rejects with MATCH_TICKET_TERMINAL.
      this.connecting = this.socket.waitAndConnectMatchedRoom(activeTicket, {
        signal: this.waitAbort.signal,
        idempotencyKey: `${this.admissionKey}-connect`,
      })
      this.room = await this.connecting
      this.ticket = null
    } catch (error) {
      if (this.exitRequested) return
      if (error instanceof OnlineError && error.code === 'MATCH_TICKET_TERMINAL') {
        this.ticket = null
        return
      }
      // After a connect failure the Ticket may still be room_ready or already requeued: first settle it to the authoritative terminal state, then show the error and allow the next matchmaking.
      try {
        const settled = await this.socket.settleMatchTicket(activeTicket)
        this.ticket = settled.status === 'confirmed' ? settled : null
      } catch (settleError) {
        this.showError('ticket_settle', settleError)
        return
      }
      this.showError('room_connect', error)
    } finally {
      this.connecting = null
      this.waitAbort = null
    }
  }

  /** Exit safely from a normal UI entry; on failure, never navigate or start matchmaking again. */
  async returnToMenu(): Promise<boolean> {
    if (this.cleaning) return false
    this.exitRequested = true
    this.cleaning = true
    this.waitAbort?.abort()
    try {
      if (this.admission) this.ticket = await this.admission
      if (this.connecting) {
        try {
          this.room = await this.connecting
        } catch {
          // The combined entry was aborted or failed; any still-live Ticket is settled below.
        }
      }
      const connectedRoom = this.room
      if (connectedRoom) {
        await this.socket.leaveRoom(connectedRoom.roomId)
        this.room = null
      } else if (this.ticket) {
        await this.cancelTicketBeforeExit()
      }
      this.socket.close()
      // Only here may router.navigate(...) be executed.
      return true
    } catch (error) {
      this.showError('cleanup', error)
      return false
    } finally {
      this.cleaning = false
    }
  }

  /** Cancel the latest Ticket; if it is already RoomReady, connect and then immediately leave the Room. */
  private async cancelTicketBeforeExit(): Promise<void> {
    let current = this.ticket
    if (!current) return
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        current = await this.socket.cancelMatchTicket(
          current.ticket_id,
          current.ticket_version,
          `exit-cancel-${current.ticket_id}-${attempt}`,
        )
      } catch {
        current = await this.socket.getMatchTicket(current.ticket_id)
      }
      this.ticket = current
      if (TERMINAL.has(current.status)) {
        this.ticket = null
        return
      }
      current = await this.socket.getMatchTicket(current.ticket_id)
      this.ticket = current
      if (TERMINAL.has(current.status)) {
        this.ticket = null
        return
      }
      if (current.status === 'room_ready' || current.status === 'confirmed') {
        this.room = await this.socket.connectMatchedRoom(current)
        this.ticket = null
        await this.socket.leaveRoom(this.room.roomId)
        this.room = null
        return
      }
    }
    throw new OnlineError('MATCH_CANCEL_NOT_SETTLED', 'Ticket cancellation not settled')
  }

  /** Show the SDK's stable error code and stage; do not override them with generic text. */
  private showError(stage: string, error: unknown): void {
    const code = error instanceof OnlineError ? String(error.code) : 'UNKNOWN_ERROR'
    console.error(`[${stage}][${code}]`, error)
  }
}
```

`beforeunload` cannot `await returnToMenu()`. A normal in-page return must first wait for the Promise above; directly closing the tab is an abnormal disconnect.
