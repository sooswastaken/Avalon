/* global localStorage, location, fetch, WebSocket */

const API_BASE = ""; // same origin
let roomId = null;
let sessionId = null;
let ws = null;

// DOM Elements
const landingSection = document.getElementById("landing");
const namePromptSection = document.getElementById("namePrompt");
const lobbySection = document.getElementById("lobby");
const gameSection = document.getElementById("game");
const roomIdDisplay = document.getElementById("roomIdDisplay");
const playerList = document.getElementById("playerList");
const readyBtn = document.getElementById("readyBtn");
const startGameBtn = document.getElementById("startGameBtn");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const continueBtn = document.getElementById("continueBtn");
const promptTitle = document.getElementById("promptTitle");
const playerNameInput = document.getElementById("playerNameInput");
const roleContainer = document.getElementById("roleContainer");
const phaseContainer = document.getElementById("phaseContainer");
const actionsContainer = document.getElementById("actionsContainer");

// Modal & toast elements
const roleModal = document.getElementById("roleModal");
const roleImgEl = document.getElementById("roleImg");
const toggleBlurBtn = document.getElementById("toggleBlurBtn");
const closeRoleBtn = document.getElementById("closeRoleBtn");
const toastContainer = document.getElementById("toastContainer");
const roleExtraContainer = document.getElementById("roleExtra");

let pendingAction = null; // "create" | "join"
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

function show(section) {
  [landingSection, namePromptSection, lobbySection, gameSection].forEach((sec) => {
    sec.classList.add("hidden");
  });
  section.classList.remove("hidden");
}

async function createRoom(name) {
  try {
    const res = await fetch(`/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();
    ({ room_id: roomId, session_id: sessionId } = data);
    localStorage.setItem("sessionId", sessionId);
    localStorage.setItem("roomId", roomId);
    history.pushState(null, '', `?room=${roomId}`);
    initWebSocket();
    show(lobbySection);
  } catch (error) {
    showToast("Failed to create room. Please try again.");
    console.error(error);
  }
}

async function joinRoom(name, id) {
  try {
    const res = await fetch(`/rooms/${id}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
        if (res.status === 404) showToast("Room not found.");
        else if (res.status === 400) showToast("Name is already taken in this room.");
        else showToast("Failed to join room.");
        return;
    }
    const data = await res.json();
    ({ room_id: roomId, session_id: sessionId } = data);
    localStorage.setItem("sessionId", sessionId);
    localStorage.setItem("roomId", roomId);
    history.pushState(null, '', `?room=${roomId}`);
    initWebSocket();
    show(lobbySection);
  } catch (error) {
    showToast("Failed to join room. Please try again.");
    console.error(error);
  }
}

function initWebSocket() {
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/${roomId}/${sessionId}`;
  ws = new WebSocket(wsUrl);
  
  ws.onmessage = (event) => {
    console.log(event.data);
    const msg = JSON.parse(event.data);
    if (msg.type === "state") {
      renderState(msg.data);
    } else if (msg.type === "info") {
      privateInfo = msg;
    } else if (msg.type === "quest_result") {
      showQuestModal(msg.data);
    } else if (msg.type === "kicked" && msg.target === sessionId) {
      alert("You have been kicked from the room.");
      localStorage.removeItem("sessionId");
      localStorage.removeItem("roomId");
      setTimeout(() => {
        location.href = "/";
      }, 5000);
    }
  };

  ws.onclose = () => {
    showToast("Disconnected. Attempting to reconnect...");
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = () => {
    showToast("WebSocket connection error.", 'danger');
  };
}

function renderState(state) {
  if (state.phase === "lobby") {
    renderLobby(state);
  } else {
    renderGame(state);
  }
}

function renderLobby(state) {
  show(lobbySection);
  roomIdDisplay.textContent = state.room_id;
  playerList.innerHTML = "";
  state.players.forEach((p) => {
    const li = document.createElement("li");
    const nameSpan = document.createElement("span");
    nameSpan.className = 'player-name';
    nameSpan.textContent = p.name;
    
    if (p.session_id === state.host_id) {
        nameSpan.innerHTML = `<span class="host-indicator">★</span>` + nameSpan.innerHTML;
    }

    const statusIndicator = document.createElement('span');
    statusIndicator.className = 'status-indicator';
    const statusDot = document.createElement('span');
    statusDot.className = p.ready ? 'status-dot ready' : 'status-dot not-ready';
    const statusText = document.createElement('span');
    statusText.textContent = p.ready ? 'Ready' : 'Not Ready';
    statusIndicator.append(statusDot, statusText);

    li.appendChild(nameSpan);
    
    if (state.host_id === sessionId && p.session_id !== sessionId) {
      const kickBtn = document.createElement("button");
      kickBtn.textContent = "Kick";
      kickBtn.className = "btn btn-danger";
      kickBtn.style.margin = 0;
      kickBtn.style.padding = "0.3rem 0.8rem";
      kickBtn.onclick = () => ws.send(JSON.stringify({ type: "kick", target: p.session_id }));
      li.appendChild(kickBtn);
    }

    li.appendChild(statusIndicator);
    playerList.appendChild(li);
  });

  const isReady = state.players.find((p) => p.session_id === sessionId).ready;
  readyBtn.textContent = isReady ? "Unready" : "Ready";
  readyBtn.classList.toggle('btn-danger', isReady);
  readyBtn.classList.toggle('btn-success', !isReady);

  if (state.host_id === sessionId) {
    startGameBtn.classList.remove("hidden");
    const canStart = state.players.every((p) => p.ready) && state.players.length >= 5 && state.players.length <= 10;
    startGameBtn.disabled = !canStart;
  } else {
    startGameBtn.classList.add("hidden");
  }

  const configDiv = document.getElementById("configOptions");
  configDiv.innerHTML = "";
  const isHost = state.host_id === sessionId;
  const cfg = state.config;
  
  const container = document.createElement('div');
  container.className = 'config-options-container';

  const header = document.createElement('div');
  header.className = 'config-header';
  header.innerHTML = '<h4>Optional Roles</h4>';
  const requires7 = state.players.length < 7;
  if(requires7){
      header.innerHTML += `<p>Morgana, Percival, and Oberon require 7+ players.</p>`;
  }

  const body = document.createElement('div');
  body.className = 'config-body';

  const mpLabel = document.createElement("label");
  const mpCheckbox = document.createElement("input");
  mpCheckbox.type = "checkbox";
  mpCheckbox.checked = cfg.morgana && cfg.percival;
  mpCheckbox.disabled = !isHost || requires7;
  mpLabel.appendChild(mpCheckbox);
  mpLabel.append(" Morgana & Percival");

  const obLabel = document.createElement("label");
  const obCheckbox = document.createElement("input");
  obCheckbox.type = "checkbox";
  obCheckbox.checked = cfg.oberon;
  obCheckbox.disabled = !isHost || requires7;
  obLabel.appendChild(obCheckbox);
  obLabel.append(" Oberon");
  
  body.append(mpLabel, obLabel);
  container.append(header, body);
  configDiv.appendChild(container);

  function sendConfig() {
    ws.send(JSON.stringify({
        type: "set_config",
        morgana: mpCheckbox.checked,
        percival: mpCheckbox.checked,
        oberon: obCheckbox.checked,
    }));
  }

  if (isHost && !requires7) {
    mpCheckbox.addEventListener("change", sendConfig);
    obCheckbox.addEventListener("change", sendConfig);
  }

  // QR code
  const qrContainer=document.getElementById('qrContainer');
  qrContainer.innerHTML='';
  const canvas=document.createElement('canvas');
  canvas.id='qrCanvas';
  qrContainer.appendChild(canvas);
  if(window.QRCode){
     const url=`${location.origin}?room=${state.room_id}`;
     QRCode.toCanvas(canvas,url,{width:128});
  }
}

function renderGame(state) {
  show(gameSection);
  const me = state.players.find((p) => p.session_id === sessionId);
  
  if (me && me.role && roleContainer.childElementCount === 0) {
    roleContainer.innerHTML = "";
    const btn = document.createElement("button");
    btn.textContent = "View Your Role";
    btn.className = "btn lg";
    const imgFile = me.role.toLowerCase().replace(/ /g, "") + ".png";
    const imgSrc = `/images/${imgFile}`;
    btn.onclick = () => showRoleModal(me.role, imgSrc);
    roleContainer.style.textAlign = 'center';
    roleContainer.style.marginTop = '2rem';
    roleContainer.appendChild(btn);

    if (!window._roleShown) {
      showRoleModal(me.role, imgSrc);
      window._roleShown = true;
    }
  }

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

  const questRow = document.getElementById("questRow");
  questRow.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const card = document.createElement("div");
    card.className = "quest-card";
    const record = state.quest_history.find((q) => q.round === i);
    const teamSize = QUEST_SIZES[state.players.length][i - 1];
    
    let circleHtml;
    let detailsHtml = '';
    
    if (record) {
        const resultText = record.success ? "Pass" : "Fail";
        circleHtml = `<div class="quest-circle ${record.success ? "success" : "fail"}"><span>${resultText}</span></div>`;
        detailsHtml = `
            <div class="quest-info-toggle"></div>
            <div class="quest-details-content">
                <div class="detail-group"><h5>Result</h5><p>${record.success ? "Success" : "Fail"} (${record.fails} fail${record.fails !== 1 ? 's' : ''})</p></div>
                <div class="detail-group"><h5>Leader</h5><p>${record.leader}</p></div>
                <div class="detail-group"><h5>Team</h5><p>${record.team.join(", ")}</p></div>
            </div>
        `;
        card.onclick = () => showQuestModal(record);
    } else {
        circleHtml = `<div class="quest-circle"><span>${teamSize}</span></div>`;
    }
    
    const questTitle = document.createElement('h4');
    questTitle.style.margin = '0';
    questTitle.textContent = `Quest ${i}`;
    if(state.round_number === i) questTitle.style.color = 'var(--color-accent-primary)';

    card.innerHTML = circleHtml + detailsHtml;
    card.appendChild(questTitle);
    
    const toggle = card.querySelector('.quest-info-toggle');
    if (toggle) {
        toggle.onclick = (e) => {
            e.stopPropagation(); // prevent modal from opening
            card.classList.toggle('expanded');
        };
    }
    questRow.appendChild(card);
  }

  phaseContainer.innerHTML = `<h3>Round ${state.round_number}</h3><p>${getPhaseDescription(state, me)}</p>`;
  actionsContainer.innerHTML = '';
  actionsContainer.classList.add('hidden');

  if (state.phase === "finished") {
    phaseContainer.innerHTML = `<h2>Game Over!</h2><p>${state.winner === "good" ? "The Good Team Wins!" : "The Evil Team Wins!"}</p>`;
    // roles grid
    const grid = document.createElement('div');
    grid.className = 'roles-grid';
    grid.style.display='grid';
    grid.style.gridTemplateColumns='repeat(auto-fit,minmax(120px,1fr))';
    grid.style.gap='0.5rem';
    state.players.forEach(pl=>{
        const card=document.createElement('div');
        card.className='card';
        card.style.textAlign='center';
        card.innerHTML=`<strong>${pl.name}</strong><br/><img src="/images/${pl.role.toLowerCase().replace(/ /g,'')}.png" style="max-width:80px;"><br/><span>${pl.role}</span>`;
        grid.appendChild(card);
    });
    phaseContainer.appendChild(grid);

    if(state.host_id===sessionId){
        const againBtn=document.createElement('button');
        againBtn.textContent='Play Again';
        againBtn.className='btn lg';
        againBtn.style.marginTop='1rem';
        againBtn.onclick=()=> ws.send(JSON.stringify({type:'restart_game'}));
        phaseContainer.appendChild(againBtn);
    }
    return;
  }
  
  if (state.subphase === "proposal" && state.current_leader === sessionId) {
    actionsContainer.classList.remove('hidden');
    const requiredSize = QUEST_SIZES[state.players.length][state.round_number - 1];
    const form = document.createElement("form");
    form.className = 'player-selection-form';
    form.innerHTML = state.players.map(p => `
        <label>
            <input type="checkbox" value="${p.session_id}" name="team">
            <span class="player-option">${p.name}</span>
        </label>
    `).join('');

    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Propose Team";
    submitBtn.type = "button";
    submitBtn.className = "btn btn-success";
    submitBtn.onclick = () => {
      const checked = [...form.querySelectorAll("input:checked")].map((el) => el.value);
      if (checked.length !== requiredSize) {
        showToast(`You must select exactly ${requiredSize} players.`);
        return;
      }
      ws.send(JSON.stringify({ type: "propose_team", team: checked }));
    };
    
    actionsContainer.innerHTML = `<h2>Propose a Team</h2><p>Select ${requiredSize} players for the quest.</p>`;
    actionsContainer.appendChild(form);
    actionsContainer.appendChild(submitBtn);

    form.addEventListener("change", () => {
      const checkedCount = form.querySelectorAll("input:checked").length;
      submitBtn.disabled = checkedCount !== requiredSize;
      if (checkedCount >= requiredSize) {
        form.querySelectorAll("input:not(:checked)").forEach((cb) => { cb.disabled = true; });
      } else {
        form.querySelectorAll("input").forEach((cb) => { cb.disabled = false; });
      }
    });
    submitBtn.disabled = true;
  }

  if (state.subphase === "voting") {
    actionsContainer.classList.remove('hidden');
    const teamNames = state.current_team.map((id) => state.players.find((p) => p.session_id === id).name).join(", ");
    actionsContainer.innerHTML = `<h2>Vote on the Proposal</h2><p><strong>${state.players.find(p=>p.session_id === state.proposal_leader).name}</strong> has proposed: <strong>${teamNames}</strong></p>`;
    
    if (!(sessionId in state.votes)) {
      const btnContainer = document.createElement('div');
      const approveBtn = document.createElement("button");
      approveBtn.textContent = "Approve";
      approveBtn.className = "btn btn-success lg";
      approveBtn.onclick = () => ws.send(JSON.stringify({ type: "vote_team", approve: true }));

      const rejectBtn = document.createElement("button");
      rejectBtn.textContent = "Reject";
      rejectBtn.className = "btn btn-danger lg";
      rejectBtn.onclick = () => ws.send(JSON.stringify({ type: "vote_team", approve: false }));
      
      btnContainer.append(approveBtn, rejectBtn);
      actionsContainer.appendChild(btnContainer);
    } else {
      actionsContainer.innerHTML += `<p><em>You have voted. Waiting for other players...</em></p>`;
    }
  }

  if (state.subphase === "quest" && state.current_team.includes(sessionId) && !(sessionId in state.submissions)) {
    actionsContainer.classList.remove('hidden');
    actionsContainer.innerHTML = '<h2>Play Your Card</h2><p>Choose whether the quest will succeed or fail.</p>';
    const btnContainer = document.createElement('div');

    const successBtn = document.createElement("button");
    successBtn.textContent = "Play Success";
    successBtn.className = "btn btn-success lg";
    successBtn.onclick = () => ws.send(JSON.stringify({ type: "submit_card", card: "S" }));

    const failBtn = document.createElement("button");
    failBtn.textContent = "Play Fail";
    failBtn.className = "btn btn-danger lg";

    if (["Merlin", "Percival", "Loyal Servant of Arthur"].includes(me.role)) {
      failBtn.disabled = true;
    } else {
      failBtn.onclick = () => ws.send(JSON.stringify({ type: "submit_card", card: "F" }));
    }
    
    btnContainer.append(successBtn, failBtn);
    actionsContainer.appendChild(btnContainer);
  }

  if (state.phase === "assassination" && me.role === "Assassin" && !state.winner) {
    actionsContainer.classList.remove('hidden');
    const form = document.createElement("form");
    form.className = 'player-selection-form';
    form.innerHTML = state.players
        .filter(p => p.role !== "Assassin" && p.role !== "Minion of Mordred" && p.role !== "Morgana" && p.role !== "Oberon" && p.role !== "Mordred")
        .map(p => `
        <label>
            <input type="radio" value="${p.session_id}" name="assassin-target">
            <span class="player-option">${p.name}</span>
        </label>
    `).join('');
    
    const shootBtn = document.createElement("button");
    shootBtn.textContent = "Assassinate";
    shootBtn.className = "btn btn-danger";
    shootBtn.onclick = () => {
      const target = form.querySelector("input:checked")?.value;
      if(target) {
        ws.send(JSON.stringify({ type: "assassin_guess", target }));
      } else {
        showToast('You must select a target.');
      }
    };
    
    actionsContainer.innerHTML = '<h2>Assassinate Merlin</h2><p>You believe one of these players is Merlin. Choose wisely.</p>';
    actionsContainer.appendChild(form);
    actionsContainer.appendChild(shootBtn);
  }
}

function getPhaseDescription(state, me) {
    const leaderName = state.players.find(p => p.session_id === state.current_leader)?.name || 'Someone';
    switch(state.subphase || state.phase) {
        case 'proposal': return `${leaderName} is proposing a team.`;
        case 'voting': return `Everyone is voting on the proposed team.`;
        case 'quest': return `The team is on the quest. Waiting for their decision...`;
        case 'assassination': return me.role === 'Assassin' ? 'You must assassinate Merlin!' : 'Waiting for the Assassin to act...';
        default: return 'The game is afoot!';
    }
}

// Event handlers
createRoomBtn.onclick = () => { pendingAction = "create"; show(namePromptSection); promptTitle.textContent = "Enter Your Name"; };
joinRoomBtn.onclick = () => {
  const id = prompt("Enter Room ID:");
  if (!id || id.trim() === '') return;
  pendingAction = "join";
  roomId = id.trim().toUpperCase();
  show(namePromptSection);
  promptTitle.textContent = "Enter Your Name";
};
continueBtn.onclick = () => {
  const name = playerNameInput.value.trim();
  if (!name) return showToast("Please enter a name");
  continueBtn.disabled = true;
  if (pendingAction === "create") { createRoom(name); } 
  else if (pendingAction === "join") { joinRoom(name, roomId); }
  setTimeout(() => { continueBtn.disabled = false; }, 1000);
};
playerNameInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') continueBtn.click(); });
readyBtn.onclick = () => { if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ type: "toggle_ready" })); } };
startGameBtn.onclick = () => { if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ type: "start_game" })); } };

window.addEventListener("load", () => {
  const params = new URLSearchParams(location.search);
  const urlRoom = params.get("room");
  if (urlRoom) {
    const storedSession = localStorage.getItem("sessionId");
    const storedRoom = localStorage.getItem("roomId");
    if (storedSession && storedRoom && storedRoom === urlRoom) {
        sessionId = storedSession;
        roomId = storedRoom;
        initWebSocket();
    } else {
        localStorage.removeItem("sessionId");
        localStorage.removeItem("roomId");
        roomId = urlRoom;
        pendingAction = "join";
        promptTitle.textContent = "Enter Your Name to Join Room";
        show(namePromptSection);
    }
  }
});

document.getElementById("shareBtn").onclick = () => {
  const shareLink = `${location.origin}?room=${roomId}`;
  navigator.clipboard.writeText(shareLink);
  showToast("Room link copied!");
  // also regenerate QR
  if(window.QRCode){
     QRCode.toCanvas(document.getElementById('qrCanvas'), shareLink, {width:128});
  }
};

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
  roleExtraContainer.classList.remove('populated');
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
      'evil': 'Your fellow minions of Mordred',
      'merlin_knows': 'You see these players as Evil',
      'percival_knows': 'You see these players as Merlin or Morgana'
  };

  const allowedKeysByRole = {
      'Merlin': ['merlin_knows'],
      'Percival': ['percival_knows'],
      'Morgana': ['evil'],
      'Assassin': ['evil'],
      'Minion of Mordred': ['evil'],
      'Mordred': ['evil']
  };
  const keysToShow = allowedKeysByRole[roleName] || [];

  roleExtraContainer.innerHTML = '';
  if (privateInfo) {
    const infoHTML = keysToShow
      .filter(key => privateInfo[key] && privateInfo[key].length > 0)
      .map(key => {
        const title = keyToTitleMap[key] || key.replace(/_/g, ' ');
        const names = Array.isArray(privateInfo[key]) ? privateInfo[key].join(", ") : privateInfo[key];
        return `<div class="role-info-group"><h4>${title}</h4><p>${names}</p></div>`;
      })
      .join("");
    
    if (infoHTML) {
      roleExtraContainer.innerHTML = infoHTML;
      roleExtraContainer.classList.add('populated');
    }
  }
}

const questModal = document.getElementById("questModal");
const questModalContent = document.getElementById("questModalContent");

function showQuestModal(record){
  const approves = Object.keys(record.votes).filter(n => record.votes[n]);
  const rejects = Object.keys(record.votes).filter(n => !record.votes[n]);

  questModalContent.innerHTML = `
    <h2>Quest ${record.round} Result</h2>
    <h3>Quest ${record.success ? "Succeeded" : "Failed"}</h3>
    <p>There were <strong>${record.fails}</strong> fail card${record.fails !== 1 ? 's' : ''} played.</p>
    <hr style="border-color: var(--color-border); margin: 1rem 0;">
    <p><strong>Leader:</strong> ${record.leader}</p>
    <p><strong>Proposed Team:</strong> ${record.team.join(", ")}</p>
    <p><strong style="color: var(--color-accent-success);">Approved (${approves.length}):</strong> ${approves.join(', ') || 'None'}</p>
    <p><strong style="color: var(--color-accent-danger);">Rejected (${rejects.length}):</strong> ${rejects.join(', ') || 'None'}</p>
    <button class="btn" id="closeQuestBtn">Close</button>
  `;
  questModal.classList.remove("hidden");
  document.getElementById("closeQuestBtn").onclick=()=>questModal.classList.add("hidden");
}