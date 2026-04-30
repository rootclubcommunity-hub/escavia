/* contestant.js — ESCAVIA Contestant Timer Logic */

const socket = io({
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
});

// ─── State ──────────────────────────────────────────────────────────────────
let myTeamId   = null;
let myTeamName = null;
let currentState = 'idle';

// For client-side interpolation between server ticks
let elapsedMs       = 0;
let lastServerMs    = 0;
let lastServerTime  = null; // Date.now() when we received the last update
let rafId           = null;
let isRunning       = false;

// ─── DOM refs ───────────────────────────────────────────────────────────────
const joinScreen      = document.getElementById('joinScreen');
const timerScreen     = document.getElementById('timerScreen');
const teamNameInput   = document.getElementById('teamNameInput');
const joinBtn         = document.getElementById('joinBtn');
const joinError       = document.getElementById('joinError');
const joinConnecting  = document.getElementById('joinConnecting');

const tsTeamName      = document.getElementById('tsTeamName');
const tsTimer         = document.getElementById('tsTimer');
const tsStatus        = document.getElementById('tsStatus');
const tsConnDot       = document.getElementById('tsConnDot');
const tsConnLabel     = document.getElementById('tsConnLabel');
const reconnectBanner = document.getElementById('reconnectBanner');

// ─── Utilities ──────────────────────────────────────────────────────────────
function msToHHMMSS(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function setTimerDisplay(ms, state) {
  tsTimer.textContent = msToHHMMSS(ms);
  tsTimer.className   = `ts-timer mono ${state}`;
}

function setStatusBadge(state) {
  let html = '';
  if (state === 'paused') {
    html = `<span class="badge badge-paused">Paused</span>`;
  } else if (state === 'stopped') {
    html = `<span class="badge badge-stopped">Time Up</span>`;
  } else if (state === 'idle') {
    html = `<span class="badge badge-idle">Waiting to start</span>`;
  }
  // 'running' = no badge (clean look)
  tsStatus.innerHTML = html;
}

// ─── Smooth interpolated tick (rAF) ─────────────────────────────────────────
function startRaf() {
  if (rafId) return;
  function tick() {
    if (!isRunning) { rafId = null; return; }
    const now = Date.now();
    const interpolated = lastServerMs + (now - lastServerTime);
    setTimerDisplay(interpolated, currentState);
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

function stopRaf() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

// ─── Apply server update ─────────────────────────────────────────────────────
function applyUpdate(update) {
  currentState = update.state;
  elapsedMs    = update.elapsedMs;

  // Compensate for approximate network latency
  const lag = Date.now() - (update.serverTimestamp || Date.now());
  lastServerMs   = update.elapsedMs + (update.state === 'running' ? Math.max(0, lag) : 0);
  lastServerTime = Date.now();

  isRunning = (update.state === 'running');

  if (isRunning) {
    startRaf();
  } else {
    stopRaf();
    setTimerDisplay(update.elapsedMs, update.state);
  }

  setStatusBadge(update.state);
}

// ─── Join flow ───────────────────────────────────────────────────────────────
function attemptJoin() {
  const name = teamNameInput.value.trim();
  if (!name) {
    joinError.textContent = 'Please enter your team name.';
    return;
  }
  joinBtn.disabled = true;
  joinBtn.textContent = 'Joining…';
  joinError.textContent = '';

  socket.emit('contestant:join', { teamName: name }, (res) => {
    if (res.success) {
      myTeamId   = res.team.id;
      myTeamName = res.team.name;

      // Switch to timer screen
      joinScreen.style.display = 'none';
      timerScreen.classList.add('active');
      tsTeamName.textContent = myTeamName;

      // Apply initial state
      applyUpdate(res.team);
    } else {
      joinError.textContent = res.error || 'Something went wrong. Please try again.';
      joinBtn.disabled = false;
      joinBtn.textContent = 'Join My Team';
    }
  });
}

joinBtn.addEventListener('click', attemptJoin);
teamNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptJoin();
});

// ─── Show join screen once connected ────────────────────────────────────────
socket.on('connect', () => {
  // Update connection UI
  tsConnDot.classList.add('connected');
  tsConnLabel.textContent = 'Live';
  reconnectBanner.classList.remove('show');

  joinConnecting.style.display = 'none';

  // If we were already in a team, re-join and resync
  if (myTeamId) {
    socket.emit('contestant:join', { teamName: myTeamName }, (res) => {
      if (res.success) applyUpdate(res.team);
    });
  }
});

socket.on('disconnect', () => {
  tsConnDot.classList.remove('connected');
  tsConnLabel.textContent = 'Offline';
  reconnectBanner.classList.add('show');
  stopRaf();
});

socket.on('connect_error', () => {
  // Show connecting hint on join screen
  joinConnecting.style.display = 'block';
  joinConnecting.textContent = 'Connecting to event server…';
});

// ─── Live timer updates ──────────────────────────────────────────────────────
socket.on('timer_update', (update) => {
  if (!myTeamId) return;
  if (update.id !== myTeamId) return;
  applyUpdate(update);
});

// ─── Full state (on reconnect) ───────────────────────────────────────────────
socket.on('full_state', (state) => {
  if (!myTeamId) return;
  const myTeam = state.find(t => t.id === myTeamId);
  if (myTeam) applyUpdate(myTeam);
});
