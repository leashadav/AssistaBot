const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('assistabot')
    .setDescription('AssistaBot Commands')
    .addSubcommand(sub =>
      sub.setName('info')
        .setDescription('Info about AssistaBot'))
    .addSubcommand(sub =>
      sub.setName('invite')
        .setDescription('Invite AssistaBot to your server'))
    .addSubcommand(sub =>
      sub.setName('say')
        .setDescription('Make AssistaBot say something (Admin only)')
        .addStringOption(opt =>
          opt.setName('message')
            .setDescription('Message to echo')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'info') {
      await interaction.reply(`An attempt at a bot by Shadav`);
    }

    if (sub === 'invite') {
      const link = `https://discord.com/oauth2/authorize?client_id=${interaction.client.user.id}&permissions=8&scope=bot%20applications.commands`;
      await interaction.reply(`Invite me using this link:\n${link}`);
    }

    if (sub === 'say') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
  return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
      }
      const message = interaction.options.getString('message');
      return interaction.reply(message);
    }
  }
};