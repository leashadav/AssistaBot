const { EmbedBuilder } = require('discord.js');

// Platform metadata for stream embeds
const platformMeta = {
  twitch: { color: 0x9146FF, name: 'Twitch', icon: 'https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png' },
  youtube: { color: 0xFF0000, name: 'YouTube', icon: 'https://www.youtube.com/s/desktop/c653c3bb/img/favicon_32x32.png' },
  rumble: { color: 0x85C742, name: 'Rumble', icon: 'https://rumble.com/favicon.ico' },
  tiktok: { color: 0xFF0050, name: 'TikTok', icon: 'https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/tiktok/webapp/main/webapp-desktop/8152caf0c8e8bc67ae0d.ico' },
  kick: { color: 0x53FC18, name: 'Kick', icon: 'https://kick.com/favicon.ico' },
  instagram: { color: 0xE4405F, name: 'Instagram', icon: 'https://www.instagram.com/static/images/ico/favicon-192.png/68d99ba29cc8.png' },
  discord: { color: 0x5865F2, name: 'Discord', icon: 'https://discord.com/assets/847541504914fd33810e70a0ea73177e.ico' },
  facebook: { color: 0x1877F2, name: 'Facebook', icon: 'https://facebook.com/favicon.ico' },
  x: { color: 0x000000, name: 'X', icon: 'https://abs.twimg.com/favicons/twitter.3.ico' }
};

function buildStreamEmbed({ platform, username, avatarUrl, url, title, game, imageUrl }) {
  const platformMetaForEmbed = platformMeta[platform] || { color: 0x2f3136, name: 'Stream', icon: null };

  const embed = new EmbedBuilder()
    .setColor(platformMetaForEmbed.color)
    .setAuthor({ 
      name: `${username || 'Streamer'}`, 
      iconURL: avatarUrl || platformMetaForEmbed.icon, 
      url 
    })
    .setTitle(title || 'Live now')
    .setURL(url)
    .setDescription(game ? `Activity: ${game}` : null)
    .setImage(imageUrl || avatarUrl || platformMetaForEmbed.icon);

  return embed;
}

// Export both the function and the metadata
module.exports = { buildStreamEmbed, platformMeta };