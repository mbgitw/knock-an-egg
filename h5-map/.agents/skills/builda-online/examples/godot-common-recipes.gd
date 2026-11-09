extends RefCounted
class_name CysjOnlineCommonRecipes

const READY_STATUSES := ["room_ready", "confirmed"]
const TERMINAL_STATUSES := [
	"cancelled", "timeout",
"confirm_timeout", "failed",
]


## Restores the in-memory Session, registers events first, then connects to the Gateway; the Socket must stay in the scene tree.
static func create_connected_socket_async(
	client, runtime_token: String, parent: Node, handlers: Dictionary
):
	var socket = client.create_socket()
	parent.add_child(socket)
	bind_socket_events(socket, handlers)
	var result: Error = await socket.connect_async(client.restore_session(runtime_token))
	if result != OK:
		socket.queue_free()
		return null
	return socket


## Waits on the same Ticket and connects; when a peer's Confirm failure causes a requeue, the SDK automatically returns to waiting until a Room handle is obtained.
## Returns null on a Ticket terminal state or connection failure; after a connection failure the Ticket may still be alive, so first
## settle it with settle_abandoned_ticket_async before allowing the next matchmaking attempt.
static func wait_and_connect_async(socket, ticket: Dictionary, operation_key: String):
	return await socket.wait_and_connect_matched_room_async(ticket, operation_key)


## Queries the original Ticket after a cold start or Gateway recovery; never create a second Ticket as a fallback.
static func recover_ticket_async(
	socket, ticket_id: String, known_version: int = -1
) -> Dictionary:
	return await socket.get_match_ticket_async(ticket_id, known_version)


## Manually renews a Ticket once, only for advanced flows that do not use wait_match_ticket_ready_async.
static func heartbeat_ticket_once_async(
	socket, ticket: Dictionary, operation_key: String
) -> Dictionary:
	return await socket.heartbeat_match_ticket_async(
		str(ticket.get("ticket_id", "")),
		int(ticket.get("ticket_version", -1)),
		operation_key
	)


## Enters a regular single-match Pool.
static func enter_pool_async(socket, match_key: String, operation_key: String):
	var ticket: Dictionary = await socket.join_pool_async(
		match_key, {}, "", -1, operation_key
	)
	return await wait_and_connect_async(socket, ticket, operation_key)


## Enters a RankPool; pass the solo score maintained by the game.
static func enter_rank_pool_async(socket, match_key: String, operation_key: String, rank_score: Variant = null):
	var ticket: Dictionary = await socket.join_rank_pool_async(
		match_key, {}, "", -1, operation_key, rank_score
	)
	return await wait_and_connect_async(socket, ticket, operation_key)


## Enters Room mode; whether a Room may be created when none exists is constrained by both this call and the deploy config.
static func enter_room_mode_async(
	socket, match_key: String, allow_create: bool, operation_key: String
):
	var ticket: Dictionary = await socket.join_room_async(
		match_key, {"allow_create": allow_create}, "", -1, operation_key
	)
	return await wait_and_connect_async(socket, ticket, operation_key)



## Join with a known Room ID: a Room shared by the game's social system or a Builda App invite; the Room ID is the admission credential, and no new Room is created.
static func enter_room_by_shared_id_async(
	socket, room_id: String, operation_key: String
):
	var ticket: Dictionary = await socket.join_room_by_id_async(
		room_id, {}, "", -1, operation_key
	)
	return await wait_and_connect_async(socket, ticket, operation_key)


## Handles a launch from a Builda App Room invite: the host returns the invite only once per page lifecycle. With an invite, request a Seat with room_id
## and wait to enter the Room; returns null when there is no invite or the host does not support it, and the game follows its normal lobby flow. Admission is still decided by the platform.
static func take_room_invite_and_enter_async(socket, operation_key: String):
	var result: Dictionary = await socket.take_room_invite_async()
	if not bool(result.get("available", false)):
		return null
	var invite: Variant = result.get("invite")
	if not invite is Dictionary:
		return null
	return await enter_room_by_shared_id_async(
		socket, str(invite.get("room_id", "")), "%s-invite" % operation_key
	)


## Refreshes the public authoritative snapshot of a Room.
static func get_room_snapshot_async(socket, room_id: String) -> Dictionary:
	return await socket.get_room_async(room_id)


## Creates a private Room and enters it as the creator: private Rooms stay out of the public listing and automatic matchmaking and can only be joined via Room ID; the creator and
## later members are equal. Share room_id through the game's own social system; other players join with enter_room_by_shared_id_async.
static func create_and_enter_private_room_async(
	socket, match_key: String, operation_key: String
) -> Dictionary:
	var game_match = await socket.create_and_connect_private_room_async(match_key, operation_key)
	return {"match": game_match, "room_id": str(game_match.match_id)} if game_match != null else {}



## Cancel the Ticket; if it already raced with RoomReady, connect to the original Assignment and leave the Room immediately.
static func cancel_ticket_or_leave_ready_room_async(
	socket, ticket: Dictionary, operation_key: String
) -> Error:
	var ticket_id := str(ticket.get("ticket_id", ""))
	var latest: Dictionary = await socket.get_match_ticket_async(ticket_id)
	if str(latest.get("status", "")) in ["waiting", "matched"]:
		var cancelled: Dictionary = await socket.cancel_match_ticket_async(
			ticket_id,
			int(latest.get("ticket_version", -1)),
			"%s-cancel" % operation_key
		)
		latest = cancelled if not cancelled.is_empty() else await socket.get_match_ticket_async(ticket_id)
	var status := str(latest.get("status", ""))
	if status in TERMINAL_STATUSES:
		return OK
	if status in READY_STATUSES:
		var game_match = await socket.connect_matched_room_async(
			latest, "%s-cancel-race" % operation_key
		)
		if game_match == null:
			return FAILED
		return await socket.leave_match_async(game_match.match_id)
	return ERR_BUSY


## After a connection failure, settle a Ticket that may still be alive: a waiting Ticket is cancelled directly; for match formation, RoomReady and other non-cancellable states the SDK waits, bounded,
## for the authoritative terminal state. Returns "confirmed" when the Room was already entered, and you must actively leave with leave_match_async; an empty Dictionary means settling failed,
## with the error code in request_failed; do not start matchmaking again in that case.
static func settle_abandoned_ticket_async(
	socket, ticket: Dictionary, operation_key: String
) -> Dictionary:
	return await socket.settle_match_ticket_async(ticket, "%s-settle" % operation_key)


## Common choices for the three channels: reliable commands, reliable key events, droppable continuous snapshots.
static func send_gameplay(
	socket, game_match, input: Dictionary, reliable_event: Dictionary, snapshot: Dictionary
) -> Error:
	var result: Error = await socket.send_match_control_async(
		game_match.match_id, 1, JSON.stringify(input)
	)
	if result != OK:
		return result
	result = await socket.send_match_state_raw_async(
		game_match.match_id, 101, JSON.stringify(reliable_event).to_utf8_buffer()
	)
	if result != OK:
		return result
	return await socket.send_match_state_unreliable_async(
		game_match.match_id, 201, JSON.stringify(snapshot)
	)


## Registers all public state events; the returned bindings must all be unbound when leaving the page.
static func bind_socket_events(socket, handlers: Dictionary) -> Array:
	var bindings: Array = []
	for entry in [
		[socket.connected, "connected"],
		[socket.closed, "closed"],
		[socket.gateway_reconnecting, "gateway_reconnecting"],
		[socket.gateway_reconnected, "gateway_reconnected"],
		[socket.received_error, "error"],
		[socket.request_failed, "request_failed"],
		[socket.received_match_ticket_updated, "ticket_updated"],



		[socket.received_match_state, "room_message"],
		[socket.received_match_presence, "match_presence"],
		[socket.received_room_presence, "room_presence"],
		[socket.match_closed, "room_closed"],
		[socket.room_reconnecting, "room_reconnecting"],
		[socket.room_reconnected, "room_reconnected"],
		[socket.room_transfer_started, "room_transfer_started"],
		[socket.room_transfer_completed, "room_transfer_completed"],
		[socket.connection_health_changed, "network_changed"],
		[socket.received_chat_message, "chat_message"],
	]:
		var callback: Variant = handlers.get(entry[1])
		if callback is Callable and callback.is_valid():
			entry[0].connect(callback)
			bindings.append([entry[0], callback])
	return bindings


## Unbinds all event bindings returned by bind_socket_events.
static func unbind_socket_events(bindings: Array) -> void:
	for binding in bindings:
		if binding is Array and binding.size() == 2 and binding[0].is_connected(binding[1]):
			binding[0].disconnect(binding[1])


## Collects only redacted network snapshots and RTT.
static func collect_network_diagnostics_async(socket, room_id: String = "") -> Dictionary:
	var result := {
		"gateway_rtt_millis": await socket.measure_gateway_rtt_async(),
		"snapshot": socket.network_path_snapshot(room_id),
	}
	if not room_id.is_empty():
		result["room_rtt_millis"] = await socket.measure_room_rtt_async(room_id)
	return result


## After waiting from a long-lived Room to a single-match RoomReady, reliably leave the old Seat first, then connect to the new Room.
static func switch_long_room_to_pool_async(
	socket, old_match, match_key: String, operation_key: String
):
	var ticket: Dictionary = await socket.join_pool_async(
		match_key, {}, "", -1, operation_key
	)
	var ready: Dictionary = await socket.wait_match_ticket_ready_async(ticket)
	if not str(ready.get("status", "")) in READY_STATUSES:
		return null
	if await socket.leave_match_async(old_match.match_id) != OK:
		return null
	return await socket.connect_matched_room_async(ready, "%s-connect" % operation_key)


## After entering the Room, join the host chat group by Room ID; team_id is decided by the game's own team rules.
## available=false means the current host has no chat-group capability; the game should hide the chat entry rather than report an error.
static func join_team_chat_async(socket, game_match, team_id: int) -> bool:
	var result: Dictionary = await socket.join_chat_group_async(game_match.match_id, team_id)
	if not bool(result.get("available", false)):
		return false
	if not bool(result.get("ok", false)):
		push_warning("Builda Online chat group join failed: %s" % str(result.get("error_code", "")))
		return false
	return true


## Actively quit the group when switching teams or muting early; actively leaving, Room close and Socket close make the SDK quit automatically, so no repeat call is needed.
static func quit_team_chat_async(socket, game_match) -> bool:
	var result: Dictionary = await socket.quit_chat_group_async(game_match.match_id)
	return bool(result.get("ok", false))


## When exiting the whole multiplayer page, leave the Room first, then close the shared Socket.
static func leave_room_and_close_async(socket, game_match) -> Error:
	var result: Error = await socket.leave_match_async(game_match.match_id)
	if result == OK:
		socket.close()
	return result
