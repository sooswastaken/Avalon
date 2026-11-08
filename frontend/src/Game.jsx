import { useEffect, useState } from "react";
import { EVIL_ROLES, QUEST_SIZES, roleImage } from "./api.js";
import { Button, Modal, PagedList } from "./components.jsx";
import { useResource } from "./hooks.js";
export function QuestResult({ record }) {
  const votes = Object.entries(record.votes || {});
  return (
    <>
      <h3>Quest {record.success ? "Succeeded" : "Failed"}</h3>
      <p>
        There were <strong>{record.fails}</strong> fail cards played.
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
      <div className={revealed ? "" : "hidden"}>
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
          <details className="role-guide">
            <summary>Role guide</summary>
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
          </details>
        )}
      </div>
      <Button onClick={() => setRevealed(!revealed)}>
        {revealed ? "Hide" : "Reveal"}
      </Button>
    </Modal>
  );
}
export function PhaseActions({ state, userId, send, disabled }) {
  const [selected, setSelected] = useState([]);
  const phase = state.subphase || state.phase;
  const me = state.players.find((player) => player.user_id === userId);
  const name = (id) =>
    state.players.find((player) => player.user_id === id)?.name || "Unknown";
  const waiting = (ids) => (
    <p>
      <em>Waiting on: {ids.map(name).join(", ") || "server"}</em>
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
      return <p>{name(state.current_leader)} is proposing a team.</p>;
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
          <strong>{state.current_team.map(name).join(", ")}</strong>
        </p>
        {waiting(
          state.players
            .filter((player) => !(player.user_id in state.votes))
            .map((player) => player.user_id),
        )}
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
      </>
    );
  if (phase === "quest")
    return (
      <>
        <h2>Quest {state.round_number}</h2>
        {state.players.length >= 7 && state.round_number === 4 && (
          <p>This quest requires two Fail cards to fail.</p>
        )}
        {waiting(state.current_team.filter((id) => !(id in state.submissions)))}
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
              disabled={disabled || !EVIL_ROLES.includes(me?.role)}
              onClick={() => send({ type: "submit_card", card: "F" })}
            >
              Play Fail
            </Button>
            {!EVIL_ROLES.includes(me?.role) && (
              <p>Good players must play Success.</p>
            )}
          </>
        ) : (
          <p>Waiting for quest team…</p>
        )}
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
          <p>{name(state.lady_holder)} is inspecting a player…</p>
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
          <strong>Evil Players:</strong> {state.evil_players.join(", ")}
        </p>
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
      <div className="quest-row">
        {[1, 2, 3, 4, 5].map((round) => {
          const record = state.quest_history.find(
            (quest) => quest.round === round,
          );
          return (
            <div
              className={`quest-card ${expanded === round ? "expanded" : ""}`}
              key={round}
            >
              <h4>Quest {round}</h4>
              <button
                type="button"
                className={`quest-circle ${record ? (record.success ? "success" : "fail") : state.round_number === round ? "current" : ""}`}
                aria-label={`Quest ${round}${record ? " result" : " details"}`}
                onClick={() =>
                  record
                    ? onQuest(record)
                    : setExpanded(expanded === round ? null : round)
                }
              >
                {record
                  ? record.success
                    ? "Pass"
                    : "Fail"
                  : QUEST_SIZES[state.players.length]?.[round - 1]}
              </button>
              <small>
                {record ? (record.success ? "Passed" : "Failed") : "players"}
              </small>
            </div>
          );
        })}
      </div>
      {state.phase === "finished" ? (
        <div className="card centered game-result">
          <h2>Game Over!</h2>
          <p>The {state.winner === "good" ? "Good" : "Evil"} Team Wins!</p>
          <div className="roles-grid">
            <PagedList
              items={state.players}
              pageSize={4}
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
          <div className="card phase-actions">
            <PhaseActions
              key={`${state.round_number}:${state.subphase}:${state.current_leader}:${state.consecutive_rejections}:${state.assassin_candidates.join(",")}`}
              state={state}
              userId={userId}
              send={send}
              disabled={disabled}
            />
          </div>
        </>
      )}
      <div className="centered game-tools">
        <Button onClick={() => setRoleOpen(true)}>View Your Role</Button>
        {state.host_id === userId && (
          <Button tone="danger" disabled={disabled} onClick={reset}>
            Return to Lobby
          </Button>
        )}
      </div>
      {expanded !== null && (
        <Modal title={`Quest ${expanded}`} onClose={() => setExpanded(null)}>
          <p>Leader: {state.round_leaders[expanded - 1] || "To be decided"}</p>
          <p>
            {QUEST_SIZES[state.players.length]?.[expanded - 1]} players required
          </p>
          {expanded === state.round_number && (
            <p>
              Team:{" "}
              {state.current_team
                .map(
                  (id) =>
                    state.players.find((player) => player.user_id === id)?.name,
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
          role={me.role}
          info={privateInfo}
          onClose={() => setRoleOpen(false)}
        />
      )}
    </section>
  );
}
