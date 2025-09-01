const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('user')
		.setDescription('Info about a user.')
		.addUserOption(option => option.setName('target').setDescription('Select a user')),
	async execute(interaction) {
		const user = interaction.options.getUser('target');
		if (user) {
			await interaction.reply(`Display Name: ${user.displayName}\nUsername: ${user.username}\nUser ID: ${user.id}\nAccount Created: <t:${Math.round(user.createdTimestamp / 1000)}>\nJoined Server: <t:${Math.round(interaction.guild.joinedTimestamp / 1000)}>\nIs Bot: ${user.bot}`);
		} else {
			await interaction.reply(`Display Name: ${interaction.user.displayName}\nUsername: ${interaction.user.username}\nUser ID: ${interaction.user.id}\nAccount Created: <t:${Math.round(interaction.user.createdTimestamp / 1000)}>\nJoined Server: <t:${Math.round(interaction.guild.joinedTimestamp / 1000)}>\nIs Bot: ${interaction.user.bot}`);
		}
	},
};