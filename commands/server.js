const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
		.setName('server')
		.setDescription('Info about the server.'),
	async execute(interaction) {
		await interaction.reply(`
			Server name: ${interaction.guild.name}\n
			Description: ${interaction.guild.description || 'No description set.'}\n
			Created on: <t:${Math.round(interaction.guild.createdTimestamp / 1000)}>\n
			Total members: ${interaction.guild.memberCount}\n
			Boost level: ${interaction.guild.premiumTier}\n
			Total boosts: ${interaction.guild.premiumSubscriptionCount || '0'}\n
			Server owner: <@!${interaction.guild.ownerId}>`);
  },
};