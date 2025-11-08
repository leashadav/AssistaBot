const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
const { setBirthday, deleteBirthday, getGuildBirthdays, getAge } = require('../modules/birthdayManager');
const guildSettings = require('../modules/guildSettings');

const ITEMS_PER_PAGE = 50;

// Display dates as 'Jan 2' or 'Jan 2, 1990' while accepting MM-DD, YYYY-MM-DD, or MM-DD-YYYY
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatReadableDate(dateString) {
  const parts = dateString.split('-').map(Number);
  let year = null, month, day;
  if (dateString.length === 5) {
    [month, day] = parts;
  } else if (parts[0] > 31) { // YYYY-MM-DD
    [year, month, day] = parts;
  } else if (parts[2] > 31) { // MM-DD-YYYY
    [month, day, year] = parts;
  } else {
    // Fallback, assume MM-DD (or MM-DD-YYYY)
    [month, day, year] = parts;
  }
  const monthName = MONTHS_SHORT[(month || 1) - 1] || 'Jan';
  return year ? `${monthName} ${day}, ${year}` : `${monthName} ${day}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Manage birthdays 🎂')
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Set your birthday')
        .addStringOption(opt => opt.setName('date')
          .setDescription('Format: MM-DD or MM-DD-YYYY')
          .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('delete')
        .setDescription('Delete your birthday'))
    .addSubcommand(sub =>
      sub.setName('setuser')
        .setDescription('Set another user’s birthday (Admin only)')
        .addUserOption(opt => opt.setName('user').setDescription('The user').setRequired(true))
        .addStringOption(opt => opt.setName('date').setDescription('Format: MM-DD or MM-DD-YYYY').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('deleteuser')
        .setDescription('Delete another user’s birthday (Admin only)')
        .addUserOption(opt => opt.setName('user').setDescription('The user').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Show all saved birthdays'))
    .addSubcommand(sub =>
      sub.setName('config')
        .setDescription('Configure birthday role and channel (Admin only)')
        .addRoleOption(opt => opt.setName('role').setDescription('Role to assign on birthdays').setRequired(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel for birthday announcements').setRequired(true))),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in a server.', flags: 64 });
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const date = interaction.options.getString('date');
      setBirthday(interaction.guild.id, interaction.user.id, date);
      return interaction.reply(`✅ Your birthday has been set to **${date}**`);
    }

    if (sub === 'delete') {
      deleteBirthday(interaction.guild.id, interaction.user.id);
      return interaction.reply('🗑️ Your birthday has been deleted.');
    }

    if (sub === 'setuser') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
      }
      const user = interaction.options.getUser('user');
      const date = interaction.options.getString('date');
      setBirthday(interaction.guild.id, user.id, date);
      return interaction.reply(`✅ Birthday for **${user.tag}** set to **${date}**`);
    }

    if (sub === 'deleteuser') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
      }
      const user = interaction.options.getUser('user');
      deleteBirthday(interaction.guild.id, user.id);
      return interaction.reply(`🗑️ Birthday for **${user.tag}** deleted.`);
    }

    if (sub === 'list') {
      // Defer immediately to keep the interaction alive (public reply visible to everyone)
      await interaction.deferReply().catch(() => {});

      const birthdays = getGuildBirthdays(interaction.guild.id);
      if (Object.keys(birthdays).length === 0) {
        return interaction.editReply('📭 No birthdays have been saved yet.');
      }

      // --- Sort by calendar month/day starting Jan 1 ---
      const sorted = Object.entries(birthdays).sort((a, b) => {
        const [, dateA] = a;
        const [, dateB] = b;

        const partsA = dateA.split('-').map(Number);
        let monthA, dayA;
        if (dateA.length === 5) {
          [monthA, dayA] = partsA; // MM-DD
        } else if (partsA[0] > 31) {
          // YYYY-MM-DD
          [, monthA, dayA] = partsA;
        } else if (partsA[2] > 31) {
          // MM-DD-YYYY
          [monthA, dayA] = partsA;
        } else {
          // Fallback assume MM-DD(-YYYY)
          [monthA, dayA] = partsA;
        }

        const partsB = dateB.split('-').map(Number);
        let monthB, dayB;
        if (dateB.length === 5) {
          [monthB, dayB] = partsB;
        } else if (partsB[0] > 31) {
          [, monthB, dayB] = partsB;
        } else if (partsB[2] > 31) {
          [monthB, dayB] = partsB;
        } else {
          [monthB, dayB] = partsB;
        }

        if (monthA !== monthB) return monthA - monthB;
        if (dayA !== dayB) return dayA - dayB;
        return a[0].localeCompare(b[0]);
      });

      // --- Build pages ---
      const pages = [];
      for (let i = 0; i < sorted.length; i += ITEMS_PER_PAGE) {
        const chunk = sorted.slice(i, i + ITEMS_PER_PAGE);
        const embed = new EmbedBuilder()
          .setTitle('<:happybirthday:1410103531360354406> All Birthdays')
          .setColor('#FF6600')
          .setFooter({ text: `Page ${Math.floor(i / ITEMS_PER_PAGE) + 1} of ${Math.ceil(sorted.length / ITEMS_PER_PAGE)}` });

        const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        let desc = '';
        let lastMonth = null;
        for (const [userId, date] of chunk) {
          const member = await interaction.guild.members.fetch(userId).catch(() => null);
          let name;
          if (member) {
            name = member.displayName;
          } else {
            const fetchedUser = await interaction.client.users.fetch(userId).catch(() => null);
            name = fetchedUser ? fetchedUser.username : `Unknown (${userId})`;
          }

          const parts = date.split('-').map(Number);
          let month;
          if (date.length === 5) {
            month = parts[0];
          } else if (parts[0] > 31) {
            month = parts[1];
          } else if (parts[2] > 31) {
            month = parts[0];
          } else {
            month = parts[0];
          }

          if (lastMonth !== month) {
            if (desc) desc += '\n';
            desc += `__${monthNames[month - 1]}__\n`;
            lastMonth = month;
          }

          const age = getAge(date);
          const prettyDate = formatReadableDate(date);

          desc += `🔸 **${name}** ${prettyDate} ${age ? ` (${age})` : ''}\n`;
        }

        embed.setDescription(desc);
        pages.push(embed);
      }

      // --- Pagination with buttons ---
      let page = 0;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('prev')
          .setLabel('◀️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pages.length === 1)
      );

      const message = await interaction.editReply({ embeds: [pages[page]], components: [row] });

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60_000 // 1 minute
      });

      collector.on('collect', async (btnInt) => {
        if (btnInt.user.id !== interaction.user.id) {
            return btnInt.reply({ content: '❌ Only the command user can control pagination.', flags: 64 });
          }

        if (btnInt.customId === 'prev') page--;
        if (btnInt.customId === 'next') page++;

        row.components[0].setDisabled(page === 0);
        row.components[1].setDisabled(page === pages.length - 1);

        await btnInt.update({ embeds: [pages[page]], components: [row] });
      });

      collector.on('end', async () => {
        row.components.forEach(btn => btn.setDisabled(true));
        try {
          await message.edit({ components: [row] });
        } catch {}
      });
    }

    if (sub === 'config') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
      }
      const role = interaction.options.getRole('role');
      const channel = interaction.options.getChannel('channel');
      guildSettings.updateSettings(interaction.guild.id, {
        birthdayInfo: {
          birthdayRole: role.id,
          birthdayChannel: channel.id
        }
      });
      return interaction.reply({ content: `✅ Birthday settings updated:\nRole: ${role}\nChannel: ${channel}`, flags: 64 });
    }
  }
};