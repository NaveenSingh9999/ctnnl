#!/usr/bin/env node
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TunnelManager } from '../src/tunnel-manager.js';
import { ConfigManager } from '../src/config.js';
import { startDashboard } from '../src/dashboard.js';
import { Logger } from '../src/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const config = new ConfigManager();
const logger = new Logger();
const manager = new TunnelManager(config, logger);

const program = new Command();

program
  .name('cloudtunnel')
  .alias('ct')
  .description('Expose local services to the internet via Cloudflare Tunnel')
  .version(pkg.version);

program
  .command('expose')
  .alias('e')
  .description('Expose a local port to the internet')
  .argument('[port]', 'Local port to expose', '8080')
  .option('-n, --name <name>', 'Tunnel name')
  .option('-s, --subdomain <subdomain>', 'Custom subdomain (random if omitted)')
  .option('--no-reconnect', 'Disable auto-reconnect on failure')
  .option('--max-retries <n>', 'Max reconnect attempts', '10')
  .action(async (port, opts) => {
    const name = opts.name || `tunnel-${port}`;
    const spinner = ora(`Starting tunnel "${name}" on port ${port}...`).start();

    try {
      const tunnel = await manager.createTunnel({
        port: parseInt(port),
        name,
        subdomain: opts.subdomain,
        autoReconnect: opts.reconnect,
        maxRetries: parseInt(opts.maxRetries),
      });

      spinner.succeed(chalk.green(`Tunnel "${name}" is live!`));
      console.log('');
      console.log(chalk.cyan('  Public URL:'), chalk.bold.underline(tunnel.url));
      console.log(chalk.gray('  Local:'), `http://localhost:${port}`);
      console.log(chalk.gray('  Status:'), 'connected');
      console.log('');
      console.log(chalk.gray('  Press Ctrl+C to stop'));
      console.log('');

      process.on('SIGINT', async () => {
        console.log('\n' + chalk.yellow('Stopping tunnel...'));
        await manager.stopTunnel(tunnel.id);
        process.exit(0);
      });

    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('dashboard')
  .alias('d')
  .description('Start web dashboard to manage tunnels')
  .option('-p, --port <port>', 'Dashboard port', '7600')
  .option('--open', 'Open browser automatically')
  .action(async (opts) => {
    const spinner = ora('Starting dashboard...').start();
    try {
      const port = parseInt(opts.port);
      await startDashboard(manager, logger, port, opts.open);
      spinner.succeed(chalk.green(`Dashboard running at http://localhost:${port}`));
    } catch (err) {
      spinner.fail(chalk.red(`Dashboard failed: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('list')
  .alias('ls')
  .description('List all active tunnels')
  .action(() => {
    const tunnels = manager.getActiveTunnels();
    if (tunnels.length === 0) {
      console.log(chalk.gray('No active tunnels.'));
      return;
    }
    console.log(chalk.bold('\nActive Tunnels:\n'));
    for (const t of tunnels) {
      console.log(`  ${chalk.cyan(t.name)}  ${chalk.bold.underline(t.url)}  port:${t.port}  ${chalk.green(t.status)}`);
    }
    console.log('');
  });

program
  .command('stop')
  .description('Stop a tunnel by name or id')
  .argument('<target>', 'Tunnel name or id')
  .action(async (target) => {
    const spinner = ora(`Stopping tunnel "${target}"...`).start();
    try {
      await manager.stopTunnel(target);
      spinner.succeed(chalk.green(`Tunnel "${target}" stopped.`));
    } catch (err) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

program
  .command('stop-all')
  .description('Stop all active tunnels')
  .action(async () => {
    const spinner = ora('Stopping all tunnels...').start();
    await manager.stopAll();
    spinner.succeed(chalk.green('All tunnels stopped.'));
  });

program
  .command('setup')
  .description('Install cloudflared binary if not present')
  .action(async () => {
    const spinner = ora('Checking cloudflared...').start();
    try {
      await manager.ensureCloudflared();
      spinner.succeed(chalk.green('cloudflared is ready.'));
    } catch (err) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

program
  .command('quick')
  .alias('q')
  .description('Quick tunnel - expose port with zero config')
  .argument('[port]', 'Port to expose', '8080')
  .action(async (port) => {
    const spinner = ora('Creating quick tunnel...').start();
    try {
      await manager.ensureCloudflared();
      const tunnel = await manager.createTunnel({
        port: parseInt(port),
        name: `quick-${port}`,
        autoReconnect: true,
      });

      spinner.succeed('');
      console.log(chalk.bold.green('\n  🔗 Quick Tunnel Ready!\n'));
      console.log(`  ${chalk.cyan('URL:')}     ${chalk.bold.underline(tunnel.url)}`);
      console.log(`  ${chalk.gray('Local:')}   http://localhost:${port}`);
      console.log(`  ${chalk.gray('PID:')}     ${tunnel.process?.pid || 'n/a'}`);
      console.log('');
      console.log(chalk.gray('  Ctrl+C to stop\n'));

      process.on('SIGINT', async () => {
        await manager.stopTunnel(tunnel.id);
        process.exit(0);
      });

    } catch (err) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

program.parse();
