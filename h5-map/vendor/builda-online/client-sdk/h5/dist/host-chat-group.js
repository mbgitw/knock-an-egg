/** Normalize arbitrarily shaped host push messages into stable fields, dropping messages without a group ID. */
function normalizeHostMessage(value) {
    const raw = (value ?? {});
    const groupId = typeof raw.groupId === 'string' ? raw.groupId : '';
    if (!groupId)
        return undefined;
    const teamId = Number(raw.teamId);
    return {
        groupId,
        teamId: Number.isInteger(teamId) ? teamId : 0,
        senderId: typeof raw.senderId === 'string' ? raw.senderId : String(raw.senderId ?? ''),
        text: typeof raw.text === 'string' ? raw.text : String(raw.text ?? ''),
    };
}
/** Room notifications and chat groups are probed separately: older hosts may have only one of the two interface sets. */
function hostRoomSurface() {
    const scope = globalThis;
    const online = scope.Builda?.__online;
    if (!online || typeof online !== 'object')
        return undefined;
    const surface = online;
    if (typeof surface.enterRoom !== 'function' || typeof surface.leaveRoom !== 'function')
        return undefined;
    return surface;
}
function hostInviteSurface() {
    const scope = globalThis;
    const online = scope.Builda?.__online;
    if (!online || typeof online !== 'object')
        return undefined;
    const surface = online;
    if (typeof surface.takeInviteInfo !== 'function')
        return undefined;
    return surface;
}
function hostRoleInfoSurface() {
    const scope = globalThis;
    const builda = scope.Builda;
    if (!builda || typeof builda.getRoleInfo !== 'function')
        return undefined;
    return builda;
}
/** Normalize an arbitrarily shaped host invitation into stable fields; a missing roomId or inviter ID is treated as no invitation. */
function normalizeHostInvite(value) {
    const raw = (value ?? {});
    const roomId = typeof raw.roomId === 'string' ? raw.roomId : '';
    const inviterId = typeof raw.inviter?.id === 'string' ? raw.inviter.id : String(raw.inviter?.id ?? '');
    if (!roomId || !inviterId)
        return null;
    return {
        roomId,
        inviter: {
            id: inviterId,
            name: typeof raw.inviter?.name === 'string' ? raw.inviter.name : '',
            avatar: typeof raw.inviter?.avatar === 'string' ? raw.inviter.avatar : '',
        },
    };
}
/** When the inviter nickname or avatar is missing, fill it from host public profile data on a best-effort basis; on failure keep the original values without affecting the invitation itself. */
async function fillInviterProfile(invite, timeoutMs) {
    if (invite.inviter.name && invite.inviter.avatar)
        return invite;
    const surface = hostRoleInfoSurface();
    if (!surface)
        return invite;
    try {
        const result = (await surface.getRoleInfo([invite.inviter.id], { timeoutMs }));
        const info = result?.ok === true ? result.data?.[invite.inviter.id] : undefined;
        if (!info)
            return invite;
        return {
            roomId: invite.roomId,
            inviter: {
                id: invite.inviter.id,
                name: invite.inviter.name || (typeof info.userName === 'string' ? info.userName : ''),
                avatar: invite.inviter.avatar || (typeof info.userImg === 'string' ? info.userImg : ''),
            },
        };
    }
    catch {
        return invite;
    }
}
/** Feature-detect only, without caching the object: the host may inject it later than the game script during the page lifecycle. */
function hostOnlineSurface() {
    const scope = globalThis;
    const online = scope.Builda?.__online;
    if (!online || typeof online !== 'object')
        return undefined;
    const surface = online;
    if (typeof surface.joinChatGroup !== 'function' || typeof surface.quitChatGroup !== 'function')
        return undefined;
    return surface;
}
/** Normalize arbitrarily shaped host replies into stable error codes without passing through the raw payload. */
function normalizeHostResponse(value) {
    const result = (value ?? {});
    if (result.ok === true)
        return { ok: true };
    const code = typeof result.error?.code === 'string' && result.error.code ? result.error.code : 'CHAT_GROUP_HOST_ERROR';
    const message = typeof result.error?.message === 'string' && result.error.message ? result.error.message : 'Builda host rejected the chat group request';
    return { ok: false, error: { code, message } };
}
/** Default bridge: calls the Builda SDK internal interface directly and adds a bounded timeout to each request. */
export class BuildaChatGroupHostBridge {
    /** Whether the host declares chat group capability. */
    available() {
        return hostOnlineSurface() !== undefined;
    }
    /** Subscribe to host chat messages; returns a no-op when older hosts lack onChatMessage, and silently ignores unsubscribe failures. */
    subscribe(handler) {
        const surface = hostOnlineSurface();
        if (!surface || typeof surface.onChatMessage !== 'function')
            return () => undefined;
        const listener = (value) => {
            const message = normalizeHostMessage(value);
            if (message)
                handler(message);
        };
        let off;
        try {
            off = surface.onChatMessage(listener);
        }
        catch {
            return () => undefined;
        }
        return () => {
            try {
                if (typeof off === 'function')
                    off();
                else if (typeof surface.offChatMessage === 'function')
                    surface.offChatMessage(listener);
            }
            catch {
                // Unsubscribing only affects the host side; failures are not returned to the game.
            }
        };
    }
    /** Whether the host provides Room enter/leave notifications. */
    roomNotificationsAvailable() {
        return hostRoomSurface() !== undefined;
    }
    /** Notify the host of entering or leaving a Room; host exceptions, rejections or timeouts return stable error codes instead of throwing. */
    async notifyRoom(command, params, timeoutMs) {
        const surface = hostRoomSurface();
        if (!surface)
            return { ok: false, error: { code: 'HOST_ROOM_UNAVAILABLE', message: 'Builda host does not provide room notifications' } };
        let timer;
        const timeout = new Promise((resolve) => {
            timer = setTimeout(() => resolve({ ok: false, error: { code: 'HOST_ROOM_TIMEOUT', message: 'Timed out waiting for the Builda host room notification response' } }), timeoutMs);
        });
        try {
            const invocation = Promise.resolve()
                .then(() => surface[command]({ roomId: params.roomId, timeoutMs }))
                .then(normalizeHostResponse, (error) => ({
                ok: false,
                error: { code: 'HOST_ROOM_ERROR', message: error instanceof Error ? error.message : 'Builda host room notification failed' },
            }));
            return await Promise.race([invocation, timeout]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    /** Whether the host provides a one-time read of the launching invitation. */
    roomInviteAvailable() {
        return hostInviteSurface() !== undefined;
    }
    /** One-time read of the launching invitation, filling in inviter profile data on a best-effort basis; host exceptions, rejections or timeouts return stable error codes instead of throwing. */
    async takeRoomInvite(timeoutMs) {
        const surface = hostInviteSurface();
        if (!surface)
            return { ok: false, error: { code: 'ROOM_INVITE_UNAVAILABLE', message: 'Builda host does not provide room invites' } };
        let timer;
        const timeout = new Promise((resolve) => {
            timer = setTimeout(() => resolve({ ok: false, error: { code: 'ROOM_INVITE_TIMEOUT', message: 'Timed out waiting for the Builda host room invite' } }), timeoutMs);
        });
        try {
            const invocation = Promise.resolve()
                .then(() => surface.takeInviteInfo({ timeoutMs }))
                .then(async (value) => {
                const result = (value ?? {});
                if (result.ok !== true) {
                    const code = typeof result.error?.code === 'string' && result.error.code ? result.error.code : 'ROOM_INVITE_HOST_ERROR';
                    const message = typeof result.error?.message === 'string' && result.error.message ? result.error.message : 'Builda host rejected the room invite request';
                    return { ok: false, error: { code, message } };
                }
                const invite = normalizeHostInvite(result.data?.invite);
                return { ok: true, invite: invite ? await fillInviterProfile(invite, timeoutMs) : null };
            }, (error) => ({
                ok: false,
                error: { code: 'ROOM_INVITE_HOST_ERROR', message: error instanceof Error ? error.message : 'Builda host room invite call failed' },
            }));
            return await Promise.race([invocation, timeout]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    /** Send one join or quit request; host exceptions, rejections or timeouts return stable error codes instead of throwing. */
    async request(command, params, timeoutMs) {
        const surface = hostOnlineSurface();
        if (!surface)
            return { ok: false, error: { code: 'CHAT_GROUP_UNAVAILABLE', message: 'Builda host does not provide chat groups' } };
        let timer;
        const timeout = new Promise((resolve) => {
            timer = setTimeout(() => resolve({ ok: false, error: { code: 'CHAT_GROUP_TIMEOUT', message: 'Timed out waiting for the Builda host chat group response' } }), timeoutMs);
        });
        try {
            const invocation = Promise.resolve()
                .then(() => surface[command]({ groupId: params.groupId, teamId: params.teamId, timeoutMs }))
                .then(normalizeHostResponse, (error) => ({
                ok: false,
                error: { code: 'CHAT_GROUP_HOST_ERROR', message: error instanceof Error ? error.message : 'Builda host chat group call failed' },
            }));
            return await Promise.race([invocation, timeout]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
}
