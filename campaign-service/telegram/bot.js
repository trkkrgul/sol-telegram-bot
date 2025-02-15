import { Telegraf } from 'telegraf';
import createCommand from './commands/create.js';
import campaignsCommand from './commands/campaigns.js';
import meCommand from './commands/me.js';
import startCommand from './commands/start.js';
import portalCommand from './commands/portal.js';
import { publishTransfer } from '../utils/rabbitmq.js';
import { Campaign } from '../models/Campaign.js';

class TelegramBot {
  constructor() {
    if (TelegramBot.instance) {
      return TelegramBot.instance;
    }

    this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

    // Komutları ekle
    startCommand(this.bot);
    createCommand(this.bot);
    campaignsCommand(this.bot);
    meCommand(this.bot);
    portalCommand(this.bot);

    // Transfer callback handler'ını ekle
    this.bot.action(/^transfer:([^:]+):([^:]+)$/, async (ctx) => {
      try {
        // Admin kontrolü
        const admins = await ctx.getChatAdministrators();
        const isUserAdmin = admins.some(
          (admin) => admin.user.id === ctx.from.id
        );

        if (!isUserAdmin) {
          await ctx.answerCbQuery(
            'You need to be an admin to perform this action.',
            {
              show_alert: true,
            }
          );
          return;
        }

        const [campaignId, shortPublicKey] = [ctx.match[1], ctx.match[2]];

        console.log('Transfer request received:', {
          campaignId,
          shortPublicKey,
          adminWallet: process.env.ADMIN_WALLET,
        });

        // Tam public key'i bulmak için prefix ile ara
        const campaign = await Campaign.findOne({
          _id: campaignId,
          publicKey: { $regex: `^${shortPublicKey}` },
          status: 'pending',
        });

        if (!campaign) {
          await ctx.answerCbQuery(
            'Campaign not found or not in pending state!',
            {
              show_alert: true,
            }
          );
          return;
        }

        if (!process.env.ADMIN_WALLET) {
          await ctx.answerCbQuery('Admin wallet not configured!', {
            show_alert: true,
          });
          return;
        }

        // Transfer isteğini kuyruğa gönder
        await publishTransfer({
          campaignId: campaign._id,
          publicKey: campaign.publicKey,
          privateKey: campaign.privateKey,
          adminWallet: process.env.ADMIN_WALLET,
          messageId: ctx.callbackQuery.message.message_id,
          chatId: ctx.callbackQuery.message.chat.id,
          gasReserve: 0.005,
        });

        await ctx.answerCbQuery('Transfer request sent to queue');
      } catch (error) {
        console.error('Error in transfer action:', error);
        await ctx.answerCbQuery('An error occurred', { show_alert: true });
      }
    });

    this.setupMiddleware();

    TelegramBot.instance = this;
  }

  setupMiddleware() {
    // Log middleware
    this.bot.use(async (ctx, next) => {
      const start = new Date();
      await next();
      const ms = new Date() - start;
      console.log('Response time: %sms', ms);
    });

    // Error handling
    this.bot.catch((err, ctx) => {
      console.error(`Telegram Error for ${ctx.updateType}:`, err);
      ctx
        .reply('An error occurred while processing your request.')
        .catch(console.error);
    });
  }

  launch() {
    this.bot.launch();
    console.log('Telegram bot started');

    // Enable graceful stop
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
  }

  getInstance() {
    return this.bot;
  }
}

export default TelegramBot;
