using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace Cysj.Online.Samples
{
    /// <summary>Common multiplayer flows that use only the Unity SDK public API.</summary>
    public static class OnlineRecipes
    {
        private static readonly HashSet<string> ReadyStatuses = new HashSet<string>
        {
            "room_ready",
            "confirmed",
        };

        private static readonly HashSet<string> TerminalStatuses = new HashSet<string>
        {
            "cancelled",
            "timeout",

            "confirm_timeout",
            "failed",
        };

        /// <summary>Restore the in-memory Session, register events first, then connect to the Gateway.</summary>
        public static async Task<OnlineSocket> CreateConnectedSocketAsync(
            OnlineClient client,
            string runtimeToken,
            Action<OnlineSocket> bindEvents,
            CancellationToken cancellationToken)
        {
            var socket = client.CreateSocket();
            bindEvents(socket);
            await socket.ConnectAsync(client.RestoreSession(runtimeToken), cancellationToken);
            return socket;
        }

        /// <summary>
        /// Wait on the same Ticket and connect; when a peer's Confirm failure causes a requeue, the SDK automatically returns to waiting until a Room handle is obtained
        /// or the Ticket reaches an authoritative terminal state (throws MATCH_TICKET_TERMINAL). Other connection failures are rethrown as is; the Ticket may then still be
        /// alive, and SettleAbandonedTicketAsync must be called to settle it before allowing the next matchmaking attempt.
        /// </summary>
        public static Task<OnlineRoom> WaitAndConnectAsync(
            OnlineSocket socket,
            JObject ticket,
            string operationKey,
            CancellationToken cancellationToken)
            => socket.WaitAndConnectMatchedRoomAsync(ticket, null, operationKey, cancellationToken);

        /// <summary>Query the original Ticket after a cold start or Gateway recovery.</summary>
        public static Task<JObject> RecoverTicketAsync(
            OnlineSocket socket,
            string ticketId,
            long? knownVersion,
            CancellationToken cancellationToken)
        {
            return socket.GetMatchTicketAsync(ticketId, knownVersion, cancellationToken);
        }

        /// <summary>Manually renew a Ticket once; only for advanced flows that do not use the wait methods.</summary>
        public static Task<JObject> HeartbeatTicketOnceAsync(
            OnlineSocket socket,
            JObject ticket,
            string operationKey,
            CancellationToken cancellationToken)
        {
            return socket.HeartbeatMatchTicketAsync(
                RequiredString(ticket, "ticket_id"),
                RequiredInteger(ticket, "ticket_version"),
                operationKey,
                cancellationToken);
        }

        /// <summary>Enter a regular single-match Pool.</summary>
        public static async Task<OnlineRoom> EnterPoolAsync(
            OnlineSocket socket,
            string matchKey,
            string operationKey,
            CancellationToken cancellationToken)
        {
            var ticket = await socket.JoinPoolAsync(matchKey, new MatchJoinOptions
            {
                IdempotencyKey = operationKey,
            }, cancellationToken);
            return await WaitAndConnectAsync(socket, ticket, operationKey, cancellationToken);
        }

        /// <summary>Enter a RankPool, passing the single-player score maintained by the game.</summary>
        public static async Task<OnlineRoom> EnterRankPoolAsync(
            OnlineSocket socket,
            string matchKey,
            string operationKey,
            CancellationToken cancellationToken,
            long? rankScore = null)
        {
            var ticket = await socket.JoinRankPoolAsync(matchKey, new MatchJoinOptions
            {
                IdempotencyKey = operationKey,
                RankScore = rankScore,
            }, cancellationToken);
            return await WaitAndConnectAsync(socket, ticket, operationKey, cancellationToken);
        }

        /// <summary>Enter Room mode; whether a Room is created when none is available is constrained by both this call and the deploy configuration.</summary>
        public static async Task<OnlineRoom> EnterRoomModeAsync(
            OnlineSocket socket,
            string matchKey,
            bool allowCreate,
            string operationKey,
            CancellationToken cancellationToken)
        {
            var ticket = await socket.JoinRoomAsync(matchKey, new MatchJoinOptions
            {
                AllowCreate = allowCreate,
                IdempotencyKey = operationKey,
            }, cancellationToken);
            return await WaitAndConnectAsync(socket, ticket, operationKey, cancellationToken);
        }


        /// <summary>Join with a known Room ID: a Room shared by the game's social system or a Builda App invite; the Room ID is the admission credential, and no new Room is created.</summary>
        public static async Task<OnlineRoom> EnterRoomBySharedIdAsync(
            OnlineSocket socket,
            string roomId,
            string operationKey,
            CancellationToken cancellationToken)
        {
            var ticket = await socket.JoinRoomByIdAsync(roomId, new MatchJoinOptions
            {
                IdempotencyKey = operationKey,
            }, cancellationToken);
            return await WaitAndConnectAsync(socket, ticket, operationKey, cancellationToken);
        }

        /// <summary>
        /// Handle a launch from a Builda App Room invitation: the host returns the invitation only once per page lifecycle. With an invitation, request a Seat with the RoomId
        /// and wait to enter; with no invitation, or when the host does not support it, return null and let the game follow its normal lobby flow. The platform still decides entry.
        /// </summary>
        public static async Task<OnlineRoom> TakeRoomInviteAndEnterAsync(
            OnlineSocket socket,
            string operationKey,
            CancellationToken cancellationToken)
        {
            var result = await socket.TakeRoomInviteAsync(cancellationToken);
            if (!result.Available || result.Invite == null) return null;
            return await EnterRoomBySharedIdAsync(socket, result.Invite.RoomId, operationKey + "-invite", cancellationToken);
        }

        /// <summary>Refresh the public authoritative snapshot of the Room.</summary>
        public static Task<JObject> GetRoomSnapshotAsync(
            OnlineSocket socket,
            string roomId,
            CancellationToken cancellationToken)
        {
            return socket.GetRoomAsync(roomId, cancellationToken);
        }

        /// <summary>
        /// Create a private Room and enter it as the creator: a private Room stays out of the public list and automatic matchmaking and can be joined only by Room ID; the creator and
        /// later members are equals. Share the RoomId through the game's own social system; other players join with EnterRoomBySharedIdAsync.
        /// </summary>
        public static async Task<Tuple<OnlineRoom, string>> CreateAndEnterPrivateRoomAsync(
            OnlineSocket socket,
            string matchKey,
            string operationKey,
            CancellationToken cancellationToken)
        {
            var room = await socket.CreateAndConnectPrivateRoomAsync(matchKey, operationKey, cancellationToken);
            return Tuple.Create(room, room.RoomId);
        }


        /// <summary>Cancel the Ticket; if it already raced with RoomReady, connect to the original Assignment and leave the Room immediately.</summary>
        public static async Task CancelTicketOrLeaveReadyRoomAsync(
            OnlineSocket socket,
            JObject ticket,
            string operationKey,
            CancellationToken cancellationToken)
        {
            var ticketId = RequiredString(ticket, "ticket_id");
            var latest = await socket.GetMatchTicketAsync(ticketId, null, cancellationToken);
            var status = RequiredString(latest, "status");
            if (status == "waiting" || status == "matched")
            {
                try
                {
                    latest = await socket.CancelMatchTicketAsync(
                        ticketId,
                        RequiredInteger(latest, "ticket_version"),
                        operationKey + "-cancel",
                        cancellationToken);
                }
                catch (OnlineException)
                {
                    latest = await socket.GetMatchTicketAsync(ticketId, null, cancellationToken);
                }
                status = RequiredString(latest, "status");
            }
            if (TerminalStatuses.Contains(status)) return;
            if (ReadyStatuses.Contains(status))
            {
                var room = await socket.ConnectMatchedRoomAsync(latest, operationKey + "-cancel-race", cancellationToken);
                await room.LeaveAsync();
                return;
            }
            throw new OnlineException("MATCH_CLEANUP_INCOMPLETE", "Ticket is still active: " + status);
        }

        /// <summary>
        /// Settle a possibly still-alive Ticket after a connection failure or a canceled wait: a waiting Ticket is canceled directly, and for non-cancelable states such as formed or RoomReady
        /// the SDK waits, bounded, for an authoritative terminal state. A confirmed result means the Room was entered and must be left actively through the Room handle. Do not rematch before settling.
        /// </summary>
        public static Task<JObject> SettleAbandonedTicketAsync(
            OnlineSocket socket,
            JObject ticket,
            string operationKey,
            CancellationToken cancellationToken)
            => socket.SettleMatchTicketAsync(ticket, operationKey + "-settle", cancellationToken);

        /// <summary>Send gameplay data according to the reliability of each of the three channels.</summary>
        public static void SendGameplay(OnlineRoom room, byte[] control, byte[] reliable, byte[] snapshot)
        {
            room.SendControl(1, control);
            room.SendReliable(101, reliable);
            room.SendUnreliable(201, snapshot);
        }

        /// <summary>After a long-lived Room reaches a single-match RoomReady, leave the old Seat first, then connect to the new Room.</summary>
        public static async Task<OnlineRoom> SwitchLongRoomToPoolAsync(
            OnlineSocket socket,
            OnlineRoom oldRoom,
            string matchKey,
            string operationKey,
            CancellationToken cancellationToken)
        {
            var ticket = await socket.JoinPoolAsync(matchKey, new MatchJoinOptions
            {
                IdempotencyKey = operationKey,
            }, cancellationToken);
            var ready = await socket.WaitForMatchTicketReadyAsync(ticket, null, cancellationToken);
            if (!ReadyStatuses.Contains(RequiredString(ready, "status")))
                throw new OnlineException("MATCH_TICKET_TERMINAL", "Ticket ended before RoomReady");
            await oldRoom.LeaveAsync();
            return await socket.ConnectMatchedRoomAsync(ready, operationKey + "-connect", cancellationToken);
        }

        /// <summary>After entering, join the host chat group with the Room ID; teamId is decided by the game's own team rules. Hide the chat entry point when Available=false.</summary>
        public static async Task<bool> JoinTeamChatAsync(OnlineRoom room, int teamId, CancellationToken cancellationToken)
        {
            var result = await room.JoinChatGroupAsync(teamId, cancellationToken);
            return result.Available;
        }

        /// <summary>Quit the group actively when switching teams or muting early; leaving, Room close, and Socket close quit automatically via the SDK, so no repeat call is needed.</summary>
        public static Task QuitTeamChatAsync(OnlineRoom room, CancellationToken cancellationToken)
        {
            return room.QuitChatGroupAsync(cancellationToken);
        }

        /// <summary>Business handling entry points for public Socket events.</summary>
        public sealed class EventHandlers
        {
            public Action Connected { get; set; } = delegate { };
            public Action<int, string> Closed { get; set; } = delegate { };
            public Action<int> GatewayReconnecting { get; set; } = delegate { };
            public Action GatewayReconnected { get; set; } = delegate { };
            public Action<OnlineException> ErrorReceived { get; set; } = delegate { };
            public Action<JObject> MatchTicketUpdated { get; set; } = delegate { };



            public Action<RoomMessage> RoomMessageReceived { get; set; } = delegate { };
            public Action<string, JObject> MatchPresenceChanged { get; set; } = delegate { };
            public Action<string, JObject> RoomPresenceChanged { get; set; } = delegate { };
            public Action<string, string> RoomClosed { get; set; } = delegate { };
            public Action<RoomReconnectEvent> RoomReconnecting { get; set; } = delegate { };
            public Action<string> RoomReconnected { get; set; } = delegate { };
            public Action<RoomTransferStartedEvent> RoomTransferStarted { get; set; } = delegate { };
            public Action<RoomTransferCompletedEvent> RoomTransferCompleted { get; set; } = delegate { };
            public Action<ChatMessage> ChatMessageReceived { get; set; } = delegate { };
        }

        /// <summary>Bind all public events and unbind each of them on Dispose.</summary>
        public sealed class EventBindings : IDisposable
        {
            private readonly OnlineSocket socket;
            private readonly EventHandlers handlers;
            private bool disposed;

            public EventBindings(OnlineSocket socket, EventHandlers handlers)
            {
                this.socket = socket;
                this.handlers = handlers;
                socket.Connected += handlers.Connected;
                socket.Closed += handlers.Closed;
                socket.GatewayReconnecting += handlers.GatewayReconnecting;
                socket.GatewayReconnected += handlers.GatewayReconnected;
                socket.ErrorReceived += handlers.ErrorReceived;
                socket.MatchTicketUpdated += handlers.MatchTicketUpdated;



                socket.RoomMessageReceived += handlers.RoomMessageReceived;
                socket.MatchPresenceChanged += handlers.MatchPresenceChanged;
                socket.RoomPresenceChanged += handlers.RoomPresenceChanged;
                socket.RoomClosed += handlers.RoomClosed;
                socket.RoomReconnecting += handlers.RoomReconnecting;
                socket.RoomReconnected += handlers.RoomReconnected;
                socket.RoomTransferStarted += handlers.RoomTransferStarted;
                socket.RoomTransferCompleted += handlers.RoomTransferCompleted;
                socket.ChatMessageReceived += handlers.ChatMessageReceived;
            }

            public void Dispose()
            {
                if (disposed) return;
                disposed = true;
                socket.Connected -= handlers.Connected;
                socket.Closed -= handlers.Closed;
                socket.GatewayReconnecting -= handlers.GatewayReconnecting;
                socket.GatewayReconnected -= handlers.GatewayReconnected;
                socket.ErrorReceived -= handlers.ErrorReceived;
                socket.MatchTicketUpdated -= handlers.MatchTicketUpdated;



                socket.RoomMessageReceived -= handlers.RoomMessageReceived;
                socket.MatchPresenceChanged -= handlers.MatchPresenceChanged;
                socket.RoomPresenceChanged -= handlers.RoomPresenceChanged;
                socket.RoomClosed -= handlers.RoomClosed;
                socket.RoomReconnecting -= handlers.RoomReconnecting;
                socket.RoomReconnected -= handlers.RoomReconnected;
                socket.RoomTransferStarted -= handlers.RoomTransferStarted;
                socket.RoomTransferCompleted -= handlers.RoomTransferCompleted;
                socket.ChatMessageReceived -= handlers.ChatMessageReceived;
            }
        }

        /// <summary>Collect only redacted network snapshots and RTT.</summary>
        public static async Task<JObject> CollectNetworkDiagnosticsAsync(
            OnlineSocket socket,
            string roomId,
            CancellationToken cancellationToken)
        {
            var result = new JObject
            {
                ["gateway_rtt_millis"] = await socket.MeasureGatewayRttAsync(cancellationToken),
                ["snapshot"] = socket.NetworkSnapshot(roomId),
            };
            if (!string.IsNullOrEmpty(roomId))
                result["room_rtt_millis"] = await socket.MeasureRoomRttAsync(roomId, cancellationToken);
            return result;
        }

        /// <summary>When exiting the whole multiplayer page, leave the Room first, then close the shared Socket.</summary>
        public static async Task LeaveRoomAndCloseAsync(OnlineSocket socket, OnlineRoom room)
        {
            await room.LeaveAsync();
            await socket.CloseAsync();
        }

        /// <summary>Read a required object field.</summary>
        private static JObject RequiredObject(JObject payload, string field)
        {
            var value = payload[field] as JObject;
            if (value == null) throw new OnlineException("PUBLIC_RESPONSE_INVALID", "Missing object field: " + field);
            return value;
        }

        /// <summary>Read a required string field.</summary>
        private static string RequiredString(JObject payload, string field)
        {
            var value = payload.Value<string>(field) ?? string.Empty;
            if (value.Length == 0) throw new OnlineException("PUBLIC_RESPONSE_INVALID", "Missing string field: " + field);
            return value;
        }

        /// <summary>Read a non-negative integer field.</summary>
        private static long RequiredInteger(JObject payload, string field)
        {
            var value = payload.Value<long?>(field);
            if (!value.HasValue || value.Value < 0)
                throw new OnlineException("PUBLIC_RESPONSE_INVALID", "Invalid integer field: " + field);
            return value.Value;
        }
    }
}
