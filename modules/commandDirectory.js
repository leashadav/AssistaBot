const customCommands = require('./customCommands');
const PUBLIC_COMMAND_DIRECTORY_URL = 'https://leashadav.github.io/AssistaBot/commands/';

const TWITCH_BUILT_INS = [
  { name: 'ad', aliases: ['ads'], description: 'Start a Twitch ad break, when the channel is eligible.' },
  { name: 'botcommands', description: 'Get a link to the built-in bot command directory.' },
  { name: 'pimpmeout', description: 'Add yourself to the automatic shoutout list.' },
  { name: 'song', description: 'Show the song currently playing on YouTube.' },
  { name: 'testvoice', description: 'Test stream voice announcements while live (broadcaster only).' }
];

const DISCORD_BUILT_INS = [
  { name: 'addcom', aliases: ['addcommand'], usage: '!addcom <name> <response>', description: 'Add a server custom command (Manage Server required).' },
  { name: 'botcommands', description: 'Get a link to the built-in bot command directory.' },
  { name: 'cominfo', usage: '!cominfo <name>', description: 'Show the response, cooldown, and access settings for a custom command.' },
  { name: 'coms', aliases: ['commands'], description: 'List built-in and custom prefix commands available in this server.' },
  { name: 'delcom', aliases: ['delcommand', 'removecom'], usage: '!delcom <name>', description: 'Remove a server custom command (Manage Server required).' },
  { name: 'reloadcom', aliases: ['reloadcoms'], description: 'Reload custom and global commands (bot owner only).' },
  { name: 'setcom', usage: '!setcom <name> <cooldown|perm|roles> <value>', description: 'Change a custom command’s cooldown or access settings (Manage Server required).' },
  { name: 'testfetch', usage: '!testfetch <url>', description: 'Fetch and display a text preview from a URL (bot owner only).' }
];

function getPublicUrl() {
  return PUBLIC_COMMAND_DIRECTORY_URL;
}

function describeCustomCommand(command) {
  if (typeof command.description === 'string' && command.description.trim()) {
    return command.description.trim();
  }

  return 'Send the configured custom response in chat.';
}

function getCustomCommands(builtIns) {
  const reservedNames = new Set();
  for (const command of builtIns) {
    reservedNames.add(command.name);
    for (const alias of command.aliases || []) reservedNames.add(alias);
  }

  return customCommands.listCommands().flatMap(name => {
    if (reservedNames.has(name)) return [];
    const command = customCommands.getCommand(null, name);
    if (!command) return [];

    return [{
      name,
      aliases: Array.isArray(command.aliases) ? command.aliases : [],
      description: describeCustomCommand(command),
      ...(command.requiredPermission ? { access: `Requires ${command.requiredPermission}` } : {})
    }];
  });
}

function sortCommands(commands) {
  return commands.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
}

function createDirectory(twitch, discord) {
  const discordNames = new Set(discord.map(command => command.name));

  return {
    twitchOnly: sortCommands(twitch.filter(command => !discordNames.has(command.name))),
    discordOnly: sortCommands(discord.filter(command => !twitch.some(twitchCommand => twitchCommand.name === command.name))),
    both: sortCommands(twitch.filter(command => discordNames.has(command.name)))
  };
}

function getDirectory() {
  customCommands.reload();
  const twitch = [...TWITCH_BUILT_INS, ...getCustomCommands(TWITCH_BUILT_INS)];
  const discord = [...DISCORD_BUILT_INS, ...getCustomCommands(DISCORD_BUILT_INS)];
  return createDirectory(twitch, discord);
}

module.exports = { getDirectory, getPublicUrl };
