use std::collections::BTreeMap;

use cysj_room_sdk::{
    ActivationReason, CheckpointReason, DisposeReason, Room, RoomClient, RoomContext, RoomMessage,
    RoomSnapshot,
};
use serde::{Deserialize, Serialize};

const OP_ACTION: &str = "1";
const OP_READY: &str = "2";
const OP_CHAT: &str = "3";
const OP_ROLL: &str = "4";
const OP_MOVE: &str = "5";
const OP_ROUND_STARTED: &str = "101";
const OP_ACTION_ACCEPTED: &str = "102";
const OP_ROUND_RESET: &str = "103";
const OP_READY_ACCEPTED: &str = "110";
const OP_CHAT_ACCEPTED: &str = "111";
const OP_ROLL_RESULT: &str = "112";
const OP_ROUND_FINISHED: &str = "199";
const TARGET_SCORE: u32 = 2;
const CF_RESET_DELAY_MS: u32 = 250;
const MATCH_CLOSE_DELAY_MS: u32 = 1_000;
const BOT_ACTION_INTERVAL_MS: u32 = 1_000;
const MAX_CHAT_CHARS: usize = 128;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum DemoMode {
    CfRoom,
    ShadowWorld,
    #[default]
    Casual,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum DemoPhase {
    Waiting,
    #[default]
    Playing,
    Settled,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PlayerState {
    score: u32,
    last_sequence: u64,
    last_ready_sequence: u64,
    last_chat_sequence: u64,
    last_move_sequence: u64,
    online: bool,
    ready: bool,
    occupant_kind: String,
    team_id: String,
    x: i32,
    y: i32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DemoState {
    mode: DemoMode,
    phase: DemoPhase,
    round: u32,
    target_score: u32,
    world_actions: u64,
    winner_id: String,
    settlement_id: String,
    transition_remaining_ms: u32,
    bot_action_remaining_ms: u32,
    players: BTreeMap<String, PlayerState>,
}

#[derive(Debug, Deserialize)]
struct ActionIntent {
    sequence: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadyIntent {
    sequence: u64,
    ready: bool,
}

#[derive(Debug, Deserialize)]
struct ChatIntent {
    sequence: u64,
    text: String,
}

#[derive(Debug, Deserialize)]
struct MoveIntent {
    sequence: u64,
    x: i32,
    y: i32,
}

/// A tiny authoritative mini-game that still expresses four product lifecycles.
/// Clients only submit a "grab the star" intent; score, outcome, Room locking, reuse, and closing are all decided by the Room.
#[derive(Default, Serialize, Deserialize)]
pub struct StarGrabRoom {
    state: DemoState,
}

impl Room for StarGrabRoom {
    /// Initialize one of the three modes from the Match Activity launch context.
    fn on_create(&mut self, context: &mut RoomContext) {
        let mode = mode_from_context(context);
        self.state = DemoState {
            mode,
            phase: if mode == DemoMode::CfRoom {
                DemoPhase::Waiting
            } else {
                DemoPhase::Playing
            },
            round: 1,
            target_score: TARGET_SCORE,
            bot_action_remaining_ms: BOT_ACTION_INTERVAL_MS,
            ..DemoState::default()
        };
        for seat in &context.roster {
            if seat.occupant_kind != cysj_room_sdk::RoomOccupantKind::Bot {
                continue;
            }
            let Some(bot_id) = seat.bot_id.as_deref() else {
                continue;
            };
            self.state
                .players
                .insert(format!("bot:{bot_id}"), new_player("bot", &seat.team_id));
        }
        self.publish_state(context);
        context.log(
            "info",
            &format!("room_created mode={mode:?} roster={}", context.roster.len()),
        );

        // Room/shadow world joinability is decided by user code; Pool is locked automatically by the platform.
        if matches!(mode, DemoMode::CfRoom | DemoMode::ShadowWorld) {
            context.release_room();
        }
    }

    /// Add the player to authoritative state after they actually enter the Room.
    fn on_join(&mut self, context: &mut RoomContext, client: RoomClient) {
        let previous = self
            .state
            .players
            .get(&client.user_id)
            .cloned()
            .unwrap_or_default();
        self.state.players.insert(
            client.user_id.clone(),
            PlayerState {
                score: previous.score,
                last_sequence: previous.last_sequence,
                last_ready_sequence: previous.last_ready_sequence,
                last_chat_sequence: previous.last_chat_sequence,
                last_move_sequence: previous.last_move_sequence,
                online: true,
                ready: previous.ready,
                occupant_kind: "human".to_string(),
                team_id: team_id_for(context, &client.user_id),
                x: previous.x,
                y: previous.y,
            },
        );
        self.publish_state(context);
    }

    /// A temporary disconnect only marks the player offline, keeping the Seat and game progress for reconnect.
    fn on_disconnect(
        &mut self,
        context: &mut RoomContext,
        client: RoomClient,
        _reason: &str,
        _reconnect_deadline_at_millis: i64,
    ) {
        if let Some(player) = self.state.players.get_mut(&client.user_id) {
            player.online = false;
            self.publish_state(context);
        }
    }

    /// Restore the same authoritative player after reconnect.
    fn on_reconnect(&mut self, context: &mut RoomContext, client: RoomClient) {
        if let Some(player) = self.state.players.get_mut(&client.user_id) {
            player.online = true;
            self.publish_state(context);
        } else {
            self.on_join(context, client);
        }
    }

    /// Remove the player on final leave; a one-shot match ends the Room as soon as it is empty.
    fn on_leave(&mut self, context: &mut RoomContext, client: RoomClient, _reason: &str) {
        self.state.players.remove(&client.user_id);
        self.publish_state(context);
        if self.is_one_shot_match() && self.state.players.is_empty() {
            context.disconnect("all_players_left");
        }
    }

    /// Validate the monotonic sequence and perform one server-authoritative star grab.
    fn on_message(&mut self, context: &mut RoomContext, message: RoomMessage) {
        match message.message_type.as_str() {
            OP_ACTION => self.handle_action(context, &message),
            OP_READY => self.handle_ready(context, &message),
            OP_CHAT => self.handle_chat(context, &message),
            OP_ROLL => self.handle_roll(context, &message),
            OP_MOVE => self.handle_move(context, &message),
            _ => {}
        }
    }

    /// Advance CF round reuse and the bounded fallback close for Pool.
    fn on_tick(&mut self, context: &mut RoomContext, delta_ms: u32) {
        if self.state.phase != DemoPhase::Settled {
            self.tick_bots(context, delta_ms);
            return;
        }
        if self.state.transition_remaining_ms == 0 {
            return;
        }
        self.state.transition_remaining_ms =
            self.state.transition_remaining_ms.saturating_sub(delta_ms);
        if self.state.transition_remaining_ms > 0 {
            return;
        }
        if self.state.mode == DemoMode::CfRoom {
            self.reset_cf_round(context);
        } else {
            context.disconnect("round_completed");
        }
    }

    /// Save authoritative state as a migratable JSON snapshot.
    fn on_checkpoint(
        &mut self,
        _context: &mut RoomContext,
        _reason: CheckpointReason,
    ) -> Result<RoomSnapshot, String> {
        RoomSnapshot::json(1, &self.state).map_err(|error| error.to_string())
    }

    /// Restore authoritative state from a same-version snapshot.
    fn on_restore(
        &mut self,
        _context: &mut RoomContext,
        snapshot: RoomSnapshot,
        _reason: ActivationReason,
    ) -> Result<(), String> {
        if snapshot.schema_version != 1 {
            return Err(format!(
                "unsupported snapshot schema: {}",
                snapshot.schema_version
            ));
        }
        self.state = snapshot.decode_json().map_err(|error| error.to_string())?;
        Ok(())
    }

    /// No extra recovery action is needed after a new generation is committed.
    fn on_activated(&mut self, _context: &mut RoomContext, _reason: ActivationReason) {}

    /// The Room holds no external resources when destroyed.
    fn on_dispose(&mut self, _context: &mut RoomContext, _reason: DisposeReason) {}
}

impl StarGrabRoom {
    /// Validate the human input sequence and reuse the shared human/Bot authoritative action function.
    fn handle_action(&mut self, context: &mut RoomContext, message: &RoomMessage) {
        if self.state.phase == DemoPhase::Settled {
            return;
        }
        let Ok(intent) = message.json::<ActionIntent>() else {
            return;
        };
        let Some(player) = self.state.players.get_mut(&message.client.user_id) else {
            return;
        };
        if !player.online || intent.sequence <= player.last_sequence {
            return;
        }
        player.last_sequence = intent.sequence;
        self.apply_authoritative_action(context, &message.client.user_id);
    }

    /// Store ready state and sync the player set via a patch.
    fn handle_ready(&mut self, context: &mut RoomContext, message: &RoomMessage) {
        let Ok(intent) = message.json::<ReadyIntent>() else {
            return;
        };
        let Some(player) = self.state.players.get_mut(&message.client.user_id) else {
            return;
        };
        if intent.sequence <= player.last_ready_sequence {
            return;
        }
        player.last_ready_sequence = intent.sequence;
        player.ready = intent.ready;
        let _ = context.patch_state(&serde_json::json!({"players": &self.state.players}));
        let _ = message.client.send_json(
            OP_READY_ACCEPTED,
            &serde_json::json!({"ready": intent.ready, "sequence": intent.sequence}),
        );
    }

    /// Broadcast bounded chat text normalized for length and whitespace.
    fn handle_chat(&mut self, context: &mut RoomContext, message: &RoomMessage) {
        let Ok(intent) = message.json::<ChatIntent>() else {
            return;
        };
        let text = intent.text.split_whitespace().collect::<Vec<_>>().join(" ");
        let Some(player) = self.state.players.get_mut(&message.client.user_id) else {
            return;
        };
        if intent.sequence <= player.last_chat_sequence
            || text.is_empty()
            || text.chars().count() > MAX_CHAT_CHARS
        {
            return;
        }
        player.last_chat_sequence = intent.sequence;
        let _ = context.broadcast_json(
            OP_CHAT_ACCEPTED,
            &serde_json::json!({
                "userId": message.client.user_id,
                "text": text,
                "sequence": intent.sequence,
            }),
        );
    }

    /// Return a controlled random result only to the requester.
    fn handle_roll(&mut self, context: &mut RoomContext, message: &RoomMessage) {
        if !self
            .state
            .players
            .get(&message.client.user_id)
            .is_some_and(|player| player.online)
        {
            return;
        }
        let value = 1 + (context.random_u64() % 6);
        let _ = message
            .client
            .send_json(OP_ROLL_RESULT, &serde_json::json!({"value": value}));
    }

    /// Accept droppable position input, validate bounds, then sync via a state patch.
    fn handle_move(&mut self, context: &mut RoomContext, message: &RoomMessage) {
        let Ok(intent) = message.json::<MoveIntent>() else {
            return;
        };
        let Some(player) = self.state.players.get_mut(&message.client.user_id) else {
            return;
        };
        if intent.sequence <= player.last_move_sequence
            || intent.x.unsigned_abs() > 10_000
            || intent.y.unsigned_abs() > 10_000
        {
            return;
        }
        player.last_move_sequence = intent.sequence;
        player.x = intent.x;
        player.y = intent.y;
        let _ = context.patch_state(&serde_json::json!({"players": &self.state.players}));
    }

    /// Produce a unique settlement id and enter the reuse or close countdown.
    fn finish_round(&mut self, context: &mut RoomContext, winner_id: &str) {
        self.state.phase = DemoPhase::Settled;
        self.state.winner_id = winner_id.to_string();
        self.state.settlement_id = format!("{}:{}", context.match_id, self.state.round);
        self.state.transition_remaining_ms = if self.state.mode == DemoMode::CfRoom {
            CF_RESET_DELAY_MS
        } else {
            MATCH_CLOSE_DELAY_MS
        };
        self.publish_state(context);
        let _ = context.broadcast_json(
            OP_ROUND_FINISHED,
            &serde_json::json!({
                "winnerId": winner_id,
                "settlementId": self.state.settlement_id,
                "closePolicy": if self.state.mode == DemoMode::CfRoom {
                    "reset_and_release"
                } else {
                    "leave_then_close"
                },
            }),
        );
        context.log(
            "info",
            &format!(
                "round_finished round={} winner={winner_id}",
                self.state.round
            ),
        );
    }

    /// Clear the previous round's scores and release the same CF Room again.
    fn reset_cf_round(&mut self, context: &mut RoomContext) {
        self.state.round += 1;
        self.state.phase = DemoPhase::Waiting;
        self.state.winner_id.clear();
        self.state.settlement_id.clear();
        for player in self.state.players.values_mut() {
            player.score = 0;
            player.ready = false;
        }
        self.publish_state(context);
        context.release_room();
        let _ = context.broadcast_json(
            OP_ROUND_RESET,
            &serde_json::json!({"round": self.state.round}),
        );
    }

    /// Broadcast a full authoritative snapshot so different clients can use the same protocol.
    fn publish_state(&mut self, context: &mut RoomContext) {
        let _ = context.set_state(&self.state);
    }

    /// Count the human players who can currently act.
    fn online_player_count(&self) -> usize {
        self.state
            .players
            .values()
            .filter(|player| player.online)
            .count()
    }

    /// Use the same authoritative action function for human input and Bots in the platform Roster.
    fn apply_authoritative_action(&mut self, context: &mut RoomContext, actor_id: &str) {
        let Some(snapshot) = self.state.players.get(actor_id) else {
            return;
        };
        if !snapshot.online || self.state.phase == DemoPhase::Settled {
            return;
        }
        if self.state.mode == DemoMode::CfRoom && self.state.phase == DemoPhase::Waiting {
            if self.online_player_count() < 2 {
                return;
            }
            self.state.phase = DemoPhase::Playing;
            context.lock_room();
            let _ = context.broadcast_json(
                OP_ROUND_STARTED,
                &serde_json::json!({"round": self.state.round}),
            );
        }
        let (score, world_actions) = {
            let player = self
                .state
                .players
                .get_mut(actor_id)
                .expect("player checked");
            player.score += 1;
            self.state.world_actions += 1;
            (player.score, self.state.world_actions)
        };
        self.publish_state(context);
        let _ = context.broadcast_json(
            OP_ACTION_ACCEPTED,
            &serde_json::json!({
                "userId": actor_id,
                "score": score,
                "worldActions": world_actions,
            }),
        );
        if self.state.mode != DemoMode::ShadowWorld && score >= TARGET_SCORE {
            self.finish_round(context, actor_id);
        }
    }

    /// Drive at most one Bot per interval so the Bot count does not inflate the cost of a single tick.
    fn tick_bots(&mut self, context: &mut RoomContext, delta_ms: u32) {
        let bot_id = self
            .state
            .players
            .iter()
            .find(|(_, player)| player.occupant_kind == "bot")
            .map(|(id, _)| id.clone());
        let Some(bot_id) = bot_id else {
            return;
        };
        self.state.bot_action_remaining_ms =
            self.state.bot_action_remaining_ms.saturating_sub(delta_ms);
        if self.state.bot_action_remaining_ms > 0 {
            return;
        }
        self.state.bot_action_remaining_ms = BOT_ACTION_INTERVAL_MS;
        self.apply_authoritative_action(context, &bot_id);
    }

    /// Whether the current Activity is a one-shot match destroyed once played.
    fn is_one_shot_match(&self) -> bool {
        matches!(self.state.mode, DemoMode::Casual)
    }
}

/// Map the stable matchKey/mode to the example gameplay without relying on internal platform fields.
fn mode_from_context(context: &RoomContext) -> DemoMode {
    match context.match_key.as_str() {
        "cf-room" => DemoMode::CfRoom,
        "shadow-world" => DemoMode::ShadowWorld,
        _ => DemoMode::Casual,
    }
}

/// Read the platform-provided team info from the launch Roster; how gameplay uses it is up to user code.
fn team_id_for(context: &RoomContext, user_id: &str) -> String {
    context
        .roster
        .iter()
        .find(|seat| seat.user_id.as_deref() == Some(user_id))
        .map(|seat| seat.team_id.clone())
        .unwrap_or_else(|| "team-unassigned".to_string())
}

/// Create a player or Bot with its own message sequence and position state.
fn new_player(occupant_kind: &str, team_id: &str) -> PlayerState {
    PlayerState {
        online: true,
        occupant_kind: occupant_kind.to_string(),
        team_id: team_id.to_string(),
        ..PlayerState::default()
    }
}

#[cfg(not(feature = "local-mock"))]
cysj_room_sdk::export_room!(StarGrabRoom);
