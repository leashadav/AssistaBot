// Example Twitch command processor usage
const customCommands = require('./modules/customCommands');

async function handleTwitchMessage(message, channel) {
    if (!message.content.startsWith('!')) return;

    const parts = message.content.slice(1).split(/\s+/);
    const cmd = parts.shift().toLowerCase();
    const args = parts;

    // Get target user (first argument if present)
    const targetUser = args.length > 0 ? args[0] : null;

    // Find the command
    const command = customCommands.getCommand(channel, cmd);
    if (!command) return;

    // Check cooldown
    const remaining = customCommands.getCooldownRemaining(channel, cmd, message.userId);
    if (remaining > 0) {
        // Optional: notify user of cooldown
        return;
    }

    // Process command with Twitch context
    const context = {
        platform: 'twitch',
        message: {
            username: message.username,
            userId: message.userId,
            color: message.color,
            badges: message.badges || {},
            subscriber: message.subscriber,
            mod: message.mod,
            vip: message.vip,
            subscriberMonths: message.subscriberMonths,
            id: message.id
        },
        channel,
        targetUser,
        args
    };

    const response = await customCommands.processCommand(command, context);
    if (response) {
        // Send response to Twitch chat
        // client.say(channel, response);
        
        // Record command use for cooldown
        customCommands.recordCommandUse(channel, cmd, message.userId);
    }
}

module.exports = { handleTwitchMessage };