/* global localStorage, location, fetch, WebSocket, btoa, history, alert, prompt, QRCode, sessionStorage, navigator */

// same origin
const API_HOST = window.location.host; // includes port if present
// Add centralized API helpers
const API_PROTOCOL = location.protocol;
const API_BASE_URL = `${API_PROTOCOL}//${API_HOST}`;
const WS_PROTOCOL = API_PROTOCOL === "https:" ? "wss" : "ws";
/**
 * Wrapper around fetch that prefixes API_HOST to relative paths.
 * @param {string} path Path beginning with '/'
 * @param {RequestInit} options fetch options
 */
function apiFetch(path, options) {
  const url = path.startsWith("/") ? `${API_BASE_URL}${path}` : path;
  return fetch(url, options);
}

let roomId = null;
let userId = null;
let authToken = null; // base64(username:password)
let ws = null;
let roomWs = null; // websocket for room list updates

// DOM Elements
const landingSection = document.getElementById("landing");
const lobbySection = document.getElementById("lobby");
const gameSection = document.getElementById("game");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roleContainer = document.getElementById("roleContainer");
const phaseContainer = document.getElementById("phaseContainer");
const actionsContainer = document.getElementById("actionsContainer");
const toastContainer = document.getElementById("toastContainer");
const roleModal = document.getElementById("roleModal");
const roleImgEl = document.getElementById("roleImg");
const toggleBlurBtn = document.getElementById("toggleBlurBtn");
const closeRoleBtn = document.getElementById("closeRoleBtn");
const roleExtraContainer = document.getElementById("roleExtra");
const roleTitleEl = document.getElementById("roleTitle");

// Authentication Elements
const authSection = document.getElementById("auth");
const showLoginBtn = document.getElementById("showLoginBtn");
const showSignupBtn = document.getElementById("showSignupBtn");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const signupUsername = document.getElementById("signupUsername");
const signupDisplay = document.getElementById("signupDisplay");
const signupPassword = document.getElementById("signupPassword");
const loginSubmit = document.getElementById("loginSubmit");
const signupSubmit = document.getElementById("signupSubmit");

let pendingRoomId = null; // room to auto-join after auth
let privateInfo = null;

// --- Assassination voting helpers (must be defined before first use) --- //
const EVIL_ROLES = ["Mordred", "Morgana", "Oberon", "Minion of Mordred"];
let _assassinationVoted = false; // track whether current evil player has voted in the ongoing round
let _assassinCandidatesKey = "";
// Lady of the Lake internal flag
let _ladyChosen = false; // whether current holder already submitted choice this round

// Quest sizes mapping for UI (mirrors backend)
const QUEST_SIZES = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

// ---- Load static game details (objectives, full role descriptions) ---- //
let GAME_DETAILS = null;
apiFetch("/game-details.json")
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    GAME_DETAILS = data;
  })
  .catch(err => console.warn("Failed to load game-details.json", err));

// ---- NEW: Nav & Additional Sections ---- //
const profileSection = document.getElementById("profileSection");
const leaderboardSection = document.getElementById("leaderboardSection");
const navHome = document.getElementById("navHome");
const navLeaderboard = document.getElementById("navLeaderboard");
const navProfile = document.getElementById("navProfile");
const navBrand = document.getElementById("navBrand");
const navWiki = document.getElementById("navWiki");

// ---- Auth / Nav helpers ---- //
let isLoggedIn = false;
function updateAuthUI(loggedIn) {
  isLoggedIn = loggedIn;
  navProfile.classList.toggle("hidden", !loggedIn);
  navLeaderboard.classList.toggle("hidden", !loggedIn);
}
updateAuthUI(false);

navHome.onclick = navBrand.onclick = () => {
  location.href = "/";
};
navLeaderboard.onclick = () => {
  loadLeaderboard();
  show(leaderboardSection);
};
navProfile.onclick = () => {
  loadProfile();
  show(profileSection);
};
navWiki.onclick = () => {
  window.open("/wiki.html", "_blank");
};

function loadLeaderboard() {
  leaderboardSection.innerHTML = "<h2>Leaderboard</h2><p>Loading...</p>";
  apiFetch(`/leaderboard`, { headers: { Authorization: `Basic ${authToken}` } })
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (!data) return (leaderboardSection.innerHTML = "<p>Failed to load.</p>");
      renderLeaderboard(data);
    })
    .catch(() => (leaderboardSection.innerHTML = "<p>Network error.</p>"));
}

function renderLeaderboard(entries) {
  leaderboardSection.innerHTML = `<h2>Top Players</h2>`;
  const container = document.createElement("div");
  entries.forEach(e => {
    const row = document.createElement("div");
    row.className = "leaderboard-entry";
    row.innerHTML = `
      <span><strong>${e.display_name}</strong> <span class="wins-badge">🏆 ${e.wins}</span></span>
      <button class="btn" data-user="${e.username}">Details</button>
    `;
    row.querySelector("button").onclick = async evt => {
      const btn = evt.currentTarget;
      const uname = btn.getAttribute("data-user");
      if (btn._expanded) {
        btn.parentElement.querySelector(".details")?.remove();
        btn.textContent = "Details";
        btn._expanded = false;
        return;
      }
      btn.textContent = "Loading...";
      const res = await apiFetch(`/profile/${uname}`, {
        headers: { Authorization: `Basic ${authToken}` },
      });
      if (!res.ok) {
        btn.textContent = "Details";
        return showToast("Failed to load profile");
      }
      const profile = await res.json();
      const details = document.createElement("div");
      details.className = "details";
      details.style.marginTop = "0.5rem";
      details.innerHTML = Object.entries(profile.role_stats || {})
        .map(([role, rs]) => `<div style="font-size:0.9rem;">${role}: ${rs.wins}W/${rs.losses}L</div>`)
        .join("") || "<em>No role stats</em>";
      btn.parentElement.appendChild(details);
      btn.textContent = "Hide";
      btn._expanded = true;
    };
    container.appendChild(row);
  });
  leaderboardSection.appendChild(container);
}

function loadProfile() {
  profileSection.innerHTML = "<h2>Your Profile</h2><p>Loading...</p>";
  apiFetch(`/profile`, { headers: { Authorization: `Basic ${authToken}` } })
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      if (!data) return (profileSection.innerHTML = "<p>Failed to load profile.</p>");
      renderProfile(data);
    })
    .catch(() => (profileSection.innerHTML = "<p>Network error.</p>"));
}

function renderProfile(p) {
  profileSection.innerHTML = `<h2>Your Profile</h2>`;
  const form = document.createElement("div");
  form.style.maxWidth = "400px";
  form.style.margin = "0 auto";
  form.innerHTML = `
    <label style="display:block;margin-bottom:0.5rem;">Username<br/><input type="text" id="profUsername" value="${p.username}" /></label>
    <label style="display:block;margin-bottom:0.5rem;">Display Name<br/><input type="text" id="profDisplay" value="${p.display_name}" /></label>
    <button class="btn" id="saveProfileBtn">Save</button>
    <hr style="margin:1rem 0;border-color:var(--color-border);"/>
    <p>Total Games: ${p.total_games}</p>
    <p><span class="wins-badge">🏆 ${p.good_wins + p.evil_wins}</span> (${p.good_wins} Good, ${p.evil_wins} Evil wins)</p>
  `;
  profileSection.appendChild(form);
  document.getElementById("saveProfileBtn").onclick = async () => {
    const newUsername = document.getElementById("profUsername").value.trim();
    const newDisplay = document.getElementById("profDisplay").value.trim();

    if (!newUsername) return showToast("Username cannot be empty");
    if (!newDisplay) return showToast("Display name cannot be empty");

    // Build payload with only changed fields
    const payload = {};
    if (newUsername !== p.username) payload.username = newUsername;
    if (newDisplay !== p.display_name) payload.display_name = newDisplay;

    if (!Object.keys(payload).length) {
      return showToast("No changes to save");
    }

    const res = await apiFetch(`/profile`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return showToast("Failed to update profile");
    }

    const updated = await res.json();

    // Display-name change can be handled in-place, username change requires re-login
    if (payload.username) {
      showToast("Username updated. Please log in again.");
      // Clear stored creds so user is redirected to login flow
      redirectHomeWithMessage("Username changed. Please log in with your new credentials.", true);
    } else {
      showToast("Profile updated");
      loadProfile();
    }
  };
}

const _allSections = [authSection, landingSection, lobbySection, gameSection, profileSection, leaderboardSection];

function showAuth(mode = "login") {
  _allSections.forEach(sec => sec.classList.add("hidden"));
  authSection.classList.remove("hidden");
  loginForm.classList.toggle("hidden", mode !== "login");
  signupForm.classList.toggle("hidden", mode !== "signup");
  updateAuthUI(false);
}

function show(section) {
  _allSections.forEach(sec => sec.classList.add("hidden"));
  section.classList.remove("hidden");
  if (section === landingSection) {
    lobbySection.innerHTML = '';
    lobbySection.style.maxHeight = '0px';
    loadRoomList();
    initRoomWebSocket();
  }
}

showLoginBtn.onclick = () => showAuth("login");
showSignupBtn.onclick = () => showAuth("signup");

async function handleLogin() {
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!username || !password) return showToast("Please enter credentials");
  try {
    const res = await apiFetch(`/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      showToast("Login failed");
      return;
    }
    const data = await res.json();
    userId = data.user_id;
    authToken = btoa(`${username}:${password}`);
    localStorage.setItem("userId", userId);
    localStorage.setItem("authToken", authToken);
    updateAuthUI(true);
    authSection.classList.add("hidden");
    if (pendingRoomId) {
      await joinRoom(pendingRoomId);
      pendingRoomId = null;
    } else {
      show(landingSection);
    }
  } catch (err) {
    console.error(err);
    showToast("Network error");
  }
}

async function handleSignup() {
  const username = signupUsername.value.trim();
  const display_name = signupDisplay.value.trim();
  const password = signupPassword.value;
  if (!username || !password || !display_name)
    return showToast("Please fill all fields");
  try {
    const res = await apiFetch(`/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, display_name }),
    });
    if (!res.ok) {
      if (res.status === 400) showToast("Username taken");
      else showToast("Signup failed");
      return;
    }
    const data = await res.json();
    userId = data.user_id;
    authToken = btoa(`${username}:${password}`);
    localStorage.setItem("userId", userId);
    localStorage.setItem("authToken", authToken);
    updateAuthUI(true);
    authSection.classList.add("hidden");
    if (pendingRoomId) {
      await joinRoom(pendingRoomId);
      pendingRoomId = null;
    } else {
      show(landingSection);
    }
  } catch (err) {
    console.error(err);
    showToast("Network error");
  }
}

loginSubmit.onclick = handleLogin;
signupSubmit.onclick = handleSignup;

function redirectHomeWithMessage(msg, clearCreds = false) {
  if (clearCreds) {
    localStorage.removeItem("authToken");
    localStorage.removeItem("userId");
  }
  sessionStorage.setItem("redirectMsg", msg);
  location.href = "/";
}

const passwordModal = document.getElementById("passwordModal");
const passwordInput = document.getElementById("passwordInput");
const createRoomConfirmBtn = document.getElementById("createRoomConfirmBtn");
const createRoomCancelBtn = document.getElementById("createRoomCancelBtn");

// ---- Join Room Modal Elements ---- //
const joinRoomModal = document.getElementById("joinRoomModal");
const joinRoomIdInput = document.getElementById("joinRoomIdInput");
const joinRoomConfirmBtn = document.getElementById("joinRoomConfirmBtn");
const joinRoomCancelBtn = document.getElementById("joinRoomCancelBtn");

// ---- Enter Room Password Modal Elements ---- //
const enterPasswordModal = document.getElementById("enterPasswordModal");
const enterRoomPasswordInput = document.getElementById("enterRoomPasswordInput");
const enterRoomPasswordConfirmBtn = document.getElementById("enterRoomPasswordConfirmBtn");
const enterRoomPasswordCancelBtn = document.getElementById("enterRoomPasswordCancelBtn");

function showJoinRoomModal() {
  joinRoomIdInput.value = "";
  joinRoomModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function hideJoinRoomModal() {
  joinRoomModal.classList.add("hidden");
  document.body.style.overflow = "auto";
}
joinRoomCancelBtn.onclick = hideJoinRoomModal;
joinRoomConfirmBtn.onclick = () => {
  const id = joinRoomIdInput.value.trim();
  if (!id) {
    showToast("Please enter a Room ID");
    return;
  }
  hideJoinRoomModal();
  joinRoom(id);
};

function showCreateRoomModal() {
  passwordInput.value = "";
  passwordModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function hideCreateRoomModal() {
  passwordModal.classList.add("hidden");
  document.body.style.overflow = "auto";
}
createRoomCancelBtn.onclick = hideCreateRoomModal;
createRoomConfirmBtn.onclick = () => {
  const pw = passwordInput.value.trim();
  hideCreateRoomModal();
  createRoom(pw || null);
};

async function createRoom(password = null) {
  show(lobbySection);
  lobbySection.style.padding = '2rem';
  lobbySection.style.maxHeight = '200px';
  lobbySection.innerHTML = `
    <div style="text-align:center;">
      <h2>Creating Room...</h2>
      <div class="loader"></div>
    </div>
  `;

  try {
    const res = await apiFetch(`/rooms`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(password ? { password } : {}),
    });

    if (res.status === 401) {
      redirectHomeWithMessage("Your credentials were invalid.", true);
      return;
    }
    if (res.status === 400) {
      showToast("You already have an active lobby. Reconnecting…");
      show(landingSection);
      return;
    }
    if (!res.ok) throw new Error(`Server responded ${res.status}`);

    const data = await res.json();

    setTimeout(() => {
      ({ room_id: roomId, user_id: userId } = data);
      localStorage.setItem("userId", userId);
      localStorage.setItem("roomId", roomId);
      history.pushState(null, "", `?room=${roomId}`);
      initWebSocket();
    }, 1200);

  } catch (error) {
    showToast("Failed to create room. Please try again.");
    console.error(error);
    show(landingSection);
  }
}


async function joinRoom(id, password = null) {
  show(lobbySection);
  lobbySection.style.padding = '2rem';
  lobbySection.style.maxHeight = '200px';
  lobbySection.innerHTML = `
    <div style="text-align:center;">
      <h2>Joining Room...</h2>
      <div class="loader"></div>
    </div>
  `;

  try {
    const res = await apiFetch(`/rooms/${id}/join`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(password ? { password } : {}),
    });

    if (res.status === 401) {
      redirectHomeWithMessage("Your credentials were invalid.", true);
      return;
    }
    if (res.status === 404) {
      redirectHomeWithMessage(`Room ${id} not found.`, false);
      return;
    }
    if (res.status === 403) {
      show(landingSection);
      if (password) showToast("Incorrect room password");
      showEnterPasswordModal(id);
      return;
    }
    if (res.status === 400 && !res.ok) {
      const err = await res.json().catch(() => null);
      if (err?.detail !== "Already in room") {
        redirectHomeWithMessage(err?.detail || "Failed to join room.", false);
        return;
      }
    }
    const data = res.ok
      ? await res.json()
      : { room_id: id, user_id: userId };
    ({ room_id: roomId, user_id: userId } = data);
    localStorage.setItem("userId", userId);
    localStorage.setItem("roomId", roomId);
    history.pushState(null, "", `?room=${id}`);
    initWebSocket();
  } catch (error) {
    showToast("Failed to join room. Please try again.");
    console.error(error);
    show(landingSection);
  }
}

function initWebSocket() {
  const wsUrl = `${WS_PROTOCOL}://${API_HOST}/ws/${roomId}?auth=${encodeURIComponent(authToken)}`;
  ws = new WebSocket(wsUrl);

  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.type === "state") renderState(msg.data);
    else if (msg.type === "info") {
      privateInfo = msg;
      if (!roleModal.classList.contains("hidden") && window._currentRoleName) {
        const wasRevealed = !roleImgEl.classList.contains("blurred");
        showRoleModal(window._currentRoleName, roleImgEl.src);
        if (wasRevealed) {
          roleImgEl.classList.remove("blurred");
          roleExtraContainer.classList.remove("hidden");
          toggleBlurBtn.textContent = "Hide";
        }
      }
    }
    else if (msg.type === "quest_result") showQuestModal(msg.data);
    else if (msg.type === "kicked") handleKick(msg);
    else if (msg.type === "pause") handlePause(msg);
    else if (msg.type === "assassination_tie") {
      _assassinationVoted = false;
      showToast(`Tie vote among: ${msg.candidates.join(", ")}. Revote!`);
    }
    else if (msg.type === "lady_result") {
      showToast(`${msg.target} is ${msg.loyalty.toUpperCase()}`);
      _ladyChosen = false; // reset for next holder when token passes
    }
    else if (msg.type === "lady_inspect") {
      // Globally announce who inspected whom using the Lady of the Lake
      showToast(`${msg.inspector} inspected ${msg.target} with the Lady of the Lake`);
    }
  };

  ws.onclose = event => {
    if (event.code === 4001)
      return redirectHomeWithMessage("Your credentials were invalid.", true);
    if (event.code === 4002)
      return redirectHomeWithMessage("Room connection was invalid.", false);
    if (event.code === 4003) {
      showToast(
        "Connection closed – this tab is paused because another one is active."
      );
      return;
    }
    showToast("Disconnected. Attempting to reconnect...");
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = () => {
    showToast("WebSocket connection error.", "danger");
  };
}

function handleKick(msg) {
  if (msg.reason === "Logged in elsewhere") {
    showToast(
      "This tab has been paused because you opened the game in another window."
    );
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close(4003, "Superseded by another tab");
    }
  } else if (msg.target === userId) {
    alert("You have been kicked from the room by the host.");
    localStorage.removeItem("userId");
    localStorage.removeItem("roomId");
    setTimeout(() => (location.href = "/"), 5000);
  }
}

// Global flags
window._roleInitDone = false; // indicates new game role initialization handled on this client

// ---- NEW: Assassination state helpers reset on lobby ---- //
// Whenever we transition back to the lobby we clear any client-side assassination flags so that
// the next game starts with a clean slate. These variables are defined above but may retain their
// previous value across play-again flows within the same page session.
if (!window._resetAvalonHelpers) {
  window._resetAvalonHelpers = function () {
    _assassinationVoted = false;
    _assassinCandidatesKey = "";
    _ladyChosen = false;
  };
}

function renderState(state) {
  // Track whether the current user is the host for conditional UI controls
  window._isHost = state.host_id === userId;

  // Reset the init flag whenever we go back to lobby (pre-game)
  if (state.phase === "lobby") {
    window._roleInitDone = false;
    // Clear per-round helper flags so next game starts clean
    if (typeof window._resetAvalonHelpers === "function") {
      window._resetAvalonHelpers();
    }
  }
  if (state.phase === "lobby") renderLobby(state);
  else renderGame(state);
}

function renderLobby(state) {
  // Always ensure the lobby section is displayed when in lobby phase
  show(lobbySection);

  const isFirstRender = !lobbySection.querySelector('#playerList');

  if (isFirstRender) {
    roleContainer.innerHTML = "";
    window._roleShown = false;
    window._currentRoleName = undefined;
    roleModal.classList.add("hidden");
    document.body.style.overflow = "auto";

    const lobbyHTML = `
      <div class="header-row">
        <h2>Room <span id="roomIdDisplay"></span></h2>
        <button class="btn" id="shareBtn">Copy Link</button>
      </div>
      <div class="qr-code-wrapper">
        <p>Scan to join on another device</p>
        <div id="qrContainer"></div>
      </div>
      <ul id="playerList" class="player-list"></ul>
      <div id="configOptions"></div>
      <div style="text-align: center; margin-top: 1.5rem;">
        <p id="startRequirement" class="hidden" style="color: var(--color-text-secondary); font-style: italic;">At least 5 players are needed to start.</p>
        <button class="btn" id="readyBtn">Ready</button>
        <button class="btn hidden" id="startGameBtn">Start Game</button>
      </div>
    `;
    lobbySection.innerHTML = lobbyHTML;

    const roomIdDisplay = document.getElementById("roomIdDisplay");
    roomIdDisplay.textContent = state.room_id;
    setTimeout(() => {
      roomIdDisplay.classList.add("populated");
    }, 10);

    document.getElementById("shareBtn").onclick = () => {
      const shareLink = `${location.origin}?room=${roomId}`;
      navigator.clipboard.writeText(shareLink);
      showToast("Room link copied!");
    };
    document.getElementById("readyBtn").onclick = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "toggle_ready" }));
      }
    };
    document.getElementById("startGameBtn").onclick = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "start_game" }));
      }
    };
  }

  const roomIdDisplay = document.getElementById("roomIdDisplay");
  const playerList = document.getElementById("playerList");
  const readyBtn = document.getElementById("readyBtn");
  const startGameBtn = document.getElementById("startGameBtn");
  const startRequirement = document.getElementById("startRequirement");

  roomIdDisplay.textContent = state.room_id;

  playerList.innerHTML = "";
  state.players.forEach(p => {
    const li = document.createElement("li");
    const nameSpan = document.createElement("span");
    nameSpan.className = "player-name";
    nameSpan.textContent = p.name;
    if (p.user_id === state.host_id) {
      nameSpan.innerHTML = `<span class="host-indicator">★</span>${nameSpan.innerHTML}`;
    }
    const winsSpan = document.createElement("span");
    winsSpan.className = "wins-badge";
    winsSpan.textContent = `🏆 ${p.wins}`;
    nameSpan.appendChild(winsSpan);
    const statusIndicator = document.createElement("span");
    statusIndicator.className = "status-indicator";
    const statusDot = document.createElement("span");
    statusDot.className = p.ready ? "status-dot ready" : "status-dot not-ready";
    const statusText = document.createElement("span");
    statusText.textContent = p.ready ? "Ready" : "Not Ready";
    statusIndicator.append(statusDot, statusText);
    li.appendChild(nameSpan);
    if (state.host_id === userId && p.user_id !== userId) {
      const kickBtn = document.createElement("button");
      kickBtn.textContent = "Kick";
      kickBtn.className = "btn btn-danger";
      kickBtn.style.margin = 0;
      kickBtn.style.padding = "0.3rem 0.8rem";
      kickBtn.onclick = () => ws.send(JSON.stringify({ type: "kick", target: p.user_id }));
      li.appendChild(kickBtn);
    }
    li.appendChild(statusIndicator);
    playerList.appendChild(li);
  });

  const meReady = state.players.find(p => p.user_id === userId).ready;
  readyBtn.textContent = meReady ? "Unready" : "Ready";
  readyBtn.classList.toggle("btn-danger", meReady);
  readyBtn.classList.toggle("btn-success", !meReady);
  
  startRequirement.classList.toggle('hidden', state.players.length >= 5);

  if (state.host_id === userId) {
    startGameBtn.classList.remove("hidden");
    const canStart =
      state.players.every(p => p.ready) &&
      state.players.length >= 5 &&
      state.players.length <= 10;
    startGameBtn.disabled = !canStart;
  } else {
    startGameBtn.classList.add("hidden");
  }

  renderConfigOptions(state);
  renderQRCode(state.room_id);

  // When lobby content is rendered, we animate its height.
  // Using a timeout ensures that the browser has calculated the layout
  // and `scrollHeight` will be accurate. This prevents the animation from
  // cutting off content like the 'Ready' button.
  setTimeout(() => {
    const finalHeight = lobbySection.scrollHeight;
    lobbySection.style.maxHeight = `${finalHeight}px`;

    // NEW: After the opening animation completes, remove the max-height
    // constraint so any further dynamic content (e.g., images loading or
    // config changes) can expand naturally and keep the Ready button visible.
    setTimeout(() => {
      lobbySection.style.maxHeight = "none";
      lobbySection.style.overflow = "visible"; // allow growth afterwards
    }, 700); // 0.6s transition + small buffer
  }, 50);
}


/**
 * ---- MODIFIED FUNCTION ----
 * Renders the configuration options using a more visual, image-based UI.
 * Handles enabling/disabling roles and selecting rounds for the Lady of the Lake.
 * @param {object} state - The current game state from the server.
 */
function renderConfigOptions(state) {
  const configDiv = document.getElementById("configOptions");
  configDiv.innerHTML = ""; // Clear previous content

  const isHost = state.host_id === userId;
  const cfg = state.config;
  const isOberonAvailable = state.players.length >= 7;

  // --- Main container ---
  const container = document.createElement("div");
  container.className = "config-options-container";

  // --- Header ---
  const header = document.createElement("div");
  header.className = "config-header";
  header.innerHTML = "<h4>Optional Roles</h4>";
  if (!isOberonAvailable) {
    header.innerHTML += `<p style="font-size:0.9rem; color:var(--color-text-secondary);">Oberon requires 7+ players.</p>`;
  }
  container.appendChild(header);

  // --- Role cards container ---
  const body = document.createElement("div");
  body.className = "config-body";
  container.appendChild(body);

  const options = [
    {
      key: "mp",
      name: "Morgana & Percival",
      img: "/images/morgana.png", // Using Morgana to represent the pair
      enabled: cfg.morgana && cfg.percival,
      available: true,
    },
    {
      key: "oberon",
      name: "Oberon",
      img: "/images/oberon.png",
      enabled: cfg.oberon,
      available: isOberonAvailable,
    },
    {
      key: "lady",
      name: "Lady of the Lake",
      img: "/images/ladyofthelake.png",
      enabled: cfg.lady_enabled,
      available: true,
    },
  ];

  options.forEach(opt => {
    const card = document.createElement("div");
    card.className = "config-option-card";
    card.title = `${opt.name} (${opt.enabled ? "Enabled" : "Disabled"})`;

    card.classList.toggle("enabled", opt.enabled);
    card.classList.toggle("disabled", !opt.enabled);
    card.classList.toggle("unavailable", !opt.available);
    card.classList.toggle("clickable", isHost && opt.available);

    // Determine wiki URL for info icon
    const wikiUrl = (() => {
      if (opt.key === "mp") return "/wiki.html?item=morgana,percival";
      if (opt.key === "oberon") return "/wiki.html?item=oberon";
      if (opt.key === "lady") return "/wiki.html?item=ladyofthelake";
      return "/wiki.html";
    })();

    // Custom markup for Morgana & Percival pair – show both images
    if (opt.key === "mp") {
      card.classList.add("dual");
      card.innerHTML = `
        <div class="dual-img-wrapper">
          <img src="/images/morgana.png" alt="Morgana">
          <img src="/images/percival.png" alt="Percival">
        </div>
        <div class="overlay-icon"></div>
        <span class="info-icon" title="Open Wiki">?</span>
        <span class="character-name-tooltip">${opt.name}</span>
      `;
    } else {
      card.innerHTML = `
        <img src="${opt.img}" alt="${opt.name}">
        <div class="overlay-icon"></div>
        <span class="info-icon" title="Open Wiki">?</span>
        <span class="character-name-tooltip">${opt.name}</span>
      `;
    }

    // --- Info icon click (opens wiki) --- //
    card.querySelector(".info-icon").onclick = evt => {
      evt.preventDefault();
      evt.stopPropagation();
      window.open(wikiUrl, "_blank");
    };

    if (isHost && opt.available) {
      card.onclick = () => {
        const currentConfig = readConfigFromDOM();
        let newConfig = {};

        if (opt.key === 'mp') newConfig = { ...currentConfig, morgana: !opt.enabled, percival: !opt.enabled };
        else if (opt.key === 'oberon') newConfig = { ...currentConfig, oberon: !opt.enabled };
        else if (opt.key === 'lady') newConfig = { ...currentConfig, lady_enabled: !opt.enabled };

        sendConfig(newConfig);
      };
    }
    body.appendChild(card);
  });

  // --- Lady of the Lake quest selector ---
  const ladySelectorContainer = document.createElement("div");
  ladySelectorContainer.className = "lady-quest-selector-container";
  ladySelectorContainer.classList.toggle("disabled", !cfg.lady_enabled);
  ladySelectorContainer.innerHTML = `<p>Select quests for the Lady to appear after:</p>`;

  const ladySelector = document.createElement("div");
  ladySelector.className = "lady-quest-selector";

  for (let i = 1; i <= 5; i++) {
    const marker = document.createElement("div");
    marker.className = "lady-quest-marker";
    marker.textContent = i;
    marker.dataset.round = i;

    const isSelectable = [2, 3, 4].includes(i);
    const isSelected = cfg.lady_after_rounds?.includes(i);

    marker.classList.toggle("selectable", isSelectable && isHost);
    marker.classList.toggle("unselectable", !isSelectable);
    marker.classList.toggle("selected", isSelected);
    
    if (isSelectable && isHost) {
        marker.onclick = () => {
            const currentConfig = readConfigFromDOM();
            const currentRounds = currentConfig.lady_after_rounds || [];
            const roundNum = parseInt(marker.dataset.round);

            let newRounds;
            if (currentRounds.includes(roundNum)) {
                newRounds = currentRounds.filter(r => r !== roundNum);
            } else {
                newRounds = [...currentRounds, roundNum];
            }
            sendConfig({ ...currentConfig, lady_after_rounds: newRounds });
        };
    }
    ladySelector.appendChild(marker);
  }

  ladySelectorContainer.appendChild(ladySelector);
  container.appendChild(ladySelectorContainer);

  configDiv.appendChild(container);
}

/** Helper to read the current config state from the DOM for sending updates */
function readConfigFromDOM() {
    const options = document.querySelectorAll('.config-option-card');
    const ladyRounds = [...document.querySelectorAll('.lady-quest-marker.selected')]
        .map(el => parseInt(el.dataset.round));

    return {
        morgana: options[0]?.classList.contains('enabled') ?? false,
        percival: options[0]?.classList.contains('enabled') ?? false,
        oberon: options[1]?.classList.contains('enabled') ?? false,
        lady_enabled: options[2]?.classList.contains('enabled') ?? false,
        lady_after_rounds: ladyRounds
    };
}

/** Helper to send the full config state to the server */
function sendConfig(config) {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "set_config", ...config }));
    }
}


function renderQRCode(roomId) {
  const qrContainer = document.getElementById("qrContainer");
  qrContainer.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.id = "qrCanvas";
  qrContainer.appendChild(canvas);
  if (window.QRCode) {
    const url = `${location.origin}?room=${roomId}`;
    QRCode.toCanvas(canvas, url, { width: 128, color: { dark: '#e9e2d4', light: '#0000' } });
  }
}

function renderGame(state) {
  // Handle first render after a brand-new game starts (once per client)
  if (state.round_number === 1 && !window._roleInitDone) {
    roleContainer.innerHTML = "";
    window._roleShown = false;
    window._roleInitDone = true;
  }
  show(gameSection);
  const me = state.players.find(p => p.user_id === userId);

  if (me?.role && roleContainer.childElementCount === 0) {
    const btn = document.createElement("button");
    btn.textContent = "View Your Role";
    btn.className = "btn lg";
    const imgFile = `${me.role.toLowerCase().replace(/ /g, "")}.png`;
    const imgSrc = `/images/${imgFile}`;
    btn.onclick = () => showRoleModal(me.role, imgSrc);
    roleContainer.style.textAlign = "center";
    roleContainer.style.marginTop = "2rem";
    roleContainer.appendChild(btn);
    if (!window._roleShown) {
      showRoleModal(me.role, imgSrc);
      window._roleShown = true;
    }
    // Host-only quick reset button
    if (window._isHost) {
      const resetBtn = document.createElement("button");
      resetBtn.textContent = "Return to Lobby";
      resetBtn.className = "btn btn-danger lg";
      resetBtn.style.marginLeft = "1rem";
      resetBtn.onclick = () => {
        if (confirm("Are you sure you want to reset the game and return to the lobby? All current progress will be lost.")) {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "reset_lobby" }));
          }
        }
      };
      roleContainer.appendChild(resetBtn);
    }
  }

  renderScoreboard(state);
  renderQuestRow(state);
  renderPhaseAndActions(state);
}

function renderScoreboard(state) {
  const scoreboard = document.getElementById("scoreboard");
  scoreboard.innerHTML = `
    <div class="team-score good">
      <span class="team-name">Good</span>
      <span class="score-value">${state.good_wins}</span>
    </div>
    <div class="score-divider">-</div>
    <div class="team-score evil">
      <span class="team-name">Evil</span>
      <span class="score-value">${state.evil_wins}</span>
    </div>
  `;
}

function renderQuestRow(state) {
  const questRow = document.getElementById("questRow");
  questRow.innerHTML = "";
  const leadersArr = state.round_leaders || [];
  for (let i = 1; i <= 5; i++) {
    const card = document.createElement("div");
    card.className = "quest-card";
    const record = state.quest_history.find(q => q.round === i);
    const teamSize = QUEST_SIZES[state.players.length][i - 1];
    const leaderNameGlobal = leadersArr[i - 1] || null;

    if (record) {
      const resultText = record.success ? "Pass" : "Fail";
      card.innerHTML = `
        <div class="quest-circle ${record.success ? "success" : "fail"}">
          <span>${resultText}</span>
        </div>
        <div class="quest-info-toggle"></div>
        <div class="quest-details-content">
          <div class="detail-group"><h5>Result</h5><p>${record.success ? "Success" : "Fail"} (${record.fails} fail${record.fails !== 1 ? "s" : ""})</p></div>
          <div class="detail-group"><h5>Leader</h5><p>${record.leader}</p></div>
          <div class="detail-group"><h5>Team</h5><p>${record.team.join(", ")}</p></div>
        </div>
      `;
      card.onclick = () => showQuestModal(record);
      const toggle = card.querySelector(".quest-info-toggle");
      toggle.onclick = e => {
        e.stopPropagation();
        card.classList.toggle("expanded");
      };
    } else {
      if (i === state.round_number) {
        const leaderName = state.players.find(p => p.user_id === state.current_leader)?.name || "TBD";
        const teamNames = state.current_team.map(id => state.players.find(p => p.user_id === id).name);
        card.innerHTML = `
          <div class="quest-circle current"><span>${teamNames.length || teamSize}</span></div>
          <div class="quest-info-toggle"></div>
          <div class="quest-details-content">
            <div class="detail-group"><h5>Leader</h5><p>${leaderName}</p></div>
            <div class="detail-group"><h5>Team</h5><p>${teamNames.length ? teamNames.join(", ") : "Not selected"}</p></div>
          </div>
        `;
        const toggle = card.querySelector(".quest-info-toggle");
        toggle.onclick = e => {
          e.stopPropagation();
          card.classList.toggle("expanded");
        };
      } else {
        card.innerHTML = `
          <div class="quest-circle"><span>${teamSize}</span></div>
        `;
      }
    }

    const title = document.createElement("h4");
    title.style.margin = "0";
    title.textContent = `Quest ${i}`;
    if (state.round_number === i) {
      title.style.color = "var(--color-accent-primary)";
    }

    const leaderLabel = document.createElement("p");
    leaderLabel.style.margin = "0.2rem 0 0.2rem";
    leaderLabel.style.fontSize = "0.9rem";
    leaderLabel.style.color = "var(--color-text-secondary)";
    leaderLabel.textContent = leaderNameGlobal ? `Leader: ${leaderNameGlobal}` : "Leader: TBD";

    card.prepend(leaderLabel);
    card.prepend(title);
    questRow.appendChild(card);
  }
}

function renderPhaseAndActions(state) {
  phaseContainer.innerHTML = `<h3>Round ${state.round_number
    }</h3><p>${getPhaseDescription(
      state,
      state.players.find(p => p.user_id === userId)
    )}</p>`;

  // NEW: Show current Lady of the Lake holder (if enabled and assigned)
  if (state.config?.lady_enabled && state.lady_holder) {
    const holderName = state.players.find(p => p.user_id === state.lady_holder)?.name || "Unknown";
    phaseContainer.innerHTML += `<p style="font-style:italic; color: var(--color-text-secondary);">Lady of the Lake Holder: <strong>${holderName}</strong></p>`;
  }

  // Show list of evil players to everyone during the assassination phase.
  if (state.phase === "assassination" && Array.isArray(state.evil_players) && state.evil_players.length) {
    const evilList = state.evil_players.join(", ");
    phaseContainer.innerHTML += `<p><strong>Evil Players:</strong> ${evilList}</p>`;
  }

  actionsContainer.innerHTML = "";
  actionsContainer.classList.add("hidden");

  if (state.phase === "finished") {
    renderGameOver(state);
    return;
  }

  switch (state.subphase) {
    case "proposal":
      renderProposalPhase(state);
      break;
    case "voting":
      renderVotingPhase(state);
      break;
    case "quest":
      renderQuestPhase(state);
      break;
    case "lady":
      renderLadyPhase(state);
      break;
    case "assassination":
      renderAssassinationPhase(state);
      break;
  }
}

function renderGameOver(state) {
  phaseContainer.innerHTML = `<h2>Game Over!</h2><p>${state.winner === "good" ? "The Good Team Wins!" : "The Evil Team Wins!"
    }</p>`;
  const grid = document.createElement("div");
  grid.className = "roles-grid";
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(auto-fit,minmax(120px,1fr))";
  grid.style.gap = "0.5rem";
  state.players.forEach(pl => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.textAlign = "center";
    card.innerHTML = `
      <strong>${pl.name}</strong><br/>
      <img src="/images/${pl.role
        .toLowerCase()
        .replace(/ /g, "")}.png" style="max-width:80px;"><br/>
      <span>${pl.role}</span><br/>
      <span class="wins-badge">🏆 ${pl.wins}</span>
    `;
    grid.appendChild(card);
  });
  phaseContainer.appendChild(grid);
  if (state.host_id === userId) {
    const againBtn = document.createElement("button");
    againBtn.textContent = "Play Again";
    againBtn.className = "btn lg";
    againBtn.style.marginTop = "1rem";
    againBtn.onclick = () => ws.send(JSON.stringify({ type: "restart_game" }));
    phaseContainer.appendChild(againBtn);
  }
}

function renderProposalPhase(state) {
  if (state.current_leader !== userId) return;
  actionsContainer.classList.remove("hidden");
  const requiredSize = QUEST_SIZES[state.players.length][
    state.round_number - 1
  ];
  const form = document.createElement("form");
  form.className = "player-selection-form";
  form.innerHTML = state.players
    .map(
      p => `
    <label>
      <input type="checkbox" value="${p.user_id}" name="team">
      <span class="player-option">${p.name}</span>
    </label>
  `
    )
    .join("");
  const submitBtn = document.createElement("button");
  submitBtn.textContent = "Propose Team";
  submitBtn.type = "button";
  submitBtn.className = "btn btn-success";
  submitBtn.disabled = true;
  submitBtn.onclick = () => {
    const checked = [...form.querySelectorAll("input:checked")].map(el =>
      el.value
    );
    if (checked.length !== requiredSize) {
      showToast(`You must select exactly ${requiredSize} players.`);
      return;
    }
    ws.send(JSON.stringify({ type: "propose_team", team: checked }));
  };

  form.addEventListener("change", () => {
    const count = form.querySelectorAll("input:checked").length;
    submitBtn.disabled = count !== requiredSize;
    form.querySelectorAll("input").forEach(cb => {
      cb.disabled = count >= requiredSize && !cb.checked;
    });
  });

  actionsContainer.innerHTML = `<h2>Propose a Team</h2><p>Select ${requiredSize} players for the quest.</p>`;
  actionsContainer.append(form, submitBtn);
}

function renderVotingPhase(state) {
  actionsContainer.classList.remove("hidden");
  const leaderName = state.players.find(
    p => p.user_id === state.proposal_leader
  ).name;
  const teamNames = state.current_team
    .map(id => state.players.find(p => p.user_id === id).name)
    .join(", ");
  actionsContainer.innerHTML = `
    <h2>Vote on the Proposal</h2>
    <p><strong>${leaderName}</strong> has proposed: <strong>${teamNames}</strong></p>
  `;

  // --- Show list of players who still need to vote --- //
  const pending = state.players
    .filter(p => !(p.user_id in state.votes))
    .map(p => p.name);
  if (pending.length) {
    actionsContainer.innerHTML += `<p><em>Waiting on: ${pending.join(", ")}</em></p>`;
  }

  if (!(userId in state.votes)) {
    const btnContainer = document.createElement("div");
    const approveBtn = document.createElement("button");
    approveBtn.textContent = "Approve";
    approveBtn.className = "btn btn-success lg";
    approveBtn.onclick = () =>
      ws.send(JSON.stringify({ type: "vote_team", approve: true }));
    const rejectBtn = document.createElement("button");
    rejectBtn.textContent = "Reject";
    rejectBtn.className = "btn btn-danger lg";
    rejectBtn.onclick = () =>
      ws.send(JSON.stringify({ type: "vote_team", approve: false }));
    btnContainer.append(approveBtn, rejectBtn);
    actionsContainer.appendChild(btnContainer);
  } else {
    actionsContainer.innerHTML += `<p><em>You have voted. Waiting for other players...</em></p>`;
  }
}

function renderQuestPhase(state) {
  // Determine remaining submissions first (used for everyone)
  const remainingIds = state.current_team.filter(id => !(id in state.submissions));
  const remainingNames = remainingIds.map(id => state.players.find(p => p.user_id === id).name);

  // Pre-build helper line showing players who still need to submit
  const pendingLine = remainingNames.length ? `<p><em>Waiting on: ${remainingNames.join(", ")}</em></p>` : "";

  if (state.current_team.includes(userId) && !(userId in state.submissions)) {
    actionsContainer.classList.remove("hidden");
    actionsContainer.innerHTML = `
      <h2>Play Your Card</h2>
      <p>Choose whether the quest will succeed or fail.</p>
      ${pendingLine}
    `;
    const btnContainer = document.createElement("div");
    const successBtn = document.createElement("button");
    successBtn.textContent = "Play Success";
    successBtn.className = "btn btn-success lg";
    successBtn.onclick = () => ws.send(JSON.stringify({ type: "submit_card", card: "S" }));
    const failBtn = document.createElement("button");
    failBtn.textContent = "Play Fail";
    failBtn.className = "btn btn-danger lg";
    const goodRoles = ["Merlin", "Percival", "Loyal Servant of Arthur"];
    const myRole = state.players.find(p => p.user_id === userId).role;
    if (goodRoles.includes(myRole)) {
      // Good players attempting to play a Fail card will just see a warning popup.
      failBtn.onclick = () => showFailAttemptWarning();
    } else {
      failBtn.onclick = () => ws.send(JSON.stringify({ type: "submit_card", card: "F" }));
    }
    btnContainer.append(successBtn, failBtn);
    actionsContainer.appendChild(btnContainer);
  } else {
    // Not on team or already acted – simply show waiting message
    actionsContainer.classList.remove("hidden");
    actionsContainer.innerHTML = `<p><em>Waiting for quest team...</em></p>${pendingLine}`;
  }
}

function renderLadyPhase(state) {
  actionsContainer.classList.remove("hidden");

  const holderName = state.players.find(p => p.user_id === state.lady_holder)?.name || "Someone";

  if (state.lady_holder !== userId) {
    actionsContainer.innerHTML = `<h2>Lady of the Lake</h2><p>${holderName} is using the Lady of the Lake...</p>`;
    return;
  }

  if (_ladyChosen) {
    actionsContainer.innerHTML = `<p><em>Choice submitted. Waiting for server…</em></p>`;
    return;
  }

  const eligible = state.players.filter(p => p.user_id !== userId && !state.lady_history.includes(p.user_id));
  if (!eligible.length) {
    actionsContainer.innerHTML = `<p>No eligible players to inspect.</p>`;
    return;
  }

  const form = document.createElement("form");
  form.className = "player-selection-form";
  form.innerHTML = eligible.map(p => `
    <label>
      <input type="radio" name="lady-target" value="${p.user_id}">
      <span class="player-option">${p.name}</span>
    </label>`).join("");

  const chooseBtn = document.createElement("button");
  chooseBtn.textContent = "Inspect Loyalty";
  chooseBtn.className = "btn btn-success";
  chooseBtn.onclick = () => {
    const target = form.querySelector("input:checked")?.value;
    if (!target) return showToast("Select a target");
    ws.send(JSON.stringify({ type: "lady_choose", target }));
    _ladyChosen = true;
    actionsContainer.innerHTML = `<p><em>Choice submitted. Waiting for result…</em></p>`;
  };

  actionsContainer.innerHTML = `<h2>Lady of the Lake</h2><p>Select a player to reveal their loyalty.</p>`;
  actionsContainer.append(form, chooseBtn);
}

function renderAssassinationPhase(state) {
  const me = state.players.find(p => p.user_id === userId);

  // Gather evil players and determine who still needs to vote
  const evilPlayers = state.players.filter(p => EVIL_ROLES.includes(p.role));
  const pendingNames = evilPlayers
    .filter(p => !(state.assassin_votes && p.user_id in state.assassin_votes))
    .map(p => p.name);

  // ----------------------
  // View for GOOD players
  // ----------------------
  if (!EVIL_ROLES.includes(me.role)) {
    actionsContainer.classList.remove("hidden");
    actionsContainer.innerHTML = pendingNames.length
      ? `<p><em>Waiting on: ${pendingNames.join(", ")}</em></p>`
      : `<p><em>Waiting for evil players...</em></p>`;
    return;
  }

  // ----------------------
  // View for EVIL players
  // ----------------------
  const alreadyVoted = state.assassin_votes && userId in state.assassin_votes;
  actionsContainer.classList.remove("hidden");

  if (alreadyVoted) {
    actionsContainer.innerHTML = `<p><em>Vote submitted. Waiting for other evil players...</em></p>`;
  } else {
    // Build the list of current Merlin candidates
    const candidates = (state.assassin_candidates && state.assassin_candidates.length)
      ? state.assassin_candidates
      : state.players
          .filter(p => !EVIL_ROLES.includes(p.role))
          .map(p => p.user_id);

    const form = document.createElement("form");
    form.className = "player-selection-form";
    form.innerHTML = candidates
      .map(pid => {
        const playerName = state.players.find(p => p.user_id === pid).name;
        return `
        <label>
          <input type="radio" value="${pid}" name="merlin-target">
          <span class="player-option">${playerName}</span>
        </label>`;
      })
      .join("");

    const voteBtn = document.createElement("button");
    voteBtn.textContent = "Vote";
    voteBtn.className = "btn btn-danger";
    voteBtn.onclick = () => {
      const target = form.querySelector("input:checked")?.value;
      if (!target) return showToast("Select a target first");
      ws.send(JSON.stringify({ type: "assassination_vote", target }));
      // UI will refresh with updated state from the server
    };

    actionsContainer.innerHTML = `
      <h2>Decide Merlin's Fate</h2>
      <p>Select the player you believe is <strong>Merlin</strong>.</p>
    `;
    actionsContainer.append(form, voteBtn);
  }

  // Standard "waiting on" list (same pattern as other phases)
  if (pendingNames.length) {
    const waitingMsg = document.createElement("p");
    waitingMsg.innerHTML = `<em>Waiting on: ${pendingNames.join(", ")}</em>`;
    actionsContainer.appendChild(waitingMsg);
  }
}

function getPhaseDescription(state, me) {
  const leaderName =
    state.players.find(p => p.user_id === state.current_leader)?.name ||
    "Someone";
  switch (state.subphase || state.phase) {
    case "proposal":
      return `${leaderName} is proposing a team.`;
    case "voting":
      return "Everyone is voting on the proposed team.";
    case "quest":
      return "The team is on the quest. Waiting for their decision...";
    case "lady":
      if (state.lady_holder === me.user_id) return "Use the Lady of the Lake to inspect a player";
      const holder = state.players.find(p => p.user_id === state.lady_holder)?.name || "Someone";
      return `${holder} is using the Lady of the Lake…`;
    case "assassination":
      return EVIL_ROLES.includes(me.role)
        ? "Vote on who Merlin is…"
        : "Evil team is deciding who Merlin is…";
    default:
      return "The game is afoot!";
  }
}

createRoomBtn.onclick = showCreateRoomModal;
if (joinRoomBtn) joinRoomBtn.classList.add("hidden");

window.addEventListener("load", async () => {
  const redirectMsg = sessionStorage.getItem("redirectMsg");
  if (redirectMsg) {
    showToast(redirectMsg);
    sessionStorage.removeItem("redirectMsg");
  }
  const params = new URLSearchParams(location.search);
  pendingRoomId = params.get("room")?.trim() || null;
  authToken = localStorage.getItem("authToken");
  userId = localStorage.getItem("userId");

  let credsValid = false;
  if (authToken && userId) {
    try {
      const res = await apiFetch(`/profile`, { headers: { Authorization: `Basic ${authToken}` } });
      if (res.ok) {
        const prof = await res.json();
        userId = prof.user_id;
        localStorage.setItem("userId", userId);
        credsValid = true;
      }
    } catch (err) {
      credsValid = false;
    }
  }

  if (!credsValid) {
    localStorage.removeItem("authToken");
    localStorage.removeItem("userId");
    authToken = null;
    userId = null;
    updateAuthUI(false);
    showAuth("login");
    return;
  }

  updateAuthUI(true);
  if (pendingRoomId) {
    await joinRoom(pendingRoomId);
    pendingRoomId = null;
  } else {
    show(landingSection);
  }
});

function showToast(message) {
  const div = document.createElement("div");
  div.className = "toast";
  div.textContent = message;
  toastContainer.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

function showRoleModal(roleName, imgSrc) {
  roleImgEl.src = imgSrc;
  roleImgEl.alt = `${roleName} card`;
  if (roleTitleEl) {
    roleTitleEl.textContent = roleName;
    roleTitleEl.classList.add("hidden");
  }
  roleImgEl.classList.add("blurred");
  roleModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  toggleBlurBtn.textContent = "Reveal";
  roleExtraContainer.classList.remove("populated");
  roleExtraContainer.classList.add("hidden");

  toggleBlurBtn.onclick = () => {
    const isBlurred = roleImgEl.classList.toggle("blurred");
    toggleBlurBtn.textContent = isBlurred ? "Reveal" : "Hide";
    if (roleTitleEl) {
      roleTitleEl.classList.toggle("hidden", isBlurred);
    }
    roleExtraContainer.classList.toggle("hidden", isBlurred);
  };
  closeRoleBtn.onclick = () => {
    roleModal.classList.add("hidden");
    document.body.style.overflow = "auto";
  };

  const keyToTitleMap = {
    evil: "Your fellow minions of Mordred",
    merlin_knows: "You see these players as Evil",
    percival_knows: "You see these players as Merlin or Morgana",
  };
  const allowedKeysByRole = {
    Merlin: ["merlin_knows"],
    Percival: ["percival_knows"],
    Morgana: ["evil"],
    "Minion of Mordred": ["evil"],
    Mordred: ["evil"],
  };
  const keysToShow = allowedKeysByRole[roleName] || [];

  window._currentRoleName = roleName;

  if (privateInfo) {
    const infoHTML = keysToShow
      .filter(key => privateInfo[key]?.length)
      .map(key => {
        const title = keyToTitleMap[key] || key.replace(/_/g, " ");
        const names = Array.isArray(privateInfo[key])
          ? privateInfo[key].join(", ")
          : privateInfo[key];
        return `<div class="role-info-group"><h4>${title}</h4><p>${names}</p></div>`;
      })
      .join("");
    if (infoHTML) {
      roleExtraContainer.innerHTML = infoHTML;
      roleExtraContainer.classList.add("populated");
    }
  }

  if (GAME_DETAILS && GAME_DETAILS.roles && GAME_DETAILS.roles[roleName]) {
    const r = GAME_DETAILS.roles[roleName];
    const staticHTML = `
      <div class="role-info-group"><h4>Team</h4><p>${r.team}</p></div>
      <div class="role-info-group"><h4>Objective</h4><p>${GAME_DETAILS.gameInfo[`${r.team.toLowerCase()}TeamObjective`]}</p></div>
      <div class="role-info-group"><h4>Description</h4><p>${r.description}</p></div>
      <div class="role-info-group"><h4>Ability</h4><p>${r.ability}</p></div>
      <div class="role-info-group"><h4>Guidelines</h4><p>${r.guidelines}</p></div>
    `;
    if (!roleExtraContainer.classList.contains("populated")) {
      roleExtraContainer.innerHTML = staticHTML;
    } else {
      roleExtraContainer.innerHTML += staticHTML;
    }
    roleExtraContainer.classList.add("populated");
  }
}

const questModal = document.getElementById("questModal");
const questModalContent = document.getElementById("questModalContent");

function showQuestModal(record) {
  const approves = Object.keys(record.votes).filter(n => record.votes[n]);
  const rejects = Object.keys(record.votes).filter(n => !record.votes[n]);
  questModalContent.innerHTML = `
    <h2>Quest ${record.round} Result</h2>
    <h3>Quest ${record.success ? "Succeeded" : "Failed"}</h3>
    <p>There were <strong>${record.fails}</strong> fail card${record.fails !== 1 ? "s" : ""
    } played.</p>
    <hr style="border-color: var(--color-border); margin: 1rem 0;">
    <p><strong>Leader:</strong> ${record.leader}</p>
    <p><strong>Proposed Team:</strong> ${record.team.join(", ")}</p>
    <p><strong style="color: var(--color-accent-success);">Approved (${approves.length
    }):</strong> ${approves.join(", ") || "None"}</p>
    <p><strong style="color: var(--color-accent-danger);">Rejected (${rejects.length
    }):</strong> ${rejects.join(", ") || "None"}</p>
    <button class="btn" id="closeQuestBtn">Close</button>
  `;
  questModal.classList.remove("hidden");
  document.getElementById("closeQuestBtn").onclick = () =>
    questModal.classList.add("hidden");
}

async function loadRoomList() {
  const container = document.getElementById("roomListContainer");
  if (!container) return;
  container.innerHTML = "<p>Loading rooms...</p>";
  try {
    const headers = {};
    if (authToken) headers["Authorization"] = `Basic ${authToken}`;
    const res = await apiFetch(`/rooms`, { headers });
    if (!res.ok) {
      container.innerHTML = `<p>Failed to load rooms.</p>`;
      return;
    }
    const rooms = await res.json();
    renderRoomList(rooms);
  } catch (err) {
    container.innerHTML = `<p>Network error.</p>`;
  }
}

function renderRoomList(rooms) {
  const container = document.getElementById("roomListContainer");
  container.innerHTML = "";
  if (!rooms.length) {
    container.innerHTML = "<p>No active rooms at the moment.</p>";
    createRoomBtn.classList.remove("hidden");
    createRoomBtn.textContent = "Create Room";
    createRoomBtn.onclick = showCreateRoomModal;
    if (joinRoomBtn) joinRoomBtn.classList.remove("hidden");
    if (joinRoomBtn) joinRoomBtn.textContent = "Join Room Via ID";
    return;
  }
  const myRooms = rooms.filter(l => l.member);
  const myHostRooms = myRooms.filter(r => r.host_id === userId);
  const myOtherRooms = myRooms.filter(r => r.host_id !== userId);
  const otherRooms = rooms.filter(l => !l.member && l.phase === "lobby");

  function createSection(title, list) {
    if (!list.length) return;
    const section = document.createElement("div");
    section.style.marginBottom = "1rem";
    section.innerHTML = `<h3 style="margin:0 0 0.5rem;">${title}</h3>`;
    list.forEach(l => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.borderBottom = "1px solid var(--color-border)";
      row.style.padding = "0.5rem 0";
      const info = document.createElement("span");
      const playerLabel = l.player_count === 1 ? "player" : "players";
      info.textContent = `${l.host_name} (${l.player_count} ${playerLabel})`;
      const joinBtn = document.createElement("button");
      joinBtn.className = "btn";
      const isMember = l.member;
      joinBtn.textContent = isMember || l.host_id === userId ? "Reconnect" : "Enter";
      joinBtn.onclick = () => {
        if (isMember || l.phase === "lobby") {
          // allow reconnect or enter lobby
          if (l.requires_password && !isMember && l.host_id !== userId) {
            showEnterPasswordModal(l.room_id);
          } else {
            joinRoom(l.room_id);
          }
        }
      };
      row.append(info, joinBtn);
      section.appendChild(row);
    });
    container.appendChild(section);
  }

  createSection("My Room", myHostRooms);
  createSection("Disconnected from", myOtherRooms);
  createSection("Open Rooms", otherRooms);

  const ownsRoom = myHostRooms.length > 0;
  const ownsBusyRoom = myHostRooms.some(r => r.player_count > 1);

  if (ownsRoom) {
    if (ownsBusyRoom) {
      createRoomBtn.classList.add("hidden");
    } else {
      createRoomBtn.classList.remove("hidden");
      createRoomBtn.textContent = "Reconnect to your own room";
      createRoomBtn.onclick = () => joinRoom(myHostRooms[0].room_id);
    }
  } else {
    createRoomBtn.classList.remove("hidden");
    createRoomBtn.textContent = "Create Room";
    createRoomBtn.onclick = showCreateRoomModal;
  }

  if (joinRoomBtn) {
    joinRoomBtn.classList.add("hidden");
  }
}

function initRoomWebSocket() {
  if (roomWs && roomWs.readyState !== WebSocket.CLOSED) return;
  const wsUrl = `${WS_PROTOCOL}://${API_HOST}/lobbies_ws${authToken ? `?auth=${encodeURIComponent(authToken)}` : ""}`;
  roomWs = new WebSocket(wsUrl);
  roomWs.onmessage = event => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "lobbies" && Array.isArray(msg.data)) {
        renderRoomList(msg.data);
      }
    } catch (e) { /* ignore parse errors */ }
  };
  roomWs.onclose = () => {
    setTimeout(initRoomWebSocket, 3000);
  };
  roomWs.onerror = () => {};
}

// ---- Enter Password Modal Helpers ---- //
let _pendingRoomIdForPassword = null;
function showEnterPasswordModal(roomId) {
  _pendingRoomIdForPassword = roomId;
  enterRoomPasswordInput.value = "";
  enterPasswordModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  enterRoomPasswordInput.focus();
}

function hideEnterPasswordModal() {
  enterPasswordModal.classList.add("hidden");
  document.body.style.overflow = "auto";
}

enterRoomPasswordCancelBtn.onclick = hideEnterPasswordModal;
enterRoomPasswordConfirmBtn.onclick = () => {
  const pw = enterRoomPasswordInput.value.trim();
  if (!pw) {
    showToast("Please enter a password");
    return;
  }
  hideEnterPasswordModal();
  if (_pendingRoomIdForPassword) {
    joinRoom(_pendingRoomIdForPassword, pw);
  }
};

// ---- Pause / Resume Handling ---- //
const pauseModal = document.getElementById("pauseModal");
const pauseModalContent = document.getElementById("pauseModalContent");
function handlePause(msg) {
  const players = msg.players || [];
  if (players.length) {
    let html = `<h2>Game Paused</h2><p>Waiting for <strong>${players.join(", ")}</strong> to reconnect…</p>`;
    if (window._isHost) {
      html += `<button class="btn btn-danger" id="pauseResetBtn" style="margin-top:1rem;">Return to Lobby</button>`;
    }
    pauseModalContent.innerHTML = html;
    if (window._isHost) {
      document.getElementById("pauseResetBtn").onclick = () => {
        if (confirm("Reset the game and return to lobby?")) {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "reset_lobby" }));
          }
        }
      };
    }
    pauseModal.classList.remove("hidden");
  } else {
    pauseModal.classList.add("hidden");
  }
}

// ---- NEW: Warning popup when good player attempts to fail ---- //
function showFailAttemptWarning() {
  let modal = document.getElementById("goodFailModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "goodFailModal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modal-content card" style="text-align:center;">
        <h2>Why the hell are you trying to fail the quest?</h2>
        <button class="btn" id="goodFailDismissBtn">My Bad</button>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector("#goodFailDismissBtn").onclick = () => {
      modal.classList.add("hidden");
      document.body.style.overflow = "auto";
    };
  }
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}