const { randomUUID } = require('crypto');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const purgeSessions = new Map();
const SESSION_TTL = 15 * 60 * 1000;
const BULK_DELETE_AGE = 14 * 24 * 60 * 60 * 1000;

function hasManageMessages(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ||
    interaction.member?.permissions?.has(PermissionFlagsBits.ManageMessages);
}

function clearSession(token) {
  const session = purgeSessions.get(token);
  if (session?.timeout) clearTimeout(session.timeout);
  purgeSessions.delete(token);
}

function button(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style);
}

function buildScopePanel(token) {
  return {
    content: [
      '**Purge messages**',
      'Choose whose messages to search. Selecting a user by ID also works if they have left the server.',
      'Pinned messages will be kept.'
    ].join('\n'),
    components: [
      new ActionRowBuilder().addComponents(
        button(`purge:scope:all:${token}`, 'All users', ButtonStyle.Primary),
        button(`purge:scope:user:${token}`, 'Specific user'),
        button(`purge:cancel:${token}`, 'Cancel', ButtonStyle.Danger)
      )
    ]
  };
}

function buildUserPanel(token) {
  return {
    content: [
      '**Purge messages from a specific user**',
      'Select a current server member below, or enter a Discord user ID if they have left the server.',
      'Pinned messages will be kept.'
    ].join('\n'),
    components: [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`purge:user_select:${token}`)
          .setPlaceholder('Search and select a server member')
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        button(`purge:user_id:${token}`, 'Enter Discord user ID', ButtonStyle.Primary),
        button(`purge:scope:back:${token}`, 'Back'),
        button(`purge:cancel:${token}`, 'Cancel', ButtonStyle.Danger)
      )
    ]
  };
}

function buildAmountPanel(token, userId) {
  const target = userId ? ` for user ID \`${userId}\`` : '';
  return {
    content: [
      `**Purge messages${target}**`,
      'Choose a maximum number of matching messages to delete, or delete all matching messages in this channel.',
      'Messages older than 14 days are deleted individually and may take longer.'
    ].join('\n'),
    components: [
      new ActionRowBuilder().addComponents(
        button(`purge:amount:count:${token}`, 'Choose an amount', ButtonStyle.Primary),
        button(`purge:amount:all:${token}`, 'All messages', ButtonStyle.Danger),
        button(`purge:cancel:${token}`, 'Cancel')
      )
    ]
  };
}

function buildConfirmPanel(session) {
  const count = session.messageIds.length;
  const targetText = session.targetUserId
    ? ` from user ID \`${session.targetUserId}\``
    : ' from all users';
  const amountText = session.amount === null
    ? 'all matching messages'
    : `up to ${session.amount} matching message${session.amount === 1 ? '' : 's'}`;
  const oldMessageText = session.oldMessageCount
    ? `\n**${session.oldMessageCount}** are older than 14 days and will be deleted individually.`
    : '';

  return {
    content: [
      '**Review purge**',
      `Found **${count}** unpinned message${count === 1 ? '' : 's'}${targetText}; ${amountText} will be deleted from <#${session.channelId}>.`,
      oldMessageText,
      'Confirm to delete these messages. This cannot be undone.'
    ].filter(Boolean).join('\n'),
    components: [
      new ActionRowBuilder().addComponents(
        button(`purge:confirm:${session.token}`, `Delete ${count} message${count === 1 ? '' : 's'}`, ButtonStyle.Danger),
        button(`purge:cancel:${session.token}`, 'Cancel')
      )
    ]
  };
}

function createUserIdModal(token) {
  return new ModalBuilder()
    .setCustomId(`purge:user:${token}`)
    .setTitle('Choose a user')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('user_id')
          .setLabel('Discord user ID')
          .setPlaceholder('Example: 123456789012345678')
          .setStyle(TextInputStyle.Short)
          .setMinLength(17)
          .setMaxLength(20)
          .setRequired(true)
      )
    );
}

function createAmountModal(token) {
  return new ModalBuilder()
    .setCustomId(`purge:count:${token}`)
    .setTitle('Choose message amount')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('amount')
          .setLabel('Number of matching messages')
          .setPlaceholder('Enter a positive whole number')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(16)
          .setRequired(true)
      )
    );
}

function validateSession(interaction, token) {
  const session = purgeSessions.get(token);
  if (!session) {
    return {
      error: 'This purge setup expired. Run `/purge` again to start over.'
    };
  }
  if (session.userId !== interaction.user.id) {
    return {
      error: 'Only the person who started this purge can use these controls.'
    };
  }
  if (session.guildId !== interaction.guildId || session.channelId !== interaction.channelId) {
    return {
      error: 'This purge setup is no longer valid in this server or channel.'
    };
  }
  return { session };
}

function getSessionToken(customId) {
  return customId.split(':').at(-1);
}

async function scanMessages(interaction, session) {
  const messageIds = [];
  let before;
  let scanned = 0;
  let oldMessageCount = 0;
  const targetCount = session.amount;

  while (true) {
    const page = await interaction.channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {})
    });
    if (!page.size) break;

    for (const message of page.values()) {
      scanned++;
      if (message.pinned) continue;
      if (session.targetUserId && message.author.id !== session.targetUserId) continue;

      messageIds.push(message.id);
      if (message.createdTimestamp < Date.now() - BULK_DELETE_AGE) {
        oldMessageCount++;
      }
      if (targetCount !== null && messageIds.length >= targetCount) break;
    }

    before = page.last().id;
    if (targetCount !== null && messageIds.length >= targetCount) break;

    if (scanned % 1000 === 0 && session.progressAvailable !== false) {
      try {
        await interaction.editReply({
          content: `Searching channel history... **${scanned}** messages checked.`,
          components: []
        });
      } catch (error) {
        session.progressAvailable = false;
        console.error('Could not update purge scan progress; continuing the scan:', error);
      }
    }
    if (page.size < 100) break;
  }

  session.messageIds = messageIds;
  session.oldMessageCount = oldMessageCount;
  return messageIds;
}

async function startScan(interaction, session) {
  session.processing = true;
  try {
    await interaction.deferUpdate();
    await interaction.editReply({
      content: 'Searching channel history for matching messages...',
      components: []
    });

    const messageIds = await scanMessages(interaction, session);
    if (!messageIds.length) {
      clearSession(session.token);
      return interaction.editReply({
        content: 'No unpinned matching messages were found in this channel.',
        components: []
      });
    }

    session.processing = false;
    await interaction.editReply(buildConfirmPanel(session));
  } catch (error) {
    clearSession(session.token);
    console.error('Failed to scan messages for purge:', error);
    await interaction.editReply({
      content: 'Could not search this channel’s history. Check my View Channel and Read Message History permissions, then try again.',
      components: []
    });
  }
}

async function deleteMessages(interaction, session) {
  const botMember = interaction.guild.members.me ||
    interaction.guild.members.cache.get(interaction.client.user.id);
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({
      content: 'I need the Manage Messages permission to delete messages.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (!hasManageMessages(interaction)) {
    return interaction.reply({
      content: 'You need the Manage Messages permission to confirm this purge.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (session.processing) {
    return interaction.reply({
      content: 'This purge is already being processed.',
      flags: MessageFlags.Ephemeral
    });
  }
  session.processing = true;
  await interaction.deferUpdate();
  await interaction.editReply({
    content: `Deleting **${session.messageIds.length}** messages...`,
    components: []
  });
  clearSession(session.token);

  let deletedCount = 0;
  let failedCount = 0;
  let skippedPinnedCount = 0;

  for (let index = 0; index < session.messageIds.length; index++) {
    const messageId = session.messageIds[index];
    try {
      const message = await interaction.channel.messages.fetch({
        message: messageId,
        force: true
      });
      if (message.pinned) {
        skippedPinnedCount++;
        continue;
      }

      await message.delete('Purge command');
      deletedCount++;
    } catch (error) {
      failedCount++;
      console.error(`Failed to recheck or delete purge message ${messageId}:`, error);
    }
    if ((index + 1) % 25 === 0 && session.progressAvailable !== false) {
      try {
        await interaction.editReply({
          content: `Checking and deleting messages... **${index + 1}/${session.messageIds.length}** processed. **${deletedCount}** deleted.`,
          components: []
        });
      } catch (error) {
        session.progressAvailable = false;
        console.error('Could not update purge progress; continuing deletion:', error);
      }
    }
  }

  const result = [
    `Purge finished: **${deletedCount}** message${deletedCount === 1 ? '' : 's'} deleted.`,
    skippedPinnedCount ? `**${skippedPinnedCount}** pinned message${skippedPinnedCount === 1 ? ' was' : 's were'} skipped.` : '',
    failedCount ? `**${failedCount}** could not be deleted; check the bot’s permissions and logs.` : ''
  ].filter(Boolean).join('\n');
  try {
    await interaction.editReply({ content: result, components: [] });
  } catch (error) {
    console.error('Purge completed but the final interaction response could not be updated:', error);
  }
}

async function handleButtonInteraction(interaction) {
  const token = getSessionToken(interaction.customId);
  const validation = validateSession(interaction, token);
  if (validation.error) {
    return interaction.reply({
      content: validation.error,
      flags: MessageFlags.Ephemeral
    });
  }
  const { session } = validation;
  if (session.processing) {
    return interaction.reply({
      content: 'This purge is already being processed. Please wait.',
      flags: MessageFlags.Ephemeral
    });
  }
  const [, action, choice] = interaction.customId.split(':');

  if (action === 'cancel') {
    clearSession(token);
    return interaction.update({
      content: 'Purge canceled. No messages were deleted.',
      components: []
    });
  }

  if (action === 'scope') {
    if (choice === 'user') {
      return interaction.update(buildUserPanel(token));
    }
    if (choice === 'back') {
      return interaction.update(buildScopePanel(token));
    }
    if (choice === 'all') {
      session.targetUserId = null;
      return interaction.update(buildAmountPanel(token, null));
    }
  }

  if (action === 'user_id') {
    return interaction.showModal(createUserIdModal(token));
  }

  if (action === 'amount') {
    if (choice === 'count') {
      return interaction.showModal(createAmountModal(token));
    }
    if (choice === 'all') {
      session.amount = null;
      return startScan(interaction, session);
    }
  }

  if (action === 'confirm') {
    return deleteMessages(interaction, session);
  }

  return interaction.reply({
    content: 'This purge action is not recognized.',
    flags: MessageFlags.Ephemeral
  });
}

async function handleSelectMenuInteraction(interaction) {
  const token = getSessionToken(interaction.customId);
  const validation = validateSession(interaction, token);
  if (validation.error) {
    return interaction.reply({
      content: validation.error,
      flags: MessageFlags.Ephemeral
    });
  }

  const { session } = validation;
  if (session.processing) {
    return interaction.reply({
      content: 'This purge is already being processed. Please wait.',
      flags: MessageFlags.Ephemeral
    });
  }
  if (!interaction.customId.startsWith('purge:user_select:')) {
    return interaction.reply({
      content: 'This purge selection is not recognized.',
      flags: MessageFlags.Ephemeral
    });
  }

  session.targetUserId = interaction.values[0];
  return interaction.update(buildAmountPanel(token, session.targetUserId));
}

async function handleModalInteraction(interaction) {
  const [, action, token] = interaction.customId.split(':');
  const validation = validateSession(interaction, token);
  if (validation.error) {
    return interaction.reply({
      content: validation.error,
      flags: MessageFlags.Ephemeral
    });
  }
  const { session } = validation;
  if (session.processing) {
    return interaction.reply({
      content: 'This purge is already being processed. Please wait.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (action === 'user') {
    const userId = interaction.fields.getTextInputValue('user_id').trim();
    if (!/^\d{17,20}$/.test(userId)) {
      return interaction.reply({
        content: 'Enter a valid Discord user ID containing 17 to 20 digits.',
        flags: MessageFlags.Ephemeral
      });
    }
    session.targetUserId = userId;
    return interaction.update(buildAmountPanel(token, userId));
  }

  if (action === 'count') {
    const amountText = interaction.fields.getTextInputValue('amount').trim();
    const amount = Number(amountText);
    if (!/^\d+$/.test(amountText) || !Number.isSafeInteger(amount) || amount < 1) {
      return interaction.reply({
        content: 'Enter a positive whole number of messages to delete.',
        flags: MessageFlags.Ephemeral
      });
    }
    session.amount = amount;
    return startScan(interaction, session);
  }

  return interaction.reply({
    content: 'This purge form is not recognized.',
    flags: MessageFlags.Ephemeral
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Interactively choose which messages to delete')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: 'This command can only be used in a server.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (!hasManageMessages(interaction)) {
        return interaction.reply({
          content: 'You need the Manage Messages permission to use this command.',
          flags: MessageFlags.Ephemeral
        });
      }

      const botMember = interaction.guild.members.me ||
        interaction.guild.members.cache.get(interaction.client.user.id);
      if (!botMember?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({
          content: 'I need the Manage Messages permission to delete messages.',
          flags: MessageFlags.Ephemeral
        });
      }

      const token = randomUUID();
      const timeout = setTimeout(async () => {
        purgeSessions.delete(token);
        try {
          await interaction.editReply({
            content: 'Purge setup expired. No messages were deleted.',
            components: []
          });
        } catch (error) {
          console.error('Failed to close expired purge setup:', error);
        }
      }, SESSION_TTL);
      timeout.unref?.();
      purgeSessions.set(token, {
        token,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        targetUserId: null,
        amount: null,
        messageIds: [],
        oldMessageCount: 0,
        timeout
      });

      await interaction.reply({
        ...buildScopePanel(token),
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      console.error('Failed to start purge setup:', error);
      const response = {
        content: 'Could not start the purge. Check the channel and bot permissions, then try again.',
        flags: MessageFlags.Ephemeral
      };
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp(response);
      }
      return interaction.reply(response);
    }
  },

  handleButtonInteraction,
  handleSelectMenuInteraction,
  handleModalInteraction
};
