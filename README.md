# The Resistance: Avalon – Online Edition

This repository contains a minimal, **work-in-progress** implementation of Avalon that you can run locally.

---

## Quick start (development)

1. **Install Python dependencies**

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

2. **Launch the backend & static frontend**

```bash
uvicorn backend.main:app --reload
```

The server starts on http://localhost:8000/ and serves the vanilla-JS frontend.

3. **Open the game**

Visit http://localhost:8000/ in two or more browser tabs/windows to simulate multiple players.

---

## Current Status

* Lobby flow with **create / join / kick / ready / start** is implemented.
* Roles are randomly dealt at game start and delivered privately.
* The remainder of the game loop (team proposals, voting, quests, assassination) is still TODO but the architecture (versioned state snapshots over WebSockets) is ready for extension.

The backend keeps all state in-memory. If you stop the server, all rooms vanish. Persistence, authentication, and production hardening are outside the scope of this demo. 