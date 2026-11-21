const {
  randomUUID
} = require('crypto');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const booster = require('../modules/booster');

const panelSessions = new Map();
const PANEL_TTL = 15 * 60 * 1000;
const PLACEHOLDERS = '{mention}, {user}, {guild}, {boostCount}, {personalBoostCount}, {boostType}, {tier}';
const IMAGE_MIME_TYPE = /^image\/(?:png|jpe?g|gif|webp|avif)(?:;|$)/i;
const IMAGE_FILE_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif)$/i;
const PLACEHOLDER_GUIDE = [
  '**Available message placeholders**',
  '`{mention}` — mentions the booster.',
  '`{user}` — the booster’s Discord username.',
  '`{guild}` — the server name.',
  '`{boostCount}` — the server’s current total boosts.',
  '`{personalBoostCount}` — estimated cumulative boosts for this member.',
  '`{boostType}` — “started boosting” or “continues to boost.”',
  '`{tier}` — the server’s current boost tier.',
  'In the message above the embed, `{mention}` sends a notification to the booster.'
].join('\n');

function buildPanel(session, notice = '') {
  const config = booster.getConfig(session.guildId);
  const preview = message => message.length > 500 ? `${message.slice(0, 497)}...` : message;
  const newBoostMessage = config.newBoostMessage || 'Default message';
  const continuedBoostMessage = config.continuedBoostMessage || 'Default message';
  const announcementMessage = config.announcementMessage || 'No message';
  const panel = {
    content: [
      notice,
      '**Booster announcement settings**',
      `Status: **${config.enabled ? 'Enabled' : 'Disabled'}**`,
      `Channel: ${config.channelId ? `<#${config.channelId}>` : 'Not set'}`,
      `Image: **${config.imageUrl ? 'Custom image' : 'Built-in default'}**`,
      `Boosts counted per booster per month: **${config.boostsPerMonth || 1}**`,
      `**Message above embed:** ${preview(announcementMessage)}`,
      `**New boost message:** ${preview(newBoostMessage)}`,
      `**Continued boost message:** ${preview(continuedBoostMessage)}`,
      '',
      `**Message placeholders:** ${PLACEHOLDERS}`,
      '`{personalBoostCount}` is an estimate based on boost starts and observed active monthly anniversaries. Discord does not provide an individual boost count.',
      'Use **Set image** to upload an image or enter an image URL. Use **Reset image** to restore the built-in image or **Test announcement** to preview it.',
      'Use the controls below to change settings. Changes are saved immediately.'
    ].filter(Boolean).join('\n'),
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`booster:channel:${session.id}`)
          .setPlaceholder('Choose announcement channel')
          .setMinValues(1)
          .setMaxValues(1)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`booster:toggle:${session.id}`)
          .setLabel(config.enabled ? 'Disable announcements' : 'Enable announcements')
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`booster:newMessage:${session.id}`)
          .setLabel('Edit new boost message')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`booster:continuedMessage:${session.id}`)
          .setLabel('Edit continued boost message')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`booster:announcementMessage:${session.id}`)
          .setLabel('Edit message above embed')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`booster:count:${session.id}`)
          .setLabel('Boosts counted per month')
          .setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`booster:setImage:${session.id}`)
          .setLabel('Set image')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`booster:imageReset:${session.id}`)
          .setLabel('Reset image')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`booster:test:${session.id}`)
          .setLabel('Test announcement')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`booster:close:${session.id}`)
          .setLabel('Close')
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
  return panel;
}

function validatePanel(interaction, sessionId) {
  const session = panelSessions.get(sessionId);
  if (!session || session.guildId !== interaction.guildId) {
    return { error: 'This booster settings panel expired. Run `/booster panel` again.' };
  }
  if (session.userId !== interaction.user.id) {
    return { error: 'Only the person who opened this panel can use it.' };
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) &&
      !interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return { error: 'You need Manage Server permission to change booster settings.' };
  }
  return { session };
}

async function handleComponent(interaction) {
  const [prefix, action, sessionId] = interaction.customId.split(':');
  if (prefix !== 'booster') return;
  const validation = validatePanel(interaction, sessionId);
  if (validation.error) {
    return interaction.reply({ content: validation.error, flags: MessageFlags.Ephemeral });
  }
  const { session } = validation;

  if (action === 'channel') {
    booster.setChannel(session.guildId, interaction.values[0]);
    if (booster.getConfig(session.guildId).enabled) {
      await interaction.deferUpdate();
      await booster.seedGuildBoosters(interaction.guild);
      return interaction.editReply(buildPanel(session, '✅ Announcement channel updated.'));
    }
    return interaction.update(buildPanel(session, '✅ Announcement channel updated.'));
  }
  if (action === 'toggle') {
    const enabled = !booster.getConfig(session.guildId).enabled;
    booster.setEnabled(session.guildId, enabled);
    if (enabled) {
      await interaction.deferUpdate();
      await booster.seedGuildBoosters(interaction.guild);
      return interaction.editReply(buildPanel(session, '✅ Booster announcements enabled.'));
    }
    return interaction.update(buildPanel(session, `✅ Booster announcements ${enabled ? 'enabled' : 'disabled'}.`));
  }
  if (action === 'imageReset') {
    booster.setImageUrl(session.guildId, null);
    return interaction.update(buildPanel(session, '✅ Custom image removed. Booster announcements will use the built-in image.'));
  }
  if (action === 'setImage') {
    const upload = new FileUploadBuilder()
      .setCustomId('upload')
      .setRequired(false)
      .setMaxValues(1)
      .addFileTypes('image');
    const url = new TextInputBuilder()
      .setCustomId('url')
      .setPlaceholder('https://example.com/image.png')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(2000);
    const modal = new ModalBuilder()
      .setCustomId(`booster:image:${sessionId}`)
      .setTitle('Set booster image')
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('Upload an image or enter a direct HTTPS image URL. Choose one option.')
      )
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Upload image')
          .setFileUploadComponent(upload),
        new LabelBuilder()
          .setLabel('Image URL')
          .setTextInputComponent(url)
      );
    return interaction.showModal(modal);
  }
  if (action === 'test') {
    await interaction.deferUpdate();
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await booster.sendTestAnnouncement(member);
      return interaction.editReply(buildPanel(session, '✅ Test announcement sent to the configured booster channel.'));
    } catch (error) {
      console.error('booster: failed to send test announcement from settings panel:', error?.message || error);
      return interaction.editReply(buildPanel(session, `❌ Could not send the test announcement: ${error?.message || 'Unknown error'}`));
    }
  }
  if (action === 'announcementMessage') {
    const config = booster.getConfig(session.guildId);
    const input = new TextInputBuilder()
      .setCustomId('message')
      .setPlaceholder('Thank you {mention}!')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(2000)
      .setValue(config.announcementMessage || 'Thank you {mention}!');
    const modal = new ModalBuilder()
      .setCustomId(`booster:announcementMessage:${sessionId}`)
      .setTitle('Edit message above embed')
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(PLACEHOLDER_GUIDE))
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Message (use {mention} to notify the booster)')
          .setTextInputComponent(input)
      );
    return interaction.showModal(modal);
  }
  if (action === 'newMessage' || action === 'continuedMessage') {
    const isNewBoost = action === 'newMessage';
    const modal = new ModalBuilder()
      .setCustomId(`booster:${action}:${sessionId}`)
      .setTitle(isNewBoost ? 'Edit new boost message' : 'Edit continued boost message');
    const input = new TextInputBuilder()
      .setCustomId('message')
      .setPlaceholder('Use {personalBoostCount}, {boostType}, {boostCount}, {mention}, {guild}, {tier}')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(2000);
    const config = booster.getConfig(session.guildId);
    const currentMessage = isNewBoost ? config.newBoostMessage : config.continuedBoostMessage;
    if (currentMessage) input.setValue(currentMessage);
    return interaction.showModal(
      modal
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(PLACEHOLDER_GUIDE))
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Announcement message')
            .setTextInputComponent(input)
        )
    );
  }
  if (action === 'count') {
    const modal = new ModalBuilder()
      .setCustomId(`booster:count:${sessionId}`)
      .setTitle('Boost count per month');
    const input = new TextInputBuilder()
      .setCustomId('count')
      .setLabel('Boosts counted per active booster monthly')
      .setPlaceholder('Enter a number from 1 to 10')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2)
      .setValue(String(booster.getConfig(session.guildId).boostsPerMonth || 1));
    return interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(input)));
  }
  if (action === 'close') {
    clearTimeout(session.timeout);
    panelSessions.delete(sessionId);
    return interaction.update({ content: 'Booster settings panel closed.', components: [] });
  }
  return interaction.reply({ content: 'This booster settings action is not recognized.', flags: MessageFlags.Ephemeral });
}

async function handleModal(interaction) {
  const [, action, sessionId] = interaction.customId.split(':');
  if (!['newMessage', 'continuedMessage', 'count', 'image', 'announcementMessage'].includes(action)) return;
  const validation = validatePanel(interaction, sessionId);
  if (validation.error) {
    return interaction.reply({ content: validation.error, flags: MessageFlags.Ephemeral });
  }

  if (action === 'image') {
    const uploads = interaction.fields.getUploadedFiles('upload');
    const attachment = uploads?.first();
    const imageUrl = interaction.fields.getTextInputValue('url').trim();
    if (attachment && imageUrl) {
      return interaction.update(buildPanel(validation.session, 'Choose either an uploaded image or a URL, not both.'));
    }

    if (attachment) {
      if (!isValidImageAttachment(attachment)) {
        return interaction.update(buildPanel(validation.session, 'Upload a PNG, JPEG, GIF, WebP, or AVIF image.'));
      }
      booster.setImageUrl(validation.session.guildId, attachment.url);
      return interaction.update(buildPanel(validation.session, '✅ Custom booster image updated from the uploaded file.'));
    }

    if (imageUrl) {
      const validImageUrl = getHttpsImageUrl(imageUrl);
      if (!validImageUrl) {
        return interaction.update(buildPanel(validation.session, 'Provide a valid HTTPS link to a directly accessible image.'));
      }
      booster.setImageUrl(validation.session.guildId, validImageUrl);
      return interaction.update(buildPanel(validation.session, '✅ Custom booster image updated from the URL.'));
    }

    return interaction.update(buildPanel(validation.session, 'Upload an image or enter an image URL.'));
  }

  if (action === 'count') {
    const value = interaction.fields.getTextInputValue('count').trim();
    const count = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(count) || count < 1 || count > 10) {
      return interaction.reply({ content: 'Enter a whole number from 1 to 10.', flags: MessageFlags.Ephemeral });
    }
    booster.setBoostsPerMonth(validation.session.guildId, count);
    return interaction.update(buildPanel(validation.session, '✅ Monthly booster count updated.'));
  }

  const message = interaction.fields.getTextInputValue('message').trim();
  if (!message) {
    return interaction.reply({ content: 'Enter a non-empty announcement message.', flags: MessageFlags.Ephemeral });
  }
  if (action === 'announcementMessage') {
    booster.setAnnouncementMessage(validation.session.guildId, message);
    return interaction.update(buildPanel(validation.session, '✅ Message above the embed updated.'));
  }
  if (action === 'newMessage') {
    booster.setNewBoostMessage(validation.session.guildId, message);
    return interaction.update(buildPanel(validation.session, '✅ New boost message updated.'));
  }
  booster.setContinuedBoostMessage(validation.session.guildId, message);
  return interaction.update(buildPanel(validation.session, '✅ Continued boost message updated.'));
}

function isValidImageAttachment(attachment) {
  return IMAGE_MIME_TYPE.test(attachment.contentType || '')
    || IMAGE_FILE_EXTENSION.test(attachment.name || '');
}

function getHttpsImageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.toString();
  } catch {
    // Invalid URLs are handled with the same user-facing validation message.
  }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('booster')
    .setDescription('Configure and test booster announcements')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand
        .setName('panel')
        .setDescription('Open interactive booster announcement settings'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('image')
        .setDescription('Set a custom image by uploading or linking one')
        .addAttachmentOption(option =>
          option
            .setName('upload')
            .setDescription('Upload an image to use in booster announcements')
            .setRequired(false))
        .addStringOption(option =>
          option
            .setName('url')
            .setDescription('Direct HTTPS link to an image')
            .setMaxLength(2000)
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('test')
        .setDescription('Send a test announcement to the configured channel')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'image') {
      const attachment = interaction.options.getAttachment('upload');
      const imageUrl = interaction.options.getString('url')?.trim();
      if (attachment && imageUrl) {
        return interaction.reply({
          content: 'Choose either an uploaded image or a URL, not both.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (attachment) {
        if (!isValidImageAttachment(attachment)) {
          return interaction.reply({
            content: 'Upload a PNG, JPEG, GIF, WebP, or AVIF image.',
            flags: MessageFlags.Ephemeral
          });
        }
        booster.setImageUrl(interaction.guild.id, attachment.url);
        return interaction.reply({
          content: '✅ Custom booster image updated from the uploaded file.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (imageUrl) {
        const validImageUrl = getHttpsImageUrl(imageUrl);
        if (!validImageUrl) {
          return interaction.reply({
            content: 'Provide a valid HTTPS link to a directly accessible image.',
            flags: MessageFlags.Ephemeral
          });
        }
        booster.setImageUrl(interaction.guild.id, validImageUrl);
        return interaction.reply({
          content: '✅ Custom booster image updated from the URL.',
          flags: MessageFlags.Ephemeral
        });
      }

      return interaction.reply({
        content: 'Upload an image or provide a URL. Use the Reset image button in `/booster panel` to restore the built-in image.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (subcommand === 'test') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await booster.sendTestAnnouncement(member);
        return interaction.editReply('✅ Test announcement sent to the configured booster channel.');
      } catch (error) {
        console.error('booster: failed to send test announcement:', error?.message || error);
        return interaction.editReply(`❌ Could not send the test announcement: ${error?.message || 'Unknown error'}`);
      }
    }

    const id = randomUUID();
    const session = { id, guildId: interaction.guild.id, userId: interaction.user.id };
    session.timeout = setTimeout(() => panelSessions.delete(id), PANEL_TTL);
    session.timeout.unref?.();
    panelSessions.set(id, session);
    return interaction.reply({ ...buildPanel(session), flags: MessageFlags.Ephemeral });
  },
  handleComponent,
  handleModal
};
