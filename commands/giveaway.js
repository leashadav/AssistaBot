/**
 * @file Giveaway Command
 * @module commands/giveaway
 * @description This module manages giveaways in the server, including starting, ending, and rerolling giveaways.
 * It handles storage, participant management, and winner selection.
 * @requires discord.js
 * @requires fs
 * @requires path
 */

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const GIVEAWAYS_FILE = path.join(__dirname, '..', 'data', 'giveaways.json');

/**
 * Ensures the giveaways file exists, creating it if necessary.
 * @function ensureGiveawaysFile
 * @returns {void}
 */
function ensureGiveawaysFile() {
  try {
    if (!fs.existsSync(GIVEAWAYS_FILE)) {
      fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify({ giveaways: {} }, null, 2));
    }
  } catch (error) {
    console.error('Error ensuring giveaways file:', error?.message || 'Unknown error');
  }
}

/**
 * Loads all giveaways from the storage file.
 * @function loadGiveaways
 * @returns {Object} The loaded giveaways data.
 */
function loadGiveaways() {
  try {
    ensureGiveawaysFile();
    return JSON.parse(fs.readFileSync(GIVEAWAYS_FILE, 'utf8'));
  } catch (error) {
    console.error('Error loading giveaways:', error?.message || 'Unknown error');
    return { giveaways: {} };
  }
}

/**
 * Saves giveaways data to the storage file.
 * @function saveGiveaways
 * @param {Object} data - The giveaways data to save.
 * @returns {void}
 */
function saveGiveaways(data) {
  try {
    fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving giveaways:', error?.message || 'Unknown error');
  }
}

/**
 * Command data and execution logic for the 'giveaway' command.
 * @type {Object}
 * @property {SlashCommandBuilder} data - The command definition.
 * @property {Function} execute - The command execution function.
 */
module.exports = {
  /**
   * Command configuration and options.
   * @type {SlashCommandBuilder}
   */
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways in the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('Start a new giveaway')
        .addStringOption(option =>
          option.setName('prize')
            .setDescription('Prize to win')
            .setRequired(true))
        .addIntegerOption(option =>
          option.setName('winners')
            .setDescription('Number of winners')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(25))
        .addStringOption(option =>
          option.setName('duration')
            .setDescription('Duration of the giveaway (e.g., 1d, 2h, 30m)')
            .setRequired(true))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel to post the giveaway in')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('description')
            .setDescription('Giveaway description or rules')
            .setRequired(false))
        .addAttachmentOption(option =>
          option.setName('image')
            .setDescription('Upload an image for the giveaway')
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('End a giveaway early')
        .addStringOption(option =>
          option.setName('message_id')
            .setDescription('The message ID of the giveaway to end')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('reroll')
        .setDescription('Reroll a giveaway')
        .addStringOption(option =>
          option.setName('message_id')
            .setDescription('The message ID of the giveaway to reroll')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all active giveaways')),

  /**
   * Executes the giveaway command with the specified subcommand.
   * @async
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction that triggered the command.
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ 
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral
      });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'start':
          await this.handleStart(interaction);
          break;
        case 'end':
          await this.handleEnd(interaction);
          break;
        case 'reroll':
          await this.handleReroll(interaction);
          break;
        case 'list':
          await this.handleList(interaction);
          break;
        default:
          await interaction.reply({ 
            content: '❌ Unknown subcommand.',
            flags: MessageFlags.Ephemeral
          });
      }
    } catch (error) {
      console.error('Error in giveaway command:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          content: '❌ An error occurred while executing this command.',
          flags: MessageFlags.Ephemeral
        });
      } else if (interaction.deferred) {
        await interaction.editReply({
          content: '❌ An error occurred while executing this command.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  },

    /**
   * Handles button interactions for giveaways (enter/leave).
   * @async
   * @param {import('discord.js').ButtonInteraction} interaction - The button interaction.
   * @returns {Promise<void>}
   */
  async handleStart(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const prize = interaction.options.getString('prize');
    const description = interaction.options.getString('description');
    const winnerCount = interaction.options.getInteger('winners');
    const durationStr = interaction.options.getString('duration');
    const channel = interaction.options.getChannel('channel');
    const imageAttachment = interaction.options.getAttachment('image');

    // Parse duration string (e.g. 1d, 2h, 30m)
    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
      return interaction.editReply({ content: '❌ Invalid duration. Use formats like `1d`, `2h`, `30m`.' });
    }

    const endsAt = Date.now() + durationMs;

    // Build embed description
    let embedDesc = description ? `${description}\n\n` : '';

    const embed = new EmbedBuilder()
      .setTitle('🎉 Giveaway!')
      .setDescription(embedDesc)
      .addFields(
        { name: '🎁 Prize', value: prize, inline: true },
        { name: '🏆 Winners', value: winnerCount.toString(), inline: true },
        { name: '🎫 Entries', value: '0', inline: true },
        { name: '⏰ Ends', value: `<t:${Math.floor(endsAt / 1000)}:R>`, inline: false }
      )
      .setColor('#FF6600');

    // Set image from attachment
    let finalImageUrl = null;
    if (imageAttachment) {
      finalImageUrl = imageAttachment.proxyURL || imageAttachment.url;
      embed.setImage(finalImageUrl);
      console.log(`[Giveaway] Image set: ${finalImageUrl}`);
    }

    const enterButton = new ButtonBuilder().setCustomId('placeholder').setLabel('Enter').setStyle(ButtonStyle.Success).setEmoji('🎉');
    const leaveButton = new ButtonBuilder().setCustomId('placeholder2').setLabel('Leave').setStyle(ButtonStyle.Secondary).setEmoji('🚪');
    const row = new ActionRowBuilder().addComponents(enterButton, leaveButton);

    const msg = await channel.send({ embeds: [embed], components: [row] });

    // Update buttons with real message ID
    enterButton.setCustomId(`giveaway_enter_${msg.id}`);
    leaveButton.setCustomId(`giveaway_leave_${msg.id}`);
    await msg.edit({ components: [new ActionRowBuilder().addComponents(enterButton, leaveButton)] });

    const giveaways = loadGiveaways();
    giveaways.giveaways[msg.id] = {
      prize,
      winnerCount,
      channelId: channel.id,
      guildId: interaction.guild.id,
      endsAt,
      participants: [],
      imageUrl: finalImageUrl || null
    };
    saveGiveaways(giveaways);

    // Schedule auto-end
    setTimeout(() => this.endGiveaway(msg.id, interaction.client), durationMs);

    await interaction.editReply({ content: `✅ Giveaway started in ${channel}!` });
  },

  async handleEnd(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const messageId = interaction.options.getString('message_id');
    const giveaways = loadGiveaways();
    if (!giveaways.giveaways[messageId]) {
      return interaction.editReply({ content: '❌ Giveaway not found.' });
    }
    await this.endGiveaway(messageId, interaction.client);
    await interaction.editReply({ content: '✅ Giveaway ended.' });
  },

  async handleReroll(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const messageId = interaction.options.getString('message_id');
    const giveaways = loadGiveaways();
    const giveaway = giveaways.giveaways[messageId];
    if (!giveaway) {
      return interaction.editReply({ content: '❌ Giveaway not found.' });
    }
    if (!giveaway.participants?.length) {
      return interaction.editReply({ content: '❌ No participants to reroll.' });
    }
    const winner = giveaway.participants[Math.floor(Math.random() * giveaway.participants.length)];
    const channel = await interaction.client.channels.fetch(giveaway.channelId).catch(() => null);
    if (channel) await channel.send({ content: `🎉 Reroll! New winner: <@${winner}>! Congratulations!` });
    await interaction.editReply({ content: `✅ Rerolled! New winner: <@${winner}>` });
  },

  async handleList(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const giveaways = loadGiveaways();
    const active = Object.entries(giveaways.giveaways)
      .filter(([, g]) => g.guildId === interaction.guild.id);

    if (!active.length) {
      return interaction.editReply({ content: 'No active giveaways.' });
    }

    const lines = active.map(([id, g]) =>
      `• **${g.prize}** — ${g.participants.length} entries — ends <t:${Math.floor(g.endsAt / 1000)}:R> — [Jump](https://discord.com/channels/${g.guildId}/${g.channelId}/${id})`
    ).join('\n');

    await interaction.editReply({ content: `**Active Giveaways:**\n${lines}` });
  },

  async handleButtonInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('giveaway_')) return;

    const [_, action, messageId] = interaction.customId.split('_');
    const userId = interaction.user.id;
    const giveaways = loadGiveaways();
    const giveaway = giveaways.giveaways[messageId];

    if (!giveaway) {
      return interaction.reply({
        content: '❌ This giveaway could not be found or has ended.',
        flags: MessageFlags.Ephemeral
      });
    }

    if (action === 'enter') {
      // Check if user already entered
      if (giveaway.participants.includes(userId)) {
        return interaction.reply({
          content: '❌ You have already entered this giveaway!',
          flags: MessageFlags.Ephemeral
        });
      }

      // Add user to participants
      giveaway.participants.push(userId);
      saveGiveaways(giveaways);

      // Update embed with new entry count
      await this.updateGiveawayEmbed(interaction.client, messageId, giveaway);

      return interaction.reply({
        content: '✅ You have successfully entered the giveaway!',
        flags: MessageFlags.Ephemeral
      });
    } else if (action === 'leave') {
      // Check if user is in the giveaway
      const participantIndex = giveaway.participants.indexOf(userId);
      if (participantIndex === -1) {
        return interaction.reply({
          content: '❌ You are not in this giveaway!',
          flags: MessageFlags.Ephemeral
        });
      }

      // Remove user from participants
      giveaway.participants.splice(participantIndex, 1);
      saveGiveaways(giveaways);

      // Update embed with new entry count
      await this.updateGiveawayEmbed(interaction.client, messageId, giveaway);

      return interaction.reply({
        content: '✅ You have left the giveaway.',
        flags: MessageFlags.Ephemeral
      });
    }
  },

  /**
   * Updates the giveaway embed with current entry count.
   * @async
   * @param {import('discord.js').Client} client - The Discord client.
   * @param {string} messageId - The giveaway message ID.
   * @param {Object} giveaway - The giveaway data.
   * @returns {Promise<void>}
   */
  async updateGiveawayEmbed(client, messageId, giveaway) {
    try {
      const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
      if (!channel) return;

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message || !message.embeds[0]) return;

      const oldEmbed = message.embeds[0];
      
      // Rebuild embed with updated entry count
      const newEmbed = new EmbedBuilder()
        .setTitle(oldEmbed.title)
        .setDescription(oldEmbed.description || '')
        .setColor(oldEmbed.color || '#FF6600')
        .setTimestamp(oldEmbed.timestamp ? new Date(oldEmbed.timestamp) : null);

      // Copy existing image if present
      if (oldEmbed.image?.url) {
        newEmbed.setImage(oldEmbed.image.url);
      }

      // Update fields with new entry count
      const fields = oldEmbed.fields.map(field => {
        if (field.name === '🎫 Entries') {
          return { ...field, value: giveaway.participants.length.toString() };
        }
        return field;
      });

      newEmbed.addFields(fields);

      await message.edit({ embeds: [newEmbed] });
    } catch (error) {
      console.error('[Giveaway] Error updating embed:', error);
    }
  },

  /**
   * Ends a giveaway and selects winners.
   * @async
   * @param {string} messageId - The ID of the giveaway message.
   * @param {import('discord.js').Client} client - The Discord client.
   * @returns {Promise<void>}
   */
  async endGiveaway(messageId, client) {
    const giveaways = loadGiveaways();
    const giveaway = giveaways.giveaways[messageId];
    
    if (!giveaway) return;

    const channel = await client.channels.fetch(giveaway.channelId).catch(console.error);
    if (!channel) return;

    try {
      const message = await channel.messages.fetch(messageId);
      const embed = message.embeds[0];
      
      if (!embed) return;

      // Select winners
      const winners = [];
      const participants = [...giveaway.participants];
      
      for (let i = 0; i < Math.min(giveaway.winnerCount, participants.length); i++) {
        const winnerIndex = Math.floor(Math.random() * participants.length);
        winners.push(participants.splice(winnerIndex, 1)[0]);
      }

      // Update embed
      const winnerMentions = winners.length > 0 
        ? winners.map(id => `<@${id}>`).join(', ')
        : 'No participants!';

      const resultEmbed = new EmbedBuilder()
        .setTitle('🎉 Giveaway Ended')
        .setDescription(embed.description || '')
        .addFields(
          { name: '🎁 Prize', value: giveaway.prize || 'No prize specified', inline: true },
          { name: '👑 Winner(s)', value: winnerMentions, inline: true },
          { name: '🎫 Entries', value: giveaway.participants.length.toString(), inline: true }
        )
        .setColor('#FF0000');

      // Add image if giveaway had one
      if (giveaway.imageUrl) {
        resultEmbed.setImage(giveaway.imageUrl);
      }

      // Update the message
      await message.edit({
        embeds: [resultEmbed],
        components: [] // Remove buttons
      });

      // Announce winners
      if (winners.length > 0) {
        await channel.send({
          content: `🎉 Congratulations ${winnerMentions}! You won the **${giveaway.prize}**!`
        });
      }

      // Remove from active giveaways
      delete giveaways.giveaways[messageId];
      saveGiveaways(giveaways);

    } catch (error) {
      console.error('Error ending giveaway:', error);
    }
  }
};

// Export additional functions for use in other modules
module.exports.handleButtonInteraction = module.exports.handleButtonInteraction.bind(module.exports);
module.exports.endGiveaway = module.exports.endGiveaway.bind(module.exports);
module.exports.handleStart = module.exports.handleStart.bind(module.exports);
module.exports.handleEnd = module.exports.handleEnd.bind(module.exports);
module.exports.handleReroll = module.exports.handleReroll.bind(module.exports);
module.exports.handleList = module.exports.handleList.bind(module.exports);
module.exports.updateGiveawayEmbed = module.exports.updateGiveawayEmbed.bind(module.exports);

function parseDuration(str) {
  if (!str) return null;
  const match = str.trim().match(/^(\d+)([dhm])$/);
  if (!match) return null;
  const val = parseInt(match[1]);
  const unit = match[2];
  if (unit === 'd') return val * 24 * 60 * 60 * 1000;
  if (unit === 'h') return val * 60 * 60 * 1000;
  if (unit === 'm') return val * 60 * 1000;
  return null;
}