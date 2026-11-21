/**
 * @file Assistabot Command
 * @module commands/assistabot
 * @description This module implements the main bot interaction commands including info, invite, and say functionality.
 * @requires discord.js
 * @requires ../modules/logger
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const logger = require('../modules/logger');
const guildSettings = require('../modules/guildSettings');
const configLoader = require('../modules/configLoader');
const branding = configLoader.load('branding');

const HELP_SELECT_PREFIX = 'assistabot_help:';

function formatOptions(options = []) {
  return options.map(option => {
    const placeholder = option.required ? `<${option.name}>` : `[${option.name}]`;
    const choices = option.choices?.length
      ? ` Choices: ${option.choices.map(choice => choice.name).join(', ')}.`
      : '';
    return `• \`${placeholder}\` — ${option.description}.${choices}`;
  });
}

function getCommandHelpFields(command) {
  const data = command.interactiveSource || command.data.toJSON();
  const fields = [];

  function addUsage(name, description, options = []) {
    const details = [`**${name}** — ${description}`, ...formatOptions(options)];
    fields.push({ name: 'Usage', value: details.join('\n') });
  }

  function walk(options, path = []) {
    for (const option of options || []) {
      if (option.type === 2) {
        walk(option.options, [...path, option.name]);
      } else if (option.type === 1) {
        const actionPath = [...path, option.name];
        addUsage(
          command.interactiveSource
            ? `/${data.name} → choose "${actionPath.join(' / ')}"`
            : `/${[data.name, ...actionPath].join(' ')}`,
          option.description,
          option.options
        );
      }
    }
  }

  const hasSubcommands = data.options?.some(option => option.type === 1 || option.type === 2);
  if (hasSubcommands) {
    walk(data.options);
  } else {
    addUsage(`/${data.name}`, data.description, data.options);
  }

  const fieldsWithChunks = [];
  for (const field of fields) {
    const lines = field.value.split('\n');
    let value = '';
    for (const line of lines) {
      if (value && `${value}\n${line}`.length > 1000) {
        fieldsWithChunks.push({ name: field.name, value });
        value = '';
      }
      value = value ? `${value}\n${line}` : line;
    }
    if (value) fieldsWithChunks.push({ name: field.name, value });
  }

  if (fieldsWithChunks.length > 25) {
    throw new Error(`The command guide for /${data.name} exceeds Discord's embed field limit.`);
  }
  return fieldsWithChunks;
}

function buildHelpResponse(command, commands, userId) {
  const data = command.interactiveSource || command.data.toJSON();
  const fields = getCommandHelpFields(command);
  if (data.default_member_permissions) {
    const permissions = new PermissionsBitField(BigInt(data.default_member_permissions)).toArray();
    fields.unshift({
      name: 'Required permission',
      value: permissions.join(', ')
    });
  }
  if (fields.length > 25) {
    throw new Error(`The command guide for /${data.name} exceeds Discord's embed field limit.`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Command guide: /${data.name}`)
    .setDescription(`${data.description}\n\nChoose another command from the menu to view its options.`)
    .addFields(...fields);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${HELP_SELECT_PREFIX}${userId}`)
    .setPlaceholder('Browse all AssistaBot commands')
    .addOptions(
      [...commands.values()]
        .sort((a, b) => a.data.name.localeCompare(b.data.name))
        .map(item => ({
          label: item.data.name,
          description: item.data.description.slice(0, 100),
          value: item.data.name
        }))
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

/**
 * Command data and execution logic for the 'assistabot' command.
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
    .setName('assistabot')
    .setDescription('AssistaBot Commands')
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('Get information about AssistaBot'))
    .addSubcommand(sub =>
      sub.setName('invite')
        .setDescription('Get an invite link to add AssistaBot to your server'))
    .addSubcommand(sub =>
      sub.setName('help')
        .setDescription('Browse all bot commands with an interactive guide'))
    .addSubcommand(sub =>
      sub.setName('say')
        .setDescription('Make AssistaBot send or edit a message (Admin only)')
        .addStringOption(opt =>
          opt.setName('message')
            .setDescription('The message content to send or edit; type \\n to create a new line')
            .setRequired(true)
            .setMaxLength(2000) // Discord message character limit
        )
        .addStringOption(opt =>
          opt.setName('message_id')
            .setDescription('ID or link of a bot message in this channel to edit (optional)')
            .setRequired(false)
        )
    ),

  /**
   * Executes the assistabot command with the specified subcommand.
   * @async
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction that triggered the command.
   * @returns {Promise<void>}
   * @throws {Error} If there's an error executing the command.
   */
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    try {
      switch (sub) {
        case 'info':
          await this.handleInfo(interaction);
          break;
          
        case 'invite':
          await this.handleInvite(interaction);
          break;

        case 'help':
          await this.handleHelp(interaction);
          break;
          
        case 'say':
          await this.handleSay(interaction);
          break;
          
        default:
          await interaction.reply({ 
            content: '❌ Unknown subcommand.',
            flags: MessageFlags.Ephemeral
          });
      }
    } catch (error) {
      console.error('Error in assistabot command:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          content: '❌ An error occurred while executing this command.',
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.followUp({ 
          content: '❌ An error occurred while executing this command.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  },
  
  /**
   * Handles the 'info' subcommand.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction that triggered the command.
   * @returns {Promise<void>}
   * @private
   */
  async handleInfo(interaction) {
    // Get guild-specific embed color
    const settings = guildSettings.getSettings(interaction.guild.id);
    let embedColor = settings?.embedColor || 0x0099ff;
    const features = [
      'Configure logging, prefixes, embed colors, and log exclusions.',
      'Set up welcomes, goodbyes, booster announcements, join roles, and brain-role leaderboards.',
      'Create tickets and reaction-based self-assignable roles.',
      'Manage birthdays, giveaways, invite stats, and message cleanup.',
      'Create custom commands with cooldowns and permission or role controls.',
      'Receive Twitch, YouTube, and TikTok live, presence, and upload alerts, plus Rumble live alerts.',
      'Manage stream roles, alert cleanup, and weekly schedules.',
      'Manage Twitch shoutouts and chat timers; viewers can opt in with `!pimpmeout`.',
      'Process Amazon and Walmart affiliate links and show product details.',
      'Send PayPal donation alerts to Twitch chat and stream overlays.',
      'Use Twitch chat commands for song info, ad breaks, shoutouts, and the command directory.',
      'Look up server, user, and invite details.',
      'Browse commands with `/assistabot help` or `!botcommands`.'
    ];
    
    // Convert string color to number if needed
    if (typeof embedColor === 'string') {
      // Remove # prefix if present and convert to number
      const colorStr = embedColor.replace(/^#/, '');
      embedColor = parseInt(colorStr, 16);
    }
    
    const infoEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`${branding.botName || 'AssistaBot'} Information`)
      .setDescription(branding.botDescription || 'A multipurpose Discord community bot.')
      .addFields(
        {
          name: branding.creatorName ? 'Creator' : 'Bot owner',
          value: [
            branding.creatorName || '',
            branding.creatorId ? `<@${branding.creatorId}>` : ''
          ].filter(Boolean).join(' ') || 'Not configured',
          inline: true
        },
        { name: 'Version', value: '1.0.0', inline: true },
        {
          name: 'What AssistaBot Offers',
          value: features.map(feature => `🔸 ${feature}`).join('\n'),
          inline: false
        },
        ...(branding.supportServerUrl ? [{
          name: 'Support Server',
          value: `[Click here to get more assistance](${branding.supportServerUrl})`,
          inline: false
        }] : [])
      )
      .setFooter(branding.infoFooterText ? { text: branding.infoFooterText } : { text: branding.botName || 'AssistaBot' });
    
    await interaction.reply({ embeds: [infoEmbed] });
  },
  
  /**
   * Handles the 'invite' subcommand.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction that triggered the command.
   * @returns {Promise<void>}
   * @private
   */
  async handleInvite(interaction) {
    const permissions = '535529254080'; // Required permissions
    const inviteLink = `https://discord.com/oauth2/authorize?client_id=${interaction.client.user.id}&permissions=${permissions}&scope=bot%20applications.commands`;

    // Get guild-specific embed color
    const settings = guildSettings.getSettings(interaction.guild.id);
    let embedColor = settings?.embedColor || 0x0099ff;

    // Convert string color to number if needed
    if (typeof embedColor === 'string') {
      const colorStr = embedColor.replace(/^#/, '');
      embedColor = parseInt(colorStr, 16);
    }

    const inviteEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('Invite AssistaBot to Your Server')
      .setDescription(`Click [here](${inviteLink}) to add me to your server!`)
      .addFields(
        { 
          name: 'Required Permissions', 
          value: '🔸Send Messages\n🔸Embed Links\n🔸Attach Files\n🔸Read Message History\n🔸View Channels\n🔸Manage Messages\n🔸Manage Channels\n🔸Manage Roles\n🔸Manage Guild',
          inline: false 
        }
      );
    
    await interaction.reply({ 
      embeds: [inviteEmbed],
      flags: MessageFlags.Ephemeral
    });
  },

  async handleHelp(interaction) {
    const commands = interaction.client.commands;
    if (!commands?.size) {
      throw new Error('The command registry is unavailable.');
    }
    if (commands.size > 25) {
      throw new Error('The command guide supports up to 25 commands in its selection menu.');
    }

    const command = commands.get('assistabot');
    await interaction.reply({
      ...buildHelpResponse(command, commands, interaction.user.id),
      flags: MessageFlags.Ephemeral
    });
  },

  async handleHelpComponent(interaction) {
    const [, ownerId] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) {
      return interaction.reply({
        content: 'Only the person who opened this command guide can use it.',
        flags: MessageFlags.Ephemeral
      });
    }

    const selectedCommand = interaction.client.commands.get(interaction.values[0]);
    if (!selectedCommand) {
      return interaction.reply({
        content: 'That command is no longer available. Run `/assistabot help` again.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.update(
      buildHelpResponse(
        selectedCommand,
        interaction.client.commands,
        interaction.user.id
      )
    );
  },
  
  /**
   * Handles the 'say' subcommand.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction that triggered the command.
   * @returns {Promise<void>}
   * @private
   */
  async handleSay(interaction) {
    // Check if the command is used in a guild
    if (!interaction.inGuild()) {
      return interaction.reply({ 
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Check if the user has permission to use this command
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ 
        content: '❌ You need the "Manage Server" permission to use this command.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    const rawContent = interaction.options.getString('message');
    const newContent = rawContent
      ?.replace(/\\r?\\n/g, '\n')
      .replace(/\r?\n/g, '\n') || '';
    const rawMessageId = interaction.options.getString('message_id');

    // Helper to parse a message id or URL
    const parseMessageId = (input) => {
      if (!input) return null;
      const trimmed = input.trim();
      // If it's a snowflake id
      if (/^\d{16,20}$/.test(trimmed)) return trimmed;
      // Try to extract from a Discord message URL
      const m = trimmed.match(/discord(?:app)?\.com\/channels\/\d+\/\d+\/(\d{16,20})/);
      if (m) return m[1];
      // Fallback: try last segment
      const parts = trimmed.split('/');
      const last = parts[parts.length - 1];
      return /^\d{16,20}$/.test(last) ? last : null;
    };

    try {
      // Acknowledge the interaction first
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetId = parseMessageId(rawMessageId);

      if (targetId) {
        // Attempt to edit an existing message in the same channel
        const channel = interaction.channel;
        let targetMsg = null;
        try {
          targetMsg = await channel.messages.fetch(targetId);
        } catch (_) { /* ignore */ }

        if (!targetMsg) {
          await interaction.editReply({
            content: '❌ Could not find a message with that ID in this channel.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const originalContent = targetMsg.content || '';

        // Optional: restrict editing to bot-authored messages to avoid accidents
        if (!targetMsg.author?.bot) {
          await interaction.editReply({
            content: '❌ For safety, only bot messages can be edited with this command.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const edited = await targetMsg.edit(newContent);

        // Log the edit
        try {
          const logContent = `**Channel:** <#${interaction.channel.id}>\n**Editor:** ${interaction.user} (${interaction.user.id})\n**Message URL:** ${edited.url}\n**Original Content:** ${originalContent || 'None'}\n**New Content:** ${newContent || 'None'}`;
          if (interaction.guild) {
        logger.sendLog(interaction.client, interaction.guild.id, 'assistabotsayLog', logContent, null, `Edited by: ${interaction.user.username}`, 'AssistaBot Say Edited');
          }
        } catch (e) {
          // best-effort logging
        }

        await interaction.editReply({ 
          content: `✏️ Message edited. [Jump to message](${edited.url})`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // Otherwise, send a new message
      const sent = await interaction.channel.send(newContent);

      // Log the post
      try {
        const logContent = `**Channel:** <#${interaction.channel.id}>\n**Poster:** ${interaction.user} (${interaction.user.id})\n**Message URL:** ${sent.url}\n**Content:** ${newContent || 'None'}`;
        if (interaction.guild) {
      logger.sendLog(interaction.client, interaction.guild.id, 'assistabotsayLog', logContent, null, `Posted by: ${interaction.user.username}`, 'AssistaBot Say Posted');
        }
      } catch (e) {
        // best-effort logging
      }

      // Confirm the message was sent
      await interaction.editReply({ 
        content: `✅ Message sent! [Jump to message](${sent.url})`,
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      console.error('Error handling say command:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ Failed to process the command. Please try again later.',
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.editReply({
          content: '❌ Failed to process the command. Please try again later.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
};