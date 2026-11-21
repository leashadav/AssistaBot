const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const walmart = require('../modules/walmartAffiliate');
const guildSettings = require('../modules/guildSettings');
const affiliateSettingsPanel = require('../modules/affiliateSettingsPanel');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('walmart')
        .setDescription('Manage Walmart-related bot functions')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('panel')
                .setDescription('Open interactive Walmart link settings')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear-cache')
                .setDescription('Clear Walmart product cache')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Enable Walmart link processing')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Disable Walmart link processing')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const gs = guildSettings.getSettings(interaction.guild.id);
        const embed = new EmbedBuilder()
            .setColor(parseInt((gs.embedColor || '#0099ff').replace('#', ''), 16))

        if (subcommand === 'panel') {
            return affiliateSettingsPanel.openPanel(interaction, {
                brand: 'walmart',
                label: 'Walmart',
                enabledKey: 'walmartEnabled',
                affiliateModule: walmart
            });
        }

        if (subcommand === 'enable') {
            // Update guild settings to enable Walmart functionality
            guildSettings.updateSettings(interaction.guild.id, {
                walmartEnabled: true
            });
            
            embed.setTitle('✅ Walmart Links Enabled')
                 .setDescription('Walmart link processing has been enabled for this server.');

            return await interaction.reply({ 
                embeds: [embed], 
                flags: MessageFlags.Ephemeral
            });
        }

        if (subcommand === 'disable') {
            // Update guild settings to disable Walmart functionality
            guildSettings.updateSettings(interaction.guild.id, {
                walmartEnabled: false
            });
            
            embed.setTitle('☑️ Walmart Links Disabled')
                 .setDescription('Walmart link processing has been disabled for this server.');

            return await interaction.reply({ 
                embeds: [embed], 
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const count = walmart.clearCache();
            embed.setTitle('✅ Walmart Cache Cleared')
                 .setDescription(`Successfully cleared ${count} items from the Walmart product cache.`);

            await interaction.reply({ 
                embeds: [embed], 
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error('Error clearing Walmart cache:', error);
            embed.setTitle('❌ Error Clearing Cache')
                 .setDescription('An error occurred while clearing the Walmart product cache.')
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
