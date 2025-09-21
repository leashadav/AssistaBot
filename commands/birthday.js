const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
const { getTodaysBirthdays, setBirthday, deleteBirthday, getAge } = require('../modules/birthdayManager');
const { BirthdayInfo } = require('../config.json');
const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, '../data/birthdays.json');
const ITEMS_PER_PAGE = 10;

// Add this utility function near the top of your file

function safeLoadJSON(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('Error loading birthday data:', e);
    return {};
  }
}

/**
 * Calculate how many days until the next occurrence of a given date
 */
function daysUntilBirthday(dateString) {
  const today = new Date();
  const currentYear = today.getFullYear();

  const [year, month, day] = dateString.length === 5
    ? [null, ...dateString.split('-').map(Number)]
    : dateString.split('-').map(Number);

  let nextBirthday = new Date(currentYear, month - 1, day);

  // If this year's birthday has already passed, move to next year
  if (
    nextBirthday < today.setHours(0, 0, 0, 0)
  ) {
    nextBirthday = new Date(currentYear + 1, month - 1, day);
  }

  const diffTime = nextBirthday - new Date();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Manage birthdays 🎂')
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
        .setDescription('Show all saved birthdays')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const date = interaction.options.getString('date');
      setBirthday(interaction.user.id, date);
      return interaction.reply(`✅ Your birthday has been set to **${date}**`);
    }

    if (sub === 'delete') {
      deleteBirthday(interaction.user.id);
      return interaction.reply('🗑️ Your birthday has been deleted.');
    }

    if (sub === 'setuser') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
      }
      const user = interaction.options.getUser('user');
      const date = interaction.options.getString('date');
      setBirthday(user.id, date);
      return interaction.reply(`✅ Birthday for **${user.tag}** set to **${date}**`);
    }

    if (sub === 'deleteuser') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You do not have permission.', ephemeral: true });
      }
      const user = interaction.options.getUser('user');
      deleteBirthday(user.id);
      return interaction.reply(`🗑️ Birthday for **${user.tag}** deleted.`);
    }

    if (sub === 'list') {
      if (!fs.existsSync(dataFile)) {
        return interaction.reply('📭 No birthdays have been saved yet.');
      }

      const birthdays = safeLoadJSON(dataFile);
      if (Object.keys(birthdays).length === 0) {
        return interaction.reply('📭 No birthdays have been saved yet.');
      }

      // --- Sorting by upcoming birthdays ---
      const today = new Date();
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();

      const sorted = Object.entries(birthdays).sort((a, b) => {
        const [, dateA] = a;
        const [, dateB] = b;

        const [yearA, monthA, dayA] = dateA.length === 5
          ? [null, ...dateA.split('-').map(Number)]
          : dateA.split('-').map(Number);

        const [yearB, monthB, dayB] = dateB.length === 5
          ? [null, ...dateB.split('-').map(Number)]
          : dateB.split('-').map(Number);

        // Adjust year to the *next occurrence*
        const nextA = new Date(today.getFullYear(), monthA - 1, dayA);
        if (monthA < currentMonth || (monthA === currentMonth && dayA < currentDay)) {
          nextA.setFullYear(today.getFullYear() + 1);
        }

        const nextB = new Date(today.getFullYear(), monthB - 1, dayB);
        if (monthB < currentMonth || (monthB === currentMonth && dayB < currentDay)) {
          nextB.setFullYear(today.getFullYear() + 1);
        }

        return nextA - nextB;
      });

      // --- Build pages ---
      const pages = [];
      for (let i = 0; i < sorted.length; i += ITEMS_PER_PAGE) {
        const chunk = sorted.slice(i, i + ITEMS_PER_PAGE);
        const embed = new EmbedBuilder()
          .setTitle('<:happybirthday:1410064532398805152> Upcoming Birthdays')
          .setColor('#FF6600')
          .setFooter({ text: `Page ${Math.floor(i / ITEMS_PER_PAGE) + 1} of ${Math.ceil(sorted.length / ITEMS_PER_PAGE)}` });

        let desc = '';
        for (const [userId, date] of chunk) {
          const member = await interaction.guild.members.fetch(userId).catch(() => null);
          const name = member ? member.displayName : (user ? user.username : `Unknown (${userId})`);

          const age = getAge(date);
          const daysLeft = daysUntilBirthday(date);

          let daysText = daysLeft === 0 ? '<:happybirthday:1410064532398805152> **Today!**' : `(in ${daysLeft} days)`;
          desc += `🔸 **${name}** ${date} ${age ? ` (${age})` : ''}\n`;
          // ${daysText}
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

      const sentMessage = await interaction.reply({ embeds: [pages[page]], components: [row] });
      const message = await interaction.fetchReply();

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60_000 // 1 minute
      });

      collector.on('collect', async (btnInt) => {
        if (btnInt.user.id !== interaction.user.id) {
          return btnInt.reply({ content: '❌ Only the command user can control pagination.', ephemeral: true });
        }

        if (btnInt.customId === 'prev') page--;
        if (btnInt.customId === 'next') page++;

        row.components[0].setDisabled(page === 0);
        row.components[1].setDisabled(page === pages.length - 1);

        await btnInt.update({ embeds: [pages[page]], components: [row] });
      });

      collector.on('end', async () => {
        row.components.forEach(btn => btn.setDisabled(true));
        await message.edit({ components: [row] });
      });
    }
  }
};