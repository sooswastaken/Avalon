import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { TabPanel } from "./motion.jsx";
import { api } from "./api.js";
import { useResource } from "./hooks.js";

export function Button({ children, tone = "", ...props }) {
  return (
    <motion.button
      type="button"
      whileTap={props.disabled ? undefined : { scale: 0.97 }}
      className={`btn ${tone ? `btn-${tone}` : ""}`}
      {...props}
    >
      {children}
    </motion.button>
  );
}
export function ModalPresence({ children }) {
  // A modal can first mount inside a view whose presence skips initial motion.
  // Give dialogs their own lifecycle so entry and exit always run, including pause.
  return (
    <AnimatePresence initial={true} mode="wait" propagate>
      {children}
    </AnimatePresence>
  );
}

export function Modal({ title, children, onClose }) {
  const box = useRef(null);
  const present = useIsPresent();
  useEffect(() => {
    if (!present) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.focus();
    const keyboard = (event) => {
      if (event.key === "Escape" && onClose) onClose();
      if (event.key === "Tab") {
        const items = box.current?.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
        );
        if (!items?.length) {
          event.preventDefault();
          return;
        }
        const first = items[0],
          last = items[items.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === box.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === box.current)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [onClose, present]);
  return createPortal(
    <motion.div
      className="modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      inert={!present}
      aria-hidden={!present}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal-content card"
      >
        <h2>{title}</h2>
        {children}
        {onClose && <Button onClick={onClose}>Close</Button>}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
export function PasswordDialog({ mode, onSubmit, onClose }) {
  const [password, setPassword] = useState("");
  return (
    <Modal
      title={mode === "create" ? "Create Room" : "Enter Room Password"}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(password);
        }}
      >
        <label>
          {mode === "create" ? "Password (optional)" : "Password"}
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={mode !== "create"}
          />
        </label>
        <button className="btn" type="submit">
          {mode === "create" ? "Create Room" : "Join Room"}
        </button>
      </form>
    </Modal>
  );
}
export function Auth({ onLogin, notify }) {
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const username = form.get("username").trim(),
      password = form.get("password");
    try {
      const data = await api(signup ? "/signup" : "/login", null, {
        method: "POST",
        body: {
          username,
          password,
          ...(signup ? { display_name: form.get("display_name").trim() } : {}),
        },
      });
      onLogin({ userId: data.user_id, token: btoa(`${username}:${password}`) });
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card centered auth-card">
      <h2>Welcome to Avalon</h2>
      <p className="auth-intro">Gather your allies. Unmask the traitors.</p>
      <div className="profile-tabs">
        <Button aria-pressed={!signup} onClick={() => setSignup(false)}>
          Login
        </Button>
        <Button aria-pressed={signup} onClick={() => setSignup(true)}>
          Sign Up
        </Button>
      </div>
      <form className="auth-form narrow" onSubmit={submit}>
        <label>
          Username
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            required
          />
        </label>
        <div className="auth-extra">
          <TabPanel active={!signup}>
            <p className="auth-note">
              Sign in to create a room or join your allies.
            </p>
          </TabPanel>
          <TabPanel active={signup}>
            <label>
              Display Name
              <input
                name="display_name"
                autoComplete="nickname"
                disabled={!signup}
                required={signup}
              />
            </label>
          </TabPanel>
        </div>
        <button className="btn" disabled={busy}>
          {busy ? "Submitting…" : "Submit"}
        </button>
      </form>
    </section>
  );
}
export function Profile({ session, notify, onLogout }) {
  const { data, error } = useResource("/profile", session.token);
  if (!data)
    return <section className="card">{error || "Loading profile…"}</section>;
  return (
    <ProfileForm
      key={data.user_id}
      profile={data}
      session={session}
      notify={notify}
      onLogout={onLogout}
    />
  );
}
function ProfileForm({ profile, session, notify, onLogout }) {
  const [data, setData] = useState(profile);
  const [tab, setTab] = useState("profile");
  const [username, setUsername] = useState(profile.username),
    [display, setDisplay] = useState(profile.display_name),
    [busy, setBusy] = useState(false);
  async function save(event) {
    event.preventDefault();
    const body = {};
    if (username.trim() !== data.username) body.username = username.trim();
    if (display.trim() !== data.display_name)
      body.display_name = display.trim();
    if (!Object.keys(body).length) return notify("No changes to save");
    setBusy(true);
    try {
      const updated = await api("/profile", session.token, {
        method: "PUT",
        body,
      });
      if (body.username) {
        onLogout();
        notify("Username changed. Please log in again.");
      } else {
        setData(updated);
        notify("Profile updated");
      }
    } catch (error) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card centered profile-card">
      <h2>Your Profile</h2>
      <div className="profile-tabs">
        <Button
          aria-pressed={tab === "profile"}
          onClick={() => setTab("profile")}
        >
          Edit Profile
        </Button>
        <Button aria-pressed={tab === "stats"} onClick={() => setTab("stats")}>
          Game Stats
        </Button>
      </div>
      <div className="tab-panels">
        <TabPanel className="profile-panel" active={tab === "profile"}>
          <form className="narrow" onSubmit={save}>
            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>
            <label>
              Display Name
              <input
                value={display}
                onChange={(e) => setDisplay(e.target.value)}
                required
              />
            </label>
            <button className="btn" disabled={busy}>
              Save
            </button>
          </form>
        </TabPanel>
        <TabPanel className="profile-panel" active={tab === "stats"}>
          <p>Total Games: {data.total_games}</p>
          <p className="wins-badge">
            🏆 {data.good_wins + data.evil_wins} ({data.good_wins} Good,{" "}
            {data.evil_wins} Evil wins)
          </p>
          <RoleStats stats={data.role_stats} />
        </TabPanel>
      </div>
      <Button tone="danger" onClick={onLogout}>
        Log Out
      </Button>
    </section>
  );
}
function RoleStats({ stats }) {
  return (
    <div className="role-stats">
      {Object.entries(stats || {}).map(([role, value]) => (
        <p key={role}>
          {role}: {value.wins}W/{value.losses}L
        </p>
      ))}
    </div>
  );
}
export function Leaderboard({ session }) {
  const { data, error } = useResource("/leaderboard", session.token);
  return (
    <section className="card">
      <h2>Top Players</h2>
      {error ||
        (!data ? (
          "Loading…"
        ) : data.length ? (
          <PagedList
            items={data}
            renderItem={(entry) => (
              <LeaderboardEntry
                key={entry.user_id}
                entry={entry}
                token={session.token}
              />
            )}
          />
        ) : (
          "No players yet."
        ))}
    </section>
  );
}
function LeaderboardEntry({ entry, token }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="leaderboard-entry">
      <span>
        <strong>{entry.display_name}</strong>{" "}
        <span className="wins-badge">🏆 {entry.wins}</span>
      </span>
      <Button onClick={() => setExpanded(!expanded)}>
        {expanded ? "Hide" : "Details"}
      </Button>
      <ModalPresence>
        {expanded && (
          <Modal
            key="player-details"
            title={`${entry.display_name} · Stats`}
            onClose={() => setExpanded(false)}
          >
            <PlayerDetails username={entry.username} token={token} />
          </Modal>
        )}
      </ModalPresence>
    </div>
  );
}
function PlayerDetails({ username, token }) {
  const { data, error } = useResource(
    `/profile/${encodeURIComponent(username)}`,
    token,
  );
  return (
    <div className="details">
      {error ||
        (!data ? (
          "Loading…"
        ) : Object.keys(data.role_stats || {}).length ? (
          <RoleStats stats={data.role_stats} />
        ) : (
          "No role stats"
        ))}
    </div>
  );
}
export function Rooms({ rooms, userId, onJoin, onCreate, loading, error }) {
  const owned = rooms.filter((room) => room.member && room.host_id === userId);
  const groups = [
    ["My Room", owned],
    [
      "Disconnected from",
      rooms.filter((room) => room.member && room.host_id !== userId),
    ],
    [
      "Open Rooms",
      rooms.filter((room) => !room.member && room.phase === "lobby"),
    ],
  ];
  return (
    <section className="card centered rooms-card">
      <h2>Avalon Online</h2>
      <p>Gather your allies. Unmask the traitors.</p>
      {error && <p role="alert">{error}</p>}
      {loading && <p>Loading rooms…</p>}
      {!loading && !rooms.length && <p>No active rooms at the moment.</p>}
      <div className="room-list">
        <PagedList
          items={groups.flatMap(([title, list]) =>
            list.map((room) => ({ ...room, group: title })),
          )}
          renderItem={(room) => (
            <div className="room-row" key={room.room_id}>
              <span>
                <small className="room-group">{room.group}</small>
                {room.host_name} ({room.player_count}{" "}
                {room.player_count === 1 ? "player" : "players"})
                {room.requires_password && " 🔒"}
              </span>
              <Button onClick={() => onJoin(room)}>
                {room.member ? "Reconnect" : "Enter"}
              </Button>
            </div>
          )}
        />
      </div>
      {!owned.length ? (
        <Button onClick={onCreate}>Create Room</Button>
      ) : (
        !owned.some((room) => room.player_count > 1) && (
          <Button onClick={() => onJoin(owned[0])}>
            Reconnect to your own room
          </Button>
        )
      )}
    </section>
  );
}

export function PagedList({
  items,
  renderItem,
  pageSize = 3,
  animated = false,
}) {
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState(1);
  const pages = Math.ceil(items.length / pageSize);
  const current = Math.min(page, Math.max(0, pages - 1));
  const content = items
    .slice(current * pageSize, current * pageSize + pageSize)
    .map(renderItem);
  function changePage(next) {
    setDirection(next > current ? 1 : -1);
    setPage(next);
  }
  return (
    <>
      {animated ? (
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={current}
            custom={direction}
            className="animated-page-items"
            variants={{
              enter: (direction) => ({ opacity: 0, x: direction * 18 }),
              visible: { opacity: 1, x: 0 },
              exit: (direction) => ({ opacity: 0, x: direction * -18 }),
            }}
            initial="enter"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {content}
          </motion.div>
        </AnimatePresence>
      ) : (
        content
      )}
      {pages > 1 && (
        <div className="pagination" aria-label="Pagination">
          <Button
            disabled={current === 0}
            onClick={() => changePage(current - 1)}
          >
            Previous
          </Button>
          <span aria-live="polite">
            {current + 1} / {pages}
          </span>
          <Button
            disabled={current === pages - 1}
            onClick={() => changePage(current + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </>
  );
}
