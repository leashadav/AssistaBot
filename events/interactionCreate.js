const DEBUG = /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''));

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
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
        console.error(error);
        try {
          const errorMessage = { content: '❌ Error executing command.', flags: 64 };
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp(errorMessage);
          } else {
            await interaction.reply(errorMessage);
          }
        } catch {
          // Swallow follow-up errors like Unknown interaction
        }
      }
    } else if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command && command.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (error) {
          console.error('Autocomplete error:', error);
        }
      }
    } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
      // Handle ticket button and select menu interactions
      const { handleButtonInteraction } = require('../commands/ticket');
      await handleButtonInteraction(interaction);
    } else if (interaction.isModalSubmit()) {
      // Handle ticket modal interactions
      const { handleModalInteraction } = require('../commands/ticket');
      await handleModalInteraction(interaction);
    }
    
    // Handle giveaway button interactions
    if (interaction.isButton() && interaction.customId.startsWith('giveaway_')) {
      const { handleButtonInteraction } = require('../commands/giveaway');
      await handleButtonInteraction(interaction);
    }
  },
};