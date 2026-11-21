const { MessageFlags } = require('discord.js');
const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

const { handleBirthdayListInteraction } = require('./birthdayListHandler');
const { handleScheduleButtonInteraction } = require('../modules/streamScheduleEmbed');
const scheduleCommand = require('../commands/schedule');
const selfroleCommand = require('../commands/selfrole');
const timerCommand = require('../commands/timer');
const birthdayCommand = require('../commands/birthday');
const assistabotCommand = require('../commands/assistabot');
const purgeCommand = require('../commands/purge');
const setupCommand = require('../commands/setup');
const boosterCommand = require('../commands/booster');
const bouncerCommand = require('../commands/bouncer');
const affiliateSettingsPanel = require('../modules/affiliateSettingsPanel');
const interactiveCommandPanels = require('../modules/interactiveCommandPanels');
const blocklistManager = require('../modules/blocklistManager');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    // Check if guild is blocked
    if (interaction.guildId && blocklistManager.isGuildBlocked(interaction.guildId)) {
      if (interaction.isCommand()) {
        return interaction.reply({
          content: '❌ This server has been blocked from using this bot.',
          flags: MessageFlags.Ephemeral
        });
      }
      return; // Silently ignore other interactions from blocked guilds
    }

    // Check if Discord user is blocked
    if (interaction.user?.id && blocklistManager.isDiscordUserBlocked(interaction.user.id)) {
      return; // Silently ignore all interactions from blocked users
    }

    // Handle commands FIRST with priority to prevent timeout
    if (interaction.isCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      if (DEBUG) {
        console.info({
          event: 'slash_command_invoked',
          name: interaction.commandName,
          user: interaction.user?.id,
          guild: interaction.guildId
        });
      }

      try {
        await command.execute(interaction, client);
        if (DEBUG) {
          console.info({ event: 'slash_command_completed', name: interaction.commandName });
        }
      } catch (error) {
        if (error.code === 10062) return;
        console.error(error);
        try {
          const errorMessage = {
            content: '❌ Error executing command.',
            flags: MessageFlags.Ephemeral
          };
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp(errorMessage);
          } else if (!interaction.deferred && !interaction.replied) {
            await interaction.reply(errorMessage);
          }
        } catch (_) {
          // Swallow follow-up errors like Unknown interaction
        }
      }
      return; // Exit early after command handling
    }
    
    // Handle other interactions after commands
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command && command.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (error) {
          console.error('Autocomplete error:', error);
        }
      }
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith('cmdpanel:')) {
        return interactiveCommandPanels.handleComponent(interaction);
      }

      if (interaction.customId.startsWith('affiliate:')) {
        return affiliateSettingsPanel.handleComponent(interaction);
      }

      if (interaction.customId.startsWith('booster:')) {
        return boosterCommand.handleComponent(interaction);
      }

      if (interaction.customId.startsWith('bouncer:')) {
        return bouncerCommand.handleComponent(interaction);
      }

      if (interaction.customId.startsWith('setup:')) {
        return setupCommand.handleSetupComponent(interaction);
      }

      if (interaction.customId.startsWith('schedule_builder_')) {
        return scheduleCommand.handleScheduleBuilderComponent(interaction);
      }

      if (interaction.customId.startsWith('purge:')) {
        return purgeCommand.handleButtonInteraction(interaction);
      }

      // Handle schedule button interactions
      if (interaction.customId.startsWith('schedule_')) {
        return handleScheduleButtonInteraction(interaction);
      }
      
      // Handle botadmin servers button interactions
      if (interaction.customId.startsWith('botadmin_servers_')) {
        const { handleButtonInteraction } = require('../commands/botadmin');
        return handleButtonInteraction(interaction);
      }
      
      // Handle birthday list buttons — only if the message embed footer matches birthday list format
      if (interaction.customId.startsWith('prev_') || interaction.customId.startsWith('next_') || interaction.customId.startsWith('refresh_')) {
        const embedFooter = interaction.message?.embeds?.[0]?.footer?.text || '';
        if (embedFooter.match(/Page \d+\/12/)) {
          return handleBirthdayListInteraction(interaction);
        }
      }
      
      // Handle giveaway button interactions
      if (interaction.customId.startsWith('giveaway_')) {
        const { handleButtonInteraction } = require('../commands/giveaway');
        return handleButtonInteraction(interaction);
      }

      // Handle selfrole button interactions
      if (interaction.customId.startsWith('selfrole_')) {
        return selfroleCommand.handleButtonInteraction(interaction);
      }

      // Handle timer setup button interactions
      if (interaction.customId.startsWith('timer_setup:')) {
        return timerCommand.handleButtonInteraction(interaction);
      }

      // Handle birthday config button interactions
      if (interaction.customId.startsWith('birthday_config:')) {
        return birthdayCommand.handleButtonInteraction(interaction);
      }

      // Handle server command button interactions
      if (interaction.customId.startsWith('server_')) {
        const { handleButtonInteraction } = require('../commands/server');
        return handleButtonInteraction(interaction);
      }

      // Handle ticket button interactions
      const { handleButtonInteraction } = require('../commands/ticket');
      return handleButtonInteraction(interaction);
      
    } else if (interaction.isAnySelectMenu()) {
      if (interaction.customId.startsWith('cmdpanel:')) {
        return interactiveCommandPanels.handleComponent(interaction);
      }

      if (interaction.customId.startsWith('booster:')) {
        return boosterCommand.handleComponent(interaction);
      }

      if (interaction.customId.startsWith('bouncer:')) {
        return bouncerCommand.handleComponent(interaction);
      }

      if (interaction.customId.startsWith('setup:')) {
        return setupCommand.handleSetupComponent(interaction);
      }

      if (interaction.customId.startsWith('birthday_config_channel:') ||
          interaction.customId.startsWith('birthday_config_role:')) {
        return birthdayCommand.handleSelectMenuInteraction(interaction);
      }

      if (interaction.customId.startsWith('purge:')) {
        return purgeCommand.handleSelectMenuInteraction(interaction);
      }

      if (interaction.customId.startsWith('assistabot_help:')) {
        return assistabotCommand.handleHelpComponent(interaction);
      }

      if (interaction.customId.startsWith('schedule_builder_')) {
        return scheduleCommand.handleScheduleBuilderComponent(interaction);
      }

      // Handle select menu interactions
      const { handleButtonInteraction } = require('../commands/ticket');
      return handleButtonInteraction(interaction);
      
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('cmdpanel:')) {
        return interactiveCommandPanels.handleModal(interaction);
      }

      if (interaction.customId.startsWith('booster:')) {
        return boosterCommand.handleModal(interaction);
      }

      if (interaction.customId.startsWith('bouncer:')) {
        return bouncerCommand.handleModal(interaction);
      }

      if (interaction.customId.startsWith('setup:')) {
        return setupCommand.handleSetupModal(interaction);
      }

      if (interaction.customId.startsWith('purge:')) {
        return purgeCommand.handleModalInteraction(interaction);
      }

      if (interaction.customId.startsWith('schedule_builder_')) {
        return scheduleCommand.handleScheduleBuilderModal(interaction);
      }

      if (interaction.customId.startsWith('selfrole_')) {
        return selfroleCommand.handleModalInteraction(interaction);
      }

      if (interaction.customId.startsWith('timer_') && interaction.customId.includes('_modal:')) {
        return timerCommand.handleModalInteraction(interaction);
      }

      if (interaction.customId.startsWith('birthday_config_modal:')) {
        return birthdayCommand.handleModalInteraction(interaction);
      }

      // Handle ticket modal interactions
      const { handleModalInteraction } = require('../commands/ticket');
      await handleModalInteraction(interaction);
    }
  },
};