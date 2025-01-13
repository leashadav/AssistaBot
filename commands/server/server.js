const { CommandInteraction, Client } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const Discord = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('server')
		.setDescription('Info about the server.'),
	async execute(interaction) {
		await interaction.reply(`Server name: ${interaction.guild.name}\nDescription: ${interaction.guild.description}\nCreated on: <t:${Math.round(interaction.guild.createdTimestamp / 1000)}>\nTotal members: ${interaction.guild.memberCount}\nBoost level: ${interaction.guild.premiumTier}\nTotal boosts: ${interaction.guild.premiumSubscriptionCount || '0'}\nServer owner: <@!${interaction.guild.ownerId}>`);
	},
};