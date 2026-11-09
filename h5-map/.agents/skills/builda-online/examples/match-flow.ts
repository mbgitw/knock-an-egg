import {
  OnlineError,
  type MatchTicket,
  type OnlineSocket,
  type RoomHandle,
} from "@cysj/online-h5"

export type TicketObserver = (ticket: MatchTicket | undefined) => void

export function getOrCreateAdmissionKey(current: string | undefined, create: () => string): string {
  return current ?? create()
}

export function isAdmissionOutcomeUnknown(error: unknown): boolean {
  return error instanceof OnlineError && [
    "CONTROL_OUTCOME_UNKNOWN",
    "REQUEST_TIMEOUT",
    "GATEWAY_CLOSED",
    "MATCH_ADMISSION_PENDING",
  ].includes(String(error.code))
}

export async function settleAbandonedTicket(
  socket: OnlineSocket,
  ticket: MatchTicket,
  operationKey: string,
  observe: TicketObserver = () => undefined,
): Promise<MatchTicket> {
  const settled = await socket.settleMatchTicket(ticket, { idempotencyKey: `${operationKey}-settle` })
  observe(settled)
  return settled
}

export async function enterWithTicket(
  socket: OnlineSocket,
  operationKey: string,
  admission: () => Promise<MatchTicket>,
  observe: TicketObserver = () => undefined,
): Promise<RoomHandle> {
  let ticket: MatchTicket | undefined
  try {
    ticket = await admission()
    observe(ticket)
    const room = await socket.waitAndConnectMatchedRoom(ticket, { idempotencyKey: operationKey })
    observe(undefined)
    return room
  } catch (error) {
    if (!ticket) throw error
    await settleAbandonedTicket(socket, ticket, `${operationKey}-recovery`, observe)
    observe(undefined)
    throw error
  }
}
