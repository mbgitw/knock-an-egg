import type { ChatGroupHostBridge, ChatGroupHostCommand, ChatGroupHostMessage, ChatGroupHostResponse, HostRoomCommand, RoomInviteHostResponse } from './types.js';
/** Default bridge: calls the Builda SDK internal interface directly and adds a bounded timeout to each request. */
export declare class BuildaChatGroupHostBridge implements ChatGroupHostBridge {
    /** Whether the host declares chat group capability. */
    available(): boolean;
    /** Subscribe to host chat messages; returns a no-op when older hosts lack onChatMessage, and silently ignores unsubscribe failures. */
    subscribe(handler: (message: ChatGroupHostMessage) => void): () => void;
    /** Whether the host provides Room enter/leave notifications. */
    roomNotificationsAvailable(): boolean;
    /** Notify the host of entering or leaving a Room; host exceptions, rejections or timeouts return stable error codes instead of throwing. */
    notifyRoom(command: HostRoomCommand, params: {
        roomId: string;
    }, timeoutMs: number): Promise<ChatGroupHostResponse>;
    /** Whether the host provides a one-time read of the launching invitation. */
    roomInviteAvailable(): boolean;
    /** One-time read of the launching invitation, filling in inviter profile data on a best-effort basis; host exceptions, rejections or timeouts return stable error codes instead of throwing. */
    takeRoomInvite(timeoutMs: number): Promise<RoomInviteHostResponse>;
    /** Send one join or quit request; host exceptions, rejections or timeouts return stable error codes instead of throwing. */
    request(command: ChatGroupHostCommand, params: {
        groupId: string;
        teamId: number;
    }, timeoutMs: number): Promise<ChatGroupHostResponse>;
}
