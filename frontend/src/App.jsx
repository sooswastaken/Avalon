import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ViewTransition } from "./motion.jsx";
import { api } from "./api.js";
import { useSocket } from "./hooks.js";
import {
  Auth,
  Button,
  Leaderboard,
  Modal,
  ModalPresence,
  PasswordDialog,
  Profile,
  Rooms,
} from "./components.jsx";
import Lobby from "./Lobby.jsx";
import Game, { QuestResult } from "./Game.jsx";
import GameExplanation from "./GameExplanation.jsx";
export default function App() {
  const [session, setSession] = useState(null),
    [ready, setReady] = useState(false);
  const [view, setView] = useState("home"),
    [rooms, setRooms] = useState([]),
    [roomsLoading, setRoomsLoading] = useState(true),
    [roomsError, setRoomsError] = useState("");
  const [roomId, setRoomId] = useState(null),
    [state, setState] = useState(null),
    [privateInfo, setPrivateInfo] = useState(null);
  const [dialog, setDialog] = useState(null),
    [pause, setPause] = useState([]),
    [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Set());
  const toastSequence = useRef(0);
  const roomRequest = useRef(null);
  const pendingRoom = useRef(
    new URLSearchParams(location.search).get("room")?.trim(),
  );
  const notify = useCallback((message) => {
    const id = ++toastSequence.current;
    setToasts((previous) => [...previous, { id, message }]);
    const timer = setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
      timers.current.delete(timer);
    }, 5000);
    timers.current.add(timer);
  }, []);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      roomRequest.current?.abort();
    },
    [],
  );
  function saveSession(value) {
    localStorage.setItem("authToken", value.token);
    localStorage.setItem("userId", value.userId);
    setSession(value);
  }
  function home() {
    roomRequest.current?.abort();
    setBusy(false);
    setRoomId(null);
    setState(null);
    setPrivateInfo(null);
    setPause([]);
    setDialog(null);
    setView("home");
    localStorage.removeItem("roomId");
    history.replaceState(null, "", "/");
  }
  function logout() {
    home();
    localStorage.removeItem("authToken");
    localStorage.removeItem("userId");
    setSession(null);
  }
  useEffect(() => {
    const controller = new AbortController();
    const token = localStorage.getItem("authToken");
    if (!token) {
      setReady(true);
      return;
    }
    api("/profile", token, { signal: controller.signal })
      .then((profile) => {
        if (!controller.signal.aborted) {
          localStorage.setItem("userId", profile.user_id);
          setSession({ token, userId: profile.user_id });
          setReady(true);
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error.status === 401) {
          localStorage.removeItem("authToken");
          localStorage.removeItem("userId");
        }
        notify(error.message);
        setReady(true);
      });
    return () => controller.abort();
  }, [notify]);
  async function enter(id, password, create = false) {
    roomRequest.current?.abort();
    const controller = new AbortController();
    roomRequest.current = controller;
    setBusy(true);
    setDialog(null);
    try {
      let data;
      try {
        data = await api(
          create ? "/rooms" : `/rooms/${encodeURIComponent(id)}/join`,
          session.token,
          {
            method: "POST",
            body: password ? { password } : {},
            signal: controller.signal,
          },
        );
      } catch (error) {
        if (!create && error.message === "Already in room")
          data = { room_id: id };
        else throw error;
      }
      if (controller.signal.aborted) return;
      setState(null);
      setPrivateInfo(null);
      setPause([]);
      setRoomId(data.room_id);
      setView("room");
      localStorage.setItem("roomId", data.room_id);
      history.replaceState(
        null,
        "",
        `/?room=${encodeURIComponent(data.room_id)}`,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error.status === 401) logout();
      if (!create && error.status === 403)
        setDialog({ type: "password", roomId: id });
      notify(error.message);
    } finally {
      if (roomRequest.current === controller) setBusy(false);
    }
  }
  useEffect(() => {
    if (!session || !pendingRoom.current) return;
    const id = pendingRoom.current;
    pendingRoom.current = null;
    enter(id);
  }, [session]);
  useEffect(() => {
    if (!session || view !== "home") return;
    const controller = new AbortController();
    setRoomsLoading(true);
    setRoomsError("");
    api("/rooms", session.token, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setRooms(data);
          setRoomsLoading(false);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setRoomsError(error.message);
          setRoomsLoading(false);
        }
      });
    return () => controller.abort();
  }, [session, view]);
  useSocket(
    session && view === "home"
      ? `/lobbies_ws?auth=${encodeURIComponent(session.token)}`
      : null,
    {
      onMessage(message) {
        if (message.type === "lobbies") {
          setRooms(message.data);
          setRoomsLoading(false);
          setRoomsError("");
        }
      },
    },
  );
  const { send: sendRaw, status } = useSocket(
    session && roomId
      ? `/ws/${encodeURIComponent(roomId)}?auth=${encodeURIComponent(session.token)}`
      : null,
    {
      onMessage(message) {
        switch (message.type) {
          case "state":
            setState(message.data);
            if (message.data.phase === "lobby") {
              setPrivateInfo(null);
              setPause([]);
              setDialog(null);
            }
            break;
          case "info":
            setPrivateInfo(message);
            break;
          case "quest_result":
            setDialog({ type: "quest", record: message.data });
            break;
          case "pause":
            setPause(message.players || []);
            break;
          case "assassination_tie":
            notify(`Tie vote among: ${message.candidates.join(", ")}. Revote!`);
            break;
          case "lady_result":
            notify(`${message.target} is ${message.loyalty.toUpperCase()}`);
            break;
          case "lady_inspect":
            notify(
              `${message.inspector} inspected ${message.target} with the Lady of the Lake`,
            );
            break;
          case "kicked":
            if (message.target === session.userId) {
              home();
              notify("You have been kicked from the room.");
            }
            break;
        }
      },
      onTerminal(code) {
        if (code === 4003)
          notify("This tab is paused because another window is active.");
        else {
          if (code === 4000 || code === 4001) logout();
          else home();
          notify(
            code === 4002
              ? "Room connection was invalid."
              : "Please log in again.",
          );
        }
      },
    },
  );
  const send = (message) => {
    if (!sendRaw(message)) {
      notify("Not connected. Please wait or reconnect.");
      return false;
    }
    return true;
  };
  const disabled = status !== "connected" || pause.length > 0;
  return (
    <>
      <header className="app-header">
        <h1>Avalon Online</h1>
      </header>
      <nav id="navbar">
        <a
          className="nav-brand"
          aria-current={view === "home" ? "page" : undefined}
          href="/"
          onClick={(event) => {
            event.preventDefault();
            home();
          }}
        >
          Home
        </a>
        <div className="nav-links">
          <a href="/wiki.html" target="_blank" rel="noreferrer">
            Wiki
          </a>
          {session && (
            <>
              <a
                href="#leaderboard"
                aria-current={view === "leaderboard" ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setView("leaderboard");
                }}
              >
                Leaderboard
              </a>
              <a
                href="#profile"
                aria-current={view === "profile" ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setView("profile");
                }}
              >
                Profile
              </a>
            </>
          )}
        </div>
      </nav>
      <main className="app-main">
        {ready && view === "home" && !busy && (
          <div className="home-help">
            <Button
              aria-haspopup="dialog"
              onClick={() => setDialog({ type: "explanation" })}
            >
              How to play
            </Button>
          </div>
        )}
        <ViewTransition
          viewKey={
            !ready
              ? "loading"
              : !session
                ? "auth"
                : busy
                  ? "connecting"
                  : view === "room"
                    ? `room:${state?.phase === "lobby" ? "lobby" : state ? "game" : "loading"}`
                    : view
          }
        >
          {!ready ? (
            <section className="card">Restoring session…</section>
          ) : !session ? (
            <Auth onLogin={saveSession} notify={notify} />
          ) : (
            <>
              {busy ? (
                <section className="card centered">
                  <h2>Connecting to room…</h2>
                  <div className="loader" />
                </section>
              ) : view === "profile" ? (
                <Profile session={session} notify={notify} onLogout={logout} />
              ) : view === "leaderboard" ? (
                <Leaderboard session={session} />
              ) : view === "room" ? (
                <>
                  {status !== "connected" && (
                    <div className="card" role="status">
                      <p>
                        {status === "paused"
                          ? "This tab is paused. Use Reconnect to make it active."
                          : "Connecting to room…"}
                      </p>
                      {status === "paused" && (
                        <Button onClick={() => location.reload()}>
                          Reconnect
                        </Button>
                      )}
                      <Button onClick={home}>Home</Button>
                    </div>
                  )}
                  {state ? (
                    state.phase === "lobby" ? (
                      <Lobby
                        state={state}
                        userId={session.userId}
                        send={send}
                        notify={notify}
                        disabled={disabled}
                      />
                    ) : (
                      <Game
                        state={state}
                        userId={session.userId}
                        privateInfo={privateInfo}
                        modalBlocked={!!dialog || pause.length > 0}
                        send={send}
                        disabled={disabled}
                        onQuest={(record) =>
                          setDialog({ type: "quest", record })
                        }
                      />
                    )
                  ) : (
                    status === "connected" && <p>Loading room…</p>
                  )}
                </>
              ) : (
                <Rooms
                  rooms={rooms}
                  userId={session.userId}
                  loading={roomsLoading}
                  error={roomsError}
                  onCreate={() => setDialog({ type: "create" })}
                  onJoin={(room) =>
                    room.requires_password && !room.member
                      ? setDialog({ type: "password", roomId: room.room_id })
                      : enter(room.room_id)
                  }
                />
              )}
            </>
          )}
        </ViewTransition>
      </main>
      <div id="toastContainer" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              className="toast"
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 16 }}
            >
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <ModalPresence>
        {pause.length > 0 ? (
          <Modal key="paused" title="Game Paused">
            <p>
              Waiting for <strong>{pause.join(", ")}</strong> to reconnect…
            </p>
            <p>
              {pause.length === 1
                ? "A player has disconnected."
                : `${pause.length} players have disconnected.`}{" "}
              The game will resume automatically when
              everyone reconnects. You can stay here and wait.
            </p>
            {state?.host_id === session?.userId && (
              <Button
                tone="danger"
                disabled={status !== "connected"}
                onClick={() => {
                  if (confirm("Reset the game and return to lobby?"))
                    send({ type: "reset_lobby" });
                }}
              >
                Return to Lobby
              </Button>
            )}
            {state?.host_id === session?.userId && (
              <p>Return to Lobby resets the game and clears its progress for everyone.</p>
            )}
            <p>
              Home takes you to the room list and disconnects you from this game.
              The game stays paused until all players return.
            </p>
            <Button onClick={home}>Home</Button>
          </Modal>
        ) : dialog?.type === "explanation" ? (
          <GameExplanation key="explanation" onClose={() => setDialog(null)} />
        ) : dialog?.type === "quest" ? (
          <Modal
            key={`quest-result:${dialog.record.round}`}
            title={`Quest ${dialog.record.round} Result`}
            onClose={() => setDialog(null)}
          >
            <QuestResult record={dialog.record} />
          </Modal>
        ) : (
          (dialog?.type === "create" || dialog?.type === "password") && (
            <PasswordDialog
              key={`${dialog.type}:${dialog.roomId}`}
              mode={dialog.type}
              onClose={() => setDialog(null)}
              onSubmit={(password) =>
                enter(dialog.roomId, password, dialog.type === "create")
              }
            />
          )
        )}
      </ModalPresence>
    </>
  );
}
