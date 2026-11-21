const { randomUUID } = require('crypto');
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const selfAssignableRoles = require('../modules/selfAssignableRoles');

const pendingSelfroleAdd = new Map();

function parseMessageReference(interaction, messageString) {
  const trimmed = (messageString || '').trim();
  const linkMatch = trimmed.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i);
  let channelId;
  let messageId;

  if (linkMatch) {
    const guildId = linkMatch[1];
    channelId = linkMatch[2];
    messageId = linkMatch[3];
    if (guildId !== interaction.guild.id) {
      throw new Error('That message belongs to a different server.');
    }
  } else if (/^\d{17,20}$/.test(trimmed)) {
    messageId = trimmed;
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel || !channel.isTextBased()) {
      throw new Error('If you provided only a message ID, also provide the channel or invoke the command in the target channel.');
    }
    channelId = channel.id;
  } else {
    throw new Error('Provide a message link or a message ID.');
  }

  return { channelId, messageId };
}

function parseRoleReference(roleText, guild) {
  const trimmed = (roleText || '').trim();
  let roleId = null;
  const mentionMatch = trimmed.match(/^<@&?(\d+)>$/);
  if (mentionMatch) {
    roleId = mentionMatch[1];
  } else if (/^\d{17,20}$/.test(trimmed)) {
    roleId = trimmed;
  }

  if (roleId) {
    return guild.roles.cache.get(roleId) || null;
  }

  return guild.roles.cache.find(role => role.name.toLowerCase() === trimmed.toLowerCase()) || null;
}

function parsePairs(value, guild) {
  const parts = String(value || '')
    .replace(/\r\n/g, '\n')
    .split(/[\n,]+/)
    .map(p => p.trim())
    .filter(Boolean);

  if (!parts.length) {
    throw new Error('No emoji-role pairs were found. Enter one pair per line, for example:\n🔥 @Gamer\n<:cool:123> @Custom');
  }

  return parts.map(part => {
    let emoji;
    let roleReference;
    const match = part.match(/^(\S+)\s+(.+)$/);
    if (match) {
      emoji = match[1];
      roleReference = match[2].trim();
    } else {
      const roleMentionIndex = part.indexOf('<@&');
      if (roleMentionIndex > 0) {
        emoji = part.slice(0, roleMentionIndex).trim();
        roleReference = part.slice(roleMentionIndex).trim();
      }
    }

    if (!emoji || !roleReference) {
      throw new Error('Invalid pair format: ' + part + '. Each pair must contain an emoji and a role, e.g. `🔥 @Gamer` or `<:cool:123> @Custom`.');
    }

    const role = parseRoleReference(roleReference, guild);
    if (!role) {
      throw new Error(`Could not find role for "${roleReference}".`);
    }

    return { emoji, role };
  });
}

function createSelfroleTargetModal(sessionId) {
  const modal = new ModalBuilder()
    .setCustomId(`selfrole_target_modal:${sessionId}`)
    .setTitle('Choose target message');

  const messageInput = new TextInputBuilder()
    .setCustomId('selfrole_message')
    .setLabel('Message link or ID')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://discord.com/channels/... or message id')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(200);

  const channelInput = new TextInputBuilder()
    .setCustomId('selfrole_channel')
    .setLabel('Channel ID (only if using message ID)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('optional: channel id')
    .setRequired(false)
    .setMaxLength(25);

  modal.addComponents(
    new ActionRowBuilder().addComponents(messageInput),
    new ActionRowBuilder().addComponents(channelInput)
  );

  return modal;
}

function createSelfroleModal(sessionId) {
  const modal = new ModalBuilder()
    .setCustomId(`selfrole_add_modal:${sessionId}`)
    .setTitle('Add self-role mappings');

  const pairsInput = new TextInputBuilder()
    .setCustomId('selfrole_pairs')
    .setLabel('Emoji + role pairs')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('One per line\n🔥 @Gamer\n<:cool:123> @Custom')
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(4000);

  modal.addComponents(new ActionRowBuilder().addComponents(pairsInput));
  return modal;
}

async function applySelfrolePairs(interaction, channel, message, pairsValue, guild) {
  const pairs = parsePairs(pairsValue, guild);
  const configured = [];

  for (const pair of pairs) {
    const emoji = pair.emoji;
    const role = pair.role;

    await message.react(emoji).catch(() => null);
    selfAssignableRoles.addReactionRole(guild.id, message.id, channel.id, emoji, role.id);
    configured.push(`${emoji} → <@&${role.id}>`);
  }

  return `✅ Self-role setup updated for <#${channel.id}> message ${message.id}.\n${configured.join('\n')}`;
}

async function handleButtonInteraction(interaction) {
  if (interaction.customId.startsWith('selfrole_add:')) {
    const sessionId = interaction.customId.replace('selfrole_add:', '');
    const session = pendingSelfroleAdd.get(sessionId);

    if (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guild.id) {
      pendingSelfroleAdd.delete(sessionId);
      return interaction.reply({ content: 'This self-role setup expired. Run `/selfrole add` again.', flags: MessageFlags.Ephemeral });
    }

    await interaction.showModal(createSelfroleModal(sessionId));
    return;
  }

  if (interaction.customId.startsWith('selfrole_cancel:')) {
    const sessionId = interaction.customId.replace('selfrole_cancel:', '');
    pendingSelfroleAdd.delete(sessionId);
    return interaction.update({ content: 'Self-role setup cancelled.', components: [], embeds: [] });
  }
}

async function handleModalInteraction(interaction) {
  if (interaction.customId.startsWith('selfrole_target_modal:')) {
    const sessionId = interaction.customId.replace('selfrole_target_modal:', '');
    const messageValue = interaction.fields.getTextInputValue('selfrole_message');
    const channelValue = interaction.fields.getTextInputValue('selfrole_channel');

    try {
      const { channelId, messageId } = parseMessageReference({ guild: interaction.guild, options: { getChannel: () => interaction.channel } }, messageValue + (channelValue ? ` ${channelValue}` : ''));
      const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        throw new Error('Unable to find the target channel or it is not text-based.');
      }

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        throw new Error('Unable to fetch the target message.');
      }

      pendingSelfroleAdd.set(sessionId, {
        guildId: interaction.guild.id,
        channelId: channel.id,
        messageId: message.id,
        userId: interaction.user.id
      });

      return interaction.reply({
        content: `Set self-role mappings for <#${channel.id}> message ${message.id}.\n\nUse the next modal and enter one emoji + role pair per line:\n🔥 @Gamer\n<:cool:123> @Custom`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`selfrole_add:${sessionId}`)
              .setLabel('Add role mappings')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`selfrole_cancel:${sessionId}`)
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Secondary)
          )
        ],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      console.error('selfrole target modal error:', error);
      return interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
    }
  }

  if (!interaction.customId.startsWith('selfrole_add_modal:')) {
    return;
  }

  const sessionId = interaction.customId.replace('selfrole_add_modal:', '');
  const session = pendingSelfroleAdd.get(sessionId);

  if (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guild.id) {
    pendingSelfroleAdd.delete(sessionId);
    return interaction.reply({ content: 'This self-role setup expired. Run `/selfrole add` again.', flags: MessageFlags.Ephemeral });
  }

  try {
    const channel = await interaction.guild.channels.fetch(session.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new Error('Unable to find the target channel or it is not text-based.');
    }

    const message = await channel.messages.fetch(session.messageId).catch(() => null);
    if (!message) {
      throw new Error('Unable to fetch the target message.');
    }

    const pairsValue = interaction.fields.getTextInputValue('selfrole_pairs');
    const response = await applySelfrolePairs(interaction, channel, message, pairsValue, interaction.guild);

    pendingSelfroleAdd.delete(sessionId);
    return interaction.reply({ content: response, flags: MessageFlags.Ephemeral });
  } catch (error) {
    pendingSelfroleAdd.delete(sessionId);
    console.error('selfrole modal error:', error);
    return interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('selfrole')
    .setDescription('Configure self-assignable roles via message reactions')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add reaction-role mappings to a message (modal-driven)'))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove one mapping from a message')
        .addStringOption(option =>
          option.setName('message')
            .setDescription('Message link or message ID')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('emoji')
            .setDescription('Emoji to remove from the mapping')
            .setRequired(true))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel containing the message if only message ID is provided')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread
            )
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List configured self-role messages for this server')
        .addStringOption(option =>
          option.setName('message')
            .setDescription('Message link or message ID to inspect')
            .setRequired(false))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel containing the message if only message ID is provided')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread
            )
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Remove all mappings for a message')
        .addStringOption(option =>
          option.setName('message')
            .setDescription('Message link or message ID')
            .setRequired(true))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel containing the message if only message ID is provided')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread
            )
            .setRequired(false)))
  ,

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command may only be used in a server.', flags: MessageFlags.Ephemeral });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === 'add') {
        const sessionId = randomUUID().replaceAll('-', '');
        pendingSelfroleAdd.set(sessionId, {
          guildId: interaction.guild.id,
          channelId: interaction.channel.id,
          messageId: null,
          userId: interaction.user.id
        });

        return interaction.showModal(createSelfroleTargetModal(sessionId));
      }

      if (subcommand === 'remove') {
        const messageValue = interaction.options.getString('message');
        const emojiValue = interaction.options.getString('emoji');
        const { channelId, messageId } = parseMessageReference(interaction, messageValue);
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
          throw new Error('Unable to find the target channel or it is not text-based.');
        }

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) {
          throw new Error('Unable to fetch the target message.');
        }

        const removed = selfAssignableRoles.removeReactionRole(interaction.guild.id, message.id, emojiValue);
        if (!removed) {
          return interaction.reply({ content: `⚠️ No mapping found for ${emojiValue} on that message.`, flags: MessageFlags.Ephemeral });
        }

        const reaction = message.reactions.cache.find(r => r.emoji.identifier === selfAssignableRoles.normalizeEmojiKey(emojiValue));
        if (reaction) {
          await reaction.users.remove(interaction.client.user.id).catch(() => null);
        }

        return interaction.reply({ content: `✅ Removed mapping for ${emojiValue} from message ${message.id}.`, flags: MessageFlags.Ephemeral });
      }

      if (subcommand === 'list') {
        const messageValue = interaction.options.getString('message');
        if (!messageValue) {
          const all = selfAssignableRoles.listGuildMessages(interaction.guild.id);
          if (!all.length) {
            return interaction.reply({ content: 'No self-assignable role messages are configured for this server.', flags: MessageFlags.Ephemeral });
          }
          const lines = all.map(entry => {
            const roleLines = Object.values(entry.emojiRoles || {}).map(item => `${item.emoji} → <@&${item.roleId}>`).join('\n');
            return `• <#${entry.channelId}> message ${entry.messageId}:\n${roleLines}`;
          });
          return interaction.reply({ content: `Configured self-role messages:\n${lines.join('\n\n')}`, flags: MessageFlags.Ephemeral });
        }

        const { channelId, messageId } = parseMessageReference(interaction, messageValue);
        const messageConfig = selfAssignableRoles.getMessageConfig(interaction.guild.id, messageId);
        if (!messageConfig) {
          return interaction.reply({ content: 'No self-role mapping configured for that message.', flags: MessageFlags.Ephemeral });
        }

        const lines = Object.values(messageConfig.emojiRoles || {}).map(entry => `${entry.emoji} → <@&${entry.roleId}>`);
        return interaction.reply({ content: `Self-role mappings for <#${channelId}> message ${messageId}:\n${lines.join('\n')}`, flags: MessageFlags.Ephemeral });
      }

      if (subcommand === 'clear') {
        const messageValue = interaction.options.getString('message');
        const { channelId, messageId } = parseMessageReference(interaction, messageValue);
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
          throw new Error('Unable to find the target channel or it is not text-based.');
        }

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) {
          throw new Error('Unable to fetch the target message.');
        }

        const config = selfAssignableRoles.getMessageConfig(interaction.guild.id, message.id);
        if (!config) {
          return interaction.reply({ content: 'No self-role mapping configured for that message.', flags: MessageFlags.Ephemeral });
        }

        for (const key of Object.keys(config.emojiRoles || {})) {
          const reaction = message.reactions.cache.find(r => r.emoji.identifier === key);
          if (reaction) {
            await reaction.users.remove(interaction.client.user.id).catch(() => null);
          }
        }
        selfAssignableRoles.deleteMessageConfig(interaction.guild.id, message.id);
        return interaction.reply({ content: `✅ Cleared all self-role mappings for message ${message.id}.`, flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      console.error('selfrole command error:', error);
      return interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
    }
  },

  handleButtonInteraction,
  handleModalInteraction
};