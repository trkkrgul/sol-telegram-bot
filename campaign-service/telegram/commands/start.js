export default function startCommand(bot) {
  bot.command('start', async (ctx) => {
    try {
      const message = `
🚀 *Welcome to Campaign Manager Bot\\!*

This bot helps you manage marketing campaigns for various services\\. Here are the available commands:

📊 *Campaign Management*
• /campaigns \\- View and manage your campaigns
• /create \\- Create a new campaign
• /me \\- View your user information

💡 *Features*
• Create campaigns for different marketing services
• Track campaign progress and balances
• Manage funds and transfers
• Monitor SOL and USDC transactions
• Automatic target detection

⚡️ *Available Services*
• DexScreener Boost & Ads
• SolTrend Trending
• CoinMarketCap Listing
• CoinGecko Listing

🔒 *Admin Features*
• Transfer campaign funds
• Cancel active campaigns
• Pin important messages
• Manage campaign status

Need help? Contact @YourSupportUsername`;

      await ctx.replyWithMarkdownV2(message, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '📊 View Campaigns',
                callback_data: 'c:l:1',
              },
              {
                text: '🆕 Create Campaign',
                callback_data: 'back_to_services',
              },
            ],
          ],
        },
      });
    } catch (error) {
      console.error('Error in start command:', error);
      await ctx.reply('Error showing start menu');
    }
  });
}
