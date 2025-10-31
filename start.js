const { fork } = require('child_process');
const path = require('path');

// Track child processes
const processes = new Map();

// Helper to start a bot process
function startBot(scriptName) {
    const scriptPath = path.join(__dirname, scriptName);
    console.log(`Starting ${scriptName}...`);
    
    const proc = fork(scriptPath, [], {
        stdio: 'inherit' // Share console output
    });

    processes.set(scriptName, proc);

    proc.on('exit', (code, signal) => {
        console.log(`${scriptName} exited with code ${code} (signal: ${signal})`);
        processes.delete(scriptName);
        
        // If one bot crashes, restart it after a delay
        if (code !== 0 && !shuttingDown) {
            console.log(`Restarting ${scriptName} in 5 seconds...`);
            setTimeout(() => startBot(scriptName), 5000);
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
    
    console.log('\nShutting down all bots...');
    
    // Send SIGINT to all processes
    for (const [name, proc] of processes) {
        console.log(`Stopping ${name}...`);
        proc.kill('SIGINT');
    }

    // Give processes time to cleanup
    setTimeout(() => {
        console.log('Force stopping any remaining processes...');
        for (const [name, proc] of processes) {
            proc.kill('SIGTERM');
        }
        process.exit(0);
    }, 5000); // Force exit after 5 seconds if graceful shutdown fails
}

// Handle various ways to exit
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

console.log('Bot launcher started. Press Ctrl+C to shutdown all bots.');