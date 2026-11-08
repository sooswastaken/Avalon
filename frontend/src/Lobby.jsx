import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button, Modal } from "./components.jsx";
export default function Lobby({ state, userId, send, notify, disabled }) {
  const host = state.host_id === userId,
    me = state.players.find((player) => player.user_id === userId);
  const link = `${location.origin}/?room=${encodeURIComponent(state.room_id)}`;
  const [qr, setQr] = useState("");
  const [tab, setTab] = useState("players");
  const [inviteOpen, setInviteOpen] = useState(false);
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(link, { width: 160, margin: 1 })
      .then((value) => {
        if (active) setQr(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [link]);
  const update = (changes) =>
    send({ type: "set_config", ...state.config, ...changes });
  const options = [
    {
      name: "Morgana & Percival",
      images: ["morgana", "percival"],
      enabled: state.config.morgana && state.config.percival,
      available: true,
      wiki: "morgana,percival",
      changes: {
        morgana: !state.config.morgana,
        percival: !state.config.morgana,
      },
    },
    {
      name: "Oberon",
      images: ["oberon"],
      enabled: state.config.oberon,
      available: state.players.length >= 7,
      wiki: "oberon",
      changes: { oberon: !state.config.oberon },
    },
    {
      name: "Lady of the Lake",
      images: ["ladyofthelake"],
      enabled: state.config.lady_enabled,
      available: true,
      wiki: "ladyofthelake",
      changes: { lady_enabled: !state.config.lady_enabled },
    },
  ];
  return (
    <section id="lobby" className="card">
      <div className="header-row">
        <h2>
          Room{" "}
          <span id="roomIdDisplay" className="populated">
            {state.room_id}
          </span>
        </h2>
      </div>
      <div
        className="lobby-tabs"
        role="tablist"
        aria-label="Lobby"
        onKeyDown={(event) => {
          if (event.target.getAttribute("role") !== "tab") return;
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const next =
              event.key === "Home"
                ? "players"
                : event.key === "End"
                  ? "setup"
                  : tab === "players"
                    ? "setup"
                    : "players";
            setTab(next);
            document.getElementById(`${next}-tab`).focus();
          }
        }}
      >
        <button
          role="tab"
          id="players-tab"
          tabIndex={tab === "players" ? 0 : -1}
          aria-selected={tab === "players"}
          aria-controls="players-panel"
          onClick={() => setTab("players")}
        >
          Players · {state.players.length}
        </button>
        <button
          role="tab"
          id="setup-tab"
          tabIndex={tab === "setup" ? 0 : -1}
          aria-selected={tab === "setup"}
          aria-controls="setup-panel"
          onClick={() => setTab("setup")}
        >
          Game setup
        </button>
        <Button onClick={() => setInviteOpen(true)}>Invite</Button>
      </div>
      {inviteOpen && (
        <Modal title="Invite Players" onClose={() => setInviteOpen(false)}>
          <div className="qr-code-wrapper">
            <p>Scan to join on another device</p>
            {qr && (
              <img
                src={qr}
                width="160"
                height="160"
                alt="Room invitation QR code"
              />
            )}
          </div>
          <p>Share the room link or scan the code to join.</p>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                notify("Room link copied!");
              } catch {
                notify(`Room link: ${link}`);
              }
            }}
          >
            Copy Link
          </Button>
        </Modal>
      )}
      <div
        id="players-panel"
        role="tabpanel"
        aria-labelledby="players-tab"
        hidden={tab !== "players"}
      >
        <ul className="player-list">
          {state.players.map((player) => (
            <li key={player.user_id}>
              <span className="player-name" title={player.name}>
                {player.user_id === state.host_id && (
                  <span className="host-indicator">★</span>
                )}
                {player.name}{" "}
                <span className="wins-badge">🏆 {player.wins}</span>
              </span>
              {host && player.user_id !== userId && (
                <Button
                  tone="danger"
                  disabled={disabled}
                  onClick={() => send({ type: "kick", target: player.user_id })}
                >
                  Kick
                </Button>
              )}
              <span className="status-indicator">
                <span
                  className={`status-dot ${player.ready ? "ready" : "not-ready"}`}
                />
                {player.ready ? "Ready" : "Not Ready"}
              </span>
            </li>
          ))}
        </ul>
        <p className="lobby-summary">
          {state.players.filter((player) => player.ready).length}/
          {state.players.length} ready ·{" "}
          {host ? "You are the host" : "Waiting for the host to start"}
        </p>
      </div>
      <div
        id="setup-panel"
        role="tabpanel"
        aria-labelledby="setup-tab"
        hidden={tab !== "setup"}
        className="config-options-container"
      >
        <div className="config-header">
          <h4>Optional Roles</h4>
          {state.players.length < 7 && <p>Oberon requires 7+ players.</p>}
        </div>
        <div className="config-body">
          {options.map((option) => (
            <div
              key={option.name}
              className={`config-option-card ${option.enabled ? "enabled" : "disabled"} ${option.images.length === 2 ? "dual" : ""} ${!option.available ? "unavailable" : ""}`}
            >
              <button
                type="button"
                className="role-toggle"
                aria-label={option.name}
                aria-pressed={option.enabled}
                disabled={!host || !option.available || disabled}
                onClick={() => update(option.changes)}
              >
                <span
                  className={
                    option.images.length === 2 ? "dual-img-wrapper" : ""
                  }
                >
                  {option.images.map((image) => (
                    <img key={image} src={`/images/${image}.png`} alt={image} />
                  ))}
                </span>
                <span className="overlay-icon" />
                <span className="role-option-name">
                  {option.name}
                  <small>
                    {!option.available
                      ? "7+ players"
                      : option.enabled
                        ? "Enabled"
                        : "Off"}
                  </small>
                </span>
              </button>
              <a
                className="info-icon"
                href={`/wiki.html?item=${option.wiki}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`About ${option.name}`}
              >
                ?
              </a>
            </div>
          ))}
        </div>
        <div
          className={`lady-quest-selector-container ${!state.config.lady_enabled ? "disabled" : ""}`}
        >
          <p>Select quests for the Lady to appear after:</p>
          <div className="lady-quest-selector">
            {[1, 2, 3, 4, 5].map((round) => {
              const selected = state.config.lady_after_rounds.includes(round);
              return (
                <button
                  type="button"
                  key={round}
                  className={`lady-quest-marker ${selected ? "selected" : ""} ${[2, 3, 4].includes(round) ? "selectable" : "unselectable"}`}
                  aria-label={`Lady after quest ${round}`}
                  aria-pressed={selected}
                  disabled={
                    !host ||
                    disabled ||
                    !state.config.lady_enabled ||
                    ![2, 3, 4].includes(round)
                  }
                  onClick={() =>
                    update({
                      lady_after_rounds: selected
                        ? state.config.lady_after_rounds.filter(
                            (value) => value !== round,
                          )
                        : [...state.config.lady_after_rounds, round].sort(),
                    })
                  }
                >
                  {round}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="centered lobby-actions">
        {state.players.length < 5 && (
          <p>At least 5 players are needed to start.</p>
        )}
        <Button
          tone={me?.ready ? "danger" : "success"}
          disabled={disabled}
          onClick={() => send({ type: "toggle_ready" })}
        >
          {me?.ready ? "Unready" : "Ready"}
        </Button>
        {host && (
          <Button
            disabled={
              disabled ||
              state.players.length < 5 ||
              state.players.length > 10 ||
              !state.players.every((player) => player.ready)
            }
            onClick={() => send({ type: "start_game" })}
          >
            Start Game
          </Button>
        )}
      </div>
    </section>
  );
}
