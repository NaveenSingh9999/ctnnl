import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

export async function startDashboard(manager, logger, port = 7600, openBrowser = false) {
  const app = express();
  const server = createServer(app);
  const io = new Server(server);

  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  // API: list tunnels
  app.get('/api/tunnels', (req, res) => {
    res.json(manager.getActiveTunnels());
  });

  // API: create tunnel
  app.post('/api/tunnels', async (req, res) => {
    try {
      const { port: localPort, name, subdomain } = req.body;
      const tunnel = await manager.createTunnel({
        port: parseInt(localPort) || 8080,
        name: name || `web-${Date.now()}`,
        subdomain,
        autoReconnect: true,
      });
      io.emit('tunnel:connected', { id: tunnel.id, name: tunnel.name, url: tunnel.url, port: tunnel.port });
      res.json({ ok: true, tunnel: { id: tunnel.id, name: tunnel.name, url: tunnel.url, port: tunnel.port } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // API: stop tunnel
  app.delete('/api/tunnels/:id', async (req, res) => {
    try {
      await manager.stopTunnel(req.params.id);
      io.emit('tunnel:stopped', { id: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Socket.io real-time events
  io.on('connection', (socket) => {
    socket.emit('tunnels', manager.getActiveTunnels());

    socket.on('create-tunnel', async (data) => {
      try {
        const tunnel = await manager.createTunnel({
          port: parseInt(data.port) || 8080,
          name: data.name,
          subdomain: data.subdomain,
          autoReconnect: true,
        });
        io.emit('tunnel:connected', { id: tunnel.id, name: tunnel.name, url: tunnel.url, port: tunnel.port });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('stop-tunnel', async (id) => {
      try {
        await manager.stopTunnel(id);
        io.emit('tunnel:stopped', { id });
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });
  });

  // Forward manager events to socket.io
  manager.on('tunnel:connected', (tunnel) => {
    io.emit('tunnel:connected', { id: tunnel.id, name: tunnel.name, url: tunnel.url, port: tunnel.port, status: tunnel.status });
  });
  manager.on('tunnel:disconnected', (tunnel) => {
    io.emit('tunnel:disconnected', { id: tunnel.id, name: tunnel.name, status: tunnel.status });
  });
  manager.on('tunnel:stopped', (tunnel) => {
    io.emit('tunnel:stopped', { id: tunnel.id, name: tunnel.name });
  });
  manager.on('tunnel:error', (tunnel, err) => {
    io.emit('tunnel:error', { id: tunnel.id, name: tunnel.name, error: err.message });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      if (openBrowser) {
        import('open').then(({ default: open }) => {
          open(`http://localhost:${port}`);
        }).catch(() => {});
      }
      resolve(server);
    });
  });
}
