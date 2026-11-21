const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const guildSettings = require('../modules/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tiktok')
    .setDescription('Manage TikTok live alerts, uploads, and presence notifications')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommandGroup(group =>
      group
        .setName('channel')
        .setDescription('Monitor a TikTok account for live streams and new videos')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Add a TikTok channel to monitor')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('TikTok username (@name) or URL')
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
                .setDescription('Optional template; placeholders: {streamer}, {url}, {platform}, {title}, {game}')
                .setRequired(false)
            )
            .addStringOption(opt =>
              opt
                .setName('upload_message')
                .setDescription('Upload message; supports {streamer}, {url}, {title}. Deleted after 24 hours.')
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
            .setDescription('Edit an existing TikTok channel entry')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('The TikTok username to edit')
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
                .setDescription('Template placeholders: {streamer}, {url}, {platform}, {title}, {game}')
                .setRequired(false)
            )
            .addStringOption(opt =>
              opt
                .setName('upload_message')
                .setDescription('Upload message; supports {streamer}, {url}, {title}. Deleted after 24 hours.')
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
            .setDescription('Remove a TikTok channel from monitoring')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('The TikTok username')
                .setAutocomplete(true)
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('list')
            .setDescription('List all monitored TikTok channels for this server')
        )
        .addSubcommand(sub =>
          sub
            .setName('check')
            .setDescription('Manually check a TikTok channel status')
            .addStringOption(opt =>
              opt
                .setName('username')
                .setDescription('The TikTok username')
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
                .setDescription('The TikTok username')
                .setAutocomplete(true)
                .setRequired(true)
            )
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('presence')
        .setDescription('Alert when members with selected roles stream on TikTok')
        .addSubcommand(sub =>
          sub
            .setName('setup')
            .setDescription('Configure presence-based TikTok streaming notifications')
            .addBooleanOption(opt =>
              opt
                .setName('enabled')
                .setDescription('Enable or disable TikTok streaming notifications')
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
                .setDescription('Channel to post TikTok notifications in')
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
                .setDescription('Minimum seconds between alerts for the same user; 0 disables the cooldown')
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
            .setDescription('Disable presence-based TikTok streaming notifications')
        )
        .addSubcommand(sub =>
          sub
            .setName('status')
            .setDescription('View current presence-based TikTok streaming settings')
        )
        .addSubcommand(sub =>
          sub
            .setName('edit')
            .setDescription('Edit presence-based TikTok streaming settings')
            .addBooleanOption(opt =>
              opt
                .setName('enabled')
                .setDescription('Enable or disable TikTok streaming notifications')
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
                .setDescription('Channel to post TikTok notifications in')
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
                .setDescription('Minimum seconds between alerts for the same user; 0 disables the cooldown')
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
        const tiktokBot = interaction.client.tiktokStreamBot;
        if (!tiktokBot) {
          return interaction.reply({ content: '❌ TikTok monitoring is not initialized yet. Please wait a moment and try again.', ephemeral: true });
        }

        if (subcommand === 'add') {
          await handleAdd(interaction, tiktokBot, guildId);
        } else if (subcommand === 'edit') {
          await handleEdit(interaction, tiktokBot, guildId);
        } else if (subcommand === 'remove') {
          await handleRemove(interaction, tiktokBot, guildId);
        } else if (subcommand === 'list') {
          await handleList(interaction, tiktokBot, guildId);
        } else if (subcommand === 'check') {
          await handleCheck(interaction, tiktokBot);
        } else if (subcommand === 'resend') {
          await handleResend(interaction, tiktokBot, guildId);
        }
      } else if (subcommandGroup === 'presence') {
        const presenceStreaming = interaction.client.presenceStreaming;
        if (!presenceStreaming) {
          return interaction.reply({ content: '❌ Presence streaming is not initialized yet. Please wait a moment and try again.', ephemeral: true });
        }

        if (subcommand === 'setup') {
          await handleTikTokSetup(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'disable') {
          await handleTikTokDisable(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'status') {
          await handleTikTokStatus(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'edit') {
          await handleTikTokEdit(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'check') {
          await handleTikTokPresenceCheck(interaction, presenceStreaming, guildId);
        } else if (subcommand === 'resend') {
          await handleTikTokPresenceResend(interaction, presenceStreaming, guildId);
        }
      }
    } catch (error) {
      console.error('[TikTok Command] Error:', error);

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
    const saved = client.tiktokStreamBot?.getChannel(target, guildId);
    if (!saved) return {};

    return {
      channel: saved.discordChannelId,
      upload_channel: saved.uploadChannelId,
      message: saved.customMessage,
      upload_message: saved.uploadMessage,
      discord_user: saved.discordUsername,
      live_role: saved.liveRoles || [],
      cleanup: saved.cleanup
    };
  },

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const tiktokBot = interaction.client.tiktokStreamBot;

    if (!tiktokBot) return interaction.respond([]);

    if (focusedOption.name === 'username') {
      const guildChannels = tiktokBot.listChannels(interaction.guildId);
      const query = focusedOption.value.trim().toLowerCase();
      const usernames = [...new Map(
        guildChannels.map(({ username }) => [username.toLowerCase(), username])
      ).values()];
      const filtered = usernames
        .filter(username => username.toLowerCase().startsWith(query))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 25);

      await interaction.respond(filtered.map(username => ({ name: username, value: username })));
    }
  }
};

async function handleAdd(interaction, tiktokBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const input = interaction.options.getString('username').trim();
  const channel = interaction.options.getChannel('channel');
  const uploadChannel = interaction.options.getChannel('upload_channel');
  const customMessage = interaction.options.getString('message') || '';
  const uploadMessage = interaction.options.getString('upload_message') || '';
  const discordUser = interaction.options.getUser('discord_user');
  const liveRoleString = interaction.options.getString('live_role');
  const cleanup = interaction.options.getBoolean('cleanup') || false;

  if (!channel) {
    return interaction.editReply('❌ Channel not found');
  }

  const username = tiktokBot._normalizeUsername(input);
  const liveRoles = liveRoleString ? parseRoleString(liveRoleString) : [];
  const discordUsername = discordUser ? discordUser.id : '';
  const uploadChannelId = uploadChannel?.id || null;

  const added = tiktokBot.addChannel(username, guildId, channel.id, uploadChannelId, customMessage, uploadMessage, discordUsername, liveRoles, cleanup);

  if (!added) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Channel Already Monitored')
      .setDescription(`**@${username}** is already being monitored`)
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ TikTok Channel Added')
    .setDescription(`Successfully added **@${username}** to monitoring`)
    .addFields(
      { name: 'Channel', value: `<#${channel.id}>`, inline: true },
      { name: 'Upload Channel', value: uploadChannel ? `<#${uploadChannel.id}>` : `<#${channel.id}> (same)`, inline: true },
      { name: 'Status', value: 'Monitoring...', inline: true }
    )
    .setColor('#00F2EA');

  if (customMessage) embed.addFields({ name: 'Live Message', value: customMessage, inline: false });
  if (uploadMessage) embed.addFields({ name: 'Upload Message', value: uploadMessage, inline: false });
  if (discordUser) embed.addFields({ name: 'Role Linked To', value: discordUser.username, inline: true });
  if (liveRoles.length > 0) embed.addFields({ name: 'Live Roles', value: liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });

  await interaction.editReply({ embeds: [embed] });
}

async function handleEdit(interaction, tiktokBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const username = interaction.options.getString('username').trim();
  const channel = interaction.options.getChannel('channel');
  const uploadChannel = interaction.options.getChannel('upload_channel');
  const customMessage = interaction.options.getString('message');
  const uploadMessage = interaction.options.getString('upload_message');
  const discordUser = interaction.options.getString('discord_user');
  const liveRoleString = interaction.options.getString('live_role');
  const cleanup = interaction.options.getBoolean('cleanup');

  const updates = {};

  if (channel) updates.discordChannelId = channel.id;
  if (uploadChannel) updates.uploadChannelId = uploadChannel.id;
  if (customMessage !== null) updates.customMessage = customMessage;
  if (uploadMessage !== null) updates.uploadMessage = uploadMessage;
  if (discordUser) updates.discordUsername = discordUser;
  if (liveRoleString !== null) updates.liveRoles = parseRoleString(liveRoleString);
  if (cleanup !== null) updates.cleanup = cleanup;

  const edited = tiktokBot.editChannel(username, guildId, updates);

  if (!edited) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Channel Not Found')
      .setDescription(`**@${username}** is not being monitored in this server`)
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ Channel Updated')
    .setDescription(`Successfully updated **@${username}**`)
    .setColor('#00F2EA');

  if (channel) embed.addFields({ name: 'Channel', value: `<#${channel.id}>`, inline: true });
  if (uploadChannel) embed.addFields({ name: 'Upload Channel', value: `<#${uploadChannel.id}>`, inline: true });
  if (customMessage !== null) embed.addFields({ name: 'Live Message', value: customMessage || '(cleared)', inline: false });
  if (uploadMessage !== null) embed.addFields({ name: 'Upload Message', value: uploadMessage || '(cleared)', inline: false });
  if (discordUser) embed.addFields({ name: 'Discord User', value: discordUser, inline: true });
  if (updates.liveRoles && updates.liveRoles.length > 0) embed.addFields({ name: 'Live Roles', value: updates.liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });

  await interaction.editReply({ embeds: [embed] });
}

async function handleRemove(interaction, tiktokBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const username = interaction.options.getString('username').trim();
  const normalized = tiktokBot._normalizeUsername(username);

  const removed = tiktokBot.removeChannel(normalized, guildId);

  if (!removed) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Channel Not Found')
      .setDescription(`**@${normalized}** is not being monitored in this server`)
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('✅ TikTok Channel Removed')
    .setDescription(`Successfully removed **@${normalized}** from monitoring`)
    .setColor('#00F2EA');

  await interaction.editReply({ embeds: [embed] });
}

async function handleList(interaction, tiktokBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channels = tiktokBot.listChannels(guildId);

  if (channels.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('📋 TikTok Channels')
      .setDescription('No TikTok channels are currently being monitored in this server')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('📋 TikTok Channels')
    .setDescription(`Currently monitoring ${channels.length} channel(s)`)
    .setColor('#00F2EA');

  for (const channel of channels) {
    embed.addFields({
      name: `@${channel.username}`,
      value: `**Status:** ${channel.isLive ? '🔴 LIVE' : '⚫ Offline'}\n**Channel:** <#${channel.discordChannelId}>${channel.uploadChannelId ? `\n**Upload Channel:** <#${channel.uploadChannelId}>` : ''}`,
      inline: false
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleCheck(interaction, tiktokBot) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const username = interaction.options.getString('username').trim();
  const normalized = tiktokBot._normalizeUsername(username);

  const status = await tiktokBot.manualCheck(normalized);

  if (status.unavailable) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ TikTok Check Unavailable')
      .setDescription(`Could not verify @${normalized} right now. No live status changes were made.`)
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const embed = new EmbedBuilder()
    .setTitle('📺 TikTok Channel Check')
    .setDescription(`@${normalized}`)
    .setColor('#00F2EA')
    .addFields(
      { name: 'Status', value: status.isLive ? '🔴 LIVE' : '⚫ Offline', inline: true },
      { name: 'Title', value: status.title || 'N/A', inline: true }
    );

  if (status.thumbnail) embed.setImage(status.thumbnail);

  await interaction.editReply({ embeds: [embed] });
}

async function handleResend(interaction, tiktokBot, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const username = interaction.options.getString('username').trim();
  const normalized = tiktokBot._normalizeUsername(username);

  const status = await tiktokBot.manualCheck(normalized);

  if (status.unavailable) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ TikTok Check Unavailable')
      .setDescription(`Could not verify @${normalized} right now. No notification was sent.`)
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  if (!status.isLive) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Live')
      .setDescription(`@${normalized} is not currently live`)
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  await tiktokBot.notifyLive(normalized, status);

  const embed = new EmbedBuilder()
    .setTitle('✅ Notification Resent')
    .setDescription(`Successfully resent notification for @${normalized}`)
    .setColor('#00F2EA');

  await interaction.editReply({ embeds: [embed] });
}

function parseRoleString(roleString) {
  if (!roleString) return [];
  
  const roles = [];
  const parts = roleString.split(',').map(s => s.trim()).filter(s => s);
  
  for (const part of parts) {
    const mentionMatch = part.match(/<@&(\d+)>/);
    if (mentionMatch) {
      roles.push(mentionMatch[1]);
      continue;
    }
    
    if (/^\d+$/.test(part)) {
      roles.push(part);
      continue;
    }
  }
  
  return [...new Set(roles)];
}

async function handleTikTokSetup(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const enabled = interaction.options.getBoolean('enabled');
  const trackingRoleString = interaction.options.getString('tracking_role');
  const liveRoleString = interaction.options.getString('live_role');
  const channel = interaction.options.getChannel('channel');
  const customMessage = interaction.options.getString('message') || '';
  const cooldown = interaction.options.getInteger('cooldown') || 0;
  const cleanup = interaction.options.getBoolean('cleanup') || false;

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
  
  settings.streaming.tiktok = {
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
    .setTitle('✅ TikTok Streaming Configured')
    .setDescription('TikTok streaming notifications have been configured')
    .setColor('#00F2EA')
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

async function handleTikTokDisable(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const settings = guildSettings.getSettings(guildId);
  if (!settings?.streaming?.tiktok) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Configured')
      .setDescription('TikTok streaming is not configured for this server')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  settings.streaming.tiktok.enabled = false;
  guildSettings.updateSettings(guildId, { streaming: settings.streaming });

  const embed = new EmbedBuilder()
    .setTitle('✅ TikTok Streaming Disabled')
    .setDescription('TikTok streaming notifications have been disabled')
    .setColor('#00F2EA');

  await interaction.editReply({ embeds: [embed] });
}

async function handleTikTokStatus(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const settings = guildSettings.getSettings(guildId);
  
  if (!settings?.streaming?.tiktok) {
    const embed = new EmbedBuilder()
      .setTitle('📺 TikTok Streaming Status')
      .setDescription('TikTok streaming is not configured for this server')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const tiktok = settings.streaming.tiktok;
  const embed = new EmbedBuilder()
    .setTitle('📺 TikTok Streaming Status')
    .setColor('#00F2EA')
    .addFields(
      { name: 'Status', value: tiktok.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
      { name: 'Tracking Roles', value: tiktok.trackingRoles?.map(r => `<@&${r}>`).join(', ') || 'None', inline: true },
      { name: 'Channel', value: `<#${tiktok.channelId}>`, inline: true }
    );

  if (tiktok.cooldown > 0) {
    embed.addFields({ name: 'Cooldown', value: `${tiktok.cooldown}s`, inline: true });
  }
  if (tiktok.liveRoles && tiktok.liveRoles.length > 0) {
    embed.addFields({ name: 'Live Roles', value: tiktok.liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });
  }
  if (tiktok.customMessage) {
    embed.addFields({ name: 'Custom Message', value: tiktok.customMessage, inline: false });
  }
  if (tiktok.cleanup) {
    embed.addFields({ name: 'Cleanup', value: 'Enabled', inline: true });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleTikTokEdit(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const settings = guildSettings.getSettings(guildId);
  if (!settings?.streaming?.tiktok) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Configured')
      .setDescription('TikTok streaming is not configured for this server. Use `/tiktok presence setup` first.')
      .setColor('#00F2EA');
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
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  Object.assign(settings.streaming.tiktok, updates);
  guildSettings.updateSettings(guildId, { streaming: settings.streaming });

  const embed = new EmbedBuilder()
    .setTitle('✅ TikTok Streaming Updated')
    .setDescription('TikTok streaming settings have been updated')
    .setColor('#00F2EA');

  if (updates.enabled !== undefined) embed.addFields({ name: 'Status', value: updates.enabled ? '✅ Enabled' : '❌ Disabled', inline: true });
  if (updates.trackingRoles) embed.addFields({ name: 'Tracking Roles', value: updates.trackingRoles.map(r => `<@&${r}>`).join(', '), inline: true });
  if (updates.liveRoles) embed.addFields({ name: 'Live Roles', value: updates.liveRoles.map(r => `<@&${r}>`).join(', '), inline: true });
  if (updates.channelId) embed.addFields({ name: 'Channel', value: `<#${updates.channelId}>`, inline: true });
  if (updates.customMessage !== undefined) embed.addFields({ name: 'Custom Message', value: updates.customMessage || '(cleared)', inline: false });
  if (updates.cooldown !== undefined) embed.addFields({ name: 'Cooldown', value: `${updates.cooldown}s`, inline: true });
  if (updates.cleanup !== undefined) embed.addFields({ name: 'Cleanup', value: updates.cleanup ? 'Enabled' : 'Disabled', inline: true });

  await interaction.editReply({ embeds: [embed] });
}

async function handleTikTokPresenceCheck(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const settings = guildSettings.getSettings(guildId);
  if (!settings?.streaming?.tiktok) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Configured')
      .setDescription('TikTok streaming is not configured for this server. Use `/tiktok presence setup` first.')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const tiktok = settings.streaming.tiktok;
  if (!tiktok.enabled) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Disabled')
      .setDescription('TikTok streaming notifications are disabled.')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const guild = interaction.guild;
  const trackingRoles = tiktok.trackingRoles || [];
  const liveRoles = tiktok.liveRoles || [];
  const channelId = tiktok.channelId;

  if (trackingRoles.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ No Tracking Roles')
      .setDescription('No tracking roles are configured.')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  if (!channelId) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ No Channel')
      .setDescription('No notification channel is configured.')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const streamingMembers = [];
  for (const roleId of trackingRoles) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) continue;

    for (const member of role.members.values()) {
      const tiktokActivity = member.presence?.activities?.filter(a => a.type === 1).find(a => presenceStreaming.detectPlatform(a) === 'tiktok');
      if (tiktokActivity && await presenceStreaming.verifyTikTokActivity(tiktokActivity)) {
        streamingMembers.push({
          member,
          activity: tiktokActivity,
          hasLiveRole: liveRoles.some(lr => member.roles.cache.has(lr))
        });
      }
    }
  }

  if (streamingMembers.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('📺 TikTok Presence Check')
      .setDescription('No users with tracking roles have a verified TikTok live stream right now.')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const fixedMembers = [];
  for (const { member, activity, hasLiveRole } of streamingMembers) {
    let fixed = false;
    
    if (!hasLiveRole && liveRoles.length > 0) {
      for (const roleId of liveRoles) {
        try {
          const role = await guild.roles.fetch(roleId).catch(() => null);
          if (role) {
            await member.roles.add(role, `Manual fix via check command`);
            fixed = true;
          }
        } catch (err) {
          console.error(`[TikTok Presence Check] Failed to assign role to ${member.displayName}:`, err.message);
        }
      }
    }
    
    if (fixed) {
      fixedMembers.push(member.displayName);
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('📺 TikTok Presence Check')
    .setDescription(`Found ${streamingMembers.length} user(s) streaming on TikTok:`)
    .setColor('#00F2EA');

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

async function handleTikTokPresenceResend(interaction, presenceStreaming, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const user = interaction.options.getUser('user');
  const settings = guildSettings.getSettings(guildId);
  
  if (!settings?.streaming?.tiktok) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Configured')
      .setDescription('TikTok streaming is not configured for this server. Use `/tiktok presence setup` first.')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const tiktok = settings.streaming.tiktok;
  if (!tiktok.enabled) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Disabled')
      .setDescription('TikTok streaming notifications are disabled.')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const guild = interaction.guild;
  const member = await guild.members.fetch(user.id).catch(() => null);
  
  if (!member) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ User Not Found')
      .setDescription('User not found in this server')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const activity = member.presence?.activities?.filter(a => a.type === 1).find(a => presenceStreaming.detectPlatform(a) === 'tiktok');
  if (!activity) {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Not Streaming')
      .setDescription('This user is not currently streaming on TikTok')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const verifiedLive = await presenceStreaming.verifyTikTokActivity(activity);
  if (verifiedLive !== true) {
    const embed = new EmbedBuilder()
      .setTitle(verifiedLive === false ? '⚠️ Not Live' : '⚠️ TikTok Check Unavailable')
      .setDescription(verifiedLive === false ? 'TikTok did not confirm that this user is live.' : 'Could not verify the TikTok live status right now.')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  const platform = presenceStreaming.detectPlatform(activity);
  if (platform !== 'tiktok') {
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Wrong Platform')
      .setDescription('This user is streaming on a different platform')
      .setColor('#00F2EA');
    return interaction.editReply({ embeds: [embed] });
  }

  await presenceStreaming.notifyLive(member.presence, activity, 'tiktok', tiktok, guildId, user.id);

  const embed = new EmbedBuilder()
    .setTitle('✅ Notification Resent')
    .setDescription(`Successfully resent notification for ${member.displayName}`)
    .setColor('#00F2EA');

  await interaction.editReply({ embeds: [embed] });
}
