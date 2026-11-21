const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rumble')
    .setDescription('Manage Rumble stream alerts, roles, and server settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add a Rumble streamer to monitor')
        .addStringOption(opt =>
          opt
            .setName('username')
            .setDescription('The Rumble username (without @)')
            .setRequired(true)
        )
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('The Discord channel for notifications')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('live_role')
            .setDescription('Role(s) to assign when streamer goes live (comma-separated, e.g., @role1, @role2)')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt
            .setName('message')
            .setDescription('Alert message; supports {streamer}, {url}, {platform}, {title}, {game}')
            .setRequired(false)
        )
        .addIntegerOption(opt =>
          opt
            .setName('cooldown')
            .setDescription('Cooldown in seconds before sending another notification for the same streamer')
            .setRequired(false)
            .setMinValue(0)
        )
        .addUserOption(opt =>
          opt
            .setName('discord_user')
            .setDescription('Optional Discord user to assign roles to when live')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt
            .setName('cleanup')
            .setDescription('Delete the live alert when the stream ends')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('edit')
        .setDescription('Edit an existing streamer entry')
        .addStringOption(opt =>
          opt
            .setName('username')
            .setDescription('The Rumble username to edit')
            .setAutocomplete(true)
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('live_role')
            .setDescription('Update role(s) to assign when live (comma-separated, e.g., @role1, @role2)')
            .setRequired(false)
        )
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Update the Discord channel for notifications')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt
            .setName('message')
            .setDescription('Alert message; supports {streamer}, {url}, {platform}, {title}, {game}')
            .setRequired(false)
        )
        .addIntegerOption(opt =>
          opt
            .setName('cooldown')
            .setDescription('Update cooldown in seconds before sending another notification for the same streamer')
            .setRequired(false)
            .setMinValue(0)
        )
        .addUserOption(opt =>
          opt
            .setName('discord_user')
            .setDescription('Choose the Discord user to assign live roles to')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt
            .setName('cleanup')
            .setDescription('Delete the live alert when the stream ends')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a Rumble streamer from monitoring')
        .addStringOption(opt =>
          opt
            .setName('username')
            .setDescription('The Rumble username')
            .setAutocomplete(true)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List all monitored Rumble streamers for this server')
    )
    .addSubcommand(sub =>
      sub
        .setName('check')
        .setDescription('Check a streamer now and notify if a new live stream is found')
        .addStringOption(opt =>
          opt
            .setName('username')
            .setDescription('Choose a monitored Rumble streamer')
            .setAutocomplete(true)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('resend')
        .setDescription('Send the live alert again for a streamer who is currently live')
        .addStringOption(opt =>
          opt
            .setName('username')
            .setDescription('Choose a monitored Rumble streamer')
            .setAutocomplete(true)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('force')
        .setDescription('Reset the saved status, check now, and send an alert if live')
        .addStringOption(opt =>
          opt
            .setName('username')
            .setDescription('The Rumble username')
            .setAutocomplete(true)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('enable')
        .setDescription('Enable Rumble notifications for this server')
    )
    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable Rumble notifications for this server')
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Check if Rumble notifications are enabled for this server')
    ),

  async execute(interaction) {
    const RumbleBot = require('../modules/rumbleBot');
    let rumbleBot = interaction.client.rumbleBot;

    // Initialize if not already done
    if (!rumbleBot) {
      rumbleBot = new RumbleBot(interaction.client);
      interaction.client.rumbleBot = rumbleBot;
      
      // Start monitoring
      rumbleBot.startMonitoring(5 * 60 * 1000); // Check every 5 minutes
    }

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    try {
      if (subcommand === 'add') {
        await handleAdd(interaction, rumbleBot, guildId);
      } else if (subcommand === 'edit') {
        await handleEdit(interaction, rumbleBot, guildId);
      } else if (subcommand === 'remove') {
        await handleRemove(interaction, rumbleBot, guildId);
      } else if (subcommand === 'list') {
        await handleList(interaction, rumbleBot, guildId);
      } else if (subcommand === 'check') {
        await handleCheck(interaction, rumbleBot, guildId);
      } else if (subcommand === 'resend') {
        await handleResend(interaction, rumbleBot, guildId);
      } else if (subcommand === 'check') {
        await handleCheck(interaction, rumbleBot);
      } else if (subcommand === 'resend') {
        await handleResend(interaction, rumbleBot);
      } else if (subcommand === 'force') {
        await handleForce(interaction, rumbleBot);
      } else if (subcommand === 'enable') {
        await handleEnable(interaction, rumbleBot, guildId);
      } else if (subcommand === 'disable') {
        await handleDisable(interaction, rumbleBot, guildId);
      } else if (subcommand === 'status') {
        await handleStatus(interaction, rumbleBot, guildId);
      }
    } catch (error) {
      console.error('[Rumble Command] Error:', error);
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Error')
        .setDescription(`An error occurred: ${error.message}`)
        .setColor('#FF0000');
      
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [errorEmbed] });
      } else {
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }
  },

  getEditDefaults({ client, guildId, target }) {
    const rumbleBot = client.rumbleBot;
    const saved = rumbleBot?.getStreamer(target, guildId);
    if (!saved) return {};

    const member = saved.discordUsername
      ? client.guilds.cache.get(guildId)?.members.cache.find(
        candidate => candidate.user.username.toLowerCase() === saved.discordUsername.toLowerCase()
      )
      : null;
    return {
      channel: saved.channelId,
      message: saved.customMessage,
      cooldown: saved.cooldown,
      discord_user: member?.id || saved.discordUsername,
      live_role: saved.liveRoles || [],
      cleanup: saved.cleanup
    };
  },

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const RumbleBot = require('../modules/rumbleBot');
    let rumbleBot = interaction.client.rumbleBot;

    if (!rumbleBot) {
      rumbleBot = new RumbleBot(interaction.client);
      interaction.client.rumbleBot = rumbleBot;
    }

    if (focusedOption.name === 'username') {
      const guildStreamers = rumbleBot.listStreamers(interaction.guildId);
      const query = focusedOption.value.trim().toLowerCase();
      const usernames = [...new Map(
        guildStreamers.map(({ username }) => [username.toLowerCase(), username])
      ).values()];
      const filtered = usernames
        .filter(username => username.toLowerCase().startsWith(query))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 25);

      await interaction.respond(
        filtered.map(name => ({ name, value: name }))
      );
    }
  }
};

async function handleAdd(interaction, rumbleBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const username = interaction.options.getString('username').toLowerCase().trim();
  const channel = interaction.options.getChannel('channel');
  const customMessage = interaction.options.getString('message') || '';
  const cooldown = interaction.options.getInteger('cooldown') || 0;
  const discordUser = interaction.options.getUser('discord_user');
  const liveRoleString = interaction.options.getString('live_role');

  if (!channel) {
    return interaction.editReply('❌ Channel not found');
  }

  // Whitelist check removed - all roles can now be used for live notifications

  const liveRoles = liveRoleString ? parseRoleString(liveRoleString) : [];
  const discordUsername = discordUser ? discordUser.id : '';
  const cleanup = interaction.options.getBoolean('cleanup') || false;

  const added = rumbleBot.addStreamer(username, guildId, channel.id, customMessage, discordUsername, liveRoles, cleanup, cooldown);

  if (!added) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Streamer Already Monitored')
      .setDescription(`**${username}** is already being monitored in <#${channel.id}>`)
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Streamer Added')
    .setDescription(`Successfully added **${username}** to monitoring`)
    .addFields(
      { name: 'Channel', value: `<#${channel.id}>`, inline: true }
    );

  if (liveRoles.length > 0) {
    embed.addFields({ name: 'Live Roles', value: liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });
  }
  if (customMessage) {
    embed.addFields({ name: 'Custom Message', value: customMessage, inline: false });
  }
  if (cooldown > 0) {
    embed.addFields({ name: 'Cooldown', value: `${cooldown}s`, inline: true });
  }
  if (cleanup) {
    embed.addFields({ name: 'Cleanup', value: 'Enabled', inline: true });
  }

  await interaction.editReply({ embeds: [embed] });
}

function parseRoleString(roleString) {
  if (!roleString) return [];
  
  const roles = [];
  const parts = roleString.split(',').map(s => s.trim()).filter(s => s);
  
  for (const part of parts) {
    // Check for role mention <@&123456789>
    const mentionMatch = part.match(/<@&(\d+)>/);
    if (mentionMatch) {
      roles.push(mentionMatch[1]);
      continue;
    }
    
    // Check for raw ID (numeric string)
    if (/^\d+$/.test(part)) {
      roles.push(part);
      continue;
    }
  }
  
  return [...new Set(roles)]; // Remove duplicates
}

async function handleEdit(interaction, rumbleBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const username = interaction.options.getString('username').toLowerCase().trim();
  const channel = interaction.options.getChannel('channel');
  const customMessage = interaction.options.getString('message');
  const discordUser = interaction.options.getUser('discord_user');
  const liveRoleString = interaction.options.getString('live_role');

  // Whitelist check removed - all roles can now be used for live notifications

  const updates = {};
  
  if (channel) {
    updates.channelId = channel.id;
  }
  if (customMessage !== null) {
    updates.customMessage = customMessage;
  }
  if (discordUser) {
    updates.discordUsername = discordUser.id;
  }
  if (liveRoleString !== null) {
    updates.liveRoles = parseRoleString(liveRoleString);
  }
  const cooldown = interaction.options.getInteger('cooldown');
  if (cooldown !== null) updates.cooldown = cooldown;
  const cleanup = interaction.options.getBoolean('cleanup');
  if (cleanup !== null) updates.cleanup = cleanup;

  const edited = rumbleBot.editStreamer(username, guildId, updates);

  if (!edited) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Streamer Not Found')
      .setDescription(`**${username}** is not being monitored in this server`)
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Streamer Updated')
    .setDescription(`Successfully updated **${username}**`);

  if (channel) {
    embed.addFields({ name: 'Channel', value: `<#${channel.id}>`, inline: true });
  }
  if (customMessage !== null) {
    embed.addFields({ name: 'Custom Message', value: customMessage || '(cleared)', inline: false });
  }
  if (cooldown !== null) {
    embed.addFields({ name: 'Cooldown', value: `${cooldown}s`, inline: true });
  }
  if (discordUser) {
    embed.addFields({ name: 'Discord User', value: `${discordUser.username}`, inline: true });
  }
  if (updates.liveRoles && updates.liveRoles.length > 0) {
    embed.addFields({ name: 'Live Roles', value: updates.liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });
  }

  embed.setColor('#FF6600');

  await interaction.editReply({ embeds: [embed] });
}

async function handleRemove(interaction, rumbleBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const username = interaction.options.getString('username').toLowerCase().trim();
  const removed = rumbleBot.removeStreamer(username, guildId);

  if (!removed) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Streamer Not Found')
      .setDescription(`**${username}** is not being monitored in this server`)
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Streamer Removed')
    .setDescription(`Successfully removed **${username}** from monitoring`)
    .setColor('#FF6600');

  await interaction.editReply({ embeds: [embed] });
}

async function handleList(interaction, rumbleBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const streamers = rumbleBot.listStreamers(guildId);

  if (streamers.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('📺 Monitored Streamers')
      .setDescription('No Rumble streamers are being monitored in this server yet.\nUse `/rumble add` to start monitoring!')
      .setColor('#0099FF');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('📺 Monitored Rumble Streamers')
    .setDescription(streamers.map(s => s.username).join('\n'))
    .setColor('#FF6600');

  await interaction.editReply({ embeds: [embed] });
}


async function handleForce(interaction, rumbleBot) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const username = interaction.options.getString('username').toLowerCase().trim();

  const embed = new EmbedBuilder()
    .setTitle('⏳ Forcing Check...')
    .setDescription(`Resetting status and checking **${username}**...`)
    .setColor('#FF6600');

  await interaction.editReply({ embeds: [embed] });

  try {
    // Force reset to offline
    rumbleBot.forceOffline(username);
    
    // Check status and trigger notification if live
    const status = await rumbleBot.manualCheck(username);

    const statusText = status.isLive ? '🔴 LIVE' : '⬜ Offline';
    const resultEmbed = new EmbedBuilder()
      .setTitle(`${username} - Forced Check Complete`)
      .setURL(`https://rumble.com/${username}`)
      .setColor('#FF6600')
      .addFields(
        { name: 'Status', value: statusText, inline: true },
        { name: 'Notification', value: status.isLive ? 'Sent ✅' : 'Not sent (offline)', inline: true },
        { name: 'Title', value: status.title || 'N/A', inline: false }
      );

    if (status.thumbnail) {
      resultEmbed.setThumbnail(status.thumbnail);
    }

    await interaction.editReply({ embeds: [resultEmbed] });
  } catch (error) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Force Check Failed')
      .setDescription(`Error checking ${username}: ${error.message}`)
      .setColor('#FF0000');

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function handleCheck(interaction, rumbleBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const username = interaction.options.getString('username').toLowerCase().trim();
  if (!rumbleBot.getStreamer(username, guildId)) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Streamer not monitored')
      .setDescription(`**${username}** is not monitored in this server. Add them with \`/rumble add\` first.`)
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const status = await rumbleBot.manualCheck(username);
  const embed = new EmbedBuilder()
    .setTitle(`Rumble status: ${username}`)
    .setColor(status.isLive ? '#85C742' : '#FFA500')
    .addFields(
      { name: 'Status', value: status.isLive ? '🔴 Live' : '⚫ Offline', inline: true },
      { name: 'Title', value: status.title || 'Not available', inline: true }
    );

  if (status.liveStreamUrl) embed.setURL(status.liveStreamUrl);
  if (status.thumbnail) embed.setThumbnail(status.thumbnail);
  if (status.isLive) {
    embed.setFooter({ text: 'A new live session may also trigger its notification.' });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleResend(interaction, rumbleBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const username = interaction.options.getString('username').toLowerCase().trim();
  if (!rumbleBot.getStreamer(username, guildId)) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Streamer not monitored')
      .setDescription(`**${username}** is not monitored in this server. Add them with \`/rumble add\` first.`)
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }
  if (!rumbleBot.isGuildEnabled(guildId)) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Rumble alerts are paused')
      .setDescription("Enable this server's Rumble alerts with `/rumble enable` before resending.")
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const wasLive = rumbleBot.getStreamerStatus(username).isLive;
  const status = await rumbleBot.manualCheck(username);

  if (!status.isLive) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Streamer is offline')
      .setDescription(`**${username}** is not live right now, so no alert was sent.`)
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  if (wasLive) await rumbleBot.notifyStreamerLive(username, status);

  const embed = new EmbedBuilder()
    .setTitle('✅ Live alert sent')
    .setDescription(`Sent the Rumble live alert for **${username}**.`)
    .setColor('#85C742');
  if (status.liveStreamUrl) embed.setURL(status.liveStreamUrl);
  await interaction.editReply({ embeds: [embed] });
}

async function handleEnable(interaction, rumbleBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const success = rumbleBot.setGuildEnabled(guildId, true);

  const embed = new EmbedBuilder()
    .setTitle(success ? '✅ Rumble Notifications Enabled' : '❌ Error')
    .setDescription(success ? 'Rumble live notifications are now **enabled** for this server.' : 'Failed to enable notifications.')
    .setColor(success ? '#85C742' : '#FF0000');

  await interaction.editReply({ embeds: [embed] });
}

async function handleDisable(interaction, rumbleBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const success = rumbleBot.setGuildEnabled(guildId, false);

  const embed = new EmbedBuilder()
    .setTitle(success ? '⏸️ Rumble Notifications Disabled' : '❌ Error')
    .setDescription(success ? 'Rumble live notifications are now **disabled** for this server.\n\nNo notifications will be sent until re-enabled.' : 'Failed to disable notifications.')
    .setColor(success ? '#FFA500' : '#FF0000');

  await interaction.editReply({ embeds: [embed] });
}

async function handleStatus(interaction, rumbleBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const isEnabled = rumbleBot.isGuildEnabled(guildId);
  const streamers = rumbleBot.listStreamers(guildId);

  const embed = new EmbedBuilder()
    .setTitle('📊 Rumble Module Status')
    .addFields(
      { name: 'Status', value: isEnabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
      { name: 'Monitored Streamers', value: streamers.length.toString(), inline: true }
    )
    .setDescription(isEnabled
      ? 'Notifications are active. You will receive alerts when monitored streamers go live.'
      : 'Notifications are paused. Use `/rumble enable` to resume notifications.')
    .setColor(isEnabled ? '#85C742' : '#FFA500');

  await interaction.editReply({ embeds: [embed] });
}