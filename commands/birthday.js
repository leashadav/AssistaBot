const { randomUUID } = require('crypto');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const birthdayManager = require('../modules/birthdayManager');
const guildSettings = require('../modules/guildSettings');
const branding = require('../modules/configLoader').load('branding');
const { getCurrentYearInTimezone } = require('../utils/timezone');

const pendingBirthdayConfig = new Map();
const BIRTHDAY_CONFIG_TTL = 15 * 60 * 1000;

function getEmbedColor(guildId) {
  try {
    const settings = guildSettings.getSettings(guildId);
    const raw = settings?.embedColor;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw >>> 0;
    } else if (typeof raw === 'string' && raw.trim()) {
      let s = raw.trim();
      if (s.startsWith('#')) s = s.slice(1);
      const n = parseInt(s, 16);
      if (!Number.isNaN(n)) return n >>> 0;
    }
  } catch (error) {
    console.error('Error getting embed color:', error);
  }
  return 0xff6600;
}

function buildBirthdayConfigPanel(interaction, sessionId, session, notice = '') {
  const channel = session.channelId
    ? `<#${session.channelId}>`
    : 'Not set';
  const role = session.roleId
    ? `<@&${session.roleId}>`
    : 'Not set';
  const message = session.message || 'Use the default birthday message';

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`birthday_config_channel:${sessionId}`)
    .setPlaceholder('Choose announcement channel')
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`birthday_config_role:${sessionId}`)
    .setPlaceholder('Choose birthday role')
    .setMinValues(1)
    .setMaxValues(1);

  return {
    content: [
      notice,
      '**Birthday announcement settings**',
      `Announcement channel: ${channel}`,
      `Birthday role: ${role}`,
      `Message: ${message}`,
      '',
      '**Available message placeholders**',
      '• `${userId}` — the birthday member’s Discord ID; use `<@${userId}>` to mention them.',
      '• `${ageText}` — the member’s age followed by a space, or empty if their birth year is not set.',
      'Choose the channel and role from Discord’s pickers. Select **Save settings** when finished.'
    ].filter(Boolean).join('\n'),
    components: [
      new ActionRowBuilder().addComponents(channelSelect),
      new ActionRowBuilder().addComponents(roleSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`birthday_config_message:${sessionId}`)
          .setLabel('Edit message')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`birthday_config_clear_channel:${sessionId}`)
          .setLabel('Clear channel')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`birthday_config_clear_role:${sessionId}`)
          .setLabel('Clear role')
          .setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`birthday_config_save:${sessionId}`)
          .setLabel('Save settings')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`birthday_config_cancel:${sessionId}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

function createBirthdayConfigModal(sessionId, initialValues = {}) {
  const modal = new ModalBuilder()
    .setCustomId(`birthday_config_modal:${sessionId}`)
    .setTitle('Edit birthday message');

  const input = new TextInputBuilder()
    .setCustomId('birthday_message')
    .setLabel('Message template')
    .setPlaceholder('Example: Happy ${ageText}Birthday <@${userId}>!')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);
  if (initialValues.message) input.setValue(initialValues.message);
  return modal.addComponents(new ActionRowBuilder().addComponents(input));
}

async function handleButtonInteraction(interaction) {
  if (!interaction.customId.startsWith('birthday_config:')) {
    if (!interaction.customId.startsWith('birthday_config_message:') &&
        !interaction.customId.startsWith('birthday_config_clear_channel:') &&
        !interaction.customId.startsWith('birthday_config_clear_role:') &&
        !interaction.customId.startsWith('birthday_config_save:') &&
        !interaction.customId.startsWith('birthday_config_cancel:')) {
      return;
    }
  }

  const [prefix, sessionId] = interaction.customId.split(':');
  const session = pendingBirthdayConfig.get(sessionId);

  if (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guildId) {
    pendingBirthdayConfig.delete(sessionId);
    return interaction.reply({ content: 'This birthday setup expired. Run the command again.', flags: MessageFlags.Ephemeral });
  }

  if (prefix === 'birthday_config_message') {
    return interaction.showModal(createBirthdayConfigModal(sessionId, session));
  }
  if (prefix === 'birthday_config_clear_channel') {
    session.channelId = '';
    return interaction.update(buildBirthdayConfigPanel(interaction, sessionId, session, 'Announcement channel cleared.'));
  }
  if (prefix === 'birthday_config_clear_role') {
    session.roleId = '';
    return interaction.update(buildBirthdayConfigPanel(interaction, sessionId, session, 'Birthday role cleared.'));
  }
  if (prefix === 'birthday_config_cancel') {
    clearTimeout(session.timeout);
    pendingBirthdayConfig.delete(sessionId);
    return interaction.update({ content: 'Birthday configuration canceled. No changes were saved.', components: [] });
  }
  if (prefix === 'birthday_config_save') {
    try {
      const updates = {
        birthdayInfo: {
          ...(guildSettings.getSettings(interaction.guildId).birthdayInfo || {}),
          birthdayChannel: session.channelId || null,
          birthdayRole: session.roleId || null
        }
      };
      if (session.message !== undefined) updates.birthdayInfo.message = session.message;
      guildSettings.updateSettings(interaction.guildId, updates);
      clearTimeout(session.timeout);
      pendingBirthdayConfig.delete(sessionId);
      return interaction.update({
        content: [
          '✔️ Birthday settings updated!',
          `📢 **Announcement channel:** ${session.channelId ? `<#${session.channelId}>` : 'Not set'}`,
          `🎖️ **Birthday role:** ${session.roleId ? `<@&${session.roleId}>` : 'Not set'}`
        ].join('\n'),
        components: []
      });
    } catch (error) {
      console.error('Birthday config save error:', error);
      return interaction.reply({ content: '❌ Failed to update birthday settings.', flags: MessageFlags.Ephemeral });
    }
  }

  return interaction.reply({ content: 'This birthday setup action is not recognized.', flags: MessageFlags.Ephemeral });
}

async function handleSelectMenuInteraction(interaction) {
  const [prefix, sessionId] = interaction.customId.split(':');
  if (prefix !== 'birthday_config_channel' && prefix !== 'birthday_config_role') return;

  const session = pendingBirthdayConfig.get(sessionId);
  if (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guildId) {
    pendingBirthdayConfig.delete(sessionId);
    return interaction.reply({ content: 'This birthday setup expired. Run the command again.', flags: MessageFlags.Ephemeral });
  }

  if (prefix === 'birthday_config_channel') session.channelId = interaction.values[0];
  else session.roleId = interaction.values[0];
  return interaction.update(buildBirthdayConfigPanel(interaction, sessionId, session));
}

async function handleModalInteraction(interaction) {
  if (!interaction.customId.startsWith('birthday_config_modal:')) {
    return;
  }

  const sessionId = interaction.customId.replace('birthday_config_modal:', '');
  const session = pendingBirthdayConfig.get(sessionId);

  if (!session || session.userId !== interaction.user.id || session.guildId !== interaction.guild.id) {
    pendingBirthdayConfig.delete(sessionId);
    return interaction.reply({ content: 'This birthday setup expired. Run the command again.', flags: MessageFlags.Ephemeral });
  }

  try {
    const messageText = interaction.fields.getTextInputValue('birthday_message').trim();
    session.message = messageText;
    return interaction.update(
      buildBirthdayConfigPanel(interaction, sessionId, session, 'Message staged. Select **Save settings** to apply your changes.')
    );
  } catch (error) {
    console.error('Birthday config modal error:', error);
    return interaction.reply({ content: '❌ Failed to update birthday settings.', flags: MessageFlags.Ephemeral });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription(`Manage birthdays ${branding.birthdayCommandEmoji || branding.birthdayEmoji || '🎂'}`)
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add your birthday')
      .addStringOption(opt => opt.setName('month').setDescription('Birth month (01-12)').setRequired(true))
      .addStringOption(opt => opt.setName('day').setDescription('Birth day (01-31)').setRequired(true))
      .addStringOption(opt => opt.setName('year').setDescription('Birth year (optional, 4 digits e.g., 1990)').setRequired(false)))
    .addSubcommand(sub => sub.setName('delete').setDescription('Remove your birthday'))
    .addSubcommand(sub => sub
      .setName('adduser')
      .setDescription('Add a birthday for another user (Admin only)')
      .addUserOption(opt => opt.setName('user').setDescription('User to set birthday for').setRequired(true))
      .addStringOption(opt => opt.setName('month').setDescription('Birth month (01-12)').setRequired(true))
      .addStringOption(opt => opt.setName('day').setDescription('Birth day (01-31)').setRequired(true))
      .addStringOption(opt => opt.setName('year').setDescription('Birth year (optional, 4 digits e.g., 1990)').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('deleteuser')
      .setDescription('Remove a birthday for another user (Admin only)')
      .addUserOption(opt => opt.setName('user').setDescription('User whose birthday to remove').setRequired(true)))
    .addSubcommand(sub => sub.setName('list').setDescription('List all birthdays'))
    .addSubcommand(sub => sub
      .setName('config')
      .setDescription('Configure birthday settings (Admin only)'))
    .addSubcommand(sub => sub.setName('check').setDescription('Manually check for birthdays (Admin only)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'check') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ You need administrator permissions to use this command.', flags: MessageFlags.Ephemeral });
      }

      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await birthdayManager.forceCheck(interaction.client);
        await interaction.editReply('✅ Birthday check completed! Check the logs for details.');
      } catch (error) {
        console.error('Error in birthday check command:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ An error occurred while checking birthdays.', flags: MessageFlags.Ephemeral });
        } else {
          await interaction.editReply({ content: '❌ An error occurred while checking birthdays.', flags: MessageFlags.Ephemeral });
        }
      }
      return;
    }

    if (sub === 'config') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
      }

      const sessionId = randomUUID();
      const settings = guildSettings.getSettings(interaction.guild.id);
      const session = {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        channelId: settings.birthdayInfo?.birthdayChannel || '',
        roleId: settings.birthdayInfo?.birthdayRole || '',
        message: settings.birthdayInfo?.message || ''
      };
      session.timeout = setTimeout(() => pendingBirthdayConfig.delete(sessionId), BIRTHDAY_CONFIG_TTL);
      session.timeout.unref?.();
      pendingBirthdayConfig.set(sessionId, session);

      return interaction.reply({
        ...buildBirthdayConfigPanel(interaction, sessionId, session),
        flags: MessageFlags.Ephemeral
      });
    }

    if (sub === 'add') {
      const month = interaction.options.getString('month');
      const day = interaction.options.getString('day');
      const year = interaction.options.getString('year');

      if (!/^(0[1-9]|1[0-2])$/.test(month)) {
        return interaction.reply({ content: '❌ Month must be 2 digits (01-12)', flags: MessageFlags.Ephemeral });
      }
      if (!/^(0[1-9]|[12][0-9]|3[01])$/.test(day)) {
        return interaction.reply({ content: '❌ Day must be 2 digits (01-31)', flags: MessageFlags.Ephemeral });
      }
      if (year && !/^\d{4}$/.test(year)) {
        return interaction.reply({ content: '❌ Year must be 4 digits (e.g., 1990)', flags: MessageFlags.Ephemeral });
      }
      if (year) {
        const yearNum = parseInt(year);
        const currentYear = getCurrentYearInTimezone();
        if (yearNum < 1900 || yearNum > currentYear) {
          return interaction.reply({ content: `❌ Year must be between 1900 and ${currentYear}`, flags: MessageFlags.Ephemeral });
        }
      }

      const date = year ? `${month}/${day}/${year}` : `${month}/${day}`;

      try {
        birthdayManager.setBirthday(interaction.guild.id, interaction.user.id, date);
        return interaction.reply({ content: `✔️ Birthday set to ${date}!`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        console.error('Error setting birthday:', error);
        return interaction.reply({ content: '❌ Failed to set birthday.', flags: MessageFlags.Ephemeral });
      }
    }

    if (sub === 'delete') {
      try {
        birthdayManager.deleteBirthday(interaction.guild.id, interaction.user.id);
        return interaction.reply({ content: '✔️ Birthday removed!', flags: MessageFlags.Ephemeral });
      } catch (error) {
        console.error('Error removing birthday:', error);
        return interaction.reply({ content: '❌ Failed to remove birthday.', flags: MessageFlags.Ephemeral });
      }
    }

    if (sub === 'adduser') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
      }

      const user = interaction.options.getUser('user');
      const month = interaction.options.getString('month');
      const day = interaction.options.getString('day');
      const year = interaction.options.getString('year');

      if (!/^(0[1-9]|1[0-2])$/.test(month)) {
        return interaction.reply({ content: '❌ Month must be 2 digits (01-12)', flags: MessageFlags.Ephemeral });
      }
      if (!/^(0[1-9]|[12][0-9]|3[01])$/.test(day)) {
        return interaction.reply({ content: '❌ Day must be 2 digits (01-31)', flags: MessageFlags.Ephemeral });
      }
      if (year && !/^\d{4}$/.test(year)) {
        return interaction.reply({ content: '❌ Year must be 4 digits (e.g., 1990)', flags: MessageFlags.Ephemeral });
      }
      if (year) {
        const yearNum = parseInt(year);
        const currentYear = getCurrentYearInTimezone();
        if (yearNum < 1900 || yearNum > currentYear) {
          return interaction.reply({ content: `❌ Year must be between 1900 and ${currentYear}`, flags: MessageFlags.Ephemeral });
        }
      }

      const date = year ? `${month}/${day}/${year}` : `${month}/${day}`;

      try {
        birthdayManager.setBirthday(interaction.guild.id, user.id, date);
        return interaction.reply({ content: `✔️ Birthday set to ${date} for ${user.username}!`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        console.error('Error setting birthday:', error);
        return interaction.reply({ content: '❌ Failed to set birthday.', flags: MessageFlags.Ephemeral });
      }
    }

    if (sub === 'deleteuser') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
      }

      const user = interaction.options.getUser('user');
      try {
        birthdayManager.deleteBirthday(interaction.guild.id, user.id);
        return interaction.reply({ content: `✔️ Birthday removed for ${user}!`, flags: MessageFlags.Ephemeral });
      } catch (error) {
        console.error('Error removing user birthday:', error);
        return interaction.reply({ content: '❌ Failed to remove birthday.', flags: MessageFlags.Ephemeral });
      }
    }

    if (sub === 'list') {
      try {
        const birthdays = birthdayManager.getGuildBirthdays(interaction.guild.id);
        const birthdayArray = Object.entries(birthdays).map(([userId, date]) => ({ userId, date }));

        if (birthdayArray.length === 0) {
          return interaction.reply({ content: 'No birthdays set yet!', flags: MessageFlags.Ephemeral });
        }

        birthdayArray.sort((a, b) => {
          const aParts = a.date.split('/').map(Number);
          const bParts = b.date.split('/').map(Number);
          const aMonth = aParts[0];
          const aDay = aParts[1];
          const aYear = aParts.length === 3 ? aParts[2] : 0;
          const bMonth = bParts[0];
          const bDay = bParts[1];
          const bYear = bParts.length === 3 ? bParts[2] : 0;
          if (aMonth !== bMonth) return aMonth - bMonth;
          if (aDay !== bDay) return aDay - bDay;
          return aYear - bYear;
        });

        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const pages = [];

        for (let month = 1; month <= 12; month++) {
          const monthBirthdays = birthdayArray.filter(b => {
            const [bMonth] = b.date.split('/').map(Number);
            return bMonth === month;
          });

          const pageContent = monthBirthdays.map(b => {
            const user = interaction.client.users.cache.get(b.userId);
            const member = interaction.guild.members.cache.get(b.userId);

            let displayName;
            if (member) {
              displayName = member.nickname || user?.displayName || user?.username || user?.globalName || `User ${b.userId}`;
            } else if (user) {
              displayName = user.displayName || user.username || user.globalName || `User ${b.userId}`;
            } else {
              displayName = `User ${b.userId}`;
            }

            const hasYear = b.date.split('/').length === 3;
            let ageDisplay = '';
            if (hasYear) {
              const birthYear = parseInt(b.date.split('/')[2]);
              const age = getCurrentYearInTimezone() - birthYear;
              ageDisplay = ` (${age})`;
            }
            return `**🔸${displayName}${ageDisplay}** ${b.date}`;
          }).join('\n') || 'No birthdays this month';

          pages.push({
            title: `${branding.birthdayEmoji || '🎂'} ${monthNames[month - 1]} Birthdays`,
            description: pageContent,
            color: getEmbedColor(interaction.guild.id),
            footer: { text: `Page ${month}/12 • Total: ${birthdayArray.length} birthdays` }
          });
        }

        const createEmbed = (pageIndex) => {
          const embed = { ...pages[pageIndex] };
          embed.footer = { text: `Page ${pageIndex + 1}/12 • Total: ${birthdayArray.length} birthdays` };
          return embed;
        };

        const createButtons = (currentPage) => [{
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              custom_id: 'prev',
              label: '◀️'
            },
            {
              type: 2,
              style: 2,
              custom_id: 'next',
              label: '▶️'
            },
            {
              type: 2,
              style: 2,
              custom_id: 'refresh',
              label: '🔄',
              disabled: false
            }
          ]
        }];

        await interaction.deferReply();
        const reply = await interaction.editReply({ embeds: [createEmbed(0)], components: createButtons(0) });

        const collector = interaction.channel.createMessageComponentCollector();
        collector.on('collect', async (i) => {
          try {
            let currentPage = 0;
            const currentEmbed = i.message.embeds[0];
            if (currentEmbed && currentEmbed.footer) {
              const match = currentEmbed.footer.text.match(/Page (\d+)\/12/);
              if (match) {
                currentPage = parseInt(match[1]) - 1;
              }
            }

            if (i.customId === 'prev') {
              currentPage = currentPage > 0 ? currentPage - 1 : 11;
            } else if (i.customId === 'next') {
              currentPage = currentPage < 11 ? currentPage + 1 : 0;
            } else if (i.customId === 'refresh') {
              const refreshedBirthdays = birthdayManager.getGuildBirthdays(interaction.guild.id);
              const refreshedArray = Object.entries(refreshedBirthdays).map(([userId, date]) => ({ userId, date }));
              refreshedArray.sort((a, b) => {
                const aParts = a.date.split('/').map(Number);
                const bParts = b.date.split('/').map(Number);
                const aMonth = aParts[0];
                const aDay = aParts[1];
                const aYear = aParts.length === 3 ? aParts[2] : 0;
                const bMonth = bParts[0];
                const bDay = bParts[1];
                const bYear = bParts.length === 3 ? bParts[2] : 0;
                if (aMonth !== bMonth) return aMonth - bMonth;
                if (aDay !== bDay) return aDay - bDay;
                return aYear - bYear;
              });

              const month = currentPage + 1;
              const monthBirthdays = refreshedArray.filter(b => {
                const [bMonth] = b.date.split('/').map(Number);
                return bMonth === month;
              });

              const refreshedPage = monthBirthdays.map(b => {
                const user = interaction.client.users.cache.get(b.userId);
                const member = interaction.guild.members.cache.get(b.userId);
                let displayName;
                if (member) {
                  displayName = member.nickname || user?.displayName || user?.username || user?.globalName || `User ${b.userId}`;
                } else if (user) {
                  displayName = user.displayName || user.username || user.globalName || `User ${b.userId}`;
                } else {
                  displayName = `User ${b.userId}`;
                }
                const hasYear = b.date.split('/').length === 3;
                let ageDisplay = '';
                if (hasYear) {
                  const age = getCurrentYearInTimezone() - parseInt(b.date.split('/')[2]);
                  ageDisplay = ` (${age})`;
                }
                return `**🔸${displayName}${ageDisplay}** ${b.date}`;
              }).join('\n') || 'No birthdays this month';

              pages[currentPage].description = refreshedPage;
              pages[currentPage].footer = { text: `Page ${currentPage + 1}/12 • Total: ${refreshedArray.length} birthdays` };
              return i.update({ embeds: [pages[currentPage]], components: createButtons(currentPage) });
            }

            await i.update({ embeds: [createEmbed(currentPage)], components: createButtons(currentPage) });
          } catch (error) {
            console.error('Error handling birthday button interaction:', error);
          }
        });

        const followup = await interaction.editReply({ embeds: [createEmbed(0)], components: createButtons(0) });
        return followup;
      } catch (error) {
        console.error('Error listing birthdays:', error);
        return interaction.reply({ content: '❌ Failed to list birthdays.', flags: MessageFlags.Ephemeral });
      }
    }

    return interaction.reply({ content: '❌ Unknown birthday subcommand.', flags: MessageFlags.Ephemeral });
  },

  handleButtonInteraction,
  handleSelectMenuInteraction,
  handleModalInteraction,
};
