import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export class ConfigManager {
  constructor() {
    this.configDir = join(homedir(), '.cloudtunnel');
    this.configPath = join(this.configDir, 'config.json');
    this.defaults = {
      cloudflaredPath: null,
      defaultPort: 8080,
      autoReconnect: true,
      maxRetries: 10,
      dashboardPort: 7600,
    };
    this._ensureDir();
    this.config = this._load();
  }

  _ensureDir() {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
  }

  _load() {
    if (existsSync(this.configPath)) {
      try {
        return { ...this.defaults, ...JSON.parse(readFileSync(this.configPath, 'utf8')) };
      } catch {
        return { ...this.defaults };
      }
    }
    return { ...this.defaults };
  }

  _save() {
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  get(key) {
    return this.config[key];
  }

  set(key, value) {
    this.config[key] = value;
    this._save();
  }

  getHomeDir() {
    return homedir();
  }
}
