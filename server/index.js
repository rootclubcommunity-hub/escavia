require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*' },
  pingInterval: 5000,
  pingTimeout: 10000,
});

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || 'escavia2026');
const MAX_TEAMS = Number(process.env.MAX_TEAMS) || 6;
const ADMIN_ROOM = 'admin';

function createTeam(index) {
  return {
    id: `team_${index + 1}`,
    name: `Team ${index + 1}`,
    state: 'idle',
    elapsedMs: 0,
    lastStartedAt: null,
  };
}

const teams = Array.from({ length: MAX_TEAMS }, (_, index) => createTeam(index));

function getElapsed(team) {
  if (team.state === 'running' && team.lastStartedAt) {
    return team.elapsedMs + (Date.now() - team.lastStartedAt);
  }
  return team.elapsedMs;
}

function teamSnapshot(team) {
  return {
    id: team.id,
    name: team.name,
    state: team.state,
    elapsedMs: getElapsed(team),
    serverTimestamp: Date.now(),
  };
}

function fullState() {
  return teams.map(teamSnapshot);
}

function broadcastTeam(team) {
  io.emit('timer_update', teamSnapshot(team));
}

function broadcastAll() {
  io.emit('full_state', fullState());
}

setInterval(() => {
  if (teams.some((team) => team.state === 'running')) {
    broadcastAll();
  }
}, 1000);

const clientRoot = path.join(__dirname, '..', 'client');
app.use(express.static(clientRoot));

app.get('/', (req, res) => {
  res.sendFile(path.join(clientRoot, 'index.html'));
});

app.get('/join', (req, res) => {
  res.sendFile(path.join(clientRoot, 'contestant.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(clientRoot, 'admin.html'));
});

io.on('connection', (socket) => {
  console.log(`connection: ${socket.id}`);
  socket.emit('full_state', fullState());

  socket.on('admin:auth', ({ pin }, cb) => {
    if (pin === ADMIN_SECRET) {
      socket.join(ADMIN_ROOM);
      console.log(`admin authenticated: ${socket.id}`);
      cb({ success: true });
      return;
    }
    cb({ success: false, error: 'Invalid PIN. Please try again.' });
  });

  socket.on('admin:set_teams', ({ teamUpdates }, cb) => {
    if (!socket.rooms.has(ADMIN_ROOM)) return cb?.({ success: false, error: 'Unauthorized' });
    if (!Array.isArray(teamUpdates)) return cb?.({ success: false, error: 'Invalid payload' });

    teamUpdates.forEach(({ id, name }) => {
      const team = teams.find((entry) => entry.id === id);
      if (team && typeof name === 'string' && name.trim()) {
        team.name = name.trim();
      }
    });

    broadcastAll();
    cb?.({ success: true });
  });

  socket.on('admin:start', ({ teamId }, cb) => {
    if (!socket.rooms.has(ADMIN_ROOM)) return cb?.({ success: false });
    const team = teams.find((entry) => entry.id === teamId);
    if (!team) return cb?.({ success: false });
    team.lastStartedAt = Date.now();
    team.state = 'running';
    broadcastTeam(team);
    cb?.({ success: true });
  });

  socket.on('admin:pause', ({ teamId }, cb) => {
    if (!socket.rooms.has(ADMIN_ROOM)) return cb?.({ success: false });
    const team = teams.find((entry) => entry.id === teamId);
    if (!team || team.state !== 'running') return cb?.({ success: false });
    team.elapsedMs = getElapsed(team);
    team.lastStartedAt = null;
    team.state = 'paused';
    broadcastTeam(team);
    cb?.({ success: true });
  });

  socket.on('admin:stop', ({ teamId }, cb) => {
    if (!socket.rooms.has(ADMIN_ROOM)) return cb?.({ success: false });
    const team = teams.find((entry) => entry.id === teamId);
    if (!team) return cb?.({ success: false });
    team.elapsedMs = getElapsed(team);
    team.lastStartedAt = null;
    team.state = 'stopped';
    broadcastTeam(team);
    cb?.({ success: true });
  });

  socket.on('admin:reset', ({ teamId }, cb) => {
    if (!socket.rooms.has(ADMIN_ROOM)) return cb?.({ success: false });
    const team = teams.find((entry) => entry.id === teamId);
    if (!team) return cb?.({ success: false });
    team.elapsedMs = 0;
    team.lastStartedAt = null;
    team.state = 'idle';
    broadcastTeam(team);
    cb?.({ success: true });
  });

  socket.on('admin:start_all', (_, cb) => {
    if (!socket.rooms.has(ADMIN_ROOM)) return cb?.({ success: false });
    const now = Date.now();
    teams.forEach((team) => {
      team.lastStartedAt = now;
      team.state = 'running';
    });
    broadcastAll();
    cb?.({ success: true });
  });

  socket.on('contestant:join', ({ teamName }, cb) => {
    const normalizedName = String(teamName || '').trim().toLowerCase();
    const team = teams.find((entry) => entry.name.trim().toLowerCase() === normalizedName);
    if (!team) {
      cb?.({ success: false, error: 'Team not found. Please check your team name and try again.' });
      return;
    }
    socket.join(team.id);
    cb?.({ success: true, team: teamSnapshot(team) });
  });

  socket.on('disconnect', () => {
    console.log(`disconnect: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`ESCAVIA timer server running on http://localhost:${PORT}`);
});
