# Avalon Online

A fully-featured, local-hostable remake of **The Resistance: Avalon**.

Supports any hostname, lobby sharing on frontend uses current host.

* **backend/** – A FastAPI application providing REST & WebSocket APIs, built with Tortoise-ORM and SQLite for persistence.
* **frontend/** – A zero-build vanilla-JS single-page app (served directly by the backend) implementing the game UI.
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

### 2. Launch the backend (+ serves the SPA)

```bash
$ uvicorn backend.app:app --reload
```

The server starts on <http://localhost:8000/> – open it in **two or more** browser tabs to emulate multiple players.

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
