export default function meCommand(bot) {
  bot.command('me', async (ctx) => {
    try {
      const message = ctx.message;
      const chat = ctx.chat;

      // Özel karakterleri escape et
      const escapeMarkdown = (text) => {
        return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      };

      const response = `
*User Info*
ID: \`${message.from.id}\`
Username: ${
        message.from.username
          ? `@${escapeMarkdown(message.from.username)}`
          : 'N/A'
      }
Name: ${escapeMarkdown(message.from.first_name)} ${
        message.from.last_name ? escapeMarkdown(message.from.last_name) : ''
      }

*Chat Info*
Type: \`${chat.type}\`
${
  chat.type !== 'private'
    ? `Group ID: \`${chat.id}\`\nTitle: ${escapeMarkdown(chat.title)}`
    : ''
}`;

      await ctx.replyWithMarkdownV2(response);
    } catch (error) {
      console.error('Error in /me command:', error);
      await ctx.reply('Error fetching information');
    }
  });
}
