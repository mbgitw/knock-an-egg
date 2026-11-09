# Godot Lifecycle and Integration Example

This page is only for Godot projects to read. For the state machine, recovery rules, and error codes, [End-to-End Lifecycle and Room Protocol](client-lifecycle.md)
is the single authority; this page only provides the Godot way of writing it.

## Lifecycle and Exit Example

The following example shows Room Admission. For a Pool, only replace the Admission method; exit settling is the same.

```gdscript
extends Node

const TICKET_TERMINAL_STATUSES := [
	"cancelled", "timeout", "confirm_timeout", "failed"
]

var socket
var game_match
var current_ticket: Dictionary = {}
var admission_in_flight := false
var match_in_flight := false
var room_connect_in_flight := false
var exit_requested := false
var cleanup_in_flight := false
var admission_key := ""
var last_error_code := ""
var last_error_stage := ""

## Create and wait on a Room Ticket; write the Ticket into long-lived state as soon as it returns.
func start_room_async(match_key: String) -> void:
	if cleanup_in_flight or exit_requested:
		return
	last_error_code = ""
	last_error_stage = "admission"
	if admission_key.is_empty():
		admission_key = "room-search-%s" % Time.get_ticks_usec()
	admission_in_flight = true
	var ticket: Dictionary = await socket.join_room_async(
		match_key,
		{"allow_create": true},
		"",
		-1,
		admission_key
	)
	admission_in_flight = false
	if not ticket.is_empty():
		current_ticket = ticket
	if exit_requested:
		return
	if ticket.is_empty():
		show_stable_error("admission", last_error_code, "Admission did not return a Ticket")
		return

	last_error_stage = "ticket_wait_and_connect"
	match_in_flight = true
	# When a peer's Confirm failure causes a requeue, the SDK automatically returns to waiting on the same Ticket; null means a terminal state or a connection failure.
	game_match = await socket.wait_and_connect_matched_room_async(
		current_ticket,
		"room-connect-%s" % str(current_ticket.get("ticket_id", ""))
	)
	match_in_flight = false
	if game_match != null:
		current_ticket = {}
		return
	if exit_requested:
		return
	if last_error_code == "MATCH_TICKET_TERMINAL":
		current_ticket = {}
		return
	# After a connection failure the Ticket may still be room_ready or already requeued: first settle it to an authoritative terminal state, then reopen the next matchmaking.
	last_error_stage = "ticket_settle"
	var settled: Dictionary = await socket.settle_match_ticket_async(
		current_ticket,
		"room-settle-%s" % str(current_ticket.get("ticket_id", ""))
	)
	if settled.is_empty():
		show_stable_error("ticket_settle", last_error_code, "Ticket settle failed, re-matchmaking is forbidden")
		return
	current_ticket = settled if str(settled.get("status", "")) == "confirmed" else {}
	show_stable_error("room_connect", last_error_code, "Room connection failed")

## Return safely from a normal UI entry point; on cleanup failure, keep the current scene and the Gateway.
func return_to_menu_async() -> void:
	if cleanup_in_flight:
		return
	exit_requested = true
	cleanup_in_flight = true
	while admission_in_flight or room_connect_in_flight:
		await get_tree().process_frame

	var result := OK
	if match_in_flight and not current_ticket.is_empty():
		# The combined entry point is still waiting or connecting: settle the same Ticket concurrently; a waiting Ticket is cancelled, while RoomReady waits for its terminal state or Room entry.
		last_error_stage = "ticket_settle"
		var settled: Dictionary = await socket.settle_match_ticket_async(
			current_ticket,
			"exit-settle-%s" % str(current_ticket.get("ticket_id", ""))
		)
		while match_in_flight:
			await get_tree().process_frame
		if settled.is_empty():
			result = FAILED
		elif str(settled.get("status", "")) in TICKET_TERMINAL_STATUSES:
			current_ticket = {}
	if result == OK and game_match != null:
		last_error_stage = "room_leave"
		result = await socket.leave_match_async(game_match.match_id)
		if result == OK:
			game_match = null
	elif result == OK and not current_ticket.is_empty():
		last_error_stage = "ticket_cancel"
		result = await cancel_ticket_before_exit_async()

	if result != OK:
		cleanup_in_flight = false
		show_stable_error(last_error_stage, last_error_code, "Exit settle failed: %s" % result)
		return

	current_ticket = {}
	socket.close()
	# Only here may change_scene_to_file(...) be called.

## Cancel the latest Ticket; on a RoomReady race, connect and then immediately actively leave the Room.
func cancel_ticket_before_exit_async() -> Error:
	for attempt in range(2):
		var ticket_id := str(current_ticket.get("ticket_id", ""))
		var ticket_version := int(current_ticket.get("ticket_version", -1))
		if ticket_id.is_empty() or ticket_version < 0:
			return ERR_INVALID_DATA

		var cancelled: Dictionary = await socket.cancel_match_ticket_async(
			ticket_id,
			ticket_version,
			"exit-cancel-%s-%d" % [ticket_id, attempt]
		)
		if not cancelled.is_empty():
			current_ticket = cancelled
		if str(current_ticket.get("status", "")) in TICKET_TERMINAL_STATUSES:
			return OK

		var latest: Dictionary = await socket.get_match_ticket_async(ticket_id)
		if latest.is_empty():
			return ERR_CANT_CONNECT
		current_ticket = latest
		var status := str(latest.get("status", ""))
		if status in TICKET_TERMINAL_STATUSES:
			return OK
		if status in ["room_ready", "confirmed"]:
			last_error_stage = "room_connect_after_cancel_race"
			room_connect_in_flight = true
			game_match = await socket.connect_matched_room_async(
				latest,
				"exit-connect-%s" % ticket_id
			)
			room_connect_in_flight = false
			if game_match == null:
				return ERR_CANT_CONNECT
			current_ticket = {}
			last_error_stage = "room_leave_after_cancel_race"
			var leave_result: Error = await socket.leave_match_async(game_match.match_id)
			if leave_result == OK:
				game_match = null
			return leave_result
	return ERR_BUSY

## Keep the SDK's stable error code; generic empty-result text must not overwrite it.
func _on_request_failed(operation: String, error_code: String, message: String) -> void:
	last_error_code = error_code
	show_stable_error(last_error_stage, error_code, "%s: %s" % [operation, message])

## Error display is implemented by the project UI; keep at least stage and error_code.
func show_stable_error(stage: String, error_code: String, message: String) -> void:
	var visible_code := error_code if not error_code.is_empty() else "UNKNOWN_ERROR"
	push_error("[%s][%s] %s" % [stage, visible_code, message])
```

Do not copy `return_to_menu_async()` into `_exit_tree()`; wait for it to succeed before switching scenes.

## Complete Integration Sequence Example

For the integration order and Room-leave rules, see [Client Integration](development-guide-client.md); the complete sequence below is used together with the exit settling above.

```gdscript
extends Node

const Cysj := preload("res://addons/cysj_online/sdk/cysj.gd")
const OP_READY := 1
const OP_STARTED := 101
const OP_FINISHED := 199

var client
var socket
var game_match
var current_ticket: Dictionary = {}
var leaving_finished_match := false

func _ready() -> void:
	client = Cysj.create_client(SERVER_ENDPOINT, GAME_ID, QUEUE_NAME)
	socket = Cysj.create_socket_from(client)
	socket.received_match_ticket_updated.connect(_on_ticket_updated)
	socket.received_match_state.connect(_on_match_state)
	socket.received_match_presence.connect(_on_match_presence)
	socket.match_closed.connect(_on_match_closed)
	socket.received_error.connect(_on_socket_error)
	add_child(socket)

	var session = client.restore_session(PLATFORM_TOKEN)
	var result: Error = await socket.connect_async(session)
	if result != OK:
		push_error("Builda Online connection failed: %s" % result)
		return

	var ticket = await socket.join_pool_async(
		MATCH_KEY,
		{},
		"",
		-1,
		"search-action-1"
	)
	if ticket.is_empty():
		push_error("Failed to create matchmaking Ticket")
		return
	current_ticket = ticket
	# When a peer's Confirm failure causes a requeue, the SDK automatically returns to waiting on the same Ticket; null means a terminal state or a connection failure.
	game_match = await socket.wait_and_connect_matched_room_async(ticket, "connect-action-1")
	if game_match == null:
		# After a connection failure the Ticket may still be alive: do not matchmake again before settling it to an authoritative terminal state.
		await socket.settle_match_ticket_async(current_ticket, "settle-action-1")
		current_ticket = {}
		push_error("Failed to join Match")
		return
	current_ticket = {}
	await socket.send_match_state_async(
		game_match.match_id,
		OP_READY,
		JSON.stringify({"ready": true})
	)

func _on_ticket_updated(ticket: Dictionary) -> void:
	# Pushes are only for showing UI states such as "opponent did not confirm, re-matchmaking"; waiting and connecting are driven by the combined entry point.
	current_ticket = ticket

func _on_match_state(match_state) -> void:
	if match_state.op_code == OP_FINISHED:
		var result = JSON.parse_string(match_state.data)
		# Copy the settlement data first; leaving the Room immediately destroys the current Match transport.
		_show_final_result(result)
		await _leave_after_final_result()
		return
	if match_state.op_code == OP_STARTED:
		var payload = JSON.parse_string(match_state.data)
		_apply_server_event(payload)

func _leave_after_final_result() -> void:
	if leaving_finished_match or game_match == null:
		return
	leaving_finished_match = true
	var result: Error = await socket.leave_match_async(game_match.match_id)
	if result != OK:
		push_error("Builda Online active Room leave failed: %s" % result)
		_set_rematch_enabled(false)
		leaving_finished_match = false
		return
	_set_rematch_enabled(true)
	leaving_finished_match = false

func _on_match_presence(_event) -> void:
	pass

func _on_match_closed(match_id: String, reason: String) -> void:
	if game_match == null or game_match.match_id != match_id:
		return
	game_match = null
	current_ticket = {}
	leaving_finished_match = false
	if reason == "reconnect_timeout":
		# The old Room is terminal; a Pool reopens new matchmaking, a long-lived Room starts a new Admission deferred.
		_set_rematch_enabled(true)
		return
	# For other Room terminal states, show the settlement or the stable error according to the gameplay.

func _on_socket_error(code: int, message: String) -> void:
	push_error("Builda Online error %s: %s" % [code, message])

```
