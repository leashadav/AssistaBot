const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const amazon = require('../modules/amazonAffiliate');
const guildSettings = require('../modules/guildSettings');
const affiliateSettingsPanel = require('../modules/affiliateSettingsPanel');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('amazon')
        .setDescription('Manage Amazon-related bot functions')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('panel')
                .setDescription('Open interactive Amazon link settings')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear-cache')
                .setDescription('Clear Amazon product cache')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Enable Amazon link processing')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Disable Amazon link processing')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const gs = guildSettings.getSettings(interaction.guild.id);
        const embed = new EmbedBuilder()
            .setColor(parseInt((gs.embedColor || '#0099ff').replace('#', ''), 16))

        if (subcommand === 'panel') {
            return affiliateSettingsPanel.openPanel(interaction, {
                brand: 'amazon',
                label: 'Amazon',
                enabledKey: 'amazonEnabled',
                affiliateModule: amazon
            });
        }

        if (subcommand === 'enable') {
            // Update guild settings to enable Amazon functionality
            guildSettings.updateSettings(interaction.guild.id, {
                amazonEnabled: true
            });
            
            embed.setTitle('✅ Amazon Links Enabled')
                 .setDescription('Amazon link processing has been enabled for this server.');

            return await interaction.reply({ 
                embeds: [embed], 
                flags: MessageFlags.Ephemeral
            });
        }

        if (subcommand === 'disable') {
            // Update guild settings to disable Amazon functionality
            guildSettings.updateSettings(interaction.guild.id, {
                amazonEnabled: false
            });
            
            embed.setTitle('☑️ Amazon Links Disabled')
                 .setDescription('Amazon link processing has been disabled for this server.');

            return await interaction.reply({ 
                embeds: [embed], 
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const count = amazon.clearCache();
            embed.setTitle('✅ Amazon Cache Cleared')
                 .setDescription(`Successfully cleared ${count} items from the Amazon product cache.`);

            await interaction.reply({ 
                embeds: [embed], 
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('Error clearing Amazon cache:', error);
            embed.setTitle('❌ Error Clearing Cache')
                 .setDescription('An error occurred while clearing the Amazon product cache.')
                 .setColor(0xff0000);
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }
        }
    },
    handleComponent: affiliateSettingsPanel.handleComponent
};
