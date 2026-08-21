import { spawn, execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';

export class TunnelManager extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.tunnels = new Map();
    this.cloudflaredPath = null;
    this.dataDir = join(config.getHomeDir(), '.cloudtunnel');
    this._ensureDataDir();
  }

  _ensureDataDir() {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  async ensureCloudflared() {
    const customPath = this.config.get('cloudflaredPath');
    if (customPath && existsSync(customPath)) {
      this.cloudflaredPath = customPath;
      return;
    }

    const systemPaths = [
      '/usr/bin/cloudflared',
      '/usr/local/bin/cloudflared',
      join(this.dataDir, 'cloudflared'),
    ];

    for (const p of systemPaths) {
      if (existsSync(p)) {
        this.cloudflaredPath = p;
        return;
      }
    }

    // Auto-install
    await this._installCloudflared();
  }

  async _installCloudflared() {
    const platform = process.platform;
    const arch = process.arch;

    // Treat android as linux (Termux)
    const effectivePlatform = platform === 'android' ? 'linux' : platform;

    let url;
    if (effectivePlatform === 'linux') {
      url = arch === 'arm64'
        ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64'
        : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
    } else if (effectivePlatform === 'darwin') {
      url = arch === 'arm64'
        ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz'
        : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz';
    } else {
      throw new Error(`Unsupported platform: ${platform}/${arch}`);
    }

    const target = join(this.dataDir, 'cloudflared');

    try {
      execSync(`curl -sL "${url}" -o "${target}" && chmod +x "${target}"`, {
        stdio: 'pipe',
      });
      this.cloudflaredPath = target;
    } catch (err) {
      throw new Error(`Failed to install cloudflared: ${err.message}`);
    }
  }

  async createTunnel(opts) {
    await this.ensureCloudflared();

    const id = randomUUID().slice(0, 8);
    const name = opts.name || `tunnel-${id}`;
    const port = opts.port || 8080;

    const args = [
      'tunnel',
      '--url', `http://localhost:${port}`,
      '--no-autoupdate',
    ];

    if (opts.subdomain) {
      args.push('--subdomain', opts.subdomain);
    }

    const tunnel = {
      id,
      name,
      port,
      url: null,
      status: 'connecting',
      process: null,
      createdAt: Date.now(),
      reconnectCount: 0,
      maxRetries: opts.maxRetries ?? 10,
      autoReconnect: opts.autoReconnect !== false,
      subdomain: opts.subdomain || null,
    };

    return new Promise((resolve, reject) => {
      const proc = spawn(this.cloudflaredPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      tunnel.process = proc;
      this.tunnels.set(id, tunnel);

      let resolved = false;
      let urlTimeout;

      const onStdout = (data) => {
        const output = data.toString();

        // Extract the public URL from cloudflared output
        const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (urlMatch && !resolved) {
          tunnel.url = urlMatch[0];
          tunnel.status = 'connected';
          resolved = true;
          clearTimeout(urlTimeout);
          this._saveTunnelState(tunnel);
          this.emit('tunnel:connected', tunnel);
          resolve(tunnel);
        }

        this.logger.debug(`[${name}] ${output.trim()}`);
      };

      const onStderr = (data) => {
        const output = data.toString();
        
        // Detect DNS issues on Termux/Android
        if (output.includes('connection refused') && output.includes('[::1]:53')) {
          tunnel.status = 'error';
          const dnsError = new Error(
            'DNS resolution failed. On Termux/Android, cloudflared cannot resolve DNS.\n' +
            'Try running: cloudflared tunnel --url http://localhost:' + port + ' --edge tcp\n' +
            'Or install a DNS resolver: pkg install dnsutils'
          );
          this.emit('tunnel:error', tunnel, dnsError);
          if (!resolved) reject(dnsError);
          return;
        }
        
        this.logger.debug(`[${name}] stderr: ${output.trim()}`);
      };

      proc.stdout.on('data', onStdout);
      proc.stderr.on('data', onStderr);

      proc.on('error', (err) => {
        tunnel.status = 'error';
        this.emit('tunnel:error', tunnel, err);
        if (!resolved) reject(err);
      });

      proc.on('exit', (code) => {
        tunnel.status = 'disconnected';
        tunnel.process = null;
        this.emit('tunnel:disconnected', tunnel, code);

        if (tunnel.autoReconnect && tunnel.reconnectCount < tunnel.maxRetries) {
          tunnel.reconnectCount++;
          tunnel.status = 'reconnecting';
          this.emit('tunnel:reconnecting', tunnel);
          this.logger.info(`[${name}] Reconnecting (attempt ${tunnel.reconnectCount}/${tunnel.maxRetries})...`);

          setTimeout(() => {
            this.createTunnel({
              ...opts,
              name: `${name}-reconnect`,
            }).catch(() => {});
          }, 2000 * tunnel.reconnectCount);
        }
      });

      // Timeout if URL not received in 15 seconds
      urlTimeout = setTimeout(() => {
        if (!resolved) {
          proc.kill();
          reject(new Error('Timeout waiting for tunnel URL'));
        }
      }, 15000);
    });
  }

  async stopTunnel(target) {
    // Find by id or name
    let tunnel = this.tunnels.get(target);
    if (!tunnel) {
      for (const [id, t] of this.tunnels) {
        if (t.name === target || t.name.startsWith(target)) {
          tunnel = t;
          break;
        }
      }
    }

    if (!tunnel) {
      throw new Error(`Tunnel "${target}" not found`);
    }

    if (tunnel.process) {
      tunnel.autoReconnect = false;
      tunnel.process.kill('SIGTERM');
      tunnel.status = 'stopped';
    }

    this.tunnels.delete(tunnel.id);
    this._removeTunnelState(tunnel.id);
    this.emit('tunnel:stopped', tunnel);
  }

  async stopAll() {
    for (const [id, tunnel] of this.tunnels) {
      if (tunnel.process) {
        tunnel.autoReconnect = false;
        tunnel.process.kill('SIGTERM');
        tunnel.status = 'stopped';
      }
      this._removeTunnelState(id);
    }
    this.tunnels.clear();
  }

  getActiveTunnels() {
    return Array.from(this.tunnels.values()).map((t) => ({
      id: t.id,
      name: t.name,
      port: t.port,
      url: t.url,
      status: t.status,
      createdAt: t.createdAt,
      reconnectCount: t.reconnectCount,
    }));
  }

  getTunnel(id) {
    return this.tunnels.get(id) || null;
  }

  _saveTunnelState(tunnel) {
    try {
      const stateFile = join(this.dataDir, 'state.json');
      let state = {};
      if (existsSync(stateFile)) {
        state = JSON.parse(readFileSync(stateFile, 'utf8'));
      }
      state[tunnel.id] = {
        name: tunnel.name,
        port: tunnel.port,
        url: tunnel.url,
        createdAt: tunnel.createdAt,
      };
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch {}
  }

  _removeTunnelState(id) {
    try {
      const stateFile = join(this.dataDir, 'state.json');
      if (existsSync(stateFile)) {
        const state = JSON.parse(readFileSync(stateFile, 'utf8'));
        delete state[id];
        writeFileSync(stateFile, JSON.stringify(state, null, 2));
      }
    } catch {}
  }
}
