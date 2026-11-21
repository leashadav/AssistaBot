const { getGuildBirthdays } = require('../modules/birthdayManager');
const branding = require('../modules/configLoader').load('branding');
const { getCurrentYearInTimezone } = require('../utils/timezone');

// Helper function to format birthday data for display
function formatBirthdays(birthdays, month, interaction) {
    const monthBirthdays = birthdays.filter(b => {
        const [bMonth] = b.date.split('/').map(Number);
        return bMonth === month;
    });
    
    return monthBirthdays.map(b => {
        const user = interaction.client.users.cache.get(b.userId);
        const member = interaction.guild?.members.cache.get(b.userId);
        let displayName = `User ${b.userId}`;
        
        if (member) {
            displayName = member.nickname || user?.displayName || user?.username || user?.globalName || displayName;
        } else if (user) {
            displayName = user.displayName || user.username || user.globalName || displayName;
        }
        
        const hasYear = b.date.split('/').length === 3;
        const ageText = hasYear ? getCurrentYearInTimezone() - parseInt(b.date.split('/')[2]) : null;
        const ageDisplay = ageText ? ` (${ageText})` : '';
        return `**🔸${displayName}${ageDisplay}** ${b.date}`;
    }).join('\n') || 'No birthdays this month';
}

module.exports = {
    handleBirthdayListInteraction: async function(interaction) {
        try {
            // Parse customId: birthday_action_messageId or birthday_action (for backwards compatibility)
            const parts = interaction.customId.split('_');
            const action = parts[0]; // prev, next, or refresh
            const messageId = parts[1] || interaction.message.id; // Use message ID for persistence
            
            // Get the current page from the embed footer
            let currentPage = 0;
            const currentEmbed = interaction.message.embeds[0];
            if (currentEmbed?.footer?.text) {
                const match = currentEmbed.footer.text.match(/Page (\d+)\/12/);
                if (match) currentPage = parseInt(match[1]) - 1;
            }

            // Handle pagination
            if (action === 'prev') {
                currentPage = currentPage > 0 ? currentPage - 1 : 11;
            } else if (action === 'next') {
                currentPage = currentPage < 11 ? currentPage + 1 : 0;
            }
            
            // Always refresh data to ensure it's up to date
            const birthdays = getGuildBirthdays(interaction.guild.id);
            const birthdayArray = Object.entries(birthdays).map(([userId, date]) => ({ userId, date }));
            
            // Sort the data
            birthdayArray.sort((a, b) => {
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

            // Format the page content
            const pageContent = formatBirthdays(birthdayArray, currentPage + 1, interaction);
            
            // Update the page with content
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                              'July', 'August', 'September', 'October', 'November', 'December'];
            
            const embed = {
                title: `${branding.birthdayEmoji || '🎂'} ${monthNames[currentPage]} Birthdays`,
                description: pageContent,
                color: 0xff6600, // Default color
                footer: { text: `Page ${currentPage + 1}/12 • Total: ${birthdayArray.length} birthdays` }
            };
            
            // Recreate buttons with message-specific IDs
            const buttons = [{
                type: 1,
                components: [
                    { type: 2, style: 2, custom_id: `prev_${messageId}`, label: '◀️' },
                    { type: 2, style: 2, custom_id: `next_${messageId}`, label: '▶️' },
                    { type: 2, style: 2, custom_id: `refresh_${messageId}`, label: '🔄' }
                ]
            }];
            
            return interaction.update({ embeds: [embed], components: buttons });

        } catch (error) {
            console.error('Error handling birthday list button:', error);
            if (!interaction.replied && !interaction.deferred) {
                return interaction.reply({ 
              content: '❌ An error occurred while processing this button.',
              flags: 'Ephemeral'
            });
            }
            try {
                return interaction.update({ content: '❌ An error occurred while processing this button.', components: [] });
            } catch (e) {
                // Ignore
            }
        }
    }
};
