const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const guildSettings = require('../modules/guildSettings');
const configLoader = require('../modules/configLoader');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('twitch')
    .setDescription('Manage Twitch streamer alerts, presence alerts, roles, and cleanup')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup(group =>
      group
        .setName('streamer')
        .setDescription('Monitor Twitch streamers and customize their live alerts')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Add a Twitch streamer to monitor')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('The Twitch username')
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
                .setDescription('Cooldown in seconds before sending another Twitch streamer notification')
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
                .setDescription('The Twitch username to edit')
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
                .setDescription('Update the cooldown in seconds before sending another Twitch streamer notification')
                .setRequired(false)
                .setMinValue(0)
            )
            .addUserOption(opt =>
              opt
                .setName('discord_user')
                .setDescription('Discord user to assign roles to when live')
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
            .setDescription('Remove a Twitch streamer from monitoring')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('The Twitch username')
                .setAutocomplete(true)
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('list')
            .setDescription('List all monitored Twitch streamers for this server')
        )
        .addSubcommand(sub =>
          sub
            .setName('check')
            .setDescription('Manually check a streamer status')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('The Twitch username')
                .setAutocomplete(true)
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('resend')
            .setDescription('Resend notification for a live streamer')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('The Twitch username')
                .setAutocomplete(true)
                .setRequired(true)
            )
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('presence')
        .setDescription('Alert when members with selected roles stream on Twitch')
        .addSubcommand(sub =>
          sub
            .setName('setup')
            .setDescription('Configure presence-based Twitch streaming notifications')
            .addBooleanOption(opt =>
              opt
                .setName('enabled')
                .setDescription('Enable or disable Twitch streaming notifications')
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName('tracking_role')
                .setDescription('Role(s) that users must have to be monitored (comma-separated, e.g., @role1, @role2)')
                .setRequired(true)
            )
            .addChannelOption(opt =>
              opt
                .setName('channel')
                .setDescription('Channel to post Twitch notifications in')
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName('live_role')
                .setDescription('Role(s) to assign when user goes live (comma-separated, e.g., @role1, @role2)')
                .setRequired(false)
            )
            .addStringOption(opt =>
              opt
                .setName('message')
                .setDescription('Custom notification message (use {streamer}, {url}, {platform}, {title}, {game})')
                .setRequired(false)
            )
            .addIntegerOption(opt =>
              opt
                .setName('cooldown')
                .setDescription('Cooldown in seconds before sending another Twitch presence notification for the same user')
                .setRequired(false)
                .setMinValue(0)
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
            .setName('disable')
            .setDescription('Disable presence-based Twitch streaming notifications')
        )
        .addSubcommand(sub =>
          sub
            .setName('status')
            .setDescription('View current presence-based Twitch streaming settings')
        )
        .addSubcommand(sub =>
          sub
            .setName('edit')
            .setDescription('Edit presence-based Twitch streaming settings')
            .addBooleanOption(opt =>
              opt
                .setName('enabled')
                .setDescription('Enable or disable Twitch streaming notifications')
                .setRequired(false)
            )
            .addStringOption(opt =>
              opt
                .setName('tracking_role')
                .setDescription('Role(s) that users must have to be monitored (comma-separated, e.g., @role1, @role2)')
                .setRequired(false)
            )
            .addChannelOption(opt =>
              opt
                .setName('channel')
                .setDescription('Channel to post Twitch notifications in')
                .setRequired(false)
            )
            .addStringOption(opt =>
              opt
                .setName('live_role')
                .setDescription('Role(s) to assign when user goes live (comma-separated, e.g., @role1, @role2)')
                .setRequired(false)
            )
            .addStringOption(opt =>
              opt
                .setName('message')
                .setDescription('Custom notification message (use {streamer}, {url}, {platform}, {title}, {game})')
                .setRequired(false)
            )
            .addIntegerOption(opt =>
              opt
                .setName('cooldown')
                .setDescription('Cooldown in seconds before sending another Twitch presence notification for the same user')
                .setRequired(false)
                .setMinValue(0)
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
            .setName('check')
            .setDescription('Check which users with tracking roles are currently streaming')
        )
        .addSubcommand(sub =>
          sub
            .setName('resend')
            .setDescription('Resend notification for a streaming user')
            .addUserOption(opt =>
              opt
                .setName('user')
                .setDescription('The user to resend notification for')
                .setRequired(true)
            )
        )
    ),

  async execute(interaction) {
    const subcommandGroup = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    try {
      if (subcommandGroup === 'streamer') {
        const twitchBot = interaction.client.twitchStreamBot;
        if (!twitchBot) {
          return interaction.reply({ content: '❌ Twitch monitoring is not initialized yet. Please wait a moment and try again.', ephemeral: true });
        }

        if (subcommand === 'add') {
          await handleAdd(interaction, twitchBot, guildId);
        } else if (subcommand === 'edit') {
          await handleEdit(interaction, twitchBot, guildId);
        } else if (subcommand === 'remove') {
          await handleRemove(interaction, twitchBot, guildId);
        } else if (subcommand === 'list') {
          await handleList(interaction, twitchBot, guildId);
        } else if (subcommand === 'check') {
          await handleCheck(interaction, twitchBot);
        } else if (subcommand === 'resend') {
          await handleResend(interaction, twitchBot, guildId);
        }
      } else if (subcommandGroup === 'presence') {
        const presenceStreaming = interaction.client.presenceStreaming;
        if (!presenceStreaming) {
          return interaction.reply({ content: '❌ Presence streaming is not initialized yet. Please wait a moment and try again.', ephemeral: true });
        }

        if (subcommand === 'setup') {
          await handleTwitchSetup(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'disable') {
          await handleTwitchDisable(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'status') {
          await handleTwitchStatus(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'edit') {
          await handleTwitchEdit(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'check') {
          await handleTwitchPresenceCheck(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'resend') {
          await handleTwitchPresenceResend(interaction, presenceStreaming, guildId);
        }
      }
    } catch (error) {
      console.error('[Twitch Command] Error:', error);
      
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
    const twitchBot = client.twitchStreamBot;
    const saved = twitchBot?.getStreamer(target, guildId);
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
    const twitchBot = interaction.client.twitchStreamBot;

    if (!twitchBot) return interaction.respond([]);

    if (focusedOption.name === 'username') {
      const guildStreamers = twitchBot.listStreamers(interaction.guildId);
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

async function handleAdd(interaction, twitchBot, guildId) {
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

  const liveRoles = liveRoleString ? parseRoleString(liveRoleString) : [];
  const discordUsername = discordUser ? discordUser.id : '';
  const cleanup = interaction.options.getBoolean('cleanup') || false;

  const added = twitchBot.addStreamer(username, guildId, channel.id, customMessage, discordUsername, liveRoles, cleanup, cooldown);

  if (!added) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Streamer Already Monitored')
      .setDescription(`**${username}** is already being monitored`)
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

async function handleTwitchSetup(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const enabled = interaction.options.getBoolean('enabled');
  const trackingRoleString = interaction.options.getString('tracking_role');
  const liveRoleString = interaction.options.getString('live_role');
  const channel = interaction.options.getChannel('channel');
  const customMessage = interaction.options.getString('message') || '';
  const cooldown = interaction.options.getInteger('cooldown') || 0;
  const cleanup = interaction.options.getBoolean('cleanup') || false;

  // Parse comma-separated role mentions/IDs
  const trackingRoles = parseRoleString(trackingRoleString);
  const liveRoles = liveRoleString ? parseRoleString(liveRoleString) : [];

  if (trackingRoles.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('❌ Invalid Roles')
      .setDescription('Could not parse tracking roles. Please use role mentions like @role or role IDs.')
      .setColor('#FF0000');
    return interaction.editReply({ embeds: [embed] });
  }

  const settings = guildSettings.getSettings(guildId);
  
  settings.streaming.twitch = {
    enabled,
    trackingRoles,
    liveRoles,
    channelId: channel.id,
    customMessage,
    cooldown,
    cleanup,
    messageId: null
  };

  guildSettings.updateSettings(guildId, { streaming: settings.streaming });

  const embed = new EmbedBuilder()
    .setTitle('✅ Twitch Streaming Configured')
    .setDescription('Twitch streaming notifications have been configured')
    .setColor('#9146FF')
    .addFields(
      { name: 'Status', value: enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: 'Tracking Roles', value: trackingRoles.map(r => `<@&${r}>`).join(', '), inline: true },
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

async function handleTwitchDisable(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const settings = guildSettings.getSettings(guildId);
  if (!settings?.streaming?.twitch) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Configured')
      .setDescription('Twitch streaming is not configured for this server')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  settings.streaming.twitch.enabled = false;
  guildSettings.updateSettings(guildId, { streaming: settings.streaming });

  const embed = new EmbedBuilder()
    .setTitle('✅ Twitch Streaming Disabled')
    .setDescription('Twitch streaming notifications have been disabled')
    .setColor('#9146FF');

  await interaction.editReply({ embeds: [embed] });
}

async function handleTwitchStatus(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const settings = guildSettings.getSettings(guildId);
  
  if (!settings?.streaming?.twitch) {
    const embed = new EmbedBuilder()
      .setTitle('📺 Twitch Streaming Status')
      .setDescription('Twitch streaming is not configured for this server')
      .setColor('#9146FF');
    return interaction.editReply({ embeds: [embed] });
  }

  const twitch = settings.streaming.twitch;
  const embed = new EmbedBuilder()
    .setTitle('📺 Twitch Streaming Status')
    .setColor('#9146FF')
    .addFields(
      { name: 'Status', value: twitch.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: 'Tracking Roles', value: twitch.trackingRoles?.map(r => `<@&${r}>`).join(', ') || 'None', inline: true },
      { name: 'Channel', value: `<#${twitch.channelId}>`, inline: true }
    );

  if (twitch.liveRoles && twitch.liveRoles.length > 0) {
    embed.addFields({ name: 'Live Roles', value: twitch.liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });
  }
  if (twitch.customMessage) {
    embed.addFields({ name: 'Custom Message', value: twitch.customMessage, inline: false });
  }
  if (twitch.cooldown) {
    embed.addFields({ name: 'Cooldown', value: `${twitch.cooldown}s`, inline: true });
  }
  if (twitch.cleanup) {
    embed.addFields({ name: 'Cleanup', value: 'Enabled', inline: true });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleTwitchEdit(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const settings = guildSettings.getSettings(guildId);
  if (!settings?.streaming?.twitch) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Configured')
      .setDescription('Twitch streaming is not configured for this server. Use `/twitch presence setup` first.')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const enabled = interaction.options.getBoolean('enabled');
  const trackingRoleString = interaction.options.getString('tracking_role');
  const liveRoleString = interaction.options.getString('live_role');
  const channel = interaction.options.getChannel('channel');
  const customMessage = interaction.options.getString('message');
  const cooldown = interaction.options.getInteger('cooldown');
  const cleanup = interaction.options.getBoolean('cleanup');

  const updates = {};
  
  if (enabled !== null) updates.enabled = enabled;
  if (trackingRoleString !== null) {
    const trackingRoles = parseRoleString(trackingRoleString);
    if (trackingRoles.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('❌ Invalid Roles')
        .setDescription('Could not parse tracking roles. Please use role mentions like @role or role IDs.')
        .setColor('#FF0000');
      return interaction.editReply({ embeds: [embed] });
    }
    updates.trackingRoles = trackingRoles;
  }
  if (liveRoleString !== null) updates.liveRoles = parseRoleString(liveRoleString);
  if (channel) updates.channelId = channel.id;
  if (customMessage !== null) updates.customMessage = customMessage;
  if (cooldown !== null) updates.cooldown = cooldown;
  if (cleanup !== null) updates.cleanup = cleanup;

  if (Object.keys(updates).length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ No Changes')
      .setDescription('No options were provided to update.')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  Object.assign(settings.streaming.twitch, updates);
  guildSettings.updateSettings(guildId, { streaming: settings.streaming });

  const embed = new EmbedBuilder()
    .setTitle('✅ Twitch Streaming Updated')
    .setDescription('Twitch streaming settings have been updated')
    .setColor('#9146FF');

  if (updates.enabled !== undefined) embed.addFields({ name: 'Status', value: updates.enabled ? '✅ Enabled' : '❌ Disabled', inline: true });
  if (updates.trackingRoles) embed.addFields({ name: 'Tracking Roles', value: updates.trackingRoles.map(r => `<@&${r}>`).join(', '), inline: true });
  if (updates.liveRoles) embed.addFields({ name: 'Live Roles', value: updates.liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });
  if (updates.channelId) embed.addFields({ name: 'Channel', value: `<#${updates.channelId}>`, inline: true });
  if (updates.customMessage !== undefined) embed.addFields({ name: 'Custom Message', value: updates.customMessage || '(cleared)', inline: false });
  if (updates.cooldown !== undefined) embed.addFields({ name: 'Cooldown', value: `${updates.cooldown}s`, inline: true });
  if (updates.cleanup !== undefined) embed.addFields({ name: 'Cleanup', value: updates.cleanup ? 'Enabled' : 'Disabled', inline: true });

  await interaction.editReply({ embeds: [embed] });
}

async function handleTwitchPresenceCheck(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const settings = guildSettings.getSettings(guildId);
  if (!settings?.streaming?.twitch) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Configured')
      .setDescription('Twitch streaming is not configured for this server. Use `/twitch presence setup` first.')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const twitch = settings.streaming.twitch;
  if (!twitch.enabled) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Disabled')
      .setDescription('Twitch streaming notifications are disabled.')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const guild = interaction.guild;
  const trackingRoles = twitch.trackingRoles || [];
  const liveRoles = twitch.liveRoles || [];
  const channelId = twitch.channelId;

  if (trackingRoles.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ No Tracking Roles')
      .setDescription('No tracking roles are configured.')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  if (!channelId) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ No Channel')
      .setDescription('No notification channel is configured.')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  // Find all members with tracking roles who are streaming
  const streamingMembers = [];
  const allStreamingMembers = []; // Debug: track all streaming members regardless of platform
  
  for (const roleId of trackingRoles) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      console.error(`[Twitch Presence Check] Role ${roleId} not found`);
      continue;
    }

    for (const member of role.members.values()) {
      const twitchActivity = member.presence?.activities?.filter(a => a.type === 1).find(a => presenceStreaming.detectPlatform(a) === 'twitch');
      const allActivities = member.presence?.activities?.filter(a => a.type === 1) || [];
      
      for (const activity of allActivities) {
        const platform = presenceStreaming.detectPlatform(activity);
        allStreamingMembers.push({
          member,
          activity,
          platform
        });
      }
      
      if (twitchActivity) {
        streamingMembers.push({
          member,
          activity: twitchActivity,
          hasLiveRole: liveRoles.some(lr => member.roles.cache.has(lr))
        });
      }
    }
  }

  // Debug: Show all streaming members if no Twitch streamers found
  if (streamingMembers.length === 0 && allStreamingMembers.length > 0) {
    const debugEmbed = new EmbedBuilder()
      .setTitle('📺 Twitch Presence Check - Debug')
      .setDescription(`Found ${allStreamingMembers.length} user(s) streaming, but not on Twitch:`)
      .setColor('#FFA500');

    for (const { member, activity, platform } of allStreamingMembers) {
      debugEmbed.addFields({
        name: `${member.displayName}`,
        value: `**Platform:** ${platform}\n**Type:** ${activity.type || 'N/A'}\n**URL:** ${activity.url || 'N/A'}\n**Name:** ${activity.name || 'N/A'}\n**Details:** ${activity.details || 'N/A'}\n**State:** ${activity.state || 'N/A'}`,
        inline: false
      });
    }

    return interaction.editReply({ embeds: [debugEmbed] });
  }

  if (streamingMembers.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('📺 Twitch Presence Check')
      .setDescription('No users with tracking roles are currently streaming on Twitch.')
      .setColor('#9146FF');
    return interaction.editReply({ embeds: [embed] });
  }

  // Fix missing live roles and post notifications
  const fixedMembers = [];
  for (const { member, activity, hasLiveRole } of streamingMembers) {
    let fixed = false;
    
    // Assign live role if missing
    if (!hasLiveRole && liveRoles.length > 0) {
      for (const roleId of liveRoles) {
        try {
          const role = await guild.roles.fetch(roleId).catch(() => null);
          if (role) {
            await member.roles.add(role, `Manual fix via check command`);
            fixed = true;
          }
        } catch (err) {
          console.error(`[Twitch Presence Check] Failed to assign role to ${member.displayName}:`, err.message);
        }
      }
    }
    
    // Post notification if needed (check if notification already exists by checking recent messages)
    if (fixed) {
      fixedMembers.push(member.displayName);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('📺 Twitch Presence Check')
    .setDescription(`Found ${streamingMembers.length} user(s) streaming on Twitch:`)
    .setColor('#9146FF');

  if (fixedMembers.length > 0) {
    embed.addFields({
      name: '🔧 Fixed',
      value: `Assigned live roles to: ${fixedMembers.join(', ')}`,
      inline: false
    });
  }

  for (const { member, activity, hasLiveRole } of streamingMembers) {
    const statusText = '🔴 LIVE';
    const streamUrl = activity.url || '';
    const title = activity.details || 'Streaming now';
    const game = activity.state || activity.name || 'Unknown';
    const thumbnail = activity.assets?.largeImageURL() || null;
    
    embed.addFields({
      name: `${member.displayName} - Status Check`,
      value: `**Status:** ${statusText}\n**Title:** ${title}\n**Game:** ${game}\n**Live Role:** ${hasLiveRole ? '✅ Assigned' : '❌ Not Assigned'}\n**URL:** ${streamUrl}`,
      inline: false
    });
    
    if (thumbnail) embed.setImage(thumbnail);
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleTwitchPresenceResend(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const user = interaction.options.getUser('user');
  const settings = guildSettings.getSettings(guildId);
  
  if (!settings?.streaming?.twitch) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Configured')
      .setDescription('Twitch streaming is not configured for this server. Use `/twitch presence setup` first.')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const twitch = settings.streaming.twitch;
  if (!twitch.enabled) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Disabled')
      .setDescription('Twitch streaming notifications are disabled.')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const guild = interaction.guild;
  const member = await guild.members.fetch(user.id).catch(() => null);
  
  if (!member) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ User Not Found')
      .setDescription('User not found in this server')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const activity = member.presence?.activities?.filter(a => a.type === 1).find(a => presenceStreaming.detectPlatform(a) === 'twitch');
  if (!activity) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Streaming')
      .setDescription('This user is not currently streaming on Twitch')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const platform = presenceStreaming.detectPlatform(activity);
  if (platform !== 'twitch') {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Twitch')
      .setDescription('This user is not streaming on Twitch')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const channel = await guild.channels.fetch(twitch.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    const embed = new EmbedBuilder()
      .setTitle('❌ Channel Not Found')
      .setDescription('Notification channel not found or is not text-based')
      .setColor('#FF0000');
    return interaction.editReply({ embeds: [embed] });
  }

  const streamURL = activity.url || '';
  const urlMatch = streamURL.match(/twitch\.tv\/([^\/]+)/);
  let thumbnail = activity.assets?.largeImageURL({ size: 512 }) || null;
  
  // Fetch stream thumbnail from Twitch API if username is available
  if (urlMatch) {
    try {
      const axios = require('axios');
      const twitchConfig = configLoader.twitch;
      const token = await axios.post('https://id.twitch.tv/oauth2/token', {
        client_id: twitchConfig.twitch_client_id,
        client_secret: twitchConfig.twitch_client_secret,
        grant_type: 'client_credentials'
      }).then(res => res.data.access_token);
      
      const response = await axios.get('https://api.twitch.tv/helix/streams', {
        params: { user_login: urlMatch[1] },
        headers: {
          'Client-ID': twitchConfig.twitch_client_id,
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.data.data.length > 0) {
        thumbnail = response.data.data[0].thumbnail_url.replace('{width}', '1920').replace('{height}', '1080');
      }
    } catch (err) {
      console.error('[TwitchPresenceResend] Error fetching stream thumbnail:', err.message);
    }
  }

  const title = activity.details || 'Streaming now';
  const game = activity.state || activity.name || 'Unknown';
  const streamerName = member.displayName;

  const embed = new EmbedBuilder()
    .setTitle(title || `${streamerName} is now live on Twitch!`)
    .setURL(streamURL)
    .setColor('#9146FF')
    .setAuthor({ name: `${streamerName} is now broadcasting on Twitch!`, iconURL: member.displayAvatarURL(), url: streamURL });

  if (game) embed.setDescription(`**Activity:** ${game}`);
  if (thumbnail) embed.setImage(thumbnail);

  let content = '';
  if (twitch.customMessage) {
    content = twitch.customMessage
      .replace(/\{streamer\}/g, streamerName)
      .replace(/\{url\}/g, streamURL)
      .replace(/\{platform\}/g, 'Twitch')
      .replace(/\{title\}/g, title)
      .replace(/\{game\}/g, game);
  }

  await channel.send({ content: content || undefined, embeds: [embed] });

  const successEmbed = new EmbedBuilder()
    .setTitle('✅ Notification Resent')
    .setDescription(`Successfully resent notification for **${streamerName}**`)
    .setColor('#9146FF');

  await interaction.editReply({ embeds: [successEmbed] });
}

async function handleEdit(interaction, twitchBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const username = interaction.options.getString('username').toLowerCase().trim();
  const channel = interaction.options.getChannel('channel');
  const customMessage = interaction.options.getString('message');
  const cooldown = interaction.options.getInteger('cooldown');
  const discordUser = interaction.options.getUser('discord_user');
  const liveRoleString = interaction.options.getString('live_role');

  const updates = {};
  
  if (channel) updates.channelId = channel.id;
  if (customMessage !== null) updates.customMessage = customMessage;
  if (cooldown !== null) updates.cooldown = cooldown;
  if (discordUser) updates.discordUsername = discordUser.id;
  if (liveRoleString !== null) updates.liveRoles = parseRoleString(liveRoleString);
  const cleanup = interaction.options.getBoolean('cleanup');
  if (cleanup !== null) updates.cleanup = cleanup;

  const edited = twitchBot.editStreamer(username, guildId, updates);

  if (!edited) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Streamer Not Found')
      .setDescription(`**${username}** is not being monitored in this server`)
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Streamer Updated')
    .setDescription(`Successfully updated **${username}**`)
    .setColor('#9146FF');

  if (channel) embed.addFields({ name: 'Channel', value: `<#${channel.id}>`, inline: true });
  if (customMessage !== null) embed.addFields({ name: 'Custom Message', value: customMessage || '(cleared)', inline: false });
  if (discordUser) embed.addFields({ name: 'Discord User', value: discordUser.username, inline: true });
  if (updates.liveRoles && updates.liveRoles.length > 0) embed.addFields({ name: 'Live Roles', value: updates.liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });

  await interaction.editReply({ embeds: [embed] });
}

async function handleRemove(interaction, twitchBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const username = interaction.options.getString('username').toLowerCase().trim();
  const removed = twitchBot.removeStreamer(username, guildId);

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
    .setColor('#9146FF');

  await interaction.editReply({ embeds: [embed] });
}

async function handleList(interaction, twitchBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const streamers = twitchBot.listStreamers(guildId);

  if (streamers.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('📺 Monitored Streamers')
      .setDescription('No Twitch streamers are being monitored in this server yet.\nUse `/twitch add` to start monitoring!')
      .setColor('#9146FF');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('📺 Monitored Twitch Streamers')
    .setDescription(streamers.map(s => s.username).join('\n'))
    .setColor('#9146FF');

  await interaction.editReply({ embeds: [embed] });
}

async function handleCheck(interaction, twitchBot) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const username = interaction.options.getString('username').toLowerCase().trim();
  const guildId = interaction.guildId;

  const embed = new EmbedBuilder()
    .setTitle('⏳ Checking...')
    .setDescription(`Checking **${username}**...`)
    .setColor('#9146FF');

  await interaction.editReply({ embeds: [embed] });

  try {
    const status = await twitchBot.manualCheck(username);
    const streamerData = twitchBot.getStreamer(username, guildId);

    const statusText = status.isLive ? '🔴 LIVE' : '⬜ Offline';
    const resultEmbed = new EmbedBuilder()
      .setTitle(`${username} - Status Check`)
      .setURL(`https://twitch.tv/${username}`)
      .setColor('#9146FF')
      .addFields(
        { name: 'Status', value: statusText, inline: true }
      );

    if (status.isLive) {
      resultEmbed.addFields(
        { name: 'Title', value: status.title || 'N/A', inline: false },
        { name: 'Game', value: status.game || 'N/A', inline: true },
        { name: 'Viewers', value: status.viewers?.toString() || '0', inline: true }
      );
      if (status.thumbnail) resultEmbed.setImage(status.thumbnail);
    }

    // Check live role status if streamer data exists
    if (streamerData && streamerData.liveRoles && streamerData.liveRoles.length > 0) {
      const guild = interaction.guild;
      let liveRoleStatus = 'N/A';
      
      if (streamerData.discordUsername) {
        const member = await guild.members.fetch(streamerData.discordUsername).catch(() => null);
        if (member) {
          const hasLiveRole = streamerData.liveRoles.some(lr => member.roles.cache.has(lr));
          liveRoleStatus = hasLiveRole ? '✅ Assigned' : '❌ Not Assigned';
        } else {
          liveRoleStatus = '⚠️ User not found';
        }
      } else {
        liveRoleStatus = '⚠️ No Discord user linked';
      }
      
      resultEmbed.addFields({ name: 'Live Role', value: liveRoleStatus, inline: true });
    }

    await interaction.editReply({ embeds: [resultEmbed] });
  } catch (error) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Check Failed')
      .setDescription(`Error checking ${username}: ${error.message}`)
      .setColor('#FF0000');

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function handleResend(interaction, twitchBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const username = interaction.options.getString('username').toLowerCase().trim();
  const streamerData = twitchBot.getStreamer(username, guildId);

  if (!streamerData) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Streamer Not Found')
      .setDescription(`**${username}** is not being monitored in this server`)
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('⏳ Checking...')
    .setDescription(`Checking **${username}**...`)
    .setColor('#9146FF');

  await interaction.editReply({ embeds: [embed] });

  try {
    const status = await twitchBot.manualCheck(username);

    if (!status.isLive) {
      const errorEmbed = new EmbedBuilder()
        .setTitle('⚠️ Not Live')
        .setDescription(`**${username}** is not currently live`)
        .setColor('#FFA500');
      return interaction.editReply({ embeds: [errorEmbed] });
    }

    const channel = await interaction.client.channels.fetch(streamerData.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Channel Not Found')
        .setDescription('Notification channel not found or is not text-based')
        .setColor('#FF0000');
      return interaction.editReply({ embeds: [errorEmbed] });
    }

    const streamURL = `https://twitch.tv/${username}`;
    const notificationEmbed = new EmbedBuilder()
      .setTitle(status.title || 'Now Broadcasting on Twitch!')
      .setURL(streamURL)
      .setColor('#9146FF');

    if (status.profileImage) {
      notificationEmbed.setAuthor({ name: `${username} is now broadcasting on Twitch!`, iconURL: status.profileImage, url: streamURL });
    }
    if (status.game) notificationEmbed.setDescription(`**Activity:** ${status.game}`);
    if (status.thumbnail) notificationEmbed.setImage(status.thumbnail);

    let content = '';
    if (streamerData.customMessage) {
      content = streamerData.customMessage
        .replace(/\{streamer\}/g, username)
        .replace(/\{url\}/g, streamURL)
        .replace(/\{platform\}/g, 'Twitch')
        .replace(/\{title\}/g, status.title || '')
        .replace(/\{game\}/g, status.game || '');
    }

    await channel.send({ content: content || undefined, embeds: [notificationEmbed] });

    const successEmbed = new EmbedBuilder()
      .setTitle('✅ Notification Resent')
      .setDescription(`Successfully resent notification for **${username}**`)
      .setColor('#9146FF');

    await interaction.editReply({ embeds: [successEmbed] });
  } catch (error) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Resend Failed')
      .setDescription(`Error resending notification for ${username}: ${error.message}`)
      .setColor('#FF0000');

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}