# Unity Lifecycle Example

This page is for Unity projects only. [End-to-End Lifecycle and Room Protocol](client-lifecycle.md) is the
sole authority for the state machine, recovery rules, and error codes; this page only provides the C# implementation.

```csharp
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Cysj.Online;
using Newtonsoft.Json.Linq;

public sealed class OnlineFlow
{
    private static readonly HashSet<string> Terminal = new HashSet<string>
    {
        "cancelled", "timeout", "confirm_timeout", "failed",
    };

    private readonly OnlineSocket socket;
    private JObject ticket;
    private OnlineRoom room;
    private Task<JObject> admissionTask;
    private string admissionKey;
    private Task<OnlineRoom> connectTask;
    private CancellationTokenSource waitCancellation;
    private bool exitRequested;
    private bool cleaning;

    public OnlineFlow(OnlineSocket socket) => this.socket = socket;

    /// <summary>Create a Room Ticket and keep saving the latest snapshot returned by the server.</summary>
    public async Task StartRoomAsync(string matchKey, CancellationToken cancellationToken)
    {
        if (cleaning || exitRequested) return;
        admissionKey = string.IsNullOrEmpty(admissionKey)
            ? Guid.NewGuid().ToString("N")
            : admissionKey;
        admissionTask = socket.JoinRoomAsync(matchKey, new MatchJoinOptions
        {
            AllowCreate = true,
            IdempotencyKey = admissionKey,
        }, cancellationToken);
        try
        {
            ticket = await admissionTask;
        }
        catch (Exception error)
        {
            ShowError("admission", error);
            return;
        }
        finally
        {
            admissionTask = null;
        }
        if (exitRequested) return;

        var activeTicket = ticket;
        waitCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        try
        {
            // When a peer's Confirm failure causes a requeue, the SDK automatically returns to waiting on the same Ticket; a terminal state throws MATCH_TICKET_TERMINAL.
            connectTask = socket.WaitAndConnectMatchedRoomAsync(
                activeTicket,
                idempotencyKey: admissionKey + "-connect",
                cancellationToken: waitCancellation.Token);
            room = await connectTask;
            ticket = null;
        }
        catch (OperationCanceledException) when (exitRequested)
        {
            // A normal exit continues to settle the saved Ticket.
        }
        catch (OnlineException error) when (error.Code == "MATCH_TICKET_TERMINAL")
        {
            ticket = null;
        }
        catch (Exception error)
        {
            // After a connect failure the Ticket may still be room_ready or already requeued: first settle it to the authoritative terminal state, then show the error and allow the next matchmaking.
            try
            {
                var settled = await socket.SettleMatchTicketAsync(activeTicket, cancellationToken: cancellationToken);
                ticket = settled.Value<string>("status") == "confirmed" ? settled : null;
                ShowError("room_connect", error);
            }
            catch (Exception settleError)
            {
                ShowError("ticket_settle", settleError);
            }
        }
        finally
        {
            connectTask = null;
            waitCancellation?.Dispose();
            waitCancellation = null;
        }
    }

    /// <summary>Exit safely from a normal UI entry; on failure, never switch scenes or start matchmaking again.</summary>
    public async Task<bool> ReturnToMenuAsync()
    {
        if (cleaning) return false;
        exitRequested = true;
        cleaning = true;
        waitCancellation?.Cancel();
        try
        {
            if (admissionTask != null) ticket = await admissionTask;
            if (connectTask != null)
            {
                try { room = await connectTask; }
                catch { /* The combined entry was cancelled or failed; any still-live Ticket is settled below. */ }
            }
            if (room != null)
            {
                await socket.LeaveRoomAsync(room.RoomId);
                room = null;
            }
            else if (ticket != null)
            {
                await CancelTicketBeforeExitAsync();
            }
            await socket.CloseAsync();
            // Only here may SceneManager.LoadScene(...) be called.
            return true;
        }
        catch (Exception error)
        {
            ShowError("cleanup", error);
            return false;
        }
        finally
        {
            cleaning = false;
        }
    }

    /// <summary>Cancel the latest Ticket; if it is already RoomReady, connect and then immediately leave the Room.</summary>
    private async Task CancelTicketBeforeExitAsync()
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var ticketId = ticket.Value<string>("ticket_id") ?? string.Empty;
            try
            {
                ticket = await socket.CancelMatchTicketAsync(
                    ticketId,
                    ticket.Value<long>("ticket_version"),
                    $"exit-cancel-{ticketId}-{attempt}");
            }
            catch
            {
                ticket = await socket.GetMatchTicketAsync(ticketId);
            }
            var status = ticket.Value<string>("status") ?? string.Empty;
            if (Terminal.Contains(status))
            {
                ticket = null;
                return;
            }
            ticket = await socket.GetMatchTicketAsync(ticketId);
            status = ticket.Value<string>("status") ?? string.Empty;
            if (Terminal.Contains(status))
            {
                ticket = null;
                return;
            }
            if (status == "room_ready" || status == "confirmed")
            {
                room = await socket.ConnectMatchedRoomAsync(ticket);
                ticket = null;
                await socket.LeaveRoomAsync(room.RoomId);
                room = null;
                return;
            }
        }
        throw new OnlineException("MATCH_CANCEL_NOT_SETTLED", "Ticket cancellation not settled");
    }

    /// <summary>Show the SDK's stable error code and stage; do not override them with generic text.</summary>
    private static void ShowError(string stage, Exception error)
    {
        var code = error is OnlineException online ? online.Code : error.GetType().Name;
        UnityEngine.Debug.LogError($"[{stage}][{code}] {error.Message}");
    }
}
```

A normal scene switch must first wait for `ReturnToMenuAsync()` to return `true`. `OnDestroy` may only do final local resource cleanup; never treat
`_ = ReturnToMenuAsync()` as a reliable Room leave.
