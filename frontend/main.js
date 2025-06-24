/* global localStorage, location, fetch, WebSocket */

const API_BASE = ""; // same origin

let roomId = null;
let userId = null;
let authToken = null; // base64(username:password)
let ws = null;
let roomWs = null; // websocket for room list updates

// DOM Elements
const landingSection = document.getElementById("landing");
const lobbySection = document.getElementById("lobby");
const gameSection = document.getElementById("game");
const roomIdDisplay = document.getElementById("roomIdDisplay");
const playerList = document.getElementById("playerList");
const readyBtn = document.getElementById("readyBtn");
const startGameBtn = document.getElementById("startGameBtn");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const continueBtn = { onclick: () => { } };
const roleContainer = document.getElementById("roleContainer");
const phaseContainer = document.getElementById("phaseContainer");
const actionsContainer = document.getElementById("actionsContainer");
const toastContainer = document.getElementById("toastContainer");
const roleModal = document.getElementById("roleModal");
const roleImgEl = document.getElementById("roleImg");
const toggleBlurBtn = document.getElementById("toggleBlurBtn");
const closeRoleBtn = document.getElementById("closeRoleBtn");
const roleExtraContainer = document.getElementById("roleExtra");

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
fetch("/game-details.json")
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

// ---- Auth / Nav helpers ---- //
let isLoggedIn = false;
function updateAuthUI(loggedIn) {
  isLoggedIn = loggedIn;
  // Hide or show the Profile and Leaderboard links depending on auth status
  navProfile.classList.toggle("hidden", !loggedIn);
  navLeaderboard.classList.toggle("hidden", !loggedIn);
}
// Hide profile link by default until we validate stored credentials
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

function loadLeaderboard() {
  leaderboardSection.innerHTML = "<h2>Leaderboard</h2><p>Loading...</p>";
  fetch(`/leaderboard`, { headers: { Authorization: `Basic ${authToken}` } })
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
      const res = await fetch(`/profile/${uname}`, {
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
  fetch(`/profile`, { headers: { Authorization: `Basic ${authToken}` } })
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
    <label style="display:block;margin-bottom:0.5rem;">Username<br/><input type="text" id="profUsername" value="${p.username}" disabled /></label>
    <label style="display:block;margin-bottom:0.5rem;">Display Name<br/><input type="text" id="profDisplay" value="${p.display_name}" /></label>
    <button class="btn" id="saveProfileBtn">Save</button>
    <hr style="margin:1rem 0;border-color:var(--color-border);"/>
    <p>Total Games: ${p.total_games}</p>
    <p><span class="wins-badge">🏆 ${p.good_wins + p.evil_wins}</span> (${p.good_wins} Good, ${p.evil_wins} Evil wins)</p>
  `;
  profileSection.appendChild(form);
  document.getElementById("saveProfileBtn").onclick = async () => {
    const newDisplay = document.getElementById("profDisplay").value.trim();
    if (!newDisplay) return showToast("Display name cannot be empty");
    const res = await fetch(`/profile`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authToken}`,
      },
      body: JSON.stringify({ display_name: newDisplay }),
    });
    if (res.ok) {
      showToast("Profile updated");
      loadProfile();
    } else {
      showToast("Failed to update profile");
    }
  };
}

// ---- MODIFY EXISTING showAuth and show to include new sections ----
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
    const res = await fetch(`/login`, {
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
    const res = await fetch(`/signup`, {
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

async function createRoom() {
  const password = prompt("Set a password for this lobby (optional):");
  try {
    const res = await fetch(`/rooms`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: password || undefined }),
    });
    if (res.status === 401) {
      redirectHomeWithMessage("Your credentials were invalid.", true);
      return;
    }
    if (res.status === 400) {
      // User already owns a lobby – prompt them to reconnect
      showToast("You already have an active lobby. Reconnecting …");
      loadRoomList();
      return;
    }
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();
    ({ room_id: roomId, user_id: userId } = data);
    localStorage.setItem("userId", userId);
    localStorage.setItem("roomId", roomId);
    history.pushState(null, "", `?room=${roomId}`);
    initWebSocket();
    show(lobbySection);
  } catch (error) {
    showToast("Failed to create room. Please try again.");
    console.error(error);
  }
}

async function joinRoom(id, password = null) {
  try {
    const res = await fetch(`/rooms/${id}/join`, {
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
      showToast("Incorrect room password");
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
    history.pushState(null, "", `?room=${roomId}`);
    initWebSocket();
    show(lobbySection);
  } catch (error) {
    showToast("Failed to join room. Please try again.");
    console.error(error);
  }
}

function initWebSocket() {
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host
    }/ws/${roomId}?auth=${encodeURIComponent(authToken)}`;
  ws = new WebSocket(wsUrl);

  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.type === "state") renderState(msg.data);
    else if (msg.type === "info") {
      privateInfo = msg;
      // If role modal already visible, re-render its private-info section
      if (!roleModal.classList.contains("hidden") && window._currentRoleName) {
        const wasRevealed = !roleImgEl.classList.contains("blurred");
        showRoleModal(window._currentRoleName, roleImgEl.src);
        if (wasRevealed) {
          // Keep it revealed after refresh
          roleImgEl.classList.remove("blurred");
          roleExtraContainer.classList.remove("hidden");
          toggleBlurBtn.textContent = "Hide";
        }
      }
    }
    else if (msg.type === "quest_result") showQuestModal(msg.data);
    else if (msg.type === "kicked") handleKick(msg);
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

function renderState(state) {
  if (state.phase === "lobby") renderLobby(state);
  else renderGame(state);
}

function renderLobby(state) {
  // ---- Reset any previous game role/UI state ----
  roleContainer.innerHTML = "";          // remove old "View Your Role" button, etc.
  window._roleShown = false;              // allow automatic role popup next game
  window._currentRoleName = undefined;    // clear cached role reference
  roleModal.classList.add("hidden");     // make sure any role modal is closed
  document.body.style.overflow = "auto"; // restore scrolling if modal was open

  show(lobbySection);
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
    statusDot.className = p.ready
      ? "status-dot ready"
      : "status-dot not-ready";
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
      kickBtn.onclick = () =>
        ws.send(JSON.stringify({ type: "kick", target: p.user_id }));
      li.appendChild(kickBtn);
    }
    li.appendChild(statusIndicator);
    playerList.appendChild(li);
  });

  const meReady = state.players.find(p => p.user_id === userId).ready;
  readyBtn.textContent = meReady ? "Unready" : "Ready";
  readyBtn.classList.toggle("btn-danger", meReady);
  readyBtn.classList.toggle("btn-success", !meReady);

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
}

function renderConfigOptions(state) {
  const configDiv = document.getElementById("configOptions");
  configDiv.innerHTML = "";
  const isHost = state.host_id === userId;
  const cfg = state.config;
  const requires7 = state.players.length < 7;

  const container = document.createElement("div");
  container.className = "config-options-container";

  const header = document.createElement("div");
  header.className = "config-header";
  header.innerHTML = "<h4>Optional Roles</h4>";
  if (requires7) {
    header.innerHTML +=
      "<p>Morgana, Percival, and Oberon require 7+ players.</p>";
  }

  const body = document.createElement("div");
  body.className = "config-body";

  const mpLabel = document.createElement("label");
  const mpCheckbox = document.createElement("input");
  mpCheckbox.type = "checkbox";
  mpCheckbox.checked = cfg.morgana && cfg.percival;
  mpCheckbox.disabled = !isHost || requires7;
  mpLabel.append(mpCheckbox, " Morgana & Percival");

  const obLabel = document.createElement("label");
  const obCheckbox = document.createElement("input");
  obCheckbox.type = "checkbox";
  obCheckbox.checked = cfg.oberon;
  obCheckbox.disabled = !isHost || requires7;
  obLabel.append(obCheckbox, " Oberon");

  body.append(mpLabel, obLabel);
  container.append(header, body);
  configDiv.appendChild(container);

  function sendConfig() {
    ws.send(
      JSON.stringify({
        type: "set_config",
        morgana: mpCheckbox.checked,
        percival: mpCheckbox.checked,
        oberon: obCheckbox.checked,
      })
    );
  }

  if (isHost && !requires7) {
    mpCheckbox.addEventListener("change", sendConfig);
    obCheckbox.addEventListener("change", sendConfig);
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
    QRCode.toCanvas(canvas, url, { width: 128 });
  }
}

function renderGame(state) {
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
  for (let i = 1; i <= 5; i++) {
    const card = document.createElement("div");
    card.className = "quest-card";
    const record = state.quest_history.find(q => q.round === i);
    const teamSize = QUEST_SIZES[state.players.length][i - 1];

    if (record) {
      const resultText = record.success ? "Pass" : "Fail";
      card.innerHTML = `
        <div class="quest-circle ${record.success ? "success" : "fail"}">
          <span>${resultText}</span>
        </div>
        <div class="quest-info-toggle"></div>
        <div class="quest-details-content">
          <div class="detail-group"><h5>Result</h5><p>${record.success ? "Success" : "Fail"
        } (${record.fails} fail${record.fails !== 1 ? "s" : ""})</p></div>
          <div class="detail-group"><h5>Leader</h5><p>${record.leader}</p></div>
          <div class="detail-group"><h5>Team</h5><p>${record.team.join(
          ", "
        )}</p></div>
        </div>
      `;
      card.onclick = () => showQuestModal(record);
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

    const title = document.createElement("h4");
    title.style.margin = "0";
    title.textContent = `Quest ${i}`;
    if (state.round_number === i) {
      title.style.color = "var(--color-accent-primary)";
    }
    card.appendChild(title);
    questRow.appendChild(card);
  }
}

function renderPhaseAndActions(state) {
  phaseContainer.innerHTML = `<h3>Round ${state.round_number
    }</h3><p>${getPhaseDescription(
      state,
      state.players.find(p => p.user_id === userId)
    )}</p>`;
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
  if (!state.current_team.includes(userId)) return;
  if (userId in state.submissions) return;
  actionsContainer.classList.remove("hidden");
  actionsContainer.innerHTML = `
    <h2>Play Your Card</h2>
    <p>Choose whether the quest will succeed or fail.</p>
  `;
  const btnContainer = document.createElement("div");
  const successBtn = document.createElement("button");
  successBtn.textContent = "Play Success";
  successBtn.className = "btn btn-success lg";
  successBtn.onclick = () => ws.send(JSON.stringify({ type: "submit_card", card: "S" }));
  const failBtn = document.createElement("button");
  failBtn.textContent = "Play Fail";
  failBtn.className = "btn btn-danger lg";
  if (["Merlin", "Percival", "Loyal Servant of Arthur"].includes(
    state.players.find(p => p.user_id === userId).role
  )) {
    failBtn.disabled = true;
  } else {
    failBtn.onclick = () => ws.send(JSON.stringify({ type: "submit_card", card: "F" }));
  }
  btnContainer.append(successBtn, failBtn);
  actionsContainer.appendChild(btnContainer);
}

function renderAssassinationPhase(state) {
  const me = state.players.find(p => p.user_id === userId);
  if (me.role !== "Assassin" || state.winner) return;
  actionsContainer.classList.remove("hidden");
  const form = document.createElement("form");
  form.className = "player-selection-form";
  form.innerHTML = state.players
    .filter(
      p =>
        !["Assassin", "Minion of Mordred", "Morgana", "Oberon", "Mordred"].includes(
          p.role
        )
    )
    .map(
      p => `
    <label>
      <input type="radio" value="${p.user_id}" name="assassin-target">
      <span class="player-option">${p.name}</span>
    </label>
  `
    )
    .join("");
  const shootBtn = document.createElement("button");
  shootBtn.textContent = "Assassinate";
  shootBtn.className = "btn btn-danger";
  shootBtn.onclick = () => {
    const target = form.querySelector("input:checked")?.value;
    if (target) {
      ws.send(JSON.stringify({ type: "assassin_guess", target }));
    } else {
      showToast("You must select a target.");
    }
  };
  actionsContainer.innerHTML = `
    <h2>Assassinate Merlin</h2>
    <p>You believe one of these players is Merlin. Choose wisely.</p>
  `;
  actionsContainer.append(form, shootBtn);
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
    case "assassination":
      return me.role === "Assassin"
        ? "You must assassinate Merlin!"
        : "Waiting for the Assassin to act...";
    default:
      return "The game is afoot!";
  }
}

// Event handlers
createRoomBtn.onclick = createRoom;
joinRoomBtn.onclick = () => {
  const id = prompt("Enter Room ID:");
  if (id?.trim()) joinRoom(id.trim());
};
readyBtn.onclick = () => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "toggle_ready" }));
  }
};
startGameBtn.onclick = () => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "start_game" }));
  }
};
document.getElementById("shareBtn").onclick = () => {
  const shareLink = `${location.origin}?room=${roomId}`;
  navigator.clipboard.writeText(shareLink);
  showToast("Room link copied!");
  if (window.QRCode) {
    QRCode.toCanvas(document.getElementById("qrCanvas"), shareLink, {
      width: 128,
    });
  }
};

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
      const res = await fetch(`/profile`, { headers: { Authorization: `Basic ${authToken}` } });
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
    // Clear any invalid creds and show login/signup
    localStorage.removeItem("authToken");
    localStorage.removeItem("userId");
    authToken = null;
    userId = null;
    updateAuthUI(false);
    showAuth("login");
    return;
  }

  // Credentials are valid – proceed as logged-in
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
  roleImgEl.classList.add("blurred");
  roleModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  toggleBlurBtn.textContent = "Reveal";
  roleExtraContainer.classList.remove("populated");
  roleExtraContainer.classList.add("hidden");

  toggleBlurBtn.onclick = () => {
    const isBlurred = roleImgEl.classList.toggle("blurred");
    toggleBlurBtn.textContent = isBlurred ? "Reveal" : "Hide";
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
    Assassin: ["evil"],
    "Minion of Mordred": ["evil"],
    Mordred: ["evil"],
  };
  const keysToShow = allowedKeysByRole[roleName] || [];

  // store for potential refresh when info arrives later
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

  /* ---- Append static role information & objectives ---- */
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

// ---- Room Listing ---- //
async function loadRoomList() {
  const container = document.getElementById("roomListContainer");
  if (!container) return;
  container.innerHTML = "<p>Loading rooms...</p>";
  try {
    const headers = {};
    if (authToken) headers["Authorization"] = `Basic ${authToken}`;
    const res = await fetch(`/rooms`, { headers });
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
    // Reset button states when there are no rooms at all
    createRoomBtn.classList.remove("hidden");
    createRoomBtn.textContent = "Create Room";
    createRoomBtn.onclick = createRoom;
    joinRoomBtn.classList.remove("hidden");
    joinRoomBtn.textContent = "Join Room Via ID";
    return;
  }
  const myRooms = rooms.filter(l => l.host_id === userId);
  const otherRooms = rooms.filter(l => l.host_id !== userId);

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
      // Show host's name instead of room id
      const playerLabel = l.player_count === 1 ? "player" : "players";
      info.textContent = `${l.host_name} (${l.player_count} ${playerLabel})`;
      const joinBtn = document.createElement("button");
      joinBtn.className = "btn";
      joinBtn.textContent = l.host_id === userId ? "Reconnect" : "Enter";
      joinBtn.onclick = () => {
        if (l.requires_password && l.host_id !== userId) {
          const pw = prompt("Enter room password:");
          joinRoom(l.room_id, pw);
        } else {
          joinRoom(l.room_id);
        }
      };
      row.append(info, joinBtn);
      section.appendChild(row);
    });
    container.appendChild(section);
  }

  createSection("My Room", myRooms);
  createSection("Open Rooms", otherRooms);

  // ---- Update the main action buttons ---- //
  const ownsRoom = myRooms.length > 0;
  const ownsBusyRoom = myRooms.some(r => r.player_count > 1);

  // Update / hide Create / Reconnect button
  if (ownsRoom) {
    if (ownsBusyRoom) {
      // Hide the duplicate reconnect button when others are already in room
      createRoomBtn.classList.add("hidden");
    } else {
      createRoomBtn.classList.remove("hidden");
      createRoomBtn.textContent = "Reconnect to your own room";
      createRoomBtn.onclick = () => joinRoom(myRooms[0].room_id);
    }
  } else {
    createRoomBtn.classList.remove("hidden");
    createRoomBtn.textContent = "Create Room";
    createRoomBtn.onclick = createRoom;
  }

  // Update Join Room button – always visible
  joinRoomBtn.classList.remove("hidden");
  joinRoomBtn.textContent = "Join Room Via ID";
}

// ---- Room WebSocket for live updates ---- //
function initRoomWebSocket() {
  if (roomWs && roomWs.readyState !== WebSocket.CLOSED) return;
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/lobbies_ws`;
  roomWs = new WebSocket(wsUrl);
  roomWs.onmessage = event => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "lobbies" && Array.isArray(msg.data)) {
        renderRoomList(msg.data);
      }
    } catch {}
  };
  roomWs.onclose = () => {
    // Attempt to reconnect after short delay
    setTimeout(initRoomWebSocket, 3000);
  };
  roomWs.onerror = () => {
    // silent – reconnect handled by onclose
  };
}