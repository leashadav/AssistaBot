const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const TICKETS_FILE = path.join(__dirname, '..', 'data', 'tickets.json');
const TRANSCRIPTS_DIR = path.join(__dirname, '..', 'data', 'transcripts');

// Ensure tickets data file and directories exist
function ensureTicketsFile() {
  try {
    if (!fs.existsSync(TICKETS_FILE)) {
      fs.writeFileSync(TICKETS_FILE, JSON.stringify({ guilds: {} }, null, 2));
    }
    if (!fs.existsSync(TRANSCRIPTS_DIR)) {
      fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
    }
  } catch (error) {
    console.error('Error ensuring tickets file:', error?.message || 'Unknown error');
  }
}

// Load tickets data
function loadTickets() {
  try {
    ensureTicketsFile();
    return JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'));
  } catch (error) {
    console.error('Error loading tickets:', error?.message || 'Unknown error');
    return { guilds: {} };
  }
}

// Save tickets data
function saveTickets(data) {
  try {
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving tickets:', error?.message || 'Unknown error');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage support tickets')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)

    .addSubcommand(sub =>
      sub.setName('panel')
        .setDescription('Create ticket panel')
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Panel title')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('description')
            .setDescription('Panel description')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('button_text')
            .setDescription('Button text')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('button_emoji')
            .setDescription('Button emoji')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('button_style')
            .setDescription('Button style')
            .setRequired(false)
            .addChoices(
              { name: 'Burple', value: 'primary' },
              { name: 'Grey', value: 'secondary' },
              { name: 'Green', value: 'success' },
              { name: 'Red', value: 'danger' }
            )))
    .addSubcommand(sub =>
      sub.setName('close')
        .setDescription('Close current ticket'))
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add user to ticket')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('User to add')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove user from ticket')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('User to remove')
            .setRequired(true)))

    .addSubcommand(sub =>
      sub.setName('transcript')
        .setDescription('Generate ticket transcript')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'panel':
        await handlePanel(interaction);
        break;
      case 'close':
        await handleClose(interaction);
        break;
      case 'add':
        await handleAdd(interaction);
        break;
      case 'remove':
        await handleRemove(interaction);
        break;
      case 'transcript':
        await handleTranscript(interaction);
        break;
    }
  }
};

async function handlePanel(interaction) {
  const guildSettings = require('../modules/guildSettings');
  const settings = guildSettings.getSettings(interaction.guild.id);

  if (!settings.supportChannelId) {
    return interaction.reply({ content: '❌ Support channel not configured. Use `/setup support` first.', flags: 64 });
  }

  const title = interaction.options.getString('title') || 'Support Tickets';
  const description = (interaction.options.getString('description') || 'Click the button below to create a support ticket.').replace(/\\n/g, '\n');
  const buttonText = interaction.options.getString('button_text') || 'Create Ticket';
  const buttonEmoji = interaction.options.getString('button_emoji') || '⁉️';
  const buttonStyleStr = interaction.options.getString('button_style') || 'secondary';
  
  const styleMap = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger
  };
  const buttonStyle = styleMap[buttonStyleStr] || ButtonStyle.Secondary;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xff6600);

  const button = new ButtonBuilder()
    .setCustomId('create_ticket')
    .setLabel(buttonText)
    .setStyle(buttonStyle)
    .setEmoji(buttonEmoji);

  const row = new ActionRowBuilder().addComponents(button);

  const webhook = await interaction.channel.createWebhook({ 
    name: interaction.client.user.username,
    avatar: interaction.client.user.displayAvatarURL()
  });
  await webhook.send({ embeds: [embed], components: [row] });
  await webhook.delete();
  await interaction.reply({ content: '✅ Ticket panel created!', flags: 64 });
}

async function handleClose(interaction) {
  const data = loadTickets();
  const guildData = data.guilds[interaction.guild.id];

  if (!guildData) {
    return interaction.reply({ content: '❌ Ticket system not configured.', flags: 64 });
  }

  // Check if this is a ticket thread
  if (!interaction.channel.isThread() || !interaction.channel.name.includes('ticket-')) {
    return interaction.reply({ content: '❌ This is not a ticket thread.', flags: 64 });
  }

  const embed = new EmbedBuilder()
    .setTitle('Close Ticket')
    .setDescription('Are you sure you want to close this ticket?')
    .setColor(0xED4245);

  const confirmButton = new ButtonBuilder()
    .setCustomId('confirm_close')
    .setLabel('Close Ticket')
    .setStyle(ButtonStyle.Danger);

  const cancelButton = new ButtonBuilder()
    .setCustomId('cancel_close')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

  await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
}

async function handleAdd(interaction) {
  const user = interaction.options.getUser('user');

  if (!interaction.channel.isThread() || !interaction.channel.name.includes('ticket-')) {
    return interaction.reply({ content: '❌ This is not a ticket thread.', flags: 64 });
  }

  try {
    await interaction.channel.members.add(user.id);
    await interaction.reply({ content: `✅ Added ${user} to the ticket.`, flags: 64 });
  } catch (error) {
    await interaction.reply({ content: '❌ Failed to add user to ticket.', flags: 64 });
  }
}

async function handleRemove(interaction) {
  const user = interaction.options.getUser('user');

  if (!interaction.channel.isThread() || !interaction.channel.name.includes('ticket-')) {
    return interaction.reply({ content: '❌ This is not a ticket thread.', flags: 64 });
  }

  try {
    await interaction.channel.members.remove(user.id);
    await interaction.reply({ content: `✅ Removed ${user} from the ticket.`, flags: 64 });
  } catch (error) {
    await interaction.reply({ content: '❌ Failed to remove user from ticket.', flags: 64 });
  }
}

async function handleTranscript(interaction) {
  if (!interaction.channel.isThread() || !interaction.channel.name.includes('ticket-')) {
    return interaction.reply({ content: '❌ This is not a ticket thread.', flags: 64 });
  }

  await interaction.deferReply({ flags: 64 });

  try {
    const messages = await interaction.channel.messages.fetch({ limit: 100 });
    const transcript = messages.reverse().map(msg => 
      `[${msg.createdAt.toISOString()}] ${msg.author.tag}: ${msg.content}`
    ).join('\n');

    const filename = `transcript-${interaction.channel.name}-${Date.now()}.txt`;
    const filepath = path.join(TRANSCRIPTS_DIR, filename);
    
    fs.writeFileSync(filepath, transcript);

    await interaction.editReply({ 
      content: '✅ Transcript generated successfully!',
      files: [{ attachment: filepath, name: filename }]
    });
  } catch (error) {
    await interaction.editReply({ content: '❌ Failed to generate transcript.' });
  }
}

// Handle button interactions
async function handleButtonInteraction(interaction) {
  if (interaction.customId === 'create_ticket') {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_priority_select')
      .setPlaceholder('Select ticket priority')
      .addOptions([
        { label: 'Low Priority', value: 'low', emoji: '🟢' },
        { label: 'Medium Priority', value: 'medium', emoji: '🟡' },
        { label: 'High Priority', value: 'high', emoji: '🔴' },
        { label: 'Urgent', value: 'urgent', emoji: '🆘' }
      ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({ content: 'Please select your ticket priority:', components: [row], flags: 64 });
  } else if (interaction.customId === 'confirm_close') {
    await closeTicket(interaction);
  } else if (interaction.customId === 'cancel_close') {
    await interaction.update({ content: '❌ Ticket close cancelled.', embeds: [], components: [] });

  } else if (interaction.customId === 'close_ticket') {
    await closeTicketButton(interaction);
  } else if (interaction.customId === 'ticket_priority_select') {
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
    
    const priority = interaction.values[0];
    
    const modal = new ModalBuilder()
      .setCustomId(`ticket_modal_${priority}`)
      .setTitle('Create Support Ticket');

    const topicInput = new TextInputBuilder()
      .setCustomId('ticket_topic')
      .setLabel('What is your ticket about?')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Please describe your issue or question...')
      .setRequired(true)
      .setMaxLength(1000);

    const row = new ActionRowBuilder().addComponents(topicInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }
}

// Handle modal interactions
async function handleModalInteraction(interaction) {
  if (interaction.customId.startsWith('ticket_modal_')) {
    const priority = interaction.customId.replace('ticket_modal_', '');
    const topic = interaction.fields.getTextInputValue('ticket_topic');
    
    await createTicket(interaction, priority, topic);
  }
}

async function createTicket(interaction, priority = 'medium', topic = null) {
  await interaction.deferReply({ flags: 64 });
  
  const guildSettings = require('../modules/guildSettings');
  const settings = guildSettings.getSettings(interaction.guild.id);

  if (!settings.supportChannelId) {
    return interaction.editReply({ content: '❌ Support channel not configured. Use `/setup tickets` first.' });
  }

  const supportChannel = interaction.guild.channels.cache.get(settings.supportChannelId);
  if (!supportChannel) {
    return interaction.editReply({ content: '❌ Support channel not found.' });
  }

  // Check if user already has a ticket thread
  const existingThread = supportChannel.threads.cache.find(
    thread => thread.name.includes(interaction.user.username.toLowerCase()) && !thread.archived
  );

  if (existingThread) {
    return interaction.editReply({ content: `❌ You already have a ticket open: ${existingThread}` });
  }

  try {
    const data = loadTickets();
    if (!data.guilds[interaction.guild.id]) {
      data.guilds[interaction.guild.id] = { counter: 0, tickets: {} };
    }
    const guildData = data.guilds[interaction.guild.id];
    guildData.counter = (guildData.counter || 0) + 1;
    if (!guildData.tickets) guildData.tickets = {};
    
    const priorityEmojis = { low: '🟢', medium: '🟡', high: '🔴', urgent: '🆘' };
    const priorityColors = { low: 0x57F287, medium: 0xFEE75C, high: 0xED4245, urgent: 0x992D22 };
    
    const ticketThread = await supportChannel.threads.create({
      name: `${priorityEmojis[priority]} ticket-${interaction.user.username.toLowerCase()}-${guildData.counter}`,
      type: ChannelType.PrivateThread,
      invitable: false
    });

    await ticketThread.members.add(interaction.user.id);
    
    // Add support role members to thread
    if (settings.supportRoleId) {
      const supportRole = interaction.guild.roles.cache.get(settings.supportRoleId);
      if (supportRole) {
        for (const member of supportRole.members.values()) {
          try {
            await ticketThread.members.add(member.id);
          } catch (error) {
            console.log(`Failed to add ${member.user.tag} to ticket thread`);
          }
        }
      }
    }

    guildData.tickets[ticketThread.id] = {
      userId: interaction.user.id,
      priority: priority,
      createdAt: Date.now(),
      number: guildData.counter
    };
    saveTickets(data);

    const embed = new EmbedBuilder()
      .setTitle(`${priorityEmojis[priority]} Ticket #${guildData.counter}`)
      .setDescription(`Hello ${interaction.user}, support will be with you shortly.\n\n${topic ? `**Topic:** ${topic}\n\n` : ''}**Priority:** ${priority.charAt(0).toUpperCase() + priority.slice(1)}`)
      .setColor(priorityColors[priority])
      .setTimestamp();

    const closeButton = new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒');

    const row = new ActionRowBuilder().addComponents(closeButton);

    await ticketThread.send({ content: `${interaction.user}`, embeds: [embed], components: [row] });

    // Log ticket creation
    const logger = require('../modules/logger');
    logger.logTicketCreation(ticketThread, interaction.client);

    await interaction.editReply({ content: `✅ Ticket created: ${ticketThread}` });
  } catch (error) {
    console.error('Error creating ticket:', error);
    await interaction.editReply({ content: '❌ Failed to create ticket.' });
  }
}

async function closeTicketButton(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('Close Ticket')
    .setDescription('Are you sure you want to close this ticket?')
    .setColor(0xED4245);

  const confirmButton = new ButtonBuilder()
    .setCustomId('confirm_close')
    .setLabel('Close Ticket')
    .setStyle(ButtonStyle.Danger);

  const cancelButton = new ButtonBuilder()
    .setCustomId('cancel_close')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

  await interaction.reply({ embeds: [embed], components: [row], flags: 64 });
}

async function closeTicket(interaction) {
  try {
    await interaction.update({ content: `🔒 Ticket closed by ${interaction.user}`, embeds: [], components: [] });
    
    // Log ticket closure
    const logger = require('../modules/logger');
    logger.logTicketClosed(interaction.channel, interaction.client, interaction.user);
    
    setTimeout(async () => {
      await interaction.channel.setArchived(true, `Ticket closed by ${interaction.user.tag}`);
    }, 3000);
  } catch (error) {
    console.error('Error closing ticket:', error);
  }
}

// Export handlers for use in main bot file
module.exports.handleButtonInteraction = handleButtonInteraction;
module.exports.handleModalInteraction = handleModalInteraction;