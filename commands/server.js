const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
		.setName('server')
		.setDescription('Info about the server.'),
	async execute(interaction) {
		await interaction.reply(`
Server name: ${interaction.guild.name}
Description: ${interaction.guild.description || 'No description set.'}
Created on: <t:${Math.round(interaction.guild.createdTimestamp / 1000)}>
Total members: ${interaction.guild.memberCount}
Boost level: ${interaction.guild.premiumTier}
Total boosts: ${interaction.guild.premiumSubscriptionCount || '0'}
Server owner: <@!${interaction.guild.ownerId}>`);
  },
};