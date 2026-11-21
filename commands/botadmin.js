const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const blocklistManager = require('../modules/blocklistManager');
const configLoader = require('../modules/configLoader');
const guildSettings = require('../modules/guildSettings');

// Get bot owner IDs from config
function isBotOwner(userId) {
  const owners = configLoader.config?.ownerIDS || [];
  return owners.includes(userId);
}

async function getTwitchBotStatus() {
  const port = Number(process.env.TWITCH_BOT_PORT || 3003);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('TWITCH_BOT_PORT must be a valid TCP port.');
  }

  const response = await fetch(`http://127.0.0.1:${port}/status`, {
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) {
    throw new Error(`Twitch status service returned HTTP ${response.status}.`);
  }
  return response.json();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botadmin')
    .setDescription('Bot administration commands (Bot Owner Only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub
        .setName('servers')
        .setDescription('List all servers the bot is in'))
    .addSubcommand(sub =>
      sub
        .setName('blockguild')
        .setDescription('Block a guild from using the bot')
        .addStringOption(opt =>
          opt
            .setName('guild_id')
            .setDescription('The guild ID to block')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub
        .setName('unblockguild')
        .setDescription('Unblock a guild')
        .addStringOption(opt =>
          opt
            .setName('guild_id')
            .setDescription('The guild ID to unblock')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub
        .setName('blockedguilds')
        .setDescription('List all blocked guilds'))
    .addSubcommand(sub =>
      sub
        .setName('twitchchannels')
        .setDescription('List all Twitch channels the bot is in'))
    .addSubcommand(sub =>
      sub
        .setName('blocktwitch')
        .setDescription('Block a Twitch channel from using the bot')
        .addStringOption(opt =>
          opt
            .setName('channel')
            .setDescription('The Twitch channel name to block')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub
        .setName('unblocktwitch')
        .setDescription('Unblock a Twitch channel')
        .addStringOption(opt =>
          opt
            .setName('channel')
            .setDescription('The Twitch channel name to unblock')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub
        .setName('blockedtwitch')
        .setDescription('List all blocked Twitch channels'))
    .addSubcommand(sub =>
      sub
        .setName('blockdiscorduser')
        .setDescription('Block a Discord user from using the bot')
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('The Discord user to block')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub
        .setName('unblockdiscorduser')
        .setDescription('Unblock a Discord user')
        .addUserOption(opt =>
          opt
            .setName('user')
            .setDescription('The Discord user to unblock')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub
        .setName('blockeddiscordusers')
        .setDescription('List all blocked Discord users'))
    .addSubcommand(sub =>
      sub
        .setName('blocktwitchuser')
        .setDescription('Block a Twitch user from using the bot in any channel')
        .addStringOption(opt =>
          opt
            .setName('username')
            .setDescription('The Twitch username to block')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub
        .setName('unblocktwitchuser')
        .setDescription('Unblock a Twitch user')
        .addStringOption(opt =>
          opt
            .setName('username')
            .setDescription('The Twitch username to unblock')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub
        .setName('blockedtwitchusers')
        .setDescription('List all blocked Twitch users')),

  // Handle button interactions for botadmin servers pagination
  async handleButtonInteraction(interaction) {
    const client = interaction.client;
    
    // Parse customId: botadmin_servers_action_messageId
    const parts = interaction.customId.split('_');
    const action = parts[2]; // prev, next, or refresh
    const messageId = parts[3]; // message ID for persistence
    
    // Get current page from embed description
    const embed = interaction.message.embeds[0];
    const description = embed.description || '';
    const pageMatch = description.match(/Page (\d+)\/(\d+)/);
    
    if (!pageMatch) {
      return interaction.reply({
        content: '❌ Could not determine current page.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    let currentPage = parseInt(pageMatch[1]) - 1;
    const totalPages = parseInt(pageMatch[2]);
    
    // Pagination settings
    const ITEMS_PER_PAGE = 1;
    
    // Get fresh data
    const guilds = client.guilds.cache.map(g => {
      const settings = guildSettings.getSettings(g.id);
      return {
        id: g.id,
        name: g.name,
        memberCount: g.memberCount,
        ownerId: g.ownerId,
        joinedAt: settings.joinedAt || g.joinedAt?.toISOString() || null
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    
    const blockedGuilds = blocklistManager.getBlockedGuilds();
    
    // Handle actions
    if (action === 'prev') {
      currentPage = currentPage > 0 ? currentPage - 1 : totalPages - 1;
    } else if (action === 'next') {
      currentPage = currentPage < totalPages - 1 ? currentPage + 1 : 0;
    } else if (action === 'refresh') {
      // Recalculate total pages after refresh
      const newTotalPages = Math.ceil(guilds.length / ITEMS_PER_PAGE);
      if (currentPage >= newTotalPages) {
        currentPage = Math.max(0, newTotalPages - 1);
      }
    }
    
    // Generate new embed
    const start = currentPage * ITEMS_PER_PAGE;
    const end = Math.min(start + ITEMS_PER_PAGE, guilds.length);
    const pageGuilds = guilds.slice(start, end);
    
    const newEmbed = new EmbedBuilder()
      .setTitle(`📋 Servers (${guilds.length} total)`)
      .setColor('#FF6600')
      .setDescription(`Page ${currentPage + 1}/${Math.ceil(guilds.length / ITEMS_PER_PAGE)}`);

    for (const guild of pageGuilds) {
      const isBlocked = blockedGuilds.includes(guild.id);
      const status = isBlocked ? '🔴 BLOCKED' : '🟢 Active';
      
      let joinDateDisplay = 'Unknown';
      if (guild.joinedAt) {
        const joinDate = new Date(guild.joinedAt);
        const unixTimestamp = Math.floor(joinDate.getTime() / 1000);
        joinDateDisplay = `<t:${unixTimestamp}:R>`;
      }
      
      newEmbed.addFields({
        name: guild.name,
        value: `🆔 ID: \`${guild.id}\`\n👥 Members: ${guild.memberCount.toLocaleString()}\n👑 Owner: <@${guild.ownerId}>\nOwner ID: ${guild.ownerId}\n📅 Joined: ${joinDateDisplay}\nStatus: ${status}`,
        inline: false
      });
    }
    
    // Generate action row with buttons
    const row = new ActionRowBuilder();
    
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`botadmin_servers_prev_${messageId}`)
        .setLabel('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false)
    );

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`botadmin_servers_next_${messageId}`)
        .setLabel('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(false)
    );

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`botadmin_servers_refresh_${messageId}`)
        .setLabel('🔄')
        .setStyle(ButtonStyle.Secondary)
    );
    
    await interaction.update({
      embeds: [newEmbed],
      components: [row]
    });
  },

  async execute(interaction, client) {
    // Verify bot owner
    if (!isBotOwner(interaction.user.id)) {
      return interaction.reply({
        content: '❌ This command is restricted to bot owners only.',
        flags: MessageFlags.Ephemeral
      });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'servers': {
          await interaction.deferReply();

          const guilds = client.guilds.cache.map(g => {
            const settings = guildSettings.getSettings(g.id);
            return {
              id: g.id,
              name: g.name,
              memberCount: g.memberCount,
              ownerId: g.ownerId,
              joinedAt: settings.joinedAt || g.joinedAt?.toISOString() || null
            };
          });

          if (guilds.length === 0) {
            return interaction.editReply('The bot is not in any servers.');
          }

          // Sort alphabetically by name
          guilds.sort((a, b) => a.name.localeCompare(b.name));

          // Check which guilds are blocked
          const blockedGuilds = blocklistManager.getBlockedGuilds();

          // Pagination settings
          const ITEMS_PER_PAGE = 1;
          const totalPages = Math.ceil(guilds.length / ITEMS_PER_PAGE);
          let currentPage = 0;

          // Function to generate embed for current page
          const generateEmbed = (page) => {
            const start = page * ITEMS_PER_PAGE;
            const end = Math.min(start + ITEMS_PER_PAGE, guilds.length);
            const pageGuilds = guilds.slice(start, end);

            const embed = new EmbedBuilder()
              .setTitle(`📋 Servers (${guilds.length} total)`)
              .setColor('#FF6600')
              .setDescription(`Page ${page + 1}/${totalPages}`)

            for (const guild of pageGuilds) {
              const isBlocked = blockedGuilds.includes(guild.id);
              const status = isBlocked ? '🔴 BLOCKED' : '🟢 Active';
              
              let joinDateDisplay = 'Unknown';
              if (guild.joinedAt) {
                const joinDate = new Date(guild.joinedAt);
                const unixTimestamp = Math.floor(joinDate.getTime() / 1000);
                // Use Discord timestamp format D for long date (Month name, day, year)
                joinDateDisplay = `<t:${unixTimestamp}:R>`;
              }
              
              embed.addFields({
                name: guild.name,
                value: `🆔 ID: \`${guild.id}\`\n👥 Members: ${guild.memberCount.toLocaleString()}\n👑 Owner: <@${guild.ownerId}>\nOwner ID: ${guild.ownerId}\n📅 Joined: ${joinDateDisplay}\nStatus: ${status}`,
                inline: false
              });
            }

            return embed;
          };

          // Function to generate action row with buttons
          const generateActionRow = (page, messageId) => {
            const row = new ActionRowBuilder();
            
            // Previous button
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(`botadmin_servers_prev_${messageId}`)
                .setLabel('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(false)
            );

            // Next button
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(`botadmin_servers_next_${messageId}`)
                .setLabel('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(false)
            );

            // Refresh button
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(`botadmin_servers_refresh_${messageId}`)
                .setLabel('🔄')
                .setStyle(ButtonStyle.Secondary)
            );

            return row;
          };

          // Send initial message
          const message = await interaction.editReply({
            embeds: [generateEmbed(currentPage)],
            components: [generateActionRow(currentPage, 'initial')]
          });

          // Update buttons with actual message ID for persistence
          await message.edit({
            components: [generateActionRow(currentPage, message.id)]
          });

          break;
        }

        case 'blockguild': {
          const guildId = interaction.options.getString('guild_id');

          // Verify the bot is actually in this guild
          const guild = client.guilds.cache.get(guildId);
          if (!guild) {
            return interaction.reply({
              content: `❌ Guild \`${guildId}\` not found. The bot must be in the guild to block it.`,
              flags: MessageFlags.Ephemeral
            });
          }

          const success = blocklistManager.blockGuild(guildId);

          const embed = new EmbedBuilder()
            .setTitle(success ? '🔴 Guild Blocked' : '❌ Error')
            .setDescription(success
              ? `**${guild.name}** (\`${guildId}\`) has been blocked from using the bot.`
              : 'Failed to block the guild.')
            .setColor(success ? '#FF0000' : '#FFA500');

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          break;
        }

        case 'unblockguild': {
          const guildId = interaction.options.getString('guild_id');
          const success = blocklistManager.unblockGuild(guildId);

          const embed = new EmbedBuilder()
            .setTitle(success ? '🟢 Guild Unblocked' : '❌ Error')
            .setDescription(success
              ? `Guild \`${guildId}\` has been unblocked. The bot will now respond to commands in that server.`
              : 'Failed to unblock the guild. It may not have been blocked.')
            .setColor(success ? '#85C742' : '#FFA500');

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          break;
        }

        case 'blockedguilds': {
          const blockedGuilds = blocklistManager.getBlockedGuilds();

          if (blockedGuilds.length === 0) {
            return interaction.reply({
              content: '✅ No guilds are currently blocked.',
              flags: MessageFlags.Ephemeral
            });
          }

          // Try to get guild names for blocked guilds
          const guildList = blockedGuilds.map(id => {
            const guild = client.guilds.cache.get(id);
            return guild ? `${guild.name} (\`${id}\`)` : `Unknown Guild (\`${id}\`)`;
          });

          const embed = new EmbedBuilder()
            .setTitle('🔴 Blocked Guilds')
            .setDescription(guildList.join('\n'))
            .setColor('#FF0000')
            .setFooter({ text: `${blockedGuilds.length} blocked guild(s)` });

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          break;
        }

        case 'twitchchannels': {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });

          let status;
          try {
            status = await getTwitchBotStatus();
          } catch (error) {
            console.error('[BotAdmin] Could not read Twitch bot status:', error?.message || error);
            return interaction.editReply(
              `❌ Could not reach the Twitch bot status service on port ${process.env.TWITCH_BOT_PORT || 3003}. Ensure the Twitch bot process is running.`
            );
          }

          const channels = (status.joinedChannels || []).map(channel => channel.replace(/^#/, '').toLowerCase());
          const configuredChannels = (status.configuredChannels || []).map(channel => channel.replace(/^#/, '').toLowerCase());
          const blockedChannels = blocklistManager.getBlockedTwitchChannels();
          const channelList = channels.length
            ? channels.map(name => {
              const isBlocked = blockedChannels.some(blocked => blocked.toLowerCase() === name);
              const channelStatus = isBlocked ? '🔴 BLOCKED' : '🟢 Active';
              return `• ${name} - ${channelStatus}`;
            })
            : ['The bot is not currently joined to any Twitch channels.'];
          const description = [
            `**Connection:** ${status.connected ? '🟢 Connected' : `🔴 Disconnected (${status.readyState})`}`,
            `**Twitch account:** ${status.username || 'Unknown'}`,
            `**Joined channels:** ${channelList.join('\n')}`,
            `**Configured channels:** ${configuredChannels.length ? configuredChannels.join(', ') : 'None'}`
          ].join('\n');

          const embed = new EmbedBuilder()
            .setTitle('📺 Twitch Bot Status')
            .setDescription(description)
            .setColor('#9146FF')
            .setFooter({ text: `${channels.length} joined channel(s) • ${blockedChannels.length} blocked channel(s)` });

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'blocktwitch': {
          const channel = interaction.options.getString('channel').toLowerCase().trim().replace('#', '');

          let isInChannel = false;
          try {
            const status = await getTwitchBotStatus();
            isInChannel = status.connected &&
              status.joinedChannels?.some(joined => joined.replace(/^#/, '').toLowerCase() === channel);
          } catch (error) {
            console.error('[BotAdmin] Could not check Twitch channel membership:', error?.message || error);
          }

          const success = blocklistManager.blockTwitchChannel(channel);

          const embed = new EmbedBuilder()
            .setTitle(success ? '🔴 Twitch Channel Blocked' : '❌ Error')
            .setDescription(success
              ? `**${channel}** has been blocked.\n\n${isInChannel ? '⚠️ The bot is currently in this channel and will ignore messages until unblocked.' : 'The bot will not join this channel if added to config.'}`
              : 'Failed to block the Twitch channel.')
            .setColor(success ? '#FF0000' : '#FFA500');

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          break;
        }

        case 'unblocktwitch': {
          const channel = interaction.options.getString('channel').toLowerCase().trim().replace('#', '');
          const success = blocklistManager.unblockTwitchChannel(channel);

          const embed = new EmbedBuilder()
            .setTitle(success ? '🟢 Twitch Channel Unblocked' : '❌ Error')
            .setDescription(success
              ? `**${channel}** has been unblocked. The bot will now process messages in this channel.`
              : 'Failed to unblock the Twitch channel. It may not have been blocked.')
            .setColor(success ? '#85C742' : '#FFA500');

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          break;
        }

        case 'blockedtwitch': {
          const blockedChannels = blocklistManager.getBlockedTwitchChannels();

          if (blockedChannels.length === 0) {
            return interaction.reply({
              content: '✅ No Twitch channels are currently blocked.',
              flags: MessageFlags.Ephemeral
            });
          }

          const embed = new EmbedBuilder()
            .setTitle('🔴 Blocked Twitch Channels')
            .setDescription(blockedChannels.map(ch => `• ${ch}`).join('\n'))
            .setColor('#FF0000')
            .setFooter({ text: `${blockedChannels.length} blocked channel(s)` });

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          break;
        }

        case 'blockdiscorduser': {
          const user = interaction.options.getUser('user');
          const success = blocklistManager.blockDiscordUser(user.id);

          const embed = new EmbedBuilder()
            .setTitle(success ? '🔴 Discord User Blocked' : '❌ Error')
            .setDescription(success
              ? `**${user.tag}** (\`${user.id}\`) has been blocked from using the bot.`
              : 'Failed to block the Discord user.')
            .setColor(success ? '#FF0000' : '#FFA500');

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          break;
        }

        case 'unblockdiscorduser': {
          const user = interaction.options.getUser('user');
          const success = blocklistManager.unblockDiscordUser(user.id);

          const embed = new EmbedBuilder()
            .setTitle(success ? '🟢 Discord User Unblocked' : '❌ Error')
            .setDescription(success
              ? `**${user.tag}** (\`${user.id}\`) has been unblocked and can now use the bot.`
              : 'Failed to unblock the Discord user. They may not have been blocked.')
            .setColor(success ? '#85C742' : '#FFA500');

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          break;
        }

        case 'blockeddiscordusers': {
          const blockedUsers = blocklistManager.getBlockedDiscordUsers();

          if (blockedUsers.length === 0) {
            return interaction.reply({
              content: '✅ No Discord users are currently blocked.',
              flags: MessageFlags.Ephemeral
            });
          }

          const embed = new EmbedBuilder()
            .setTitle('🔴 Blocked Discord Users')
            .setDescription(blockedUsers.map(id => `• <@${id}> (\`${id}\`)`).join('\n'))
            .setColor('#FF0000')
            .setFooter({ text: `${blockedUsers.length} blocked user(s)` });

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          break;
        }

        case 'blocktwitchuser': {
          const username = interaction.options.getString('username').toLowerCase().trim();
          const success = blocklistManager.blockTwitchUser(username);

          const embed = new EmbedBuilder()
            .setTitle(success ? '🔴 Twitch User Blocked' : '❌ Error')
            .setDescription(success
              ? `**${username}** has been blocked from using the bot in any channel.`
              : 'Failed to block the Twitch user.')
            .setColor(success ? '#FF0000' : '#FFA500');

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          break;
        }

        case 'unblocktwitchuser': {
          const username = interaction.options.getString('username').toLowerCase().trim();
          const success = blocklistManager.unblockTwitchUser(username);

          const embed = new EmbedBuilder()
            .setTitle(success ? '🟢 Twitch User Unblocked' : '❌ Error')
            .setDescription(success
              ? `**${username}** has been unblocked and can now use the bot.`
              : 'Failed to unblock the Twitch user. They may not have been blocked.')
            .setColor(success ? '#85C742' : '#FFA500');

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          break;
        }

        case 'blockedtwitchusers': {
          const blockedUsers = blocklistManager.getBlockedTwitchUsers();

          if (blockedUsers.length === 0) {
            return interaction.reply({
              content: '✅ No Twitch users are currently blocked.',
              flags: MessageFlags.Ephemeral
            });
          }

          const embed = new EmbedBuilder()
            .setTitle('🔴 Blocked Twitch Users')
            .setDescription(blockedUsers.map(u => `• ${u}`).join('\n'))
            .setColor('#FF0000')
            .setFooter({ text: `${blockedUsers.length} blocked user(s)` });

          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          break;
        }
      }
    } catch (error) {
      console.error('[BotAdmin] Error:', error);
      const response = { content: `❌ An error occurred: ${error.message}`, flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.editReply(response);
      else await interaction.reply(response);
    }
  }
};
