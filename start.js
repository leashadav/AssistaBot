/**
 * @file Manages the startup and monitoring of Discord and Twitch bot processes.
 * @module start
 * @description This module handles the initialization, monitoring, and graceful shutdown
 * of the Discord and Twitch bot processes. It also manages webhook notifications for
 * process events and system status updates.
 */

const { fork } = require('child_process');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const configLoader = require('./modules/configLoader');

// Configuration
const WEBHOOK_URL = process.env.DISCORD_STATUS_WEBHOOK_URL || configLoader.config.WEBHOOK_URL;

/**
 * Debug mode flag. When true, additional debug information is included in logs and webhooks.
 * @type {boolean}
 */
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

// Initialize the alert server for real-time notifications
const { startAlertServer } = require('./alerts/server');

// Start the alert server
startAlertServer().catch(error => {
    console.error('❌ Failed to start alert server:', error);
});

/**
 * Sends an embedded message to a Discord webhook.
 * @param {string} title - The title of the embed.
 * @param {Object} [data={}] - Additional data to include as fields in the embed.
 * @param {number} [color=0xff6600] - The color of the embed in decimal format.
 * @returns {void}
 */
function sendWebhookEmbed(title, data = {}, color = 0xff6600) {
  if (!WEBHOOK_URL) return;
  try {
    const url = new URL(WEBHOOK_URL);
    const extra = DEBUG ? {
      pid: process.pid,
      cwd: process.cwd(),
      node: process.version,
      platform: process.platform,
      argv: process.argv.slice(2).join(' ')
    } : {};
    const merged = { ...(data || {}), ...(DEBUG ? { debug: extra } : {}) };
    const fields = Object.entries(merged).map(([k, v]) => ({
      name: String(k),
      value: typeof v === 'string' ? v : '```json\n' + JSON.stringify(v, null, 2) + '\n```',
      inline: false
    }));

    const body = JSON.stringify({ embeds: [{ title, color, timestamp: new Date().toISOString(), fields }] });
    const opts = {
      method: 'POST',
      hostname: url.hostname,
      path: (url.pathname || '/') + (url.search || ''),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, res => { res.on('data', () => {}); });
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch (error) {
    console.error('Webhook error:', error);
  }
}

/**
 * Map to track active bot processes by their script name.
 * @type {Map<string, import('child_process').ChildProcess>}
 */
const processes = new Map();

/**
 * Starts a bot process and sets up event listeners for process management.
 * @param {string} scriptName - The name of the script to start (e.g., 'index.js', 'twitch.js').
 * @returns {import('child_process').ChildProcess} The spawned child process.
 * @throws {Error} If the script fails to start or encounters an error.
 */
function startBot(scriptName) {
    const scriptPath = path.join(__dirname, scriptName);
    console.log(`[${scriptName}] Starting bot process`);
    sendWebhookEmbed('Bot Start', { script: scriptName });

    const proc = fork(scriptPath, [], {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'] // Include an IPC channel so we can send graceful shutdown messages
    });

    processes.set(scriptName, proc);

    proc.on('exit', (code, signal) => {
        console.log(`[${scriptName}] Process exited with code ${code} and signal ${signal}`);
        sendWebhookEmbed('Bot Exit', { script: scriptName, code, signal }, 0xf59e0b);
        processes.delete(scriptName);

        if (code !== 0 && !shuttingDown) {
            const delay = 5000;
            console.warn(`[${scriptName}] Process crashed, restarting in ${delay}ms`);
            sendWebhookEmbed('Bot Restart Scheduled', { script: scriptName, delay_ms: delay }, 0xf59e0b);
            setTimeout(() => startBot(scriptName), delay);
        }
    });

    return proc;
}

// Start both Discord and Twitch bot processes
let shuttingDown = false;

// Start Discord bot
startBot('index.js');

// Start Twitch bot
startBot('twitch.js');

/**
 * Handles graceful shutdown of all bot processes.
 * @param {string} signal - The signal that triggered the shutdown.
 * @returns {Promise<void>}
 */
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    const bots = Array.from(processes.keys());
    console.log(`Shutting down ${bots.join(', ')}`);
    
    const shutdownPromises = [];
    
    for (const [name, proc] of processes) {

        const shutdownPromise = new Promise((resolve) => {
            try {
                if (proc.connected && typeof proc.send === 'function') {
                    proc.send('graceful_shutdown');
                }
                // Fallback to SIGINT after a short grace period
                const forceKillTimer = setTimeout(() => {
                    try { 
                        if (!proc.killed) {
                            proc.kill('SIGTERM'); 
                        }
                    } catch (error) {
                        // Ignore errors during force kill
                    }
                    resolve();
                }, 1500);

                // If process exits before timeout, clear the timer
                proc.once('exit', () => {
                    clearTimeout(forceKillTimer);
                    resolve();
                });
            } catch (error) {
                console.error(`[${name}] Error during shutdown:`, error.message);
                resolve();
            }
        });
        
        shutdownPromises.push(shutdownPromise);
    }

    // Wait for all processes to shut down or timeout
    await Promise.race([
        Promise.all(shutdownPromises),
        new Promise(resolve => setTimeout(resolve, 5000))
    ]);

    // Force kill any remaining processes
    const remaining = [];
    for (const [name, proc] of processes) {
        if (!proc.killed) {
            remaining.push(name);
            try { 
                proc.kill('SIGKILL'); 
            } catch (error) {
                // Ignore errors during force kill
            }
        }
    }
    
    if (remaining.length > 0) {
        console.error(`Force stopped: ${remaining.join(', ')}`);
    }
    process.exit(0);
}

// Register signal handlers for graceful shutdown
process.on('SIGINT', shutdown);  // Ctrl+C
process.on('SIGTERM', shutdown); // kill command
process.on('SIGHUP', shutdown);  // Terminal closed

console.log({ event: 'launcher_started', message: 'Press Ctrl+C to shutdown all bots.' });
sendWebhookEmbed('Launcher Started', { message: 'Press Ctrl+C to shutdown all bots.' });