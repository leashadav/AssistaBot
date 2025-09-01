module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author.bot) return;

    // Example custom prefix command
    if (message.content.startsWith('!say')) {
      const text = message.content.slice(4).trim();
      if (text) await message.channel.send(text);
    }
  },
};