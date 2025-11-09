const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const twitchTimers = require('../modules/twitchTimers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timer')
    .setDescription('Manage Twitch chat timers')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a new timer')
        .addStringOption(option => option.setName('name').setDescription('Timer name').setRequired(true))
        .addStringOption(option => option.setName('message').setDescription('Message to post').setRequired(true))
        .addIntegerOption(option => option.setName('interval').setDescription('Interval in minutes (default: 10)').setMinValue(1).setMaxValue(120))
        .addStringOption(option => option.setName('games').setDescription('Comma-separated game names to filter (optional)'))
        .addIntegerOption(option => option.setName('min_viewers').setDescription('Minimum viewers required (default: 0)').setMinValue(0))
        .addIntegerOption(option => option.setName('min_lines').setDescription('Minimum chat lines required (default: 0)').setMinValue(0))
        .addBooleanOption(option => option.setName('enabled').setDescription('Enable timer (default: true)')))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a timer')
        .addStringOption(option => option.setName('name').setDescription('Timer name').setRequired(true).setAutocomplete(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('toggle')
        .setDescription('Enable/disable a timer')
        .addStringOption(option => option.setName('name').setDescription('Timer name').setRequired(true).setAutocomplete(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all timers'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('Edit an existing timer')
        .addStringOption(option => option.setName('name').setDescription('Timer name').setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName('message').setDescription('New message'))
        .addIntegerOption(option => option.setName('interval').setDescription('New interval in minutes').setMinValue(1).setMaxValue(120))
        .addStringOption(option => option.setName('games').setDescription('New game filter (comma-separated)'))
        .addIntegerOption(option => option.setName('min_viewers').setDescription('New minimum viewers').setMinValue(0))
        .addIntegerOption(option => option.setName('min_lines').setDescription('New minimum chat lines').setMinValue(0))
        .addBooleanOption(option => option.setName('enabled').setDescription('Enable/disable timer'))),

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name === 'name') {
      const timers = twitchTimers.listTimers(interaction.guild.id);
      const allNames = [...Object.keys(timers.global), ...Object.keys(timers.guild)];
      const filtered = allNames.filter(name => name.toLowerCase().includes(focusedOption.value.toLowerCase()));
      await interaction.respond(filtered.slice(0, 25).map(name => ({ name, value: name })));
    }
  },

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: '❌ This command can only be used in a server.', flags: 64 });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === 'add') {
        const name = interaction.options.getString('name');
        const message = interaction.options.getString('message');
        const interval = interaction.options.getInteger('interval') || 10;
        const games = interaction.options.getString('games');
        const minViewers = interaction.options.getInteger('min_viewers') || 0;
        const minLines = interaction.options.getInteger('min_lines') || 0;
        const enabled = interaction.options.getBoolean('enabled') ?? true;

        const gameFilter = games ? games.split(',').map(g => g.trim()).filter(Boolean) : null;

        const success = twitchTimers.addTimer(interaction.guild.id, name, {
          message,
          interval,
          gameFilter,
          minViewers,
          minLines,
          enabled
        });

        if (success) {
          let response = `✅ Added timer "${name}"\n`;
          response += `📝 Message: ${message}\n`;
          response += `⏰ Interval: ${interval} minutes\n`;
          response += `👥 Min viewers: ${minViewers}`;
          response += `\n💬 Min lines: ${minLines}`;
          response += `\n${enabled ? '✅' : '❌'} Enabled: ${enabled}`;
          if (gameFilter) {
            response += `\n🎮 Games: ${gameFilter.join(', ')}`;
          }
          return interaction.reply({ content: response, flags: 64 });
        } else {
          return interaction.reply({ content: '❌ Failed to add timer.', flags: 64 });
        }
      }

      if (subcommand === 'remove') {
        const name = interaction.options.getString('name');
        const success = twitchTimers.removeTimer(interaction.guild.id, name);

        if (success) {
          return interaction.reply({ content: `✅ Removed timer "${name}"`, flags: 64 });
        } else {
          const timers = twitchTimers.listTimers(interaction.guild.id);
          const allNames = [...Object.keys(timers.global), ...Object.keys(timers.guild)];
          const namesList = allNames.length > 0 ? `\n\nAvailable timers: ${allNames.join(', ')}` : '';
          return interaction.reply({ content: `❌ Timer "${name}" not found.${namesList}`, flags: 64 });
        }
      }

      if (subcommand === 'toggle') {
        const name = interaction.options.getString('name');
        const newState = twitchTimers.toggleTimer(interaction.guild.id, name);

        if (newState !== null) {
          const status = newState ? 'enabled' : 'disabled';
          return interaction.reply({ content: `✅ Timer "${name}" ${status}`, flags: 64 });
        } else {
          const timers = twitchTimers.listTimers(interaction.guild.id);
          const allNames = [...Object.keys(timers.global), ...Object.keys(timers.guild)];
          const namesList = allNames.length > 0 ? `\n\nAvailable timers: ${allNames.join(', ')}` : '';
          return interaction.reply({ content: `❌ Timer "${name}" not found.${namesList}`, flags: 64 });
        }
      }

      if (subcommand === 'list') {
        const timers = twitchTimers.listTimers(interaction.guild.id);
        let response = '**Twitch Chat Timers**\n\n';

        if (Object.keys(timers.global).length > 0) {
          response += '🌐 **Global Timers:**\n';
          for (const [name, timer] of Object.entries(timers.global)) {
            const status = timer.enabled ? '✅' : '❌';
            response += `${status} **${name}** - ${timer.interval}m`;
            if (timer.gameFilter) response += ` (Games: ${timer.gameFilter.join(', ')})`;
            if (timer.minViewers > 0) response += ` (Min viewers: ${timer.minViewers})`;
            if (timer.minLines > 0) response += ` (Min lines: ${timer.minLines})`;
            response += '\n';
          }
          response += '\n';
        }

        if (Object.keys(timers.guild).length > 0) {
          response += '🏠 **Server Timers:**\n';
          for (const [name, timer] of Object.entries(timers.guild)) {
            const status = timer.enabled ? '✅' : '❌';
            response += `${status} **${name}** - ${timer.interval}m`;
            if (timer.gameFilter) response += ` (Games: ${timer.gameFilter.join(', ')})`;
            if (timer.minViewers > 0) response += ` (Min viewers: ${timer.minViewers})`;
            if (timer.minLines > 0) response += ` (Min lines: ${timer.minLines})`;
            response += '\n';
          }
        } else if (Object.keys(timers.global).length === 0) {
          response += 'No timers configured.';
        }

        return interaction.reply({ content: response, flags: 64 });
      }

      if (subcommand === 'edit') {
        const name = interaction.options.getString('name');
        const message = interaction.options.getString('message');
        const interval = interaction.options.getInteger('interval');
        const games = interaction.options.getString('games');
        const minViewers = interaction.options.getInteger('min_viewers');
        const minLines = interaction.options.getInteger('min_lines');
        const enabled = interaction.options.getBoolean('enabled');

        const timers = twitchTimers.listTimers(interaction.guild.id);
        const existingTimer = timers.global[name] || timers.guild[name];
        
        if (!existingTimer) {
          const allNames = [...Object.keys(timers.global), ...Object.keys(timers.guild)];
          const namesList = allNames.length > 0 ? `\n\nAvailable timers: ${allNames.join(', ')}` : '';
          return interaction.reply({ content: `❌ Timer "${name}" not found.${namesList}`, flags: 64 });
        }

        const updates = {};
        if (message) updates.message = message;
        if (interval) updates.interval = interval;
        if (games !== null) updates.gameFilter = games ? games.split(',').map(g => g.trim()).filter(Boolean) : null;
        if (minViewers !== null) updates.minViewers = minViewers;
        if (minLines !== null) updates.minLines = minLines;
        if (enabled !== null) updates.enabled = enabled;

        const success = twitchTimers.addTimer(interaction.guild.id, name, {
          ...existingTimer,
          ...updates
        });

        if (success) {
          let response = `✅ Updated timer "${name}"\n`;
          const updatedTimer = { ...existingTimer, ...updates };
          response += `📝 Message: ${updatedTimer.message}\n`;
          response += `⏰ Interval: ${updatedTimer.interval} minutes\n`;
          response += `👥 Min viewers: ${updatedTimer.minViewers}`;
          response += `\n💬 Min lines: ${updatedTimer.minLines || 0}`;
          response += `\n${updatedTimer.enabled ? '✅' : '❌'} Enabled: ${updatedTimer.enabled}`;
          if (updatedTimer.gameFilter) {
            response += `\n🎮 Games: ${updatedTimer.gameFilter.join(', ')}`;
          }
          return interaction.reply({ content: response, flags: 64 });
        } else {
          return interaction.reply({ content: '❌ Failed to update timer.', flags: 64 });
        }
      }

    } catch (error) {
      console.error('Timer command error:', error);
      return interaction.reply({ content: '❌ An error occurred while processing the timer command.', flags: 64 });
    }
  },
};