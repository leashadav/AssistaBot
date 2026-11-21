const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const guildSettings = require('../modules/guildSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Get information about this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({ 
          content: '❌ This command can only be used in a server.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (!interaction.guild.available) {
        return interaction.reply({ 
          content: '❌ Server information is currently unavailable.',
          flags: MessageFlags.Ephemeral
        });
      }

      const { guild } = interaction;
      const createdAt = Math.round(guild.createdTimestamp / 1000);
      
      // Try to get complete guild data including description
      const fullGuild = await interaction.client.guilds.fetch(guild.id, { force: true }).catch(() => guild);
      const serverDescription = fullGuild.description || 'No description set';

      const settings = guildSettings.getSettings(guild.id);
      const embedColor = settings.embedColor ? settings.embedColor.replace('0x', '#') : '#ff6600';

      const featuresText = guild.features.length > 0 ? guild.features.map(f => `• ${f.replace(/_/g, ' ').toLowerCase()}`).join('\n') : 'None';

      const serverEmbed = new EmbedBuilder()
        .setAuthor({ name: `${guild.name} Server Information`, iconURL: guild.iconURL({ dynamic: true, size: 256 }) })
        .setDescription(`**Description:** ${serverDescription}`)
        .addFields(
          { name: '🆔 Server ID', value: guild.id, inline: false },
          { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: false },
          { name: '📅 Created', value: `<t:${createdAt}:D> (<t:${createdAt}:R>)`, inline: false },
          { name: '👥 Members', value: guild.members.cache.filter(m => !m.user.bot).size.toLocaleString(), inline: true },
          { name: '🤖 Bots', value: guild.members.cache.filter(m => m.user.bot).size.toString(), inline: true },
          { name: '⚠️ Spam Accounts', value: guild.members.cache.filter(m => !m.user.bot && m.user.createdTimestamp > Date.now() - 7 * 24 * 60 * 60 * 1000).size.toString(), inline: true },
          { name: '🎭 Roles', value: (guild.roles.cache.size - 1).toString(), inline: true },
          { name: '📺 Channels', value: guild.channels.cache.size.toString() + ' total', inline: true },
          { name: '\u200b', value: '\u200b', inline: true },
          { name: '🚀 Boost Level', value: guild.premiumTier.toString(), inline: true },
          { name: '💎 Boosts', value: (guild.premiumSubscriptionCount || 0).toString(), inline: true },
          { name: '\u200b', value: '\u200b', inline: true }          
        );

        // Calculate emoji and sticker limits based on boost level
        const boostLevel = guild.premiumTier;
        let regularEmojiLimit = 50;
        let animatedEmojiLimit = 50;
        let stickerLimit = 5; // 5 free slots without boosts
        
        switch (boostLevel) {
          case 1: // Level 1
            regularEmojiLimit = 100;
            animatedEmojiLimit = 100;
            stickerLimit = 15;
            break;
          case 2: // Level 2
            regularEmojiLimit = 150;
            animatedEmojiLimit = 150;
            stickerLimit = 30;
            break;
          case 3: // Level 3
            regularEmojiLimit = 250;
            animatedEmojiLimit = 250;
            stickerLimit = 60;
            break;
        }

        const regularEmojis = guild.emojis.cache.filter(e => !e.animated).size;
        const animatedEmojis = guild.emojis.cache.filter(e => e.animated).size;
        const totalEmojis = regularEmojis + animatedEmojis;
        
        // Calculate usable counts based on separate limits
        const usableRegular = Math.min(regularEmojis, regularEmojiLimit);
        const usableAnimated = Math.min(animatedEmojis, animatedEmojiLimit);
        const totalUsableEmojis = usableRegular + usableAnimated;
        
        const subscriptionEmojis = guild.emojis.cache.filter(e => e.managed).size;
        const usableSubscriptionEmojis = Math.min(subscriptionEmojis, 50); // Subscription emojis have separate limit
        
        const totalStickers = guild.stickers.cache.size;
        const usableStickers = Math.min(totalStickers, stickerLimit);

        serverEmbed.addFields(
          { name: '😀 Emojis', value: `Regular: ${regularEmojis} uploaded / ${regularEmojiLimit} useable \n Animated: ${animatedEmojis} uploaded / ${animatedEmojiLimit} useable`, inline: false },
          { name: '⭐ Server Subscription Emojis', value: `${subscriptionEmojis} / 50 usable`, inline: false },
          { name: '🏷️ Stickers', value: `${totalStickers} uploaded / ${stickerLimit} usable`, inline: false }
        )
        .setColor(embedColor)
        .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }));

      const toggleButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('server_toggle_features_initial')
          .setLabel('Show Features')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⚙️'),
        new ButtonBuilder()
          .setCustomId('server_refresh_initial')
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔄')
      );

      await interaction.reply({ 
        embeds: [serverEmbed], 
        components: [toggleButton]
      });
      
      const reply = await interaction.fetchReply();

      // Update buttons with actual message ID for persistence
      const persistentButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`server_toggle_features_${reply.id}`)
          .setLabel('Show Features')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⚙️'),
        new ButtonBuilder()
          .setCustomId(`server_refresh_${reply.id}`)
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔄')
      );

      await reply.edit({ components: [persistentButton] });
    } catch (error) {
      console.error('Error in /server command:', error);
      await interaction.reply({
        content: '❌ An error occurred while fetching server information.',
        flags: MessageFlags.Ephemeral
      });
    }
  },

  /**
   * Handles button interactions for server command.
   * @async
   * @param {import('discord.js').ButtonInteraction} interaction - The button interaction.
   * @returns {Promise<void>}
   */
  async handleButtonInteraction(interaction) {
    try {
      const guild = interaction.guild;
      if (!guild) {
        return interaction.reply({
          content: '❌ Server not found.',
          flags: MessageFlags.Ephemeral
        });
      }

      // Parse customId: server_action_messageId or server_action (for backwards compatibility)
      const parts = interaction.customId.split('_');
      const action = parts[2]; // toggle_features or refresh
      const messageId = parts[3] || interaction.message.id; // Use message ID for persistence

      // Fetch fresh guild data
      const fullGuild = await interaction.client.guilds.fetch(guild.id, { force: true }).catch(() => guild);
      const serverDescription = fullGuild.description || 'No description set';
      const createdAt = Math.round(fullGuild.createdTimestamp / 1000);

      const settings = guildSettings.getSettings(guild.id);
      const embedColor = settings.embedColor ? settings.embedColor.replace('0x', '#') : '#ff6600';

      // Check if features are currently visible by checking the embed fields
      const currentEmbed = interaction.message.embeds[0];
      const featuresVisible = currentEmbed?.fields?.some(f => f.name === '⚙️ Features') || false;

      // Toggle features visibility
      let newFeaturesVisible = featuresVisible;
      if (action === 'toggle_features') {
        newFeaturesVisible = !featuresVisible;
      }

      // Calculate emoji limits based on boost level
      const boostLevel = fullGuild.premiumTier;
      let regularEmojiLimit = 50;
      let animatedEmojiLimit = 50;
      let stickerLimit = 0;

      switch (boostLevel) {
        case 1:
          regularEmojiLimit = 100;
          animatedEmojiLimit = 100;
          stickerLimit = 5;
          break;
        case 2:
          regularEmojiLimit = 150;
          animatedEmojiLimit = 150;
          stickerLimit = 15;
          break;
        case 3:
          regularEmojiLimit = 250;
          animatedEmojiLimit = 250;
          stickerLimit = 30;
          break;
      }

      const regularEmojis = fullGuild.emojis.cache.filter(e => !e.animated).size;
      const animatedEmojis = fullGuild.emojis.cache.filter(e => e.animated).size;
      const subscriptionEmojis = fullGuild.emojis.cache.filter(e => e.managed).size;
      const totalStickers = fullGuild.stickers.cache.size;

      if (interaction.customId === 'toggle_features') {
        // Toggle features visibility
        const newFeaturesVisible = !featuresVisible;

        const updatedEmbed = new EmbedBuilder()
          .setAuthor({ name: `${fullGuild.name} Server Information`, iconURL: fullGuild.iconURL({ dynamic: true, size: 256 }) })
          .setDescription(`**Description:** ${serverDescription}`)
          .addFields(
            { name: '🆔 Server ID', value: fullGuild.id, inline: false },
            { name: '👑 Owner', value: `<@${fullGuild.ownerId}>`, inline: false },
            { name: '📅 Created', value: `<t:${createdAt}:D> (<t:${createdAt}:R>)`, inline: false },
            { name: '👥 Members', value: fullGuild.members.cache.filter(m => !m.user.bot).size.toLocaleString(), inline: true },
            { name: '🤖 Bots', value: fullGuild.members.cache.filter(m => m.user.bot).size.toString(), inline: true },
            { name: '⚠️ Spam Accounts', value: fullGuild.members.cache.filter(m => !m.user.bot && m.user.createdTimestamp > Date.now() - 7 * 24 * 60 * 60 * 1000).size.toString(), inline: true },
            { name: '🎭 Roles', value: (fullGuild.roles.cache.size - 1).toString(), inline: true },
            { name: '📺 Channels', value: fullGuild.channels.cache.size.toString() + ' total', inline: true },
            { name: '\u200b', value: '\u200b', inline: true },
            { name: '🚀 Boost Level', value: fullGuild.premiumTier.toString(), inline: true },
            { name: '💎 Boosts', value: (fullGuild.premiumSubscriptionCount || 0).toString(), inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
          )
          .addFields(
            { name: '😀 Emojis', value: `Regular: ${regularEmojis} uploaded / ${regularEmojiLimit} useable \n Animated: ${animatedEmojis} uploaded / ${animatedEmojiLimit} useable`, inline: false },
            { name: '⭐ Server Subscription Emojis', value: `${subscriptionEmojis} / 50 usable`, inline: false },
            { name: '🏷️ Stickers', value: `${totalStickers} uploaded / ${stickerLimit} usable`, inline: false }
          )
          .setColor(embedColor)
          .setThumbnail(fullGuild.iconURL({ dynamic: true, size: 256 }));

        if (newFeaturesVisible) {
          updatedEmbed.addFields({
            name: '⚙️ Features',
            value: fullGuild.features.length > 0 ? fullGuild.features.map(f => `• ${f.replace(/_/g, ' ').toLowerCase()}`).join('\n') : 'None',
            inline: false
          });
        }

        const toggleButton = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('toggle_features')
            .setLabel(newFeaturesVisible ? 'Hide Features' : 'Show Features')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('refresh_server')
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄')
        );

        await interaction.update({
          embeds: [updatedEmbed],
          components: [toggleButton]
        });

      } else if (interaction.customId === 'refresh_server') {
        // Refresh server data
        const refreshedEmbed = new EmbedBuilder()
          .setAuthor({ name: `${fullGuild.name} Server Information`, iconURL: fullGuild.iconURL({ dynamic: true, size: 256 }) })
          .setDescription(`**Description:** ${serverDescription}`)
          .addFields(
            { name: '🆔 Server ID', value: fullGuild.id, inline: false },
            { name: '👑 Owner', value: `<@${fullGuild.ownerId}>`, inline: false },
            { name: '📅 Created', value: `<t:${createdAt}:D> (<t:${createdAt}:R>)`, inline: false },
            { name: '👥 Members', value: fullGuild.members.cache.filter(m => !m.user.bot).size.toLocaleString(), inline: true },
            { name: '🤖 Bots', value: fullGuild.members.cache.filter(m => m.user.bot).size.toString(), inline: true },
            { name: '⚠️ Spam Accounts', value: fullGuild.members.cache.filter(m => !m.user.bot && m.user.createdTimestamp > Date.now() - 7 * 24 * 60 * 60 * 1000).size.toString(), inline: true },
            { name: '🎭 Roles', value: (fullGuild.roles.cache.size - 1).toString(), inline: true },
            { name: '📺 Channels', value: fullGuild.channels.cache.size.toString() + ' total', inline: true },
            { name: '\u200b', value: '\u200b', inline: true },
            { name: '🚀 Boost Level', value: fullGuild.premiumTier.toString(), inline: true },
            { name: '💎 Boosts', value: (fullGuild.premiumSubscriptionCount || 0).toString(), inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
          )
          .addFields(
            { name: '😀 Emojis', value: `Regular: ${regularEmojis} uploaded / ${regularEmojiLimit} useable \n Animated: ${animatedEmojis} uploaded / ${animatedEmojiLimit} useable`, inline: false },
            { name: '⭐ Server Subscription Emojis', value: `${subscriptionEmojis} / 50 usable`, inline: false },
            { name: '🏷️ Stickers', value: `${totalStickers} uploaded / ${stickerLimit} usable`, inline: false }
          )
          .setColor(embedColor)
          .setThumbnail(fullGuild.iconURL({ dynamic: true, size: 256 }));

        // Add features if they were visible
        if (featuresVisible) {
          refreshedEmbed.addFields({
            name: '⚙️ Features',
            value: fullGuild.features.length > 0 ? fullGuild.features.map(f => `• ${f.replace(/_/g, ' ').toLowerCase()}`).join('\n') : 'None',
            inline: false
          });
        }

        const toggleButton = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`server_toggle_features_${messageId}`)
            .setLabel(newFeaturesVisible ? 'Hide Features' : 'Show Features')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`server_refresh_${messageId}`)
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄')
        );

        await interaction.update({
          embeds: [refreshedEmbed],
          components: [toggleButton]
        });
      }
    } catch (error) {
      console.error('[Server] Error handling button interaction:', error);
      await interaction.reply({
        content: '❌ An error occurred while processing the button click.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
};

// Bind handleButtonInteraction for global button handling
const boundHandleButtonInteraction = module.exports.handleButtonInteraction.bind(module.exports);
module.exports.handleButtonInteraction = boundHandleButtonInteraction;