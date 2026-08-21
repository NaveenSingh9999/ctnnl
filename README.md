# CloudTunnel

Expose local services to the internet using Cloudflare Tunnel. Zero config, no account needed.

## Install

```bash
cd ~/cloudtunnel
npm install
npm link  # makes 'cloudtunnel' and 'ct' available globally
```

## Usage

### Quick tunnel (zero config)
```bash
cloudtunnel quick 8080
# or
ct q 8080
```

### Expose with options
```bash
cloudtunnel expose 3000 --name my-app
cloudtunnel expose 8080 --subdomain myapp
```

### Web dashboard
```bash
cloudtunnel dashboard
# opens http://localhost:7600
```

### Manage tunnels
```bash
cloudtunnel list       # show active tunnels
cloudtunnel stop my-app  # stop a tunnel
cloudtunnel stop-all   # stop everything
```

### Setup (auto-installs cloudflared)
```bash
cloudtunnel setup
```

## How it works

Uses [Cloudflare's quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/) feature — creates temporary public URLs via `trycloudflare.com` with zero configuration. No Cloudflare account, no DNS setup, no auth tokens.

## Termux / Android

On Termux/Android, cloudflared has a known DNS resolution issue (it tries to use `[::1]:53` which isn't available). Workarounds:

1. **Use a cloud VPS** (recommended): Run on a Linux VPS where DNS works natively
2. **Install a DNS resolver**: `pkg install dnsutils` and configure `/etc/resolv.conf`
3. **Use Docker**: `docker run -it --network host cloudtunnel`

The CLI detects this error and provides helpful messages.

## Dashboard

The web dashboard provides real-time tunnel management:
- Create tunnels from the UI
- See live status (connected/reconnecting/disconnected)
- Click URLs to open in browser
- Auto-reconnect on failure
- Event logs

## Architecture

```
bin/cloudtunnel.js     CLI entry point (commander.js)
src/
  tunnel-manager.js    Core cloudflared wrapper, lifecycle, auto-reconnect
  dashboard.js         Express + Socket.io web UI
  config.js            Persistent config (~/.cloudtunnel/config.json)
  logger.js            File logging (~/.cloudtunnel/logs/)
public/                Dashboard frontend (HTML/CSS/JS)
```

## Config

Config stored at `~/.cloudtunnel/config.json`:

```json
{
  "cloudflaredPath": null,
  "defaultPort": 8080,
  "autoReconnect": true,
  "maxRetries": 10,
  "dashboardPort": 7600
}
```

## License

MIT
