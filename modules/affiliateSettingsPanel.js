const { randomUUID } = require('crypto');
const {
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const guildSettings = require('./guildSettings');

const sessions = new Map();
const SESSION_TTL = 15 * 60 * 1000;

function buildPanel(session, notice = '') {
  const enabled = !!guildSettings.getSettings(session.guildId)[session.enabledKey];
  return {
    content: [
      notice,
      `**${session.label} link settings**`,
      `Link processing: **${enabled ? 'Enabled' : 'Disabled'}**`,
      'Use the buttons to toggle processing or clear the product cache.'
    ].filter(Boolean).join('\n'),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`affiliate:${session.brand}:toggle:${session.id}`)
          .setLabel(enabled ? 'Disable link processing' : 'Enable link processing')
          .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`affiliate:${session.brand}:cache:${session.id}`)
          .setLabel('Clear product cache')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`affiliate:${session.brand}:close:${session.id}`)
          .setLabel('Close')
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

function openPanel(interaction, config) {
  const id = randomUUID();
  const session = {
    id,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    brand: config.brand,
    label: config.label,
    enabledKey: config.enabledKey,
    affiliateModule: config.affiliateModule
  };
  session.timeout = setTimeout(() => sessions.delete(id), SESSION_TTL);
  session.timeout.unref?.();
  sessions.set(id, session);
  return interaction.reply({ ...buildPanel(session), flags: MessageFlags.Ephemeral });
}

async function handleComponent(interaction) {
  const [, brand, action, sessionId] = interaction.customId.split(':');
  const session = sessions.get(sessionId);
  if (!session || session.brand !== brand || session.guildId !== interaction.guildId) {
    return interaction.reply({ content: 'This settings panel expired. Run the command again.', flags: MessageFlags.Ephemeral });
  }
  if (session.userId !== interaction.user.id) {
    return interaction.reply({ content: 'Only the person who opened this panel can use it.', flags: MessageFlags.Ephemeral });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'You need Administrator permission to change these settings.', flags: MessageFlags.Ephemeral });
  }

  if (action === 'toggle') {
    const enabled = !guildSettings.getSettings(session.guildId)[session.enabledKey];
    guildSettings.updateSettings(session.guildId, { [session.enabledKey]: enabled });
    return interaction.update(buildPanel(session, `✅ ${session.label} link processing ${enabled ? 'enabled' : 'disabled'}.`));
  }
  if (action === 'cache') {
    const count = session.affiliateModule.clearCache();
    return interaction.update(buildPanel(session, `✅ Cleared ${count} ${session.label} product cache item(s).`));
  }
  if (action === 'close') {
    clearTimeout(session.timeout);
    sessions.delete(sessionId);
    return interaction.update({ content: `${session.label} settings panel closed.`, components: [] });
  }
  return interaction.reply({ content: 'This settings action is not recognized.', flags: MessageFlags.Ephemeral });
}

module.exports = { openPanel, handleComponent };
