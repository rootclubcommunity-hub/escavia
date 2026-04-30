/* admin.js — ESCAVIA Admin Panel Logic */

const socket = io({ autoConnect: false });

// ─── State ─────────────────────────────────────────────────────────────────
let teams = [];
let pendingReset = null;
let namesDirty = false;

// ─── DOM refs ──────────────────────────────────────────────────────────────
const authOverlay  = document.getElementById('authOverlay');
const pageHeader   = document.getElementById('pageHeader');
const adminMain    = document.getElementById('adminMain');
const pinInput     = document.getElementById('pinInput');
const pinSubmit    = document.getElementById('pinSubmit');
const pinError     = document.getElementById('pinError');
const connDot      = document.getElementById('connDot');
const connLabel    = document.getElementById('connLabel');
const teamsGrid    = document.getElementById('teamsGrid');
const saveBar      = document.getElementById('saveBar');
const saveNamesBtn = document.getElementById('saveNamesBtn');
const startAllBtn  = document.getElementById('startAllBtn');
const resetModal   = document.getElementById('resetModal');
const resetModalText  = document.getElementById('resetModalText');
const resetCancelBtn  = document.getElementById('resetCancelBtn');
const resetConfirmBtn = document.getElementById('resetConfirmBtn');

// ─── Utilities ─────────────────────────────────────────────────────────────
function msToHHMMSS(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function badgeClass(state) {
  return `badge badge-${state}`;
}

function badgeLabel(state) {
  const labels = { idle: 'Idle', running: 'Running', paused: 'Paused', stopped: 'Stopped' };
  return labels[state] || state;
}

function getJoinUrl() {
  return `${location.protocol}//${location.host}/join`;
}

// ─── Auth ───────────────────────────────────────────────────────────────────
function attemptAuth() {
  const pin = pinInput.value.trim();
  if (!pin) { pinError.textContent = 'Please enter your PIN.'; return; }
  pinSubmit.disabled = true;
  pinSubmit.textContent = 'Verifying…';
  pinError.textContent = '';

  socket.connect();
  socket.once('connect', () => {
    socket.emit('admin:auth', { pin }, (res) => {
      if (res.success) {
        authOverlay.style.display = 'none';
        pageHeader.style.display  = '';
        adminMain.style.display   = '';
      } else {
        pinError.textContent = res.error || 'Authentication failed.';
        pinSubmit.disabled = false;
        pinSubmit.textContent = 'Unlock Admin Panel';
        socket.disconnect();
      }
    });
  });
}

pinSubmit.addEventListener('click', attemptAuth);
pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptAuth(); });

// ─── Connection status ──────────────────────────────────────────────────────
socket.on('connect', () => {
  connDot.classList.add('connected');
  connLabel.textContent = 'Connected';
});
socket.on('disconnect', () => {
  connDot.classList.remove('connected');
  connLabel.textContent = 'Reconnecting…';
});

// ─── Build/Update team cards ────────────────────────────────────────────────
function renderAll() {
  if (!teams.length) return;
  // If grid is empty, build it; otherwise just update values
  if (teamsGrid.children.length !== teams.length) {
    teamsGrid.innerHTML = '';
    teams.forEach(team => teamsGrid.appendChild(buildCard(team)));
  } else {
    teams.forEach(team => updateCard(team));
  }
}

function buildCard(team) {
  const card = document.createElement('div');
  card.className = `team-card ${team.state}`;
  card.id = `card-${team.id}`;
  card.innerHTML = `
    <div class="card-top">
      <input
        class="team-name-input"
        id="name-${team.id}"
        type="text"
        value="${escHtml(team.name)}"
        placeholder="Team name"
        maxlength="30"
        title="Click to rename team"
      />
      <span class="${badgeClass(team.state)}" id="badge-${team.id}">${badgeLabel(team.state)}</span>
    </div>
    <div class="card-timer mono" id="timer-${team.id}">${msToHHMMSS(team.elapsedMs)}</div>
    <div class="card-controls">
      <button class="btn btn-start"  id="start-${team.id}"  title="Start">▶ Start</button>
      <button class="btn btn-pause"  id="pause-${team.id}"  title="Pause">⏸ Pause</button>
      <button class="btn btn-stop"   id="stop-${team.id}"   title="Stop">■ Stop</button>
      <button class="btn btn-reset"  id="reset-${team.id}"  title="Reset">↺ Reset</button>
    </div>
    <div class="card-link">
      <span class="card-link-url" id="link-${team.id}">${getJoinUrl()}</span>
      <button class="btn btn-copy" id="copy-${team.id}" title="Copy link">Copy</button>
    </div>
  `;

  // Name change listener
  const nameInput = card.querySelector(`#name-${team.id}`);
  nameInput.addEventListener('input', () => {
    namesDirty = true;
    saveBar.classList.add('visible');
  });

  // Control listeners
  card.querySelector(`#start-${team.id}`).addEventListener('click', () => {
    socket.emit('admin:start', { teamId: team.id });
  });
  card.querySelector(`#pause-${team.id}`).addEventListener('click', () => {
    socket.emit('admin:pause', { teamId: team.id });
  });
  card.querySelector(`#stop-${team.id}`).addEventListener('click', () => {
    socket.emit('admin:stop', { teamId: team.id });
  });
  card.querySelector(`#reset-${team.id}`).addEventListener('click', () => {
    const currentName = document.getElementById(`name-${team.id}`).value || team.id;
    pendingReset = team.id;
    resetModalText.textContent = `Reset "${currentName}" to 00:00:00? This cannot be undone.`;
    resetModal.classList.add('open');
  });

  // Copy link
  card.querySelector(`#copy-${team.id}`).addEventListener('click', () => {
    const btn = document.getElementById(`copy-${team.id}`);
    navigator.clipboard.writeText(getJoinUrl()).then(() => {
      btn.textContent = '✓ Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    });
  });

  return card;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updateCard(team) {
  const card  = document.getElementById(`card-${team.id}`);
  if (!card) return;

  // Update state class
  card.className = `team-card ${team.state}`;

  // Badge
  const badge = document.getElementById(`badge-${team.id}`);
  if (badge) {
    badge.className = badgeClass(team.state);
    badge.textContent = badgeLabel(team.state);
  }

  // Timer (don't overwrite if user is editing name)
  const timerEl = document.getElementById(`timer-${team.id}`);
  if (timerEl) timerEl.textContent = msToHHMMSS(team.elapsedMs);

  // Update local reference
  const idx = teams.findIndex(t => t.id === team.id);
  if (idx !== -1) teams[idx] = { ...teams[idx], ...team };
}

// ─── Socket: Full state (on connect / refresh) ──────────────────────────────
socket.on('full_state', (state) => {
  teams = state;
  renderAll();
});

// ─── Socket: Individual timer update ───────────────────────────────────────
socket.on('timer_update', (update) => {
  updateCard(update);
});

// ─── Start All Teams ─────────────────────────────────────────────────────────
startAllBtn.addEventListener('click', () => {
  startAllBtn.disabled = true;
  startAllBtn.textContent = 'Starting…';
  socket.emit('admin:start_all', {}, (res) => {
    if (res?.success) {
      startAllBtn.textContent = '✓ All Teams Started!';
      // Keep it disabled — it's a one-time action at event start
    } else {
      startAllBtn.textContent = '▶▶ Start All Teams';
      startAllBtn.disabled = false;
    }
  });
});

// ─── Save team names ────────────────────────────────────────────────────────
saveNamesBtn.addEventListener('click', () => {
  const teamUpdates = teams.map(team => ({
    id: team.id,
    name: (document.getElementById(`name-${team.id}`)?.value || team.name).trim(),
  }));
  socket.emit('admin:set_teams', { teamUpdates }, (res) => {
    if (res?.success) {
      namesDirty = false;
      saveBar.classList.remove('visible');
      saveNamesBtn.textContent = '✓ Saved!';
      setTimeout(() => { saveNamesBtn.textContent = 'Save Names'; }, 1500);
    }
  });
});

// ─── Reset Modal ─────────────────────────────────────────────────────────────
resetCancelBtn.addEventListener('click', () => {
  resetModal.classList.remove('open');
  pendingReset = null;
});
resetConfirmBtn.addEventListener('click', () => {
  if (pendingReset) {
    socket.emit('admin:reset', { teamId: pendingReset });
    pendingReset = null;
  }
  resetModal.classList.remove('open');
});
resetModal.addEventListener('click', (e) => {
  if (e.target === resetModal) { resetModal.classList.remove('open'); pendingReset = null; }
});
