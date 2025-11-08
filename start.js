const { fork } = require('child_process');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const configLoader = require('./modules/configLoader');
const { WEBHOOK_URL } = configLoader.config;
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

function sendWebhookEmbed(title, data, color = 0xff6600) {
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
  } catch (_) {}
}

// Track child processes
const processes = new Map();

// Helper to start a bot process
function startBot(scriptName) {
    const scriptPath = path.join(__dirname, scriptName);
    console.info({ event: 'bot_start', script: scriptName });
    sendWebhookEmbed('Bot Start', { script: scriptName });

    const proc = fork(scriptPath, [], {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'] // Include an IPC channel so we can send graceful shutdown messages
    });

    processes.set(scriptName, proc);

    proc.on('exit', (code, signal) => {
        console.info({ event: 'bot_exit', script: scriptName, code, signal });
        sendWebhookEmbed('Bot Exit', { script: scriptName, code, signal }, 0xf59e0b);
        processes.delete(scriptName);

        if (code !== 0 && !shuttingDown) {
            const delay = 5000;
            console.warn({ event: 'bot_restart_scheduled', script: scriptName, delay_ms: delay });
            sendWebhookEmbed('Bot Restart Scheduled', { script: scriptName, delay_ms: delay }, 0xf59e0b);
            setTimeout(() => startBot(scriptName), delay);
        }
    });

    return proc;
}

// Start both bots
let shuttingDown = false;
startBot('index.js');  // Discord bot
startBot('twitch.js'); // Twitch bot

// Handle graceful shutdown
async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;

    const bots = Array.from(processes.keys());
    console.info({ event: 'shutdown_begin', bots });
    sendWebhookEmbed('Shutdown Begin', { bots }, 0xef4444);

    for (const [name, proc] of processes) {
        console.info({ event: 'bot_stopping', script: name, signal: 'graceful_shutdown' });
        sendWebhookEmbed('Bot Stopping', { script: name, signal: 'graceful_shutdown' }, 0xef4444);
        try {
            if (proc.connected && typeof proc.send === 'function') {
                proc.send('graceful_shutdown');
            }
        } catch {}
        // Fallback to SIGINT after a short grace period to allow the bot to post shutdown logs
        setTimeout(() => {
            try { proc.kill('SIGINT'); } catch {}
        }, 1500);
    }

    setTimeout(() => {
        const remaining = Array.from(processes.keys());
        console.warn({ event: 'force_stop_pending', remaining });
        sendWebhookEmbed('Force Stop Pending', { remaining }, 0xef4444);
        for (const [name, proc] of processes) {
            console.warn({ event: 'bot_force_stop', script: name, signal: 'SIGTERM' });
            sendWebhookEmbed('Bot Force Stop', { script: name, signal: 'SIGTERM' }, 0xef4444);
            try { proc.kill('SIGTERM'); } catch {}
        }
        process.exit(0);
    }, 7000); // Slightly longer to allow Discord sends to complete
}

// Handle various ways to exit
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

console.info({ event: 'launcher_started', message: 'Press Ctrl+C to shutdown all bots.' });
sendWebhookEmbed('Launcher Started', { message: 'Press Ctrl+C to shutdown all bots.' });