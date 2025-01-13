const { CommandInteraction, Client } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const Discord = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('user')
		.setDescription('Provides information about the user.'),
	async execute(interaction) {
		await interaction.reply(`Display Name: ${interaction.user.displayName}\nUsername: ${interaction.user.username}\nUser ID: ${interaction.user.id}\nAccount Created: <t:${Math.round(interaction.user.createdTimestamp / 1000)}>\nJoined Server: <t:${Math.round(interaction.guild.joinedTimestamp / 1000)}>`);
	},
};