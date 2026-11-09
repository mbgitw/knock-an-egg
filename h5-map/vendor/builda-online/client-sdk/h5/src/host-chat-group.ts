import type {
  ChatGroupHostBridge,
  ChatGroupHostCommand,
  ChatGroupHostMessage,
  ChatGroupHostResponse,
  HostRoomCommand,
  RoomInvite,
  RoomInviteHostResponse,
} from './types.js'

/** Internal chat group interface the Builda SDK reserves for the Online SDK; treated as unavailable when older hosts lack the object. */
interface HostOnlineSurface {
  joinChatGroup(options: { groupId: string; teamId: number; timeoutMs?: number }): Promise<unknown>
  quitChatGroup(options: { groupId: string; teamId: number; timeoutMs?: number }): Promise<unknown>
  // Message push is a later internal interface; older hosts may only have join/quit.
  onChatMessage?(handler: (message: unknown) => void): unknown
  offChatMessage?(handler?: (message: unknown) => void): void
}

/** Normalize arbitrarily shaped host push messages into stable fields, dropping messages without a group ID. */
function normalizeHostMessage(value: unknown): ChatGroupHostMessage | undefined {
  const raw = (value ?? {}) as { groupId?: unknown; teamId?: unknown; senderId?: unknown; text?: unknown }
  const groupId = typeof raw.groupId === 'string' ? raw.groupId : ''
  if (!groupId) return undefined
  const teamId = Number(raw.teamId)
  return {
    groupId,
    teamId: Number.isInteger(teamId) ? teamId : 0,
    senderId: typeof raw.senderId === 'string' ? raw.senderId : String(raw.senderId ?? ''),
    text: typeof raw.text === 'string' ? raw.text : String(raw.text ?? ''),
  }
}

/** Room presence notification interface the Builda SDK reserves for the Online SDK; available only when both methods exist. */
interface HostRoomSurface {
  enterRoom(options: { roomId: string; timeoutMs?: number }): Promise<unknown>
  leaveRoom(options: { roomId: string; timeoutMs?: number }): Promise<unknown>
}

/** Room notifications and chat groups are probed separately: older hosts may have only one of the two interface sets. */
function hostRoomSurface(): HostRoomSurface | undefined {
  const scope = globalThis as { Builda?: { __online?: unknown } }
  const online = scope.Builda?.__online
  if (!online || typeof online !== 'object') return undefined
  const surface = online as Partial<HostRoomSurface>
  if (typeof surface.enterRoom !== 'function' || typeof surface.leaveRoom !== 'function') return undefined
  return surface as HostRoomSurface
}

/** One-time invitation read interface the Builda SDK reserves for the Online SDK; the public getRoleInfo is used to fill in inviter profile data. */
interface HostInviteSurface {
  takeInviteInfo(options: { timeoutMs?: number }): Promise<unknown>
}

interface HostRoleInfoSurface {
  getRoleInfo(roleIds: string[], options: { timeoutMs?: number }): Promise<unknown>
}

function hostInviteSurface(): HostInviteSurface | undefined {
  const scope = globalThis as { Builda?: { __online?: unknown } }
  const online = scope.Builda?.__online
  if (!online || typeof online !== 'object') return undefined
  const surface = online as Partial<HostInviteSurface>
  if (typeof surface.takeInviteInfo !== 'function') return undefined
  return surface as HostInviteSurface
}

function hostRoleInfoSurface(): HostRoleInfoSurface | undefined {
  const scope = globalThis as { Builda?: Partial<HostRoleInfoSurface> }
  const builda = scope.Builda
  if (!builda || typeof builda.getRoleInfo !== 'function') return undefined
  return builda as HostRoleInfoSurface
}

/** Normalize an arbitrarily shaped host invitation into stable fields; a missing roomId or inviter ID is treated as no invitation. */
function normalizeHostInvite(value: unknown): RoomInvite | null {
  const raw = (value ?? {}) as { roomId?: unknown; inviter?: { id?: unknown; name?: unknown; avatar?: unknown } }
  const roomId = typeof raw.roomId === 'string' ? raw.roomId : ''
  const inviterId = typeof raw.inviter?.id === 'string' ? raw.inviter.id : String(raw.inviter?.id ?? '')
  if (!roomId || !inviterId) return null
  return {
    roomId,
    inviter: {
      id: inviterId,
      name: typeof raw.inviter?.name === 'string' ? raw.inviter.name : '',
      avatar: typeof raw.inviter?.avatar === 'string' ? raw.inviter.avatar : '',
    },
  }
}

/** When the inviter nickname or avatar is missing, fill it from host public profile data on a best-effort basis; on failure keep the original values without affecting the invitation itself. */
async function fillInviterProfile(invite: RoomInvite, timeoutMs: number): Promise<RoomInvite> {
  if (invite.inviter.name && invite.inviter.avatar) return invite
  const surface = hostRoleInfoSurface()
  if (!surface) return invite
  try {
    const result = (await surface.getRoleInfo([invite.inviter.id], { timeoutMs })) as { ok?: unknown; data?: Record<string, { userName?: unknown; userImg?: unknown }> }
    const info = result?.ok === true ? result.data?.[invite.inviter.id] : undefined
    if (!info) return invite
    return {
      roomId: invite.roomId,
      inviter: {
        id: invite.inviter.id,
        name: invite.inviter.name || (typeof info.userName === 'string' ? info.userName : ''),
        avatar: invite.inviter.avatar || (typeof info.userImg === 'string' ? info.userImg : ''),
      },
    }
  } catch {
    return invite
  }
}

/** Feature-detect only, without caching the object: the host may inject it later than the game script during the page lifecycle. */
function hostOnlineSurface(): HostOnlineSurface | undefined {
  const scope = globalThis as { Builda?: { __online?: unknown } }
  const online = scope.Builda?.__online
  if (!online || typeof online !== 'object') return undefined
  const surface = online as Partial<HostOnlineSurface>
  if (typeof surface.joinChatGroup !== 'function' || typeof surface.quitChatGroup !== 'function') return undefined
  return surface as HostOnlineSurface
}

/** Normalize arbitrarily shaped host replies into stable error codes without passing through the raw payload. */
function normalizeHostResponse(value: unknown): ChatGroupHostResponse {
  const result = (value ?? {}) as { ok?: unknown; error?: { code?: unknown; message?: unknown } }
  if (result.ok === true) return { ok: true }
  const code = typeof result.error?.code === 'string' && result.error.code ? result.error.code : 'CHAT_GROUP_HOST_ERROR'
  const message = typeof result.error?.message === 'string' && result.error.message ? result.error.message : 'Builda host rejected the chat group request'
  return { ok: false, error: { code, message } }
}

/** Default bridge: calls the Builda SDK internal interface directly and adds a bounded timeout to each request. */
export class BuildaChatGroupHostBridge implements ChatGroupHostBridge {
  /** Whether the host declares chat group capability. */
  available(): boolean {
    return hostOnlineSurface() !== undefined
  }

  /** Subscribe to host chat messages; returns a no-op when older hosts lack onChatMessage, and silently ignores unsubscribe failures. */
  subscribe(handler: (message: ChatGroupHostMessage) => void): () => void {
    const surface = hostOnlineSurface()
    if (!surface || typeof surface.onChatMessage !== 'function') return () => undefined
    const listener = (value: unknown) => {
      const message = normalizeHostMessage(value)
      if (message) handler(message)
    }
    let off: unknown
    try {
      off = surface.onChatMessage(listener)
    } catch {
      return () => undefined
    }
    return () => {
      try {
        if (typeof off === 'function') off()
        else if (typeof surface.offChatMessage === 'function') surface.offChatMessage(listener)
      } catch {
        // Unsubscribing only affects the host side; failures are not returned to the game.
      }
    }
  }

  /** Whether the host provides Room enter/leave notifications. */
  roomNotificationsAvailable(): boolean {
    return hostRoomSurface() !== undefined
  }

  /** Notify the host of entering or leaving a Room; host exceptions, rejections or timeouts return stable error codes instead of throwing. */
  async notifyRoom(command: HostRoomCommand, params: { roomId: string }, timeoutMs: number): Promise<ChatGroupHostResponse> {
    const surface = hostRoomSurface()
    if (!surface) return { ok: false, error: { code: 'HOST_ROOM_UNAVAILABLE', message: 'Builda host does not provide room notifications' } }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<ChatGroupHostResponse>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: { code: 'HOST_ROOM_TIMEOUT', message: 'Timed out waiting for the Builda host room notification response' } }), timeoutMs)
    })
    try {
      const invocation = Promise.resolve()
        .then(() => surface[command]({ roomId: params.roomId, timeoutMs }))
        .then(normalizeHostResponse, (error: unknown) => ({
          ok: false as const,
          error: { code: 'HOST_ROOM_ERROR', message: error instanceof Error ? error.message : 'Builda host room notification failed' },
        }))
      return await Promise.race([invocation, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** Whether the host provides a one-time read of the launching invitation. */
  roomInviteAvailable(): boolean {
    return hostInviteSurface() !== undefined
  }

  /** One-time read of the launching invitation, filling in inviter profile data on a best-effort basis; host exceptions, rejections or timeouts return stable error codes instead of throwing. */
  async takeRoomInvite(timeoutMs: number): Promise<RoomInviteHostResponse> {
    const surface = hostInviteSurface()
    if (!surface) return { ok: false, error: { code: 'ROOM_INVITE_UNAVAILABLE', message: 'Builda host does not provide room invites' } }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<RoomInviteHostResponse>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: { code: 'ROOM_INVITE_TIMEOUT', message: 'Timed out waiting for the Builda host room invite' } }), timeoutMs)
    })
    try {
      const invocation = Promise.resolve()
        .then(() => surface.takeInviteInfo({ timeoutMs }))
        .then(async (value): Promise<RoomInviteHostResponse> => {
          const result = (value ?? {}) as { ok?: unknown; data?: { invite?: unknown }; error?: { code?: unknown; message?: unknown } }
          if (result.ok !== true) {
            const code = typeof result.error?.code === 'string' && result.error.code ? result.error.code : 'ROOM_INVITE_HOST_ERROR'
            const message = typeof result.error?.message === 'string' && result.error.message ? result.error.message : 'Builda host rejected the room invite request'
            return { ok: false, error: { code, message } }
          }
          const invite = normalizeHostInvite(result.data?.invite)
          return { ok: true, invite: invite ? await fillInviterProfile(invite, timeoutMs) : null }
        }, (error: unknown): RoomInviteHostResponse => ({
          ok: false,
          error: { code: 'ROOM_INVITE_HOST_ERROR', message: error instanceof Error ? error.message : 'Builda host room invite call failed' },
        }))
      return await Promise.race([invocation, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** Send one join or quit request; host exceptions, rejections or timeouts return stable error codes instead of throwing. */
  async request(command: ChatGroupHostCommand, params: { groupId: string; teamId: number }, timeoutMs: number): Promise<ChatGroupHostResponse> {
    const surface = hostOnlineSurface()
    if (!surface) return { ok: false, error: { code: 'CHAT_GROUP_UNAVAILABLE', message: 'Builda host does not provide chat groups' } }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<ChatGroupHostResponse>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: { code: 'CHAT_GROUP_TIMEOUT', message: 'Timed out waiting for the Builda host chat group response' } }), timeoutMs)
    })
    try {
      const invocation = Promise.resolve()
        .then(() => surface[command]({ groupId: params.groupId, teamId: params.teamId, timeoutMs }))
        .then(normalizeHostResponse, (error: unknown) => ({
          ok: false as const,
          error: { code: 'CHAT_GROUP_HOST_ERROR', message: error instanceof Error ? error.message : 'Builda host chat group call failed' },
        }))
      return await Promise.race([invocation, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
