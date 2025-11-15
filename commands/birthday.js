const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const birthdayManager = require('../modules/birthdayManager');
const guildSettings = require('../modules/guildSettings');

// Helper function to get guild-specific embed color
function getEmbedColor(guildId) {
  try {
    const settings = guildSettings.getSettings(guildId);
    const raw = settings?.embedColor;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw >>> 0; // ensure uint32
    } else if (typeof raw === 'string' && raw.trim()) {
      let s = raw.trim();
      if (s.startsWith('#')) s = s.slice(1);
      const n = parseInt(s, 16);
      if (!Number.isNaN(n)) return n >>> 0;
    }
  } catch (error) {
    console.error('Error getting embed color:', error);
  }
  return 0xff6600; // Default birthday color
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Manage birthdays <:happybirthday:1410103531360354406>')
    .setDMPermission(false)
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add your birthday')
      .addStringOption(opt => opt
        .setName('month')
        .setDescription('Birth month (01-12)')
        .setRequired(true))
      .addStringOption(opt => opt
        .setName('day')
        .setDescription('Birth day (01-31)')
        .setRequired(true))
      .addStringOption(opt => opt
        .setName('year')
        .setDescription('Birth year (optional, 4 digits e.g., 1990)')
        .setRequired(false)))
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('Remove your birthday'))
    .addSubcommand(sub => sub
      .setName('adduser')
      .setDescription('Add a birthday for another user (Admin only)')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User to set birthday for')
        .setRequired(true))
      .addStringOption(opt => opt
        .setName('month')
        .setDescription('Birth month (01-12)')
        .setRequired(true))
      .addStringOption(opt => opt
        .setName('day')
        .setDescription('Birth day (01-31)')
        .setRequired(true))
      .addStringOption(opt => opt
        .setName('year')
        .setDescription('Birth year (optional, 4 digits e.g., 1990)')
        .setRequired(false)))
    .addSubcommand(sub => sub
      .setName('deleteuser')
      .setDescription('Remove a birthday for another user (Admin only)')
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User whose birthday to remove')
        .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all birthdays'))
    .addSubcommand(sub => sub
      .setName('config')
      .setDescription('Configure birthday settings (Admin only)')
      .addStringOption(opt => opt
        .setName('action')
        .setDescription('Choose an action')
        .setRequired(true)
        .addChoices(
          { name: 'View Settings', value: 'view' },
          { name: 'Set Settings', value: 'set' }
        ))
      .addChannelOption(opt => opt
        .setName('channel')
        .setDescription('Channel for birthday announcements')
        .setRequired(false))
      .addRoleOption(opt => opt
        .setName('role')
        .setDescription('Role to assign on birthdays')
        .setRequired(false))
      .addStringOption(opt => opt
        .setName('message')
        .setDescription('Custom birthday message template (use ${ageText} and ${userId} placeholders)')
        .setRequired(false))),
    
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'config') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ 
          content: '❌ You do not have permission to use this command.', 
          flags: MessageFlags.Ephemeral 
        });
      }

      const action = interaction.options.getString('action');

      if (action === 'view') {
        const currentSettings = guildSettings.getSettings(interaction.guild.id);
        const birthdayInfo = currentSettings.birthdayInfo || {};
        
        let response = '**<:happybirthday:1410103531360354406> Current Birthday Settings**\n\n';
        
        // Birthday channel
        response += `<:bullhorn:1410103150815219743> **Announcement Channel:** ${birthdayInfo.birthdayChannel ? `<#${birthdayInfo.birthdayChannel}>` : 'Not set'}\n`;
        
        // Birthday role
        response += `🎖️ **Birthday Role:** ${birthdayInfo.birthdayRole ? `<@&${birthdayInfo.birthdayRole}>` : 'Not set'}\n`;
        
        // Birthday message
        response += `💬 **Custom Message:** ${birthdayInfo.message || 'Using default message'}\n\n`;
        
        // Show default message
        response += `**Default Message Template:**\n`;
        response += `<:happybirthday:1410064532398805152> Happy \${ageText}Birthday <@\${userId}>!\n\n`;
        
        // Show placeholders info
        response += `**Available Placeholders:**\n`;
        response += `• \${ageText} - Age with space (e.g., "18th", "21st")\n`;
        response += `• \${userId} - User ID for mentions\n\n`;
        
        // Show current birthdays count
        const birthdays = birthdayManager.getGuildBirthdays(interaction.guild.id);
        const birthdayArray = Object.entries(birthdays).map(([userId, date]) => ({ userId, date }));
        response += `**Total Birthdays Set:** ${birthdayArray.length}\n`;
        
        // Show upcoming birthdays (next 7 days)
        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentDay = today.getDate();
        
        const upcomingBirthdays = birthdayArray.filter(b => {
          const [month, day] = b.date.split('/').map(Number);
          if (month === currentMonth && day >= currentDay && day <= currentDay + 7) {
            return true;
          }
          if (month === currentMonth + 1 || (currentMonth === 12 && month === 1)) {
            return day <= (7 - (31 - currentDay));
          }
          return false;
        });
        
        if (upcomingBirthdays.length > 0) {
          response += `**Upcoming Birthdays (Next 7 Days):**\n`;
          upcomingBirthdays.forEach(b => {
            const user = interaction.client.users.cache.get(b.userId);
            const username = user ? user.username : `User ${b.userId}`;
            response += `• **${b.date}** - ${username}\n`;
          });
        }
        
        return interaction.reply({ 
          content: response, 
          flags: MessageFlags.Ephemeral 
        });
      }

      if (action === 'set') {
        const channel = interaction.options.getChannel('channel');
        const role = interaction.options.getRole('role');
        const message = interaction.options.getString('message');

        // Handle setting options (if any are provided)
        if (channel || role || message) {
          // Update only the provided options
          const currentSettings = guildSettings.getSettings(interaction.guild.id);
          const birthdayInfo = currentSettings.birthdayInfo || {};
          const updates = { birthdayInfo: { ...birthdayInfo } };
          
          if (channel) updates.birthdayInfo.birthdayChannel = channel.id;
          if (role) updates.birthdayInfo.birthdayRole = role.id;
          if (message) updates.birthdayInfo.message = message;

          try {
            guildSettings.updateSettings(interaction.guild.id, updates);
            
            let response = '✔️ Birthday settings updated!\n';
            if (channel) response += `<:bullhorn:1410103150815219743> **Channel:** ${channel}\n`;
            if (role) response += `🎖️ **Role:** ${role}\n`;
            if (message) response += `💬 **Message:** ${message}\n`;
            
            return interaction.reply({ 
              content: response, 
              flags: MessageFlags.Ephemeral 
            });
          } catch (error) {
            console.error('Error updating birthday settings:', error);
            return interaction.reply({ 
              content: '❌ Failed to update birthday settings.', 
              flags: MessageFlags.Ephemeral 
            });
          }
        }

        // If no options provided, show current settings
        const currentSettings = guildSettings.getSettings(interaction.guild.id);
        const birthdayInfo = currentSettings.birthdayInfo || {};
        
        let response = '**<:happybirthday:1410103531360354406> Current Birthday Settings**\n\n';
        
        // Birthday channel
        response += `<:bullhorn:1410103150815219743> **Announcement Channel:** ${birthdayInfo.birthdayChannel ? `<#${birthdayInfo.birthdayChannel}>` : 'Not set'}\n`;
        
        // Birthday role
        response += `🎖️ **Birthday Role:** ${birthdayInfo.birthdayRole ? `<@&${birthdayInfo.birthdayRole}>` : 'Not set'}\n`;
        
        // Birthday message
        response += `💬 **Custom Message:** ${birthdayInfo.message || 'Using default message'}\n\n`;
        
        // Show default message
        response += `**Default Message Template:**\n`;
        response += `<:happybirthday:1410064532398805152> Happy \${ageText}Birthday <@\${userId}>!\n\n`;
        
        // Show placeholders info
        response += `**Available Placeholders:**\n`;
        response += `• \${ageText} - Age with space (e.g., "18th", "21st")\n`;
        response += `• \${userId} - User ID for mentions\n\n`;
        
        // Show current birthdays count
        const birthdays = birthdayManager.getGuildBirthdays(interaction.guild.id);
        const birthdayArray = Object.entries(birthdays).map(([userId, date]) => ({ userId, date }));
        response += `**Total Birthdays Set:** ${birthdayArray.length}\n`;
        
        // Show upcoming birthdays (next 7 days)
        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentDay = today.getDate();
        
        const upcomingBirthdays = birthdayArray.filter(b => {
          const [month, day] = b.date.split('/').map(Number);
          if (month === currentMonth && day >= currentDay && day <= currentDay + 7) {
            return true;
          }
          if (month === currentMonth + 1 || (currentMonth === 12 && month === 1)) {
            return day <= (7 - (31 - currentDay));
          }
          return false;
        });
        
        if (upcomingBirthdays.length > 0) {
          response += `**Upcoming Birthdays (Next 7 Days):**\n`;
          upcomingBirthdays.forEach(b => {
            const user = interaction.client.users.cache.get(b.userId);
            const username = user ? user.username : `User ${b.userId}`;
            response += `• **${b.date}** - ${username}\n`;
          });
        }
        
        return interaction.reply({ 
          content: response, 
          flags: MessageFlags.Ephemeral 
        });
      }
    }

    if (sub === 'add') {
      const month = interaction.options.getString('month');
      const day = interaction.options.getString('day');
      const year = interaction.options.getString('year');
      
      // Validate month (01-12)
      if (!/^(0[1-9]|1[0-2])$/.test(month)) {
        return interaction.reply({ 
          content: '❌ Month must be 2 digits (01-12)', 
          flags: MessageFlags.Ephemeral 
        });
      }
      
      // Validate day (01-31)
      if (!/^(0[1-9]|[12][0-9]|3[01])$/.test(day)) {
        return interaction.reply({ 
          content: '❌ Day must be 2 digits (01-31)', 
          flags: MessageFlags.Ephemeral 
        });
      }
      
      // Validate year if provided (4 digits)
      if (year) {
        if (!/^\d{4}$/.test(year)) {
          return interaction.reply({ 
            content: '❌ Year must be 4 digits (e.g., 1990)', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const yearNum = parseInt(year);
        const currentYear = new Date().getFullYear();
        if (yearNum < 1900 || yearNum > currentYear) {
          return interaction.reply({ 
            content: `❌ Year must be between 1900 and ${currentYear}`, 
            flags: MessageFlags.Ephemeral 
          });
        }
      }
      
      // Format the date string (no padding needed since input is already 2 digits)
      const date = year ? `${month}/${day}/${year}` : `${month}/${day}`;

      try {
        birthdayManager.setBirthday(interaction.guild.id, interaction.user.id, date);
        return interaction.reply({ 
          content: `✔️ Birthday set to ${date}!`, 
          flags: MessageFlags.Ephemeral 
        });
      } catch (error) {
        console.error('Error setting birthday:', error);
        return interaction.reply({ 
          content: '❌ Failed to set birthday.', 
          flags: MessageFlags.Ephemeral 
        });
      }
    }

    if (sub === 'delete') {
      try {
        birthdayManager.deleteBirthday(interaction.guild.id, interaction.user.id);
        return interaction.reply({ 
          content: '✔️ Birthday removed!', 
          flags: MessageFlags.Ephemeral 
        });
      } catch (error) {
        console.error('Error removing birthday:', error);
        return interaction.reply({ 
          content: '❌ Failed to remove birthday.', 
          flags: MessageFlags.Ephemeral 
        });
      }
    }

    if (sub === 'adduser') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ 
          content: '❌ You do not have permission to use this command.', 
          flags: MessageFlags.Ephemeral 
        });
      }

      const user = interaction.options.getUser('user');
      const month = interaction.options.getString('month');
      const day = interaction.options.getString('day');
      const year = interaction.options.getString('year');
      
      // Validate month (01-12)
      if (!/^(0[1-9]|1[0-2])$/.test(month)) {
        return interaction.reply({ 
          content: '❌ Month must be 2 digits (01-12)', 
          flags: MessageFlags.Ephemeral 
        });
      }
      
      // Validate day (01-31)
      if (!/^(0[1-9]|[12][0-9]|3[01])$/.test(day)) {
        return interaction.reply({ 
          content: '❌ Day must be 2 digits (01-31)', 
          flags: MessageFlags.Ephemeral 
        });
      }
      
      // Validate year if provided (4 digits)
      if (year) {
        if (!/^\d{4}$/.test(year)) {
          return interaction.reply({ 
            content: '❌ Year must be 4 digits (e.g., 1990)', 
            flags: MessageFlags.Ephemeral 
          });
        }
        
        const yearNum = parseInt(year);
        const currentYear = new Date().getFullYear();
        if (yearNum < 1900 || yearNum > currentYear) {
          return interaction.reply({ 
            content: `❌ Year must be between 1900 and ${currentYear}`, 
            flags: MessageFlags.Ephemeral 
          });
        }
      }
      
      // Format the date string (no padding needed since input is already 2 digits)
      const date = year ? `${month}/${day}/${year}` : `${month}/${day}`;

      try {
        birthdayManager.setBirthday(interaction.guild.id, user.id, date);
        return interaction.reply({ 
          content: `✔️ Birthday set to ${date} for ${user.username}!`, 
          flags: MessageFlags.Ephemeral 
        });
      } catch (error) {
        console.error('Error setting birthday:', error);
        return interaction.reply({ 
          content: '❌ Failed to set birthday.', 
          flags: MessageFlags.Ephemeral 
        });
      }
    }

    if (sub === 'deleteuser') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ 
          content: '❌ You do not have permission to use this command.', 
          flags: MessageFlags.Ephemeral 
        });
      }

      const user = interaction.options.getUser('user');

      try {
        birthdayManager.deleteBirthday(interaction.guild.id, user.id);
        return interaction.reply({ 
          content: `✔️ Birthday removed for ${user}!`, 
          flags: MessageFlags.Ephemeral 
        });
      } catch (error) {
        console.error('Error removing user birthday:', error);
        return interaction.reply({ 
          content: '❌ Failed to remove birthday.', 
          flags: MessageFlags.Ephemeral 
        });
      }
    }

    if (sub === 'list') {
      try {
        const birthdays = birthdayManager.getGuildBirthdays(interaction.guild.id);
        const birthdayArray = Object.entries(birthdays).map(([userId, date]) => ({ userId, date }));
        
        if (birthdayArray.length === 0) {
          return interaction.reply({ 
            content: 'No birthdays set yet!', 
            flags: MessageFlags.Ephemeral 
          });
        }

        // Sort by month, day, then year (no year = earliest)
        birthdayArray.sort((a, b) => {
          const aParts = a.date.split('/').map(Number);
          const bParts = b.date.split('/').map(Number);
          
          // Handle different formats (MM/DD vs MM/DD/YYYY)
          const aMonth = aParts[0];
          const aDay = aParts[1];
          const aYear = aParts.length === 3 ? aParts[2] : 0; // No year = 0 for sorting
          
          const bMonth = bParts[0];
          const bDay = bParts[1];
          const bYear = bParts.length === 3 ? bParts[2] : 0; // No year = 0 for sorting
          
          // Sort by month first
          if (aMonth !== bMonth) return aMonth - bMonth;
          // Then by day
          if (aDay !== bDay) return aDay - bDay;
          // Finally by year (no year comes first)
          return aYear - bYear;
        });

        // Create 12 monthly pages
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
        const pages = [];
        
        for (let month = 1; month <= 12; month++) {
          const monthBirthdays = birthdayArray.filter(b => {
            const [bMonth, _] = b.date.split('/').map(Number);
            return bMonth === month;
          });
          
          const pageContent = monthBirthdays.map(b => {
            const user = interaction.client.users.cache.get(b.userId);
            const member = interaction.guild.members.cache.get(b.userId);
            
            let displayName;
            if (member) {
              // User is in the guild: use nickname first, then display name
              displayName = member.nickname || user?.displayName || user?.username || user?.globalName || user?.tag || `User ${b.userId}`;
            } else if (user) {
              // User is not in guild but we have their user object: use global display name
              displayName = user.displayName || user.username || user.globalName || user.tag || `User ${b.userId}`;
            } else {
              // User not found in any cache
              displayName = `User ${b.userId}`;
            }
            
            const hasYear = b.date.split('/').length === 3;
            const ageText = hasYear ? new Date().getFullYear() - parseInt(b.date.split('/')[2]) : null;
            const ageDisplay = ageText ? ` (${ageText})` : '';
            return `**🔸${displayName}${ageDisplay}** ${b.date}`;
          }).join('\n') || 'No birthdays this month';
          
          pages.push({
            title: `<:happybirthday:1410064532398805152> ${monthNames[month - 1]} Birthdays`,
            description: pageContent,
            color: getEmbedColor(interaction.guild.id),
            footer: { text: `Page ${month}/12 • Total: ${birthdayArray.length} birthdays` }
          });
        }

        // Function to create embed with current page
        const createEmbed = (pageIndex) => {
          const embed = { ...pages[pageIndex] };
          embed.footer = { text: `Page ${pageIndex + 1}/12 • Total: ${birthdayArray.length} birthdays` };
          return embed;
        };

        // Create navigation buttons
        const createButtons = (currentPage) => [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 2,
                custom_id: 'prev',
                label: '◀️'
              },
              {
                type: 2,
                style: 2,
                custom_id: 'next',
                label: '▶️'
              },
              {
                type: 2,
                style: 2,
                custom_id: 'refresh',
                label: '🔄',
                disabled: false
              },              
            ]
          }
        ];

        // Send initial message
        const { msg } = await interaction.reply({ 
          embeds: [createEmbed(0)], 
          components: createButtons(0),
          withResponse: true
        });

        // Create persistent collector (no timeout)
        const collector = interaction.channel.createMessageComponentCollector();

        collector.on('collect', async (i) => {
          let currentPage = 0;
          
          // Get current page from the existing embed
          const currentEmbed = i.message.embeds[0];
          if (currentEmbed && currentEmbed.footer) {
            const match = currentEmbed.footer.text.match(/Page (\d+)\/12/);
            if (match) {
              currentPage = parseInt(match[1]) - 1;
            }
          }

          if (i.customId === 'prev') {
            currentPage = currentPage > 0 ? currentPage - 1 : 11;
          } else if (i.customId === 'next') {
            currentPage = currentPage < 11 ? currentPage + 1 : 0;
          } else if (i.customId === 'refresh') {
            // Refresh data for current month
            const refreshedBirthdays = birthdayManager.getGuildBirthdays(interaction.guild.id);
            const refreshedArray = Object.entries(refreshedBirthdays).map(([userId, date]) => ({ userId, date }));
            refreshedArray.sort((a, b) => {
              const aParts = a.date.split('/').map(Number);
              const bParts = b.date.split('/').map(Number);
              
              // Handle different formats (MM/DD vs MM/DD/YYYY)
              const aMonth = aParts[0];
              const aDay = aParts[1];
              const aYear = aParts.length === 3 ? aParts[2] : 0; // No year = 0 for sorting
              
              const bMonth = bParts[0];
              const bDay = bParts[1];
              const bYear = bParts.length === 3 ? bParts[2] : 0; // No year = 0 for sorting
              
              // Sort by month first
              if (aMonth !== bMonth) return aMonth - bMonth;
              // Then by day
              if (aDay !== bDay) return aDay - bDay;
              // Finally by year (no year comes first)
              return aYear - bYear;
            });

            // Update the page with refreshed data
            const month = currentPage + 1;
            const monthBirthdays = refreshedArray.filter(b => {
              const [bMonth, _] = b.date.split('/').map(Number);
              return bMonth === month;
            });
            
            const pageContent = monthBirthdays.map(b => {
              const user = interaction.client.users.cache.get(b.userId);
              const member = interaction.guild.members.cache.get(b.userId);
              
              let displayName;
              if (member) {
                // User is in the guild: use nickname first, then display name
                displayName = member.nickname || user?.displayName || user?.username || user?.globalName || user?.tag || `User ${b.userId}`;
              } else if (user) {
                // User is not in guild but we have their user object: use global display name
                displayName = user.displayName || user.username || user.globalName || user.tag || `User ${b.userId}`;
              } else {
                // User not found in any cache
                displayName = `User ${b.userId}`;
              }
              
              const hasYear = b.date.split('/').length === 3;
              const ageText = hasYear ? new Date().getFullYear() - parseInt(b.date.split('/')[2]) : null;
              const ageDisplay = ageText ? ` (${ageText})` : '';
              return `**🔸${displayName}${ageDisplay}** ${b.date}`;
            }).join('\n') || 'No birthdays this month';
            
            pages[currentPage].description = pageContent;
            pages[currentPage].footer = { text: `Page ${currentPage + 1}/12 • Total: ${refreshedArray.length} birthdays` };
            
            return await i.update({ embeds: [pages[currentPage]], components: createButtons(currentPage) });
          }

          await i.update({ embeds: [createEmbed(currentPage)], components: createButtons(currentPage) });
        });

      } catch (error) {
        console.error('Error listing birthdays:', error);
        return interaction.reply({ 
          content: '❌ Failed to list birthdays.', 
          flags: MessageFlags.Ephemeral 
        });
      }
    }

  }
};
