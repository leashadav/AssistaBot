const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../modules/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('assistabot')
    .setDescription('AssistaBot Commands')
    .setDMPermission(false)
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

    switch (sub) {
      case 'info': {
        await interaction.reply(`An attempt at a bot by Shadav`);
        return;
      }

      case 'invite': {
        const link = `https://discord.com/oauth2/authorize?client_id=${interaction.client.user.id}&permissions=535529254080&integration_type=0&scope=bot+applications.commands`;
        await interaction.reply(`Invite me using this link:\n${link}`);
        return;
      }

      case 'say': {
        if (!interaction.inGuild()) {
          return interaction.reply({ content: 'This command can only be used in a server.', flags: 64 });
        }
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
        }
        const message = interaction.options.getString('message');

        await interaction.deferReply({ flags: 64 });
        const sent = await interaction.channel.send(message);

        if (interaction.guild && sent) {
          const link = `https://discord.com/channels/${interaction.guild.id}/${sent.channel.id}/${sent.id}`;
          const content = `Say command used by ${interaction.user.tag} (${interaction.user.id}) in <#${interaction.channel.id}>\nMessage: ${message}\nLink: ${link}`;
          logger.sendLog(interaction.client, interaction.guild.id, 'assistabotsayLog', content);
        }

        return interaction.editReply('✅ Sent.');
      }

      default:
        return;
    }
  }
};