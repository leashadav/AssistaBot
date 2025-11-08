const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete a number of recent messages in this channel')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('How many messages to delete (1-100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: '❌ This command can only be used in a server.', flags: 64 });
      }

      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
      }

      const me = interaction.guild.members.me;
      if (!me?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: '❌ I need the Manage Messages permission.', flags: 64 });
      }

      const channel = interaction.channel;
      const amount = interaction.options.getInteger('amount', true);

      // Fetch up to 100 recent messages, filter out pinned, and delete up to the requested amount
      const recent = await channel.messages.fetch({ limit: 100 });
      const targets = recent.filter(m => !m.pinned).first(amount);

      if (!targets || targets.length === 0) {
        return interaction.reply({ content: '⚠️ No unpinned messages found to delete.', flags: 64 });
      }

      const deleted = await channel.bulkDelete(targets, true);
      const count = deleted?.size ?? 0;

      if (count === 0) {
        return interaction.reply({ content: '⚠️ No messages could be deleted (they may be older than 14 days).', flags: 64 });
      }

      return interaction.reply({ content: `✅ Deleted ${count} unpinned message${count === 1 ? '' : 's'}.`, flags: 64 });
    } catch (err) {
      return interaction.reply({ content: `❌ Failed to delete messages: ${err.message}`, flags: 64 });
    }
  }
};