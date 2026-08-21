import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export class Logger {
  constructor() {
    this.logDir = join(homedir(), '.cloudtunnel', 'logs');
    this._ensureDir();
  }

  _ensureDir() {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  _timestamp() {
    return new Date().toISOString();
  }

  _write(level, msg) {
    const line = `[${this._timestamp()}] [${level}] ${msg}\n`;
    const logFile = join(this.logDir, `${new Date().toISOString().slice(0, 10)}.log`);
    appendFileSync(logFile, line);
  }

  info(msg) {
    this._write('INFO', msg);
  }

  debug(msg) {
    this._write('DEBUG', msg);
  }

  error(msg) {
    this._write('ERROR', msg);
  }

  warn(msg) {
    this._write('WARN', msg);
  }
}
