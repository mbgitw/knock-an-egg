extends Node

const Cysj := preload("res://addons/cysj_online/sdk/cysj.gd")
const OP_ACTION := 1
const OP_ROUND_FINISHED := 199
const MATCH_KEYS := ["cf-room", "shadow-world", "casual-2p"]
const TICKET_TERMINAL_STATUSES := [
	"cancelled", "timeout",
"confirm_timeout", "failed"
]
const RECOVERY_RETRY_SECONDS := 2.0
const MAX_RECOVERY_ATTEMPTS := 30

var player_select: OptionButton
var mode_select: OptionButton
var connect_button: Button
var action_button: Button
var status_label: Label
var state_label: RichTextLabel
var socket
var game_match
var current_ticket: Dictionary = {}
var admission_in_flight := false
var room_connect_in_flight := false
var recovery_scheduled := false
var recovery_attempts := 0
var last_error_code := ""
var active_match_key := ""
var active_player_id := ""
var sequence := 0
var authoritative_state: Dictionary = {}


## Build a minimal UI; the BuildaClient Autoload already calls runtime_ready during its own initialization.
func _ready() -> void:
	build_ui()


## When the App returns to the foreground, only resume the original Ticket/Assignment; never re-run Admission.
func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_RESUMED:
		call_deferred("resume_current_online_state_async")


## Local fallback cleanup on tree exit only; the normal exit flow must first wait for cancel/leave to return.
func _exit_tree() -> void:
	if socket != null:
		socket.close()


## Build the example UI in code without depending on art assets.
func build_ui() -> void:
	var background := ColorRect.new()
	background.color = Color("08101f")
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(background)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 42)
	margin.add_theme_constant_override("margin_top", 42)
	margin.add_theme_constant_override("margin_right", 42)
	margin.add_theme_constant_override("margin_bottom", 42)
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	background.add_child(margin)

	var layout := VBoxContainer.new()
	layout.add_theme_constant_override("separation", 18)
	margin.add_child(layout)

	var title := Label.new()
	title.text = "STAR GRAB · ONE GAME / THREE LIFECYCLES"
	title.add_theme_font_size_override("font_size", 30)
	layout.add_child(title)

	var toolbar := HBoxContainer.new()
	toolbar.add_theme_constant_override("separation", 12)
	layout.add_child(toolbar)
	player_select = OptionButton.new()
	player_select.add_item("player-1")
	player_select.add_item("player-2")
	toolbar.add_child(player_select)
	mode_select = OptionButton.new()
	for key in MATCH_KEYS:
		mode_select.add_item(key)
	toolbar.add_child(mode_select)
	connect_button = Button.new()
	connect_button.text = "MATCH AND ENTER ROOM"
	connect_button.pressed.connect(_connect)
	toolbar.add_child(connect_button)
	status_label = Label.new()
	status_label.text = "offline"
	toolbar.add_child(status_label)

	var game_row := HBoxContainer.new()
	game_row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	game_row.add_theme_constant_override("separation", 24)
	layout.add_child(game_row)
	action_button = Button.new()
	action_button.text = "★\nGRAB"
	action_button.disabled = true
	action_button.custom_minimum_size = Vector2(360, 360)
	action_button.add_theme_font_size_override("font_size", 52)
	action_button.pressed.connect(_grab_star)
	game_row.add_child(action_button)
	state_label = RichTextLabel.new()
	state_label.fit_content = false
	state_label.scroll_active = true
	state_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	state_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	state_label.text = "Waiting for authoritative state..."
	game_row.add_child(state_label)


## Use a locally synthesized identity to complete Match Admission and actually enter the Room.
func _connect() -> void:
	connect_button.disabled = true
	player_select.disabled = true
	mode_select.disabled = true
	status_label.text = "connecting..."
	var player_id := player_select.get_item_text(player_select.selected)
	var match_key: String = MATCH_KEYS[mode_select.selected]
	active_player_id = player_id
	active_match_key = match_key
	var client = Cysj.create_client("ws://127.0.0.1:7350/ws", "star-grab-demo", "local")
	socket = Cysj.create_socket_from(client)
	socket.received_match_state.connect(_on_match_state)
	socket.received_error.connect(_on_online_error)
	socket.request_failed.connect(_on_request_failed)
	socket.match_closed.connect(_on_match_closed)
	socket.gateway_reconnecting.connect(_on_gateway_reconnecting)
	socket.gateway_reconnected.connect(_on_gateway_reconnected)
	socket.room_reconnecting.connect(_on_room_reconnecting)
	socket.room_reconnected.connect(_on_room_reconnected)
	add_child(socket)
	var connected: Error = await socket.connect_async(client.restore_session("local:%s" % player_id))
	if connected != OK:
		fail_connection("Gateway connect failed: %s" % connected)
		return
	admission_in_flight = true
	current_ticket = await join_mode(match_key, player_id)
	admission_in_flight = false
	if current_ticket.is_empty():
		keep_recovery_blocked("Admission result is uncertain", last_error_code)
		return
	await wait_and_connect_current_ticket_async(match_key, player_id)


## Wait and connect along the current Ticket; when a peer Confirm failure causes a requeue, the SDK automatically returns to waiting. A failure does not prove the role's occupancy has been released.
func wait_and_connect_current_ticket_async(match_key: String, player_id: String) -> void:
	if current_ticket.is_empty() or room_connect_in_flight:
		return
	room_connect_in_flight = true
	game_match = await socket.wait_and_connect_matched_room_async(
		current_ticket, "connect-%s-%s" % [match_key, player_id]
	)
	room_connect_in_flight = false
	if game_match == null:
		var latest: Dictionary = await socket.get_match_ticket_async(str(current_ticket.get("ticket_id", "")))
		if not latest.is_empty():
			current_ticket = latest
		var status := str(current_ticket.get("status", ""))
		if status in TICKET_TERMINAL_STATUSES:
			finish_terminal_ticket(status)
			return
		keep_recovery_blocked("Room connect result is uncertain", last_error_code)
		call_deferred("schedule_current_recovery_async")
		return
	current_ticket = {}
	status_label.text = "%s entered %s" % [player_id, game_match.match_id]
	action_button.disabled = false


## Connect only along the current Ticket/Assignment; a failure does not prove the role's occupancy has been released.
func connect_current_assignment_async(match_key: String, player_id: String) -> void:
	if current_ticket.is_empty() or room_connect_in_flight:
		return
	room_connect_in_flight = true
	game_match = await socket.connect_matched_room_async(
		current_ticket, "connect-%s-%s" % [match_key, player_id]
	)
	room_connect_in_flight = false
	if game_match == null:
		keep_recovery_blocked("Room connect result is uncertain", last_error_code)
		call_deferred("schedule_current_recovery_async")
		return
	current_ticket = {}
	status_label.text = "%s entered %s" % [player_id, game_match.match_id]
	action_button.disabled = false


## Query the authoritative snapshot of the original Ticket, then continue the original Assignment or wait for an authoritative terminal state.
func resume_current_online_state_async() -> void:
	if socket == null or admission_in_flight or room_connect_in_flight:
		return
	if game_match != null:
		# Peer recovery after entering the Room is handled by the SDK's room_reconnecting path.
		return
	if current_ticket.is_empty():
		return
	var ticket_id := str(current_ticket.get("ticket_id", ""))
	var ticket_version := int(current_ticket.get("ticket_version", -1))
	if ticket_id.is_empty():
		keep_recovery_blocked("Original Admission is still unresolved", last_error_code)
		return
	var latest: Dictionary = await socket.get_match_ticket_async(ticket_id, ticket_version)
	if latest.is_empty():
		keep_recovery_blocked("Original Ticket recovery is uncertain", last_error_code)
		call_deferred("schedule_current_recovery_async")
		return
	current_ticket = latest
	var status := str(latest.get("status", ""))
	if status in TICKET_TERMINAL_STATUSES:
		finish_terminal_ticket(status)
		return
	if status in ["room_ready", "confirmed"]:
		await connect_current_assignment_async(active_match_key, active_player_id)
		return
	await wait_and_connect_current_ticket_async(active_match_key, active_player_id)


## When the connection outcome is unclear, recover the same Ticket at low frequency without creating a second Ticket.
func schedule_current_recovery_async() -> void:
	if recovery_scheduled or current_ticket.is_empty() or game_match != null:
		return
	if recovery_attempts >= MAX_RECOVERY_ATTEMPTS:
		keep_recovery_blocked("Original Ticket recovery budget exhausted", last_error_code)
		return
	recovery_scheduled = true
	recovery_attempts += 1
	await get_tree().create_timer(RECOVERY_RETRY_SECONDS).timeout
	recovery_scheduled = false
	await resume_current_online_state_async()


## Open the next Admission only after the Ticket reaches an authoritative terminal state.
func finish_terminal_ticket(status: String) -> void:
	current_ticket = {}
	recovery_attempts = 0
	fail_connection("Previous Ticket ended: %s" % status)


## Call the public Match Admission API that matches the matchKey.
func join_mode(match_key: String, player_id: String) -> Dictionary:
	var key := "join-%s-%s" % [match_key, player_id]
	match match_key:
		"casual-2p":
			return await socket.join_pool_async(match_key, {}, "", -1, key)
		_:
			return await socket.join_room_async(match_key, {"allow_create": true}, "", -1, key)


## Send only action intents; scores and outcomes are computed by the authoritative Room.
func _grab_star() -> void:
	if game_match == null:
		return
	sequence += 1
	socket.send_match_state_async(game_match.match_id, OP_ACTION, JSON.stringify({"sequence": sequence}))


## Render the full authoritative state or merge a patch, and leave the Room immediately after a one-shot match settles.
func _on_match_state(match_state) -> void:
	var payload = match_state.json()
	if match_state.op_code == -2 and payload is Dictionary:
		authoritative_state = payload
		state_label.text = JSON.stringify(authoritative_state, "  ")
	elif match_state.op_code == -1 and payload is Dictionary:
		authoritative_state = merge_patch(authoritative_state, payload)
		state_label.text = JSON.stringify(authoritative_state, "  ")
	elif match_state.op_code == OP_ROUND_FINISHED:
		state_label.text += "\n\nROUND FINISHED\n%s" % JSON.stringify(payload)
		var match_key: String = MATCH_KEYS[mode_select.selected]
		if match_key == "casual-2p" and game_match != null:
			action_button.disabled = true
			var leave_result: Error = await socket.leave_match_async(game_match.match_id)
			if leave_result != OK:
				keep_recovery_blocked("Active leave was not confirmed: %s" % leave_result)
				return
			game_match = null


## Recursively merge public state patches; arrays and scalars are replaced wholesale by the patch.
func merge_patch(target: Variant, patch: Variant) -> Variant:
	if not target is Dictionary or not patch is Dictionary:
		return patch
	var result: Dictionary = target.duplicate(true)
	for key in patch:
		result[key] = merge_patch(result.get(key), patch[key])
	return result


## Reduce SDK errors to a UI status that contains no credentials.
func _on_online_error(code: int, message: String) -> void:
	keep_recovery_blocked("Online error %s: %s" % [code, message], last_error_code)


## Keep the stable error code; MATCH_ROLE_BUSY does not trigger a new Admission.
func _on_request_failed(_operation: String, error_code: String, message: String) -> void:
	last_error_code = error_code
	keep_recovery_blocked(message, error_code)


## Gateway recovery does not mean the Ticket or Room has reached a terminal state.
func _on_gateway_reconnecting(attempt: int) -> void:
	keep_recovery_blocked("Gateway reconnecting (%s)" % attempt)


func _on_gateway_reconnected() -> void:
	status_label.text = "Gateway restored; resuming current online state"
	call_deferred("resume_current_online_state_async")


## Only a Room that was entered successfully goes into this automatic reconnect phase.
func _on_room_reconnecting(room_id: String, attempt: int) -> void:
	action_button.disabled = true
	keep_recovery_blocked("Room %s reconnecting (%s)" % [room_id, attempt])


func _on_room_reconnected(room_id: String) -> void:
	if game_match == null or game_match.match_id != room_id:
		return
	status_label.text = "room reconnected: %s" % room_id
	action_button.disabled = false


## Show the final reason the Room closed.
func _on_match_closed(match_id: String, reason: String) -> void:
	if game_match != null and game_match.match_id != match_id:
		return
	status_label.text = "room closed: %s" % reason
	authoritative_state = {}
	game_match = null
	current_ticket = {}
	recovery_scheduled = false
	recovery_attempts = 0
	action_button.disabled = true
	connect_button.disabled = false
	player_select.disabled = false
	mode_select.disabled = false


## Restore the retryable connection controls and show the failure reason.
func fail_connection(message: String) -> void:
	status_label.text = message
	connect_button.disabled = false
	player_select.disabled = false
	mode_select.disabled = false


## When the outcome is unclear, keep the entry disabled so no new Ticket is created while the old Seat may still be occupied.
func keep_recovery_blocked(message: String, error_code: String = "") -> void:
	var suffix := " [%s]" % error_code if not error_code.is_empty() else ""
	status_label.text = "%s%s" % [message, suffix]
	connect_button.disabled = true
	player_select.disabled = true
	mode_select.disabled = true
	action_button.disabled = true
