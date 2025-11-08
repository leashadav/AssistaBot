const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const GIVEAWAYS_FILE = path.join(__dirname, '..', 'data', 'giveaways.json');

function ensureGiveawaysFile() {
  try {
    if (!fs.existsSync(GIVEAWAYS_FILE)) {
      fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify({ giveaways: {} }, null, 2));
    }
  } catch (error) {
    console.error('Error ensuring giveaways file:', error?.message || 'Unknown error');
  }
}

function loadGiveaways() {
  try {
    ensureGiveawaysFile();
    return JSON.parse(fs.readFileSync(GIVEAWAYS_FILE, 'utf8'));
  } catch (error) {
    console.error('Error loading giveaways:', error?.message || 'Unknown error');
    return { giveaways: {} };
  }
}

function saveGiveaways(data) {
  try {
    fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving giveaways:', error?.message || 'Unknown error');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('Start a giveaway')
        .addStringOption(option =>
          option.setName('prize')
            .setDescription('Prize description')
            .setRequired(true))
        .addIntegerOption(option =>
          option.setName('winners')
            .setDescription('Number of winners')
            .setRequired(true)
            .setMinValue(1))
        .addStringOption(option =>
          option.setName('duration')
            .setDescription('Duration (e.g., 1m, 1h, 1d)')
            .setRequired(true))
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel to post giveaway')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('subtitle')
            .setDescription('Giveaway Title')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('description')
            .setDescription('Giveaway description')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('url')
            .setDescription('URL to show prize info')
            .setRequired(false))
        .addAttachmentOption(option =>
          option.setName('image')
            .setDescription('Giveaway image')
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('End a giveaway early')
        .addStringOption(option =>
          option.setName('message_id')
            .setDescription('Giveaway message ID')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('reroll')
        .setDescription('Reroll giveaway winners')
        .addStringOption(option =>
          option.setName('message_id')
            .setDescription('Giveaway message ID')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List active giveaways')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'start':
        await handleStart(interaction);
        break;
      case 'end':
        await handleEnd(interaction);
        break;
      case 'reroll':
        await handleReroll(interaction);
        break;
      case 'list':
        await handleList(interaction);
        break;
    }
  }
};

async function handleStart(interaction) {
  const subtitle = interaction.options.getString('subtitle');
  const description = interaction.options.getString('description');
  const prize = interaction.options.getString('prize');
  const url = interaction.options.getString('url');
  const image = interaction.options.getAttachment('image');
  const winners = interaction.options.getInteger('winners');
  const duration = interaction.options.getString('duration');
  const channel = interaction.options.getChannel('channel') || interaction.channel;

  const ms = parseDuration(duration);
  if (!ms) {
    return interaction.reply({ content: '❌ Invalid duration format. Use: 1h, 30m, 1d', flags: 64 });
  }

  const endTime = Date.now() + ms;
  let finalDesc = '';
  
    if (subtitle) {
      finalDesc += `${subtitle}\n\n`;
    }
    if (description) {
      finalDesc += `${description}\n\n`;
    }
    finalDesc += `**Prize:** ${prize}`;
    if (url) {
      finalDesc += `\n**Link:** ${url}`;
    }
    finalDesc += `\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endTime / 1000)}:R> (<t:${Math.floor(endTime / 1000)}:f>)`;
  
  
  const embed = new EmbedBuilder()
    .setTitle('🎉 GIVEAWAY 🎉')
    .setDescription(finalDesc)
    .setColor(0x00ff00)
    .setFooter({ text: `Hosted by ${interaction.user.username} • 0 entries` });

  if (image) {
    embed.setImage(image.url);
  }

  const button = new ButtonBuilder()
    .setCustomId('giveaway_enter')
    .setLabel('🎉 Enter Giveaway 🎉')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(button);

  const message = await channel.send({ embeds: [embed], components: [row] });

  const data = loadGiveaways();
  data.giveaways[message.id] = {
    channelId: channel.id,
    guildId: interaction.guild.id,
    hostId: interaction.user.id,
    prize,
    winners,
    endTime,
    entries: [],
    ended: false,
    subtitle
  };
  saveGiveaways(data);

  await interaction.reply({ content: `✅ Giveaway started in ${channel}!`, flags: 64 });
}

async function handleEnd(interaction) {
  const messageId = interaction.options.getString('message_id');
  const data = loadGiveaways();
  const giveaway = data.giveaways[messageId];

  if (!giveaway || giveaway.ended) {
    return interaction.reply({ content: '❌ Giveaway not found or already ended.', flags: 64 });
  }

  await endGiveaway(interaction.client, messageId, giveaway);
  await interaction.reply({ content: '✅ Giveaway ended!', flags: 64 });
}

async function handleReroll(interaction) {
  const messageId = interaction.options.getString('message_id');
  const data = loadGiveaways();
  const giveaway = data.giveaways[messageId];

  if (!giveaway || !giveaway.ended) {
    return interaction.reply({ content: '❌ Giveaway not found or not ended.', flags: 64 });
  }

  const winners = selectWinners(giveaway.entries, giveaway.winners);
  if (!winners.length) {
    return interaction.reply({ content: '❌ No valid entries to reroll.', flags: 64 });
  }

  const channel = interaction.client.channels.cache.get(giveaway.channelId);
  if (channel) {
    const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
    await channel.send(`🎉 **Rerolled Winners:** ${winnerMentions}\n**Prize:** ${giveaway.prize}`);
  }

  await interaction.reply({ content: '✅ Giveaway rerolled!', flags: 64 });
}

async function handleList(interaction) {
  const data = loadGiveaways();
  const activeGiveaways = Object.entries(data.giveaways)
    .filter(([id, g]) => !g.ended && g.guildId === interaction.guild.id)
    .slice(0, 10);

  if (!activeGiveaways.length) {
    return interaction.reply({ content: 'No active giveaways.', flags: 64 });
  }

  const embed = new EmbedBuilder()
    .setTitle('Active Giveaways')
    .setColor(0x00ff00);

  for (const [id, g] of activeGiveaways) {
    embed.addFields({
      name: g.prize,
      value: `**Channel:** <#${g.channelId}>\n**Ends:** <t:${Math.floor(g.endTime / 1000)}:R>\n**ID:** ${id}`,
      inline: true
    });
  }

  await interaction.reply({ embeds: [embed], flags: 64 });
}

function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return null;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}

function selectWinners(entries, count) {
  if (entries.length <= count) return [...entries];
  
  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

async function endGiveaway(client, messageId, giveaway) {
  const data = loadGiveaways();
  data.giveaways[messageId].ended = true;
  saveGiveaways(data);

  const channel = client.channels.cache.get(giveaway.channelId);
  if (!channel) return;

  const winners = selectWinners(giveaway.entries, giveaway.winners);
  
  let endDesc = '';
  if (giveaway.subtitle) {
    endDesc += `${giveaway.subtitle}\n\n`;
  }
  endDesc += `**Prize:** ${giveaway.prize}\n**Winners:** ${winners.length ? winners.map(id => `<@${id}>`).join(', ') : 'No valid entries'}\n**Entries:** ${giveaway.entries.length}\n**Hosted by:** <@${giveaway.hostId}>`;
  
  const embed = new EmbedBuilder()
    .setTitle('🎉 GIVEAWAY ENDED 🎉')
    .setDescription(endDesc)
    .setColor(0xff0000)
    .setTimestamp();

  try {
    const message = await channel.messages.fetch(messageId);
    await message.edit({ embeds: [embed], components: [] });
    
    if (winners.length) {
      await channel.send(`🎉 Congratulations ${winners.map(id => `<@${id}>`).join(', ')}! You won **${giveaway.prize}**!`);
    }
  } catch (error) {
    console.error('Error ending giveaway:', error?.message || 'Unknown error');
  }
}

async function handleButtonInteraction(interaction) {
  if (interaction.customId === 'giveaway_enter') {
    const data = loadGiveaways();
    const giveaway = data.giveaways[interaction.message.id];

    if (!giveaway || giveaway.ended) {
      return interaction.reply({ content: '❌ This giveaway has ended.', flags: 64 });
    }

    if (giveaway.entries.includes(interaction.user.id)) {
      const leaveButton = new ButtonBuilder()
        .setCustomId(`giveaway_leave_${interaction.message.id}`)
        .setLabel('Leave Giveaway')
        .setStyle(ButtonStyle.Danger);
      
      const cancelButton = new ButtonBuilder()
        .setCustomId('giveaway_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary);
      
      const row = new ActionRowBuilder().addComponents(leaveButton, cancelButton);
      
      return interaction.reply({ 
        content: 'ℹ️ You are already entered. Do you want to leave this giveaway?', 
        components: [row], 
        flags: 64 
      });
    }

    giveaway.entries.push(interaction.user.id);
    saveGiveaways(data);

    // Update embed with new entry count
    try {
      const embed = interaction.message.embeds[0];
      if (embed && embed.description) {
        const newDesc = embed.description.replace(/\*\*Entries:\*\* \d+/, `**Entries:** ${giveaway.entries.length}`);
        const newEmbed = EmbedBuilder.from(embed)
          .setDescription(newDesc)
          .setFooter({ text: `Hosted by ${interaction.client.users.cache.get(giveaway.hostId)?.username || 'Unknown'} • ${giveaway.entries.length} entries` });
        await interaction.message.edit({ embeds: [newEmbed], components: interaction.message.components });
      }
    } catch {}

    await interaction.reply({ content: '✅ You have been entered into the giveaway!', flags: 64 });
  } else if (interaction.customId.startsWith('giveaway_leave_')) {
    const messageId = interaction.customId.replace('giveaway_leave_', '');
    const data = loadGiveaways();
    const giveaway = data.giveaways[messageId];

    if (giveaway && giveaway.entries.includes(interaction.user.id)) {
      giveaway.entries = giveaway.entries.filter(id => id !== interaction.user.id);
      saveGiveaways(data);
      
      // Update embed with new entry count
      try {
        const originalMessage = await interaction.client.channels.cache.get(giveaway.channelId)?.messages.fetch(messageId);
        if (originalMessage) {
          const embed = originalMessage.embeds[0];
          if (embed && embed.description) {
            const newDesc = embed.description.replace(/\*\*Entries:\*\* \d+/, `**Entries:** ${giveaway.entries.length}`);
            const newEmbed = EmbedBuilder.from(embed)
              .setDescription(newDesc)
              .setFooter({ text: `Hosted by ${interaction.client.users.cache.get(giveaway.hostId)?.username || 'Unknown'} • ${giveaway.entries.length} entries` });
            await originalMessage.edit({ embeds: [newEmbed], components: originalMessage.components });
          }
        }
      } catch {}
      
      await interaction.update({ content: '❌ You have left the giveaway.', components: [] });
    }
  } else if (interaction.customId === 'giveaway_cancel') {
    await interaction.update({ content: '✅ Action cancelled.', components: [] });
  }
}

module.exports.handleButtonInteraction = handleButtonInteraction;
module.exports.endGiveaway = endGiveaway;