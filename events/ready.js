const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType } = require('discord.js');
const { sendLog } = require('../modules/logger');
const { initInvites } = require('../modules/inviteTracker');
const booster = require('../modules/booster');
const branding = require('../modules/configLoader').load('branding');
const { getCurrentYearInTimezone } = require('../utils/timezone');

// Only log errors
const DEBUG = false;

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    booster.startRenewalMonitor(client);

    // Helper function to create navigation buttons
    function createButtons(currentPage) {
      return [
        new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('prev')
              .setLabel('◀️')
              .setStyle(currentPage === 0 ? ButtonStyle.Secondary : ButtonStyle.Primary)
              .setDisabled(currentPage === 0),
            new ButtonBuilder()
              .setCustomId('refresh')
              .setLabel('🔄')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(false),
            new ButtonBuilder()
              .setCustomId('next')
              .setLabel('▶️')
              .setStyle(currentPage === 11 ? ButtonStyle.Secondary : ButtonStyle.Primary)
              .setDisabled(currentPage === 11)
          )
      ];
    }

    // Set initial presence with custom status
    setTimeout(() => {
      try {
        client.user.setPresence({
          activities: [{
            name: 'Custom Status',
            type: ActivityType.Custom,
            state: branding.statusText || 'Keeping the community running'
          }],
          status: 'online'
        });
      } catch (error) {
        console.error('Failed to set presence:', error);
      }
    }, 5000); // 5 second delay

    // Log bot info to file only
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${new Date().toISOString()}] Bot ready: ${client.user.tag} (${client.guilds.cache.size} guilds)`);
    }

    // Restore persistent collectors after restart
    if (!client.persistentCollectors) client.persistentCollectors = new Map();
    
    // Wait a bit for guilds to be ready
    setTimeout(async () => {
      for (const [messageId, collectorData] of client.persistentCollectors) {
        try {
          const channel = client.channels.cache.get(collectorData.channelId);
          if (!channel) continue;
          
          const message = await channel.messages.fetch(messageId).catch(() => null);
          if (!message) continue;
          
          // Recreate collector with stored data
          const collector = message.createMessageComponentCollector();
          
          collector.on('collect', async (i) => {
            try {
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
                const birthdayManager = require('../modules/birthdayManager');
                const refreshedBirthdays = birthdayManager.getGuildBirthdays(collectorData.guildId);
                const refreshedArray = Object.entries(refreshedBirthdays).map(([userId, date]) => ({ userId, date }));
                refreshedArray.sort((a, b) => {
                  const aParts = a.date.split('/').map(Number);
                  const bParts = b.date.split('/').map(Number);
                  
                  const aMonth = aParts[0];
                  const aDay = aParts[1];
                  const aYear = aParts.length === 3 ? aParts[2] : 0;
                  
                  const bMonth = bParts[0];
                  const bDay = bParts[1];
                  const bYear = bParts.length === 3 ? bParts[2] : 0;
                  
                  if (aMonth !== bMonth) return aMonth - bMonth;
                  if (aDay !== bDay) return aDay - bDay;
                  return aYear - bYear;
                });

                // Update the page with refreshed data
                const month = currentPage + 1;
                const monthBirthdays = refreshedArray.filter(b => {
                  const [bMonth, _] = b.date.split('/').map(Number);
                  return bMonth === month;
                });
                
                const pageContent = monthBirthdays.map(b => {
                  const user = i.client.users.cache.get(b.userId);
                  const member = i.guild.members.cache.get(b.userId);
                  
                  let displayName;
                  if (member) {
                    displayName = member.nickname || user?.displayName || user?.username || user?.globalName || user?.tag || `User ${b.userId}`;
                  } else if (user) {
                    displayName = user.displayName || user.username || user.globalName || user.tag || `User ${b.userId}`;
                  } else {
                    displayName = `User ${b.userId}`;
                  }
                  
                  const hasYear = b.date.split('/').length === 3;
                  let ageDisplay = '';
                  if (hasYear) {
                    const birthYear = parseInt(b.date.split('/')[2]);
                    const currentYear = getCurrentYearInTimezone();
                    const age = currentYear - birthYear;
                    ageDisplay = ` (${age})`;
                  }
                  return `**🔸${displayName}${ageDisplay}** ${b.date}`;
                }).join('\n') || 'No birthdays this month';
                
                collectorData.pages[currentPage].description = pageContent;
                collectorData.pages[currentPage].footer = { text: `Page ${currentPage + 1}/12 • Total: ${refreshedArray.length} birthdays` };
                
                return await i.update({ embeds: [collectorData.pages[currentPage]], components: createButtons(currentPage) });
              }

              await i.update({ embeds: [collectorData.pages[currentPage]], components: createButtons(currentPage) });
            } catch (error) {
              console.error('Error handling button interaction:', error);
            }
          });
          
          console.log(`Restored collector for message ${messageId}`);
        } catch (error) {
          console.error(`Failed to restore collector for message ${messageId}:`, error);
        }
      }
    }, 5000); // Wait 5 seconds for full startup

    const base = `${client.user} is now online`;
    const tasks = [];
    for (const [gid] of client.guilds.cache) {
      // Log startup only to assistabotLogging
      tasks.push(sendLog(client, gid, 'assistabotLogging', base, null, null, 'Bot Status'));
    }
    await Promise.allSettled(tasks);

    try {
      // Initialize invite tracking
      await initInvites(client);
      
      // Start periodic checks for birthday role management
      const { startPeriodicChecks } = require('../modules/birthdayManager');
      startPeriodicChecks(client);
      
      // Initialize Rumble monitoring
      try {
        const RumbleBot = require('../modules/rumbleBot');
        const rumbleBot = new RumbleBot(client);
        client.rumbleBot = rumbleBot;
        
        // Start monitoring with 5-minute interval
        rumbleBot.startMonitoring(5 * 60 * 1000);
      } catch (error) {
        console.error('[Rumble] Failed to initialize Rumble monitoring:', error.message);
      }
      
    } catch (error) {
      console.error('Error initializing services:', error);
      // Try to continue even if initialization fails
    }
    
    console.log('Bot initialization complete');
  }
};