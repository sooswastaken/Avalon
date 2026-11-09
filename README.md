# Avalon Online

A self-hostable, real-time multiplayer version of **The Resistance: Avalon** for 5–10 players. A React frontend handles lobbies and gameplay; a FastAPI backend runs the game engine and stores accounts and statistics in SQLite.

## Features

- Account signup and login, editable profiles, per-role statistics, and a leaderboard ranked by total wins.
- Public or password-protected lobbies with invitation links and QR codes.
- Host controls for optional roles, player readiness, and starting or resetting games.
- Live team proposals, approval votes, quests, Lady of the Lake investigations, assassination voting, and quest history.
- Automatic connection retries, a pause screen while players are disconnected, and private role information restored on reconnect.
- A character and rules wiki at `/wiki.html`, plus an installable production PWA.

## Run locally

You need Python (3.13 recommended), Node.js 22.12+ or a newer supported LTS, and npm. Run commands from the repository root unless a step says otherwise.

### 1. Install backend dependencies

```sh
git clone https://github.com/sooswastaken/Avalon.git
cd Avalon
python -m venv .venv
```

Activate the virtual environment in PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Or on macOS/Linux:

```sh
source .venv/bin/activate
```

Then install dependencies:

```sh
python -m pip install -r backend/requirements.txt
```

### 2. Build the frontend

```sh
cd frontend
npm ci
npm run build
cd ..
```

Vite writes the main app, wiki, public assets, and PWA files to `frontend/dist`. Character images remain in `images/` and are served separately by FastAPI.

### 3. Start the application

```sh
python -m uvicorn backend.app:app --reload
```

Open [localhost:8000](http://localhost:8000/). FastAPI serves both the API and the built frontend. SQLite creates `database.db` in the server's working directory on first startup.

Create an account and a lobby, then use **Invite** to share its link or QR code. Each player needs a separate account. With 5–10 players in the room, everyone marks themselves ready and the host starts the game.

For local multiplayer testing, use separate browser profiles or devices. Tabs in the same browser profile share saved credentials, and a new room connection for the same account replaces its previous connection.

### Frontend development

Keep the backend running and start Vite in a second terminal:

```sh
cd frontend
npm run dev
```

Open [localhost:5173](http://localhost:5173/). Vite proxies REST requests, `/images`, and both WebSocket endpoints to `http://127.0.0.1:8000`. API-only development can start before a frontend build; opening the UI on port 8000 requires that build.

To use another backend, set `AVALON_BACKEND_URL` before starting Vite. For example, in PowerShell:

```powershell
$env:AVALON_BACKEND_URL = "http://127.0.0.1:8001"
npm run dev
```

For LAN testing with the built frontend, run from the repository root:

```sh
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

For LAN testing through Vite, run `npm run dev -- --host 0.0.0.0` from `frontend/`. Open the app using the computer's LAN address on other devices. Invitation links and WebSocket connections use the browser's current host and protocol.

After frontend changes, run `npm run build` from `frontend/` to update the app served by FastAPI.

## Game rules and options

The current engine includes several custom rules:

- **Roles:** Merlin and Mordred are always included. Morgana and Percival are enabled together by default; Oberon is optional and requires at least seven players when configuring the lobby. Remaining slots are filled with Loyal Servants and Minions of Mordred.
- **Team balance:** The engine assigns `max(2, ceil(player_count / 3))` evil players, which differs from the standard distribution for some player counts.
- **Private information:** Merlin sees evil players except Mordred and Oberon. Evil players other than Oberon know each other. Percival sees Merlin and Morgana without knowing which is which.
- **Quests:** Teams need a strict majority of approval votes. Five consecutive rejected proposals give evil the win. Good players must submit Success; evil players may submit Success or Fail. Quest four requires two Fail cards with seven or more players. Three failed quests give evil the win.
- **Assassination:** After three successful quests, all evil players vote on a target from the good team. There is no separately assigned Assassin role. Ties trigger another vote among the tied candidates; identifying Merlin gives evil the win, otherwise good wins.
- **Lady of the Lake:** Enabled by default after quests 2, 3, and 4, provided the game continues. The host can select those quest timings in the lobby. The holder privately learns a player's alignment and passes them the token; previous holders cannot be investigated again.

The host can return a finished game to the lobby for another match. See [`backend/game_logic.py`](backend/game_logic.py) for the implemented rules and [`backend/constants.py`](backend/constants.py) for quest team sizes.

## Install as an app

The production build includes a web app manifest and service worker. Open the app over HTTPS, or on `localhost` for testing, and use the browser's install option. On iPhone/iPad, use Safari's **Share → Add to Home Screen**. A plain HTTP LAN address does not support service workers.

The app shell and wiki are precached when the production service worker installs. Accounts, lobbies, and live games still need a server connection. Updates activate after all app tabs and windows close so an update does not reload an ongoing match. PWA caching is enabled only in production builds.

To regenerate the 192px, 512px, and maskable icons from `frontend/public/favicon.svg`, run the following from `frontend/`, then rebuild:

```sh
npm run icons
npm run build
```

The Apple touch icon is maintained separately at `frontend/public/apple-touch-icon.png`.

## API and authentication

Interactive REST documentation is available at [localhost:8000/docs](http://localhost:8000/docs), with the OpenAPI schema at `/openapi.json`.

| Method | Path | Purpose | Authentication |
| --- | --- | --- | --- |
| POST | `/signup` | Create an account; return `user_id` and `display_name` | None |
| POST | `/login` | Validate credentials; return `user_id` and `display_name` | Credentials in JSON body |
| GET | `/profile` | Read your profile and statistics | HTTP Basic |
| PUT | `/profile` | Update your username or display name | HTTP Basic |
| GET | `/profile/{username}` | Read another player's profile and statistics | HTTP Basic |
| GET | `/leaderboard` | List players ranked by total wins (`limit` defaults to 20) | HTTP Basic |
| POST | `/rooms` | Create a lobby, optionally with a password | HTTP Basic |
| POST | `/rooms/{room_id}/join` | Join or rejoin a room | HTTP Basic |
| GET | `/rooms` | List lobbies; authenticated members also see their active games | Optional HTTP Basic |

Login does **not** issue a server token. Protected REST requests use `Authorization: Basic <base64(username:password)>`. The frontend stores this encoded credential value in local storage as `authToken`; account passwords are bcrypt-hashed in the database. Use HTTPS when hosting beyond localhost.

| WebSocket path | Purpose | Authentication |
| --- | --- | --- |
| `/lobbies_ws` | Push lobby list updates | Optional `auth` query parameter |
| `/ws/{room_id}` | Exchange room state, private information, and game actions | Required `auth` query parameter; join the room through REST first |

For WebSockets, `auth` is the URL-encoded Base64 value of `username:password`. Room actions are JSON messages with a `type`, such as `toggle_ready`, `start_game`, `propose_team`, `vote_team`, or `submit_card`. The dispatcher in [`backend/game_logic.py`](backend/game_logic.py) defines incoming actions; [`backend/room.py`](backend/room.py) builds personalized `state` messages, and [`backend/schemas.py`](backend/schemas.py) defines their data models.

## Persistence and hosting

Only the `users` table is persisted: account details, total games, good/evil wins and losses, and per-role win/loss statistics. Rooms, role assignments, connections, and game progress live in memory.

- Restarting the backend, including a development reload, clears all lobbies and games.
- Run a **single backend worker**. Multiple workers would have separate room state.
- When the last WebSocket disconnects from a lobby, the lobby is removed. A room outside the lobby phase is retained for five minutes without connections; reconnecting cancels that cleanup.
- Back up `database.db` to preserve accounts and statistics. Its path is relative to the server's working directory, so use a consistent working directory when hosting.

For hosting, build the frontend and run Uvicorn without `--reload` behind an HTTPS reverse proxy or tunnel that supports WebSocket upgrades. Serve the app at the origin root: API, asset, and wiki URLs use root-relative paths. The backend currently allows all CORS origins; adjust the middleware in `backend/app.py` for your hosting environment.

## Project layout

| Path | Responsibility |
| --- | --- |
| `backend/app.py` | FastAPI setup, static files, CORS, and SQLite initialization |
| `backend/routers/` | User and room REST endpoints, lobby and room WebSockets |
| `backend/game_logic.py` | Role assignment, game actions, progression, and statistics updates |
| `backend/room.py`, `backend/state.py` | In-memory rooms, connections, and personalized broadcasts |
| `backend/models.py`, `backend/schemas.py` | Persistent user model and API/runtime schemas |
| `frontend/src/App.jsx` | Session state, navigation, and room connections |
| `frontend/src/Lobby.jsx`, `frontend/src/Game.jsx` | Lobby setup and game phase UI |
| `frontend/src/Wiki.jsx`, `frontend/public/game-details.json` | Character wiki and game reference content |
| `frontend/src/api.js`, `frontend/src/socket.js`, `frontend/src/hooks.js` | REST requests, WebSocket retries, and lifecycle cleanup |
| `frontend/public/`, `frontend/scripts/` | Public assets and PWA icon generation |
| `images/` | Character portraits and textures served at `/images` |

## Checks

Run from `frontend/`:

```sh
npm test
npm run build
```

The Vitest and React Testing Library suite covers invitation/login flows, lobby and game controls, wiki links, modal behavior, and WebSocket lifecycle handling. There is currently no backend automated test suite in the repository.
