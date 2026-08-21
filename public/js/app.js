const socket = io();
const tunnelsList = document.getElementById('tunnels-list');
const logsDiv = document.getElementById('logs');
const createBtn = document.getElementById('create-btn');
const portInput = document.getElementById('port');
const nameInput = document.getElementById('name');
const subdomainInput = document.getElementById('subdomain');

function addLog(msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsDiv.appendChild(entry);
  logsDiv.scrollTop = logsDiv.scrollHeight;
  if (logsDiv.children.length > 100) logsDiv.removeChild(logsDiv.firstChild);
}

function renderTunnels(tunnels) {
  if (!tunnels.length) {
    tunnelsList.innerHTML = '<p class="empty-state">No active tunnels. Create one above.</p>';
    return;
  }
  tunnelsList.innerHTML = tunnels.map(t => `
    <div class="tunnel-card" data-id="${t.id}">
      <div class="tunnel-info">
        <div class="tunnel-name">${escHtml(t.name)}</div>
        ${t.url ? `<a href="${escHtml(t.url)}" target="_blank" class="tunnel-url">${escHtml(t.url)}</a>` : '<span class="tunnel-url">Connecting...</span>'}
        <div class="tunnel-meta">Port: ${t.port} &middot; Created: ${new Date(t.createdAt).toLocaleTimeString()}</div>
      </div>
      <span class="tunnel-status status-${t.status}">${t.status}</span>
      <button class="btn btn-danger" onclick="stopTunnel('${t.id}')">Stop</button>
    </div>
  `).join('');
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

createBtn.addEventListener('click', async () => {
  const port = portInput.value;
  const name = nameInput.value || `web-${Date.now()}`;
  const subdomain = subdomainInput.value;

  if (!port || port < 1 || port > 65535) {
    addLog('Invalid port number', 'error');
    return;
  }

  createBtn.disabled = true;
  addLog(`Creating tunnel on port ${port}...`);

  socket.emit('create-tunnel', { port, name, subdomain });
});

window.stopTunnel = async function(id) {
  socket.emit('stop-tunnel', id);
  addLog(`Stopping tunnel ${id}...`);
};

// Socket events
socket.on('tunnels', (tunnels) => {
  renderTunnels(tunnels);
  addLog(`Loaded ${tunnels.length} active tunnel(s)`);
});

socket.on('tunnel:connected', (t) => {
  addLog(`Tunnel "${t.name}" connected: ${t.url}`, 'success');
  socket.emit('tunnels');
  createBtn.disabled = false;
});

socket.on('tunnel:disconnected', (t) => {
  addLog(`Tunnel "${t.name}" disconnected`, 'error');
  socket.emit('tunnels');
});

socket.on('tunnel:stopped', (t) => {
  addLog(`Tunnel stopped: ${t.id}`);
  socket.emit('tunnels');
});

socket.on('tunnel:error', (e) => {
  addLog(`Error: ${e.error || e.message}`, 'error');
  createBtn.disabled = false;
});

socket.on('error', (e) => {
  addLog(`Error: ${e.message}`, 'error');
  createBtn.disabled = false;
});

// Init
addLog('Connected to dashboard server');
