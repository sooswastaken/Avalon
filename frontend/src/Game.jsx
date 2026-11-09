import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { TypingNames, TypingText, ViewTransition } from "./motion.jsx";
import { EVIL_ROLES, QUEST_SIZES, roleImage } from "./api.js";
import { Button, Modal, ModalPresence, PagedList } from "./components.jsx";
import { useResource } from "./hooks.js";
export function QuestResult({ record }) {
  const votes = Object.entries(record.votes || {});
  return (
    <>
      <h3>Quest {record.success ? "Succeeded" : "Failed"}</h3>
      <p>
        There {record.fails === 1 ? "was" : "were"}{" "}
        <strong>{record.fails}</strong> fail{" "}
        {record.fails === 1 ? "card" : "cards"} played.
      </p>
      <p>
        <strong>Leader:</strong> {record.leader}
      </p>
      <p>
        <strong>Proposed Team:</strong> {record.team.join(", ")}
      </p>
      <p>
        <strong>Approved:</strong>{" "}
        {votes
          .filter(([, vote]) => vote)
          .map(([name]) => name)
          .join(", ") || "None"}
      </p>
      <p>
        <strong>Rejected:</strong>{" "}
        {votes
          .filter(([, vote]) => !vote)
          .map(([name]) => name)
          .join(", ") || "None"}
      </p>
    </>
  );
}
function RoleDialog({ role, info, onClose }) {
  const [revealed, setRevealed] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideId = useId();
  const reduceMotion = useReducedMotion();
  const { data } = useResource("/game-details.json");
  const details = data?.roles?.[role];
  const keys =
    role === "Merlin"
      ? ["merlin_knows"]
      : role === "Percival"
        ? ["percival_knows"]
        : ["Mordred", "Morgana", "Minion of Mordred"].includes(role)
          ? ["evil"]
          : [];
  const titles = {
    merlin_knows: "You see these players as Evil",
    percival_knows: "You see these players as Merlin or Morgana",
    evil: "Your fellow minions of Mordred",
  };
  return (
    <Modal title={revealed ? role : "Your Secret Role"} onClose={onClose}>
      <img
        className={`role-card ${revealed ? "" : "blurred"}`}
        src={roleImage(role)}
        alt={revealed ? role : "Hidden role card"}
      />
      <motion.div
        className="role-reveal-content"
        initial={false}
        animate={{ height: revealed ? "auto" : 0, opacity: revealed ? 1 : 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.25, ease: "easeInOut" }}
        aria-hidden={!revealed}
        inert={!revealed}
      >
        {keys.map(
          (key) =>
            info?.[key]?.length > 0 && (
              <div className="role-info-group" key={key}>
                <h4>{titles[key]}</h4>
                <p>{info[key].join(", ")}</p>
              </div>
            ),
        )}
        {details && (
          <section className="role-guide">
            <button
              type="button"
              className="role-guide-toggle"
              aria-expanded={guideOpen}
              aria-controls={guideId}
              onClick={() => setGuideOpen((open) => !open)}
            >
              Role guide
              <motion.span
                aria-hidden="true"
                animate={{ rotate: guideOpen ? 90 : 0 }}
              >
                ›
              </motion.span>
            </button>
            <motion.div
              id={guideId}
              className="role-guide-content"
              initial={false}
              animate={{
                height: guideOpen ? "auto" : 0,
                opacity: guideOpen ? 1 : 0,
              }}
              transition={{
                duration: reduceMotion ? 0 : 0.25,
                ease: "easeInOut",
              }}
              aria-hidden={!guideOpen}
              inert={!guideOpen}
            >
              <div className="role-guide-body">
                {[
                  ["Team", details.team],
                  [
                    "Objective",
                    data.gameInfo[`${details.team.toLowerCase()}TeamObjective`],
                  ],
                  ["Description", details.description],
                  ["Ability", details.ability],
                  ["Guidelines", details.guidelines],
                ].map(([title, text]) => (
                  <div key={title} className="role-info-group">
                    <h4>{title}</h4>
                    <p>{text}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </section>
        )}
      </motion.div>
      <Button onClick={() => setRevealed(!revealed)}>
        {revealed ? "Hide" : "Reveal"}
      </Button>
    </Modal>
  );
}
export function PhaseActions({ state, userId, send, disabled }) {
  const [selected, setSelected] = useState([]);
  const [failWarningOpen, setFailWarningOpen] = useState(false);
  const phase = state.subphase || state.phase;
  const me = state.players.find((player) => player.user_id === userId);
  const name = (id) =>
    state.players.find((player) => player.user_id === id)?.name || "Unknown";
  const waiting = (ids) => (
    <p>
      <em>Waiting on: <TypingNames items={ids.map((id) => ({ id, text: name(id) }))} /></em>
    </p>
  );
  const choose = (players, multiple = false, max = 1) => (
    <div className="player-selection-form">
      {players.map((player) => (
        <label key={player.user_id}>
          <input
            type={multiple ? "checkbox" : "radio"}
            name="target"
            value={player.user_id}
            checked={selected.includes(player.user_id)}
            disabled={
              disabled ||
              (multiple &&
                selected.length >= max &&
                !selected.includes(player.user_id))
            }
            onChange={() =>
              setSelected(
                multiple
                  ? selected.includes(player.user_id)
                    ? selected.filter((id) => id !== player.user_id)
                    : [...selected, player.user_id]
                  : [player.user_id],
              )
            }
          />
          <span className="player-option">{player.name}</span>
        </label>
      ))}
    </div>
  );
  if (phase === "proposal") {
    if (state.current_leader !== userId)
      return <p><TypingText text={name(state.current_leader)} /> is proposing a team.</p>;
    const required =
      QUEST_SIZES[state.players.length]?.[state.round_number - 1];
    return (
      <>
        <h2>Propose a Team</h2>
        <p>
          Select {required} players · {selected.length}/{required} selected
        </p>
        {choose(state.players, true, required)}
        <Button
          tone="success"
          disabled={disabled || selected.length !== required}
          onClick={() => send({ type: "propose_team", team: selected })}
        >
          Propose Team
        </Button>
      </>
    );
  }
  if (phase === "voting")
    return (
      <>
        <h2>Vote on the Proposal</h2>
        <p>
          <strong>{name(state.proposal_leader)}</strong> has proposed:{" "}
          <strong><TypingText text={state.current_team.map(name).join(", ")} /></strong>
        </p>
        {waiting(
          state.players
            .filter((player) => !(player.user_id in state.votes))
            .map((player) => player.user_id),
        )}
        <ViewTransition viewKey={userId in state.votes ? "submitted" : "choose"}>
          {userId in state.votes ? (
            <p>You have voted. Waiting for other players…</p>
          ) : (
            <>
              <Button
                tone="success"
                disabled={disabled}
                onClick={() => send({ type: "vote_team", approve: true })}
              >
                Approve
              </Button>
              <Button
                tone="danger"
                disabled={disabled}
                onClick={() => send({ type: "vote_team", approve: false })}
              >
                Reject
              </Button>
            </>
          )}
        </ViewTransition>
      </>
    );
  if (phase === "quest")
    return (
      <>
        <h2>Quest {state.round_number}</h2>
        <section aria-label="Proposal votes">
          <p>
            <strong>Voted for:</strong>{" "}
            <TypingText text={state.players
              .filter((player) => state.votes[player.user_id] === true)
              .map((player) => player.name)
              .join(", ") || "None"} />
          </p>
          <p>
            <strong>Voted against:</strong>{" "}
            <TypingText text={state.players
              .filter((player) => state.votes[player.user_id] === false)
              .map((player) => player.name)
              .join(", ") || "None"} />
          </p>
        </section>
        {state.players.length >= 7 && state.round_number === 4 && (
          <p>This quest requires two Fail cards to fail.</p>
        )}
        {waiting(state.current_team.filter((id) => !(id in state.submissions)))}
        <ViewTransition viewKey={state.current_team.includes(userId) && !(userId in state.submissions) ? "choose" : "submitted"}>
          {state.current_team.includes(userId) &&
          !(userId in state.submissions) ? (
            <>
              <h3>Play Your Card</h3>
              <Button
                tone="success"
                disabled={disabled}
                onClick={() => send({ type: "submit_card", card: "S" })}
              >
                Play Success
              </Button>
              <Button
                tone="danger"
                disabled={disabled}
                onClick={() => {
                  if (EVIL_ROLES.includes(me?.role))
                    send({ type: "submit_card", card: "F" });
                  else setFailWarningOpen(true);
                }}
              >
                Play Fail
              </Button>
            </>
          ) : (
            <p>Waiting for quest team…</p>
          )}
        </ViewTransition>
        <ModalPresence>
          {failWarningOpen && !disabled && (
            <Modal
              key="fail-warning"
              title="Why the hell are you trying to fail the quest?"
              onClose={() => setFailWarningOpen(false)}
            >
              <p>
                You’re on the Good team. Good players must play Success to help
                the quest succeed. Close this and play your Success card.
              </p>
            </Modal>
          )}
        </ModalPresence>
      </>
    );
  if (phase === "lady") {
    const eligible = state.players.filter(
      (player) =>
        player.user_id !== userId &&
        !state.lady_history.includes(player.user_id),
    );
    return (
      <>
        <h2>Lady of the Lake</h2>
        {state.lady_holder !== userId ? (
          <p><TypingText text={name(state.lady_holder)} /> is inspecting a player…</p>
        ) : (
          <>
            <p>Select a player to reveal their loyalty.</p>
            {choose(eligible)}
            <Button
              disabled={disabled || selected.length !== 1}
              onClick={() => send({ type: "lady_choose", target: selected[0] })}
            >
              Inspect Loyalty
            </Button>
          </>
        )}
      </>
    );
  }
  if (phase === "assassination")
    return (
      <>
        <h2>Decide Merlin’s Fate</h2>
        <p>
          <strong>Evil Players:</strong> <TypingText text={state.evil_players.join(", ")} />
        </p>
        <ViewTransition viewKey={!EVIL_ROLES.includes(me?.role) ? "spectator" : userId in state.assassin_votes ? "submitted" : "choose"}>
          {!EVIL_ROLES.includes(me?.role) ? (
            <p>Evil team is deciding who Merlin is…</p>
          ) : userId in state.assassin_votes ? (
            <p>Vote submitted. Waiting for other evil players…</p>
          ) : (
            <>
              <p>Select the player you believe is Merlin.</p>
              {choose(
                state.players.filter((player) =>
                  state.assassin_candidates.includes(player.user_id),
                ),
              )}
              <Button
                tone="danger"
                disabled={disabled || selected.length !== 1}
                onClick={() =>
                  send({ type: "assassination_vote", target: selected[0] })
                }
              >
                Vote
              </Button>
            </>
          )}
        </ViewTransition>
      </>
    );
  return <p>Waiting for server…</p>;
}
export default function Game({
  state,
  userId,
  privateInfo,
  send,
  disabled,
  onQuest,
  modalBlocked,
}) {
  const [roleOpen, setRoleOpen] = useState(state.phase !== "finished");
  const [expanded, setExpanded] = useState(null);
  const me = state.players.find((player) => player.user_id === userId);
  const reset = () => {
    if (
      confirm(
        "Reset the game and return to the lobby? All current progress will be lost.",
      )
    )
      send({ type: "reset_lobby" });
  };
  useEffect(() => {
    if (state.phase === "finished") setRoleOpen(false);
  }, [state.phase]);
  return (
    <section id="game">
      <div className="scoreboard">
        <div className="team-score good">
          <span className="team-name">Good</span>
          <span className="score-value">{state.good_wins}</span>
        </div>
        <div className="score-divider">-</div>
        <div className="team-score evil">
          <span className="team-name">Evil</span>
          <span className="score-value">{state.evil_wins}</span>
        </div>
      </div>
      <p className="quest-hint" id="quest-hint">
        Tap a quest for details
      </p>
      <div
        className="quest-row"
        role="group"
        aria-label="Quest history"
        aria-describedby="quest-hint"
      >
        {[1, 2, 3, 4, 5].map((round) => {
          const record = state.quest_history.find(
            (quest) => quest.round === round,
          );
          return (
            <motion.button
              type="button"
              className={`quest-card ${expanded === round ? "expanded" : ""}`}
              key={round}
              aria-label={`Quest ${round}${record ? " result" : " details"}`}
              aria-haspopup="dialog"
              whileTap={{ scale: 0.97 }}
              onClick={() => (record ? onQuest(record) : setExpanded(round))}
            >
              <span className="quest-title">Quest {round}</span>
              <span
                className={`quest-circle ${record ? (record.success ? "success" : "fail") : state.round_number === round ? "current" : ""}`}
              >
                {record
                  ? record.success
                    ? "Pass"
                    : "Fail"
                  : QUEST_SIZES[state.players.length]?.[round - 1]}
              </span>
              {!record && <small>players</small>}
            </motion.button>
          );
        })}
      </div>
      <ViewTransition viewKey={state.phase === "finished" ? "finished" : "playing"}>
        {state.phase === "finished" ? (
          <div className="card centered game-result">
            <h2>Game Over!</h2>
            <p>The {state.winner === "good" ? "Good" : "Evil"} Team Wins!</p>
            <div className="roles-grid">
              <PagedList
                items={state.players}
                pageSize={4}
                animated
                renderItem={(player) => (
                  <div className="card" key={player.user_id}>
                    <strong>{player.name}</strong>
                    <img src={roleImage(player.role)} alt={player.role} />
                    <p>{player.role}</p>
                    <span className="wins-badge">🏆 {player.wins}</span>
                  </div>
                )}
              />
            </div>
            {state.host_id === userId && (
              <Button
                disabled={disabled}
                onClick={() => send({ type: "restart_game" })}
              >
                Play Again
              </Button>
            )}
          </div>
        ) : (
          <>
            <div id="phaseContainer">
              <h3>Round {state.round_number}</h3>
              <p>Consecutive rejections: {state.consecutive_rejections}/5</p>
              {state.config.lady_enabled && state.lady_holder && (
                <p>
                  Lady of the Lake Holder:{" "}
                  {
                    state.players.find(
                      (player) => player.user_id === state.lady_holder,
                    )?.name
                  }
                </p>
              )}
            </div>
            <div
              className="card phase-actions"
              style={{ "--selection-rows": Math.ceil(state.players.length / 3) }}
            >
              <ViewTransition
                viewKey={`${state.round_number}:${state.subphase || state.phase}:${state.current_leader}:${state.consecutive_rejections}`}
              >
                <PhaseActions
                  key={`${state.round_number}:${state.subphase}:${state.current_leader}:${state.consecutive_rejections}:${state.assassin_candidates.join(",")}`}
                  state={state}
                  userId={userId}
                  send={send}
                  disabled={disabled}
                />
            </ViewTransition>
          </div>
        </>
      )}
      </ViewTransition>
      <div className="centered game-tools">
        <Button onClick={() => setRoleOpen(true)}>View Your Role</Button>
        {state.host_id === userId && (
          <Button tone="danger" disabled={disabled} onClick={reset}>
            Return to Lobby
          </Button>
        )}
      </div>
      <ModalPresence>
        {expanded !== null && (
          <Modal
            key={`quest-details:${expanded}`}
            title={`Quest ${expanded}`}
            onClose={() => setExpanded(null)}
          >
            <p>
              Leader: {state.round_leaders[expanded - 1] || "To be decided"}
            </p>
            <p>
              {QUEST_SIZES[state.players.length]?.[expanded - 1]} players
              required
            </p>
            {expanded === state.round_number && (
              <p>
                Team:{" "}
                {state.current_team
                  .map(
                    (id) =>
                      state.players.find((player) => player.user_id === id)
                        ?.name,
                  )
                  .join(", ") || "Not selected"}
              </p>
            )}
            {state.players.length >= 7 && expanded === 4 && (
              <p>Two Fail cards required to fail.</p>
            )}
          </Modal>
        )}
        {roleOpen && !modalBlocked && me?.role && (
          <RoleDialog
            key="secret-role"
            role={me.role}
            info={privateInfo}
            onClose={() => setRoleOpen(false)}
          />
        )}
      </ModalPresence>
    </section>
  );
}
