const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const guildSettings = require('../modules/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('Manage YouTube live alerts, uploads, and presence notifications')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup(group =>
      group
        .setName('channel')
        .setDescription('Monitor a YouTube channel for live streams and new videos')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Add a YouTube channel to monitor')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('YouTube channel ID, handle (@name), or URL')
                .setRequired(true)
            )
            .addChannelOption(opt =>
              opt
                .setName('channel')
                .setDescription('The Discord channel for live notifications')
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName('live_role')
                .setDescription('Role(s) to assign when channel goes live (comma-separated, e.g., @role1, @role2)')
                .setRequired(false)
            )
            .addChannelOption(opt =>
              opt
                .setName('upload_channel')
                .setDescription('The Discord channel for upload notifications (defaults to live channel)')
                .setRequired(false)
            )
            .addStringOption(opt =>
              opt
                .setName('message')
                .setDescription('Optional template; placeholders: {streamer}, {url}, {platform}, {title}')
                .setRequired(false)
            )
            .addIntegerOption(opt =>
              opt
                .setName('cooldown')
                .setDescription('Cooldown in seconds before sending another live notification for the same channel')
                .setRequired(false)
                .setMinValue(0)
            )
            .addStringOption(opt =>
              opt
                .setName('upload_message')
                .setDescription('Upload message; supports {streamer}, {url}, {platform}, {title}. Deleted after 24 hours.')
                .setRequired(false)
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
                .setDescription('Delete live alerts when the stream ends. Upload alerts expire after 24 hours.')
                .setRequired(false)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('edit')
            .setDescription('Edit an existing YouTube channel entry')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('Choose the YouTube channel you are already monitoring')
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
                .setDescription('Update the Discord channel for live notifications')
                .setRequired(false)
            )
            .addChannelOption(opt =>
              opt
                .setName('upload_channel')
                .setDescription('Update the Discord channel for upload notifications')
                .setRequired(false)
            )
            .addStringOption(opt =>
              opt
                .setName('message')
                .setDescription('Template placeholders: {streamer}, {url}, {platform}, {title}')
                .setRequired(false)
            )
            .addIntegerOption(opt =>
              opt
                .setName('cooldown')
                .setDescription('Update cooldown in seconds before sending another live notification for the same channel')
                .setRequired(false)
                .setMinValue(0)
            )
            .addStringOption(opt =>
              opt
                .setName('upload_message')
                .setDescription('Upload message; supports {streamer}, {url}, {platform}, {title}. Deleted after 24 hours.')
                .setRequired(false)
            )
            .addStringOption(opt =>
              opt
                .setName('discord_user')
                .setDescription('Update Discord user to assign roles to')
                .setRequired(false)
            )
            .addBooleanOption(opt =>
              opt
                .setName('cleanup')
                .setDescription('Delete live alerts when the stream ends. Upload alerts expire after 24 hours.')
                .setRequired(false)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Remove a YouTube channel from monitoring')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('Choose a monitored YouTube channel')
                .setAutocomplete(true)
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('list')
            .setDescription('List all monitored YouTube channels for this server')
        )
        .addSubcommand(sub =>
          sub
            .setName('check')
            .setDescription('Manually check a YouTube channel status')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('Choose a monitored YouTube channel')
                .setAutocomplete(true)
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('resend')
            .setDescription('Resend notification for a live channel')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('The YouTube channel ID')
                .setAutocomplete(true)
                .setRequired(true)
            )
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('presence')
        .setDescription('Alert when members with selected roles stream on YouTube')
        .addSubcommand(sub =>
          sub
            .setName('setup')
            .setDescription('Configure presence-based YouTube streaming notifications')
            .addBooleanOption(opt =>
              opt
                .setName('enabled')
                .setDescription('Enable or disable YouTube streaming notifications')
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
                .setDescription('Channel to post YouTube notifications in')
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
                .setDescription('Template placeholders: {streamer}, {url}, {platform}, {title}')
                .setRequired(false)
            )
            .addIntegerOption(opt =>
              opt
                .setName('cooldown')
                .setDescription('Cooldown in seconds before sending another YouTube presence notification for the same user')
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
            .setDescription('Disable presence-based YouTube streaming notifications')
        )
        .addSubcommand(sub =>
          sub
            .setName('status')
            .setDescription('View current presence-based YouTube streaming settings')
        )
        .addSubcommand(sub =>
          sub
            .setName('edit')
            .setDescription('Edit presence-based YouTube streaming settings')
            .addBooleanOption(opt =>
              opt
                .setName('enabled')
                .setDescription('Enable or disable YouTube streaming notifications')
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
                .setDescription('Channel to post YouTube notifications in')
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
                .setDescription('Template placeholders: {streamer}, {url}, {platform}, {title}')
                .setRequired(false)
            )
            .addIntegerOption(opt =>
              opt
                .setName('cooldown')
                .setDescription('Cooldown in seconds before sending another YouTube presence notification for the same user')
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
      if (subcommandGroup === 'channel') {
        const ytBot = interaction.client.youtubeStreamBot;
        if (!ytBot) {
          return interaction.reply({ content: '❌ YouTube monitoring is not initialized yet. Please wait a moment and try again.', ephemeral: true });
        }

        if (subcommand === 'add') {
          await handleAdd(interaction, ytBot, guildId);
        } else if (subcommand === 'edit') {
          await handleEdit(interaction, ytBot, guildId);
        } else if (subcommand === 'remove') {
          await handleRemove(interaction, ytBot, guildId);
        } else if (subcommand === 'list') {
          await handleList(interaction, ytBot, guildId);
        } else if (subcommand === 'check') {
          await handleCheck(interaction, ytBot);
        } else if (subcommand === 'resend') {
          await handleResend(interaction, ytBot, guildId);
        }
      } else if (subcommandGroup === 'presence') {
        const presenceStreaming = interaction.client.presenceStreaming;
        if (!presenceStreaming) {
          return interaction.reply({ content: '❌ Presence streaming is not initialized yet. Please wait a moment and try again.', ephemeral: true });
        }

        if (subcommand === 'setup') {
          await handleYouTubeSetup(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'disable') {
          await handleYouTubeDisable(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'status') {
          await handleYouTubeStatus(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'edit') {
          await handleYouTubeEdit(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'check') {
          await handleYouTubePresenceCheck(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'resend') {
          await handleYouTubePresenceResend(interaction, presenceStreaming, guildId);
        }
      }
    } catch (error) {
      console.error('[YouTube Command] Error:', error);

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
    const saved = client.youtubeStreamBot?.getChannel(target, guildId);
    if (!saved) return {};

    return {
      channel: saved.discordChannelId,
      upload_channel: saved.uploadChannelId,
      message: saved.customMessage,
      cooldown: saved.cooldown,
      upload_message: saved.uploadMessage,
      discord_user: saved.discordUsername,
      live_role: saved.liveRoles || [],
      cleanup: saved.cleanup
    };
  },

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const ytBot = interaction.client.youtubeStreamBot;

    if (!ytBot) return interaction.respond([]);

    if (focusedOption.name === 'username') {
      const guildChannels = ytBot.listChannels(interaction.guildId);
      const query = focusedOption.value.trim().toLowerCase();
      const handles = [...new Map(
        guildChannels.map(({ handle }) => [handle.toLowerCase(), handle])
      ).values()];
      const filtered = handles
        .filter(handle => handle.toLowerCase().startsWith(query))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 25);

      await interaction.respond(filtered.map(handle => ({ name: handle, value: handle })));
    }
  }
};

async function handleAdd(interaction, ytBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const input = interaction.options.getString('username').trim();
  const channel = interaction.options.getChannel('channel');
  const uploadChannel = interaction.options.getChannel('upload_channel');
  const customMessage = interaction.options.getString('message') || '';
  const cooldown = interaction.options.getInteger('cooldown') || 0;
  const uploadMessage = interaction.options.getString('upload_message') || '';
  const discordUser = interaction.options.getUser('discord_user');
  const liveRoleString = interaction.options.getString('live_role');
  const cleanup = interaction.options.getBoolean('cleanup') || false;

  if (!channel) {
    return interaction.editReply('❌ Channel not found');
  }

  let resolved;
  try {
    resolved = await ytBot.resolveChannel(input);
  } catch (err) {
    return interaction.editReply(`❌ ${err.message}`);
  }

  const { handle, channelId } = resolved;
  const channelInfo = await ytBot.getChannelInfoById(channelId);
  const displayName = channelInfo?.title || handle;
  const liveRoles = liveRoleString ? parseRoleString(liveRoleString) : [];
  const discordUsername = discordUser ? discordUser.id : '';
  const uploadChannelId = uploadChannel?.id || null;

  const added = ytBot.addChannel(handle, channelId, guildId, channel.id, uploadChannelId, customMessage, uploadMessage, discordUsername, liveRoles, cleanup, cooldown);

  if (!added) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Channel Already Monitored')
      .setDescription(`**${displayName}** is already being monitored`)
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ YouTube Channel Added')
    .setDescription(`Successfully added **${displayName}** to monitoring`)
    .addFields(
      { name: 'Channel', value: `<#${channel.id}>`, inline: true },
      { name: 'Upload Channel', value: uploadChannel ? `<#${uploadChannel.id}>` : `<#${channel.id}> (same)`, inline: true },
      { name: 'Status', value: 'Monitoring...', inline: true }
    )
    .setColor('#FF0000');

  if (channelInfo?.thumbnail) embed.setThumbnail(channelInfo.thumbnail);
  if (customMessage) embed.addFields({ name: 'Live Message', value: customMessage, inline: false });
  if (cooldown > 0) embed.addFields({ name: 'Cooldown', value: `${cooldown}s`, inline: true });
  if (uploadMessage) embed.addFields({ name: 'Upload Message', value: uploadMessage, inline: false });
  if (discordUser) embed.addFields({ name: 'Role Linked To', value: discordUser.username, inline: true });
  if (liveRoles.length > 0) embed.addFields({ name: 'Live Roles', value: liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });

  await interaction.editReply({ embeds: [embed] });
}

async function handleEdit(interaction, ytBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const handle = interaction.options.getString('username').trim();
  const channel = interaction.options.getChannel('channel');
  const uploadChannel = interaction.options.getChannel('upload_channel');
  const customMessage = interaction.options.getString('message');
  const cooldown = interaction.options.getInteger('cooldown');
  const uploadMessage = interaction.options.getString('upload_message');
  const discordUser = interaction.options.getString('discord_user');
  const liveRoleString = interaction.options.getString('live_role');
  const cleanup = interaction.options.getBoolean('cleanup');

  const updates = {};

  if (channel) updates.discordChannelId = channel.id;
  if (uploadChannel) updates.uploadChannelId = uploadChannel.id;
  if (customMessage !== null) updates.customMessage = customMessage;
  if (cooldown !== null) updates.cooldown = cooldown;
  if (uploadMessage !== null) updates.uploadMessage = uploadMessage;
  if (discordUser) updates.discordUsername = discordUser;
  if (liveRoleString !== null) updates.liveRoles = parseRoleString(liveRoleString);
  if (cleanup !== null) updates.cleanup = cleanup;

  const edited = ytBot.editChannel(handle, guildId, updates);

  if (!edited) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Channel Not Found')
      .setDescription(`**${handle}** is not being monitored in this server`)
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Channel Updated')
    .setDescription(`Successfully updated **${handle}**`)
    .setColor('#FF0000');

  if (channel) embed.addFields({ name: 'Channel', value: `<#${channel.id}>`, inline: true });
  if (uploadChannel) embed.addFields({ name: 'Upload Channel', value: `<#${uploadChannel.id}>`, inline: true });
  if (customMessage !== null) embed.addFields({ name: 'Live Message', value: customMessage || '(cleared)', inline: false });
  if (cooldown !== null) embed.addFields({ name: 'Cooldown', value: `${cooldown}s`, inline: true });
  if (uploadMessage !== null) embed.addFields({ name: 'Upload Message', value: uploadMessage || '(cleared)', inline: false });
  if (discordUser) embed.addFields({ name: 'Discord User', value: discordUser, inline: true });
  if (updates.liveRoles && updates.liveRoles.length > 0) embed.addFields({ name: 'Live Roles', value: updates.liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });

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

async function handleYouTubeSetup(interaction, presenceStreaming, guildId) {
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
  
  settings.streaming.youtube = {
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
    .setTitle('✅ YouTube Streaming Configured')
    .setDescription('YouTube streaming notifications have been configured')
    .setColor('#FF0000')
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

async function handleYouTubeDisable(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const settings = guildSettings.getSettings(guildId);
  if (!settings?.streaming?.youtube) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Configured')
      .setDescription('YouTube streaming is not configured for this server')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  settings.streaming.youtube.enabled = false;
  guildSettings.updateSettings(guildId, { streaming: settings.streaming });

  const embed = new EmbedBuilder()
    .setTitle('✅ YouTube Streaming Disabled')
    .setDescription('YouTube streaming notifications have been disabled')
    .setColor('#FF0000');

  await interaction.editReply({ embeds: [embed] });
}

async function handleYouTubeStatus(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const settings = guildSettings.getSettings(guildId);
  
  if (!settings?.streaming?.youtube) {
    const embed = new EmbedBuilder()
      .setTitle('📺 YouTube Streaming Status')
      .setDescription('YouTube streaming is not configured for this server')
      .setColor('#FF0000');
    return interaction.editReply({ embeds: [embed] });
  }

  const youtube = settings.streaming.youtube;
  const embed = new EmbedBuilder()
    .setTitle('📺 YouTube Streaming Status')
    .setColor('#FF0000')
    .addFields(
      { name: 'Status', value: youtube.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: 'Tracking Roles', value: youtube.trackingRoles?.map(r => `<@&${r}>`).join(', ') || 'None', inline: true },
      { name: 'Channel', value: `<#${youtube.channelId}>`, inline: true }
    );

  if (youtube.liveRoles && youtube.liveRoles.length > 0) {
    embed.addFields({ name: 'Live Roles', value: youtube.liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });
  }
  if (youtube.customMessage) {
    embed.addFields({ name: 'Custom Message', value: youtube.customMessage, inline: false });
  }
  if (youtube.cooldown) {
    embed.addFields({ name: 'Cooldown', value: `${youtube.cooldown}s`, inline: true });
  }
  if (youtube.cleanup) {
    embed.addFields({ name: 'Cleanup', value: 'Enabled', inline: true });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleYouTubeEdit(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const settings = guildSettings.getSettings(guildId);
  if (!settings?.streaming?.youtube) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Configured')
      .setDescription('YouTube streaming is not configured for this server. Use `/youtube presence setup` first.')
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

  Object.assign(settings.streaming.youtube, updates);
  guildSettings.updateSettings(guildId, { streaming: settings.streaming });

  const embed = new EmbedBuilder()
    .setTitle('✅ YouTube Streaming Updated')
    .setDescription('YouTube streaming settings have been updated')
    .setColor('#FF0000');

  if (updates.enabled !== undefined) embed.addFields({ name: 'Status', value: updates.enabled ? '✅ Enabled' : '❌ Disabled', inline: true });
  if (updates.trackingRoles) embed.addFields({ name: 'Tracking Roles', value: updates.trackingRoles.map(r => `<@&${r}>`).join(', '), inline: true });
  if (updates.liveRoles) embed.addFields({ name: 'Live Roles', value: updates.liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });
  if (updates.channelId) embed.addFields({ name: 'Channel', value: `<#${updates.channelId}>`, inline: true });
  if (updates.customMessage !== undefined) embed.addFields({ name: 'Custom Message', value: updates.customMessage || '(cleared)', inline: false });
  if (updates.cooldown !== undefined) embed.addFields({ name: 'Cooldown', value: `${updates.cooldown}s`, inline: true });
  if (updates.cleanup !== undefined) embed.addFields({ name: 'Cleanup', value: updates.cleanup ? 'Enabled' : 'Disabled', inline: true });

  await interaction.editReply({ embeds: [embed] });
}

async function handleYouTubePresenceCheck(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const settings = guildSettings.getSettings(guildId);
  if (!settings?.streaming?.youtube) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Configured')
      .setDescription('YouTube streaming is not configured for this server. Use `/youtube presence setup` first.')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const youtube = settings.streaming.youtube;
  if (!youtube.enabled) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Disabled')
      .setDescription('YouTube streaming notifications are disabled.')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const guild = interaction.guild;
  const trackingRoles = youtube.trackingRoles || [];
  const liveRoles = youtube.liveRoles || [];
  const channelId = youtube.channelId;

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
  for (const roleId of trackingRoles) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) continue;

    for (const member of role.members.values()) {
      const youtubeActivity = member.presence?.activities?.filter(a => a.type === 1).find(a => presenceStreaming.detectPlatform(a) === 'youtube');
      if (youtubeActivity) {
        streamingMembers.push({
          member,
          activity: youtubeActivity,
          hasLiveRole: liveRoles.some(lr => member.roles.cache.has(lr))
        });
      }
    }
  }

  if (streamingMembers.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('📺 YouTube Presence Check')
      .setDescription('No users with tracking roles are currently streaming on YouTube.')
      .setColor('#FF0000');
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
          console.error(`[YouTube Presence Check] Failed to assign role to ${member.displayName}:`, err.message);
        }
      }
    }
    
    // Post notification if needed (check if notification already exists by checking recent messages)
    if (fixed) {
      fixedMembers.push(member.displayName);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('📺 YouTube Presence Check')
    .setDescription(`Found ${streamingMembers.length} user(s) streaming on YouTube:`)
    .setColor('#FF0000');

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

async function handleYouTubePresenceResend(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const user = interaction.options.getUser('user');
  const settings = guildSettings.getSettings(guildId);
  
  if (!settings?.streaming?.youtube) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Configured')
      .setDescription('YouTube streaming is not configured for this server. Use `/youtube presence setup` first.')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const youtube = settings.streaming.youtube;
  if (!youtube.enabled) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Disabled')
      .setDescription('YouTube streaming notifications are disabled.')
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

  const activity = member.presence?.activities?.filter(a => a.type === 1).find(a => presenceStreaming.detectPlatform(a) === 'youtube');
  if (!activity) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Streaming')
      .setDescription('This user is not currently streaming on YouTube')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const platform = presenceStreaming.detectPlatform(activity);
  if (platform !== 'youtube') {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not YouTube')
      .setDescription('This user is not streaming on YouTube')
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const channel = await guild.channels.fetch(youtube.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    const embed = new EmbedBuilder()
      .setTitle('❌ Channel Not Found')
      .setDescription('Notification channel not found or is not text-based')
      .setColor('#FF0000');
    return interaction.editReply({ embeds: [embed] });
  }

  const streamURL = activity.url || '';
  const title = activity.details || 'Streaming now';
  const game = activity.state || activity.name || 'Unknown';
  const streamerName = member.displayName;

  const embed = new EmbedBuilder()
    .setTitle(title || `${streamerName} is now live on YouTube!`)
    .setURL(streamURL)
    .setColor('#FF0000')
    .setAuthor({ name: `${streamerName} is now live on YouTube!`, url: streamURL });

  if (game) embed.setDescription(`**Activity:** ${game}`);

  let content = '';
  if (youtube.customMessage) {
    content = youtube.customMessage
      .replace(/\{streamer\}/g, streamerName)
      .replace(/\{url\}/g, streamURL)
      .replace(/\{platform\}/g, 'YouTube')
      .replace(/\{title\}/g, title)
      .replace(/\{game\}/g, game);
  }

  await channel.send({ content: content || undefined, embeds: [embed] });

  const successEmbed = new EmbedBuilder()
    .setTitle('✅ Notification Resent')
    .setDescription(`Successfully resent notification for **${streamerName}**`)
    .setColor('#FF0000');

  await interaction.editReply({ embeds: [successEmbed] });
}

async function handleRemove(interaction, ytBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const handle = interaction.options.getString('username').trim();
  const removed = ytBot.removeChannel(handle, guildId);

  if (!removed) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Channel Not Found')
      .setDescription(`**${handle}** is not being monitored in this server`)
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Channel Removed')
    .setDescription(`Successfully removed **${handle}** from monitoring`)
    .setColor('#FF0000');

  await interaction.editReply({ embeds: [embed] });
}

async function handleList(interaction, ytBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channels = ytBot.listChannels(guildId);

  if (channels.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('📺 Monitored YouTube Channels')
      .setDescription('No YouTube channels are being monitored in this server yet.\nUse `/youtube add` to start monitoring!')
      .setColor('#FF0000');
    return interaction.editReply({ embeds: [embed] });
  }

  const lines = channels.map(c => {
    const uploadStr = c.uploadChannelId && c.uploadChannelId !== c.discordChannelId
      ? ` | uploads → <#${c.uploadChannelId}>`
      : '';
    return `${c.isLive ? '🔴' : '⬜'} **${c.handle}** → <#${c.discordChannelId}>${uploadStr}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('📺 Monitored YouTube Channels')
    .setDescription(lines)
    .setColor('#FF0000');

  await interaction.editReply({ embeds: [embed] });
}

async function handleCheck(interaction, ytBot) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const handle = interaction.options.getString('username').trim();
  const guildId = interaction.guildId;

  const embed = new EmbedBuilder()
    .setTitle('⏳ Checking...')
    .setDescription(`Checking **${handle}**...`)
    .setColor('#FF0000');

  await interaction.editReply({ embeds: [embed] });

  try {
    const status = await ytBot.manualCheck(handle);
    const channelData = ytBot.getChannel(handle, guildId);

    const statusText = status.unavailable
      ? '⚠️ Unavailable (could not reach YouTube)'
      : status.isLive ? '🔴 LIVE' : '⬜ Offline';
    const resultEmbed = new EmbedBuilder()
      .setTitle(`${handle} - Status Check`)
      .setColor('#FF0000')
      .addFields({ name: 'Status', value: statusText, inline: true });

    if (status.isLive) {
      resultEmbed
        .setURL(`https://www.youtube.com/watch?v=${status.videoId}`)
        .addFields({ name: 'Title', value: status.title || 'N/A', inline: false });
      if (status.thumbnail) resultEmbed.setImage(status.thumbnail);
    }

    // Check live role status if channel data exists
    if (channelData && channelData.liveRoles && channelData.liveRoles.length > 0) {
      const guild = interaction.guild;
      let liveRoleStatus = 'N/A';
      
      if (channelData.discordUsername) {
        const member = await guild.members.fetch(channelData.discordUsername).catch(() => null);
        if (member) {
          const hasLiveRole = channelData.liveRoles.some(lr => member.roles.cache.has(lr));
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
      .setDescription(`Error checking ${handle}: ${error.message}`)
      .setColor('#FF0000');

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function handleResend(interaction, ytBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const handle = interaction.options.getString('username').trim();
  const channelData = ytBot.getChannel(handle, guildId);

  if (!channelData) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Channel Not Found')
      .setDescription(`**${handle}** is not being monitored in this server`)
      .setColor('#FFA500');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('⏳ Checking...')
    .setDescription(`Checking **${handle}**...`)
    .setColor('#FF0000');

  await interaction.editReply({ embeds: [embed] });

  try {
    const status = await ytBot.manualCheck(handle);

    if (status.unavailable) {
      const errorEmbed = new EmbedBuilder()
        .setTitle('⚠️ YouTube Unavailable')
        .setDescription('Could not reach YouTube to check this channel. Please try again shortly.')
        .setColor('#FFA500');
      return interaction.editReply({ embeds: [errorEmbed] });
    }

    if (!status.isLive) {
      const errorEmbed = new EmbedBuilder()
        .setTitle('⚠️ Not Live')
        .setDescription(`**${handle}** is not currently live`)
        .setColor('#FFA500');
      return interaction.editReply({ embeds: [errorEmbed] });
    }

    const channel = await interaction.client.channels.fetch(channelData.discordChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Channel Not Found')
        .setDescription('Notification channel not found or is not text-based')
        .setColor('#FF0000');
      return interaction.editReply({ embeds: [errorEmbed] });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${status.videoId}`;
    const notificationEmbed = new EmbedBuilder()
      .setTitle(status.title || `${status.channelTitle} is now live on YouTube!`)
      .setURL(videoUrl)
      .setColor('#FF0000')
      .setAuthor({ name: `${status.channelTitle} is now live on YouTube!`, url: videoUrl });

    if (status.thumbnail) notificationEmbed.setImage(status.thumbnail);

    let content = '';
    if (channelData.customMessage) {
      content = channelData.customMessage
        .replace(/\{streamer\}/g, status.channelTitle || handle)
        .replace(/\{url\}/g, videoUrl)
        .replace(/\{platform\}/g, 'YouTube')
        .replace(/\{title\}/g, status.title || '');
    }

    await channel.send({ content: content || undefined, embeds: [notificationEmbed] });

    const successEmbed = new EmbedBuilder()
      .setTitle('✅ Notification Resent')
      .setDescription(`Successfully resent notification for **${handle}**`)
      .setColor('#FF0000');

    await interaction.editReply({ embeds: [successEmbed] });
  } catch (error) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Resend Failed')
      .setDescription(`Error resending notification for ${handle}: ${error.message}`)
      .setColor('#FF0000');

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}
