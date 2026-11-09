# Avalon Online

A fully-featured, local-hostable remake of **The Resistance: Avalon**.

Supports any hostname, lobby sharing on frontend uses current host.

* **backend/** – A FastAPI application providing REST & WebSocket APIs, built with Tortoise-ORM and SQLite for persistence.
* **frontend/** – A React application built with Vite, with reusable components and managed REST/WebSocket connections. FastAPI serves the production build.
* **images/** – Character portraits & textures used by the SPA.

---

## Features

* Account signup / login with hashed passwords
* Lobby creation, join & listing with optional passwords
* Real-time room synchronisation over WebSockets (pause/resum`e on disconnect)
* In-memory game engine modelling Avalon roles & turn logic (see `backend/game_logic.py`)
* Persistent aggregate statistics per user stored in SQLite
* Basic global leaderboard with win/lose statistics for each role.

> **Status:** The core game loop is playable.

---

## Quick-start (Development)

### 1. Clone & set up a virtualenv

```bash
# Clone
$ git clone https://github.com/<your-fork>/Avalon.git
$ cd Avalon

# Python ≥3.13 recommended
$ python -m venv .venv
$ source .venv/bin/activate

# Install backend dependencies
$ pip install -r backend/requirements.txt
```

### 2. Build the frontend

Install Node.js 22.12+ (or a newer supported LTS), then run:

```bash
cd frontend
npm ci
npm run build
cd ..
```

The build creates `frontend/dist`, including the main application, wiki page, and game details. Character images continue to be served from `/images` by FastAPI.

### Install as an app (PWA)

The production build includes an install manifest and service worker using the crowned-sword artwork in `frontend/public/favicon.svg` and the existing `apple-touch-icon.png`. Open the app over HTTPS (or `localhost` for local testing), then use your browser's install option. On iPhone/iPad, use Safari's Share → Add to Home Screen. Plain HTTP on a LAN IP does not support service workers; use HTTPS for phone installation.

The app shell and wiki are cached after the first successful visit. Accounts, lobbies, and live games require a server connection. New versions activate after all app tabs/windows close so an update does not reload an ongoing match. PWA caching is enabled in production builds only.

To regenerate the 192px, 512px, and maskable PNG icons from the SVG, run `npm run icons` inside `frontend`, then rebuild. Keep the existing Apple touch icon when updating artwork, or replace it with a matching 180×180 PNG.

### 3. Launch the backend (+ serves the React app)

```bash
$ uvicorn backend.app:app --reload
```

The server starts on <http://localhost:8000/> – open it in **two or more** browser tabs to emulate multiple players.

For frontend development, leave the backend running and start Vite in a second terminal:

```bash
cd frontend
npm run dev
```

Open <http://localhost:5173/>. Vite proxies the existing REST endpoints, `/images`, and both WebSocket endpoints to <http://127.0.0.1:8000>. Set `AVALON_BACKEND_URL` before starting Vite to use another backend address. Use `npm run dev -- --host 0.0.0.0` for LAN testing; invitation links use the browser's current origin.

After frontend changes, run `npm run build` to update the UI served on port 8000. Run `npm test` inside `frontend` for component and connection lifecycle tests. API-only development can start before a frontend build; build the frontend before opening the UI on port 8000.

The React source lives in `frontend/src`: `App.jsx` coordinates sessions and navigation, `Lobby.jsx` manages lobby controls, `Game.jsx` renders game phases, and `Wiki.jsx` preserves wiki deep links. `hooks.js`, `socket.js`, and `api.js` manage requests and connection cleanup. No backend game rules or wire formats are changed.

Tortoise-ORM auto-creates `database.db` on first run. Delete it to wipe user accounts & stats.

---

## 📡 REST API (selected routes)

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST   | `/signup`               | Create a new account |
| POST   | `/login`                | Log in and receive auth token |
| GET    | `/profile`              | Get current user profile |
| PUT    | `/profile`              | Update username / display-name |
| GET    | `/profile/{username}`   | Lookup another player |
| GET    | `/leaderboard`          | Global leaderboard |
| POST   | `/rooms`                | Create a lobby (host only) |
| POST   | `/rooms/{roomId}/join`  | Join an existing lobby |
| GET    | `/rooms`                | List open lobbies |

Authentication uses HTTP **Basic**. Send a `Authorization: Basic <base64(username:password)>` header.

---

## WebSocket Endpoints

| Path | Purpose |
| ---- | ------- |
| `/lobbies_ws` | Push-updates when lobby list changes |
| `/ws/{roomId}` | Bi-directional game messaging inside a room |

See `backend/game_logic.py` for the message schema.

---

## Database Schema

Only one table – `users` – is currently persisted.  Fields referenced in `backend/models.py`:

```text
id (UUID) | username (unique) | password_hash | display_name
 total_games | good_wins | good_losses | evil_wins | evil_losses
 role_stats (JSON)
```

Game & lobby state are held in-memory. If the last player leaves a running room it is pruned after 5 minutes.
