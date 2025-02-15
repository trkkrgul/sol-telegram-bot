import TelegramBot from '../telegram/bot.js';
import {
  formatAddress,
  formatNumber,
  createProgressBar,
  ICONS,
} from '../utils/format.js';
import { connectQueue } from '../utils/rabbitmq.js';
import { getSolscanAccountLink, getSolscanTxLink } from '../utils/solscan.js';
import { isAdmin } from '../utils/middleware.js';

class NotificationService {
  constructor() {
    if (NotificationService.instance) {
      return NotificationService.instance;
    }
    this.bot = new TelegramBot().getInstance();

    // Admin transfer butonu için handler ekle
    this.bot.action(/^transfer:.*/, isAdmin, async (ctx) => {
      try {
        const [_, campaignId, publicKey] = ctx.callbackQuery.data.split(':');

        // Transfer işlemini başlat
        await this.handleAdminTransfer(campaignId, publicKey, ctx);
        await ctx.answerCbQuery('Transfer process started');
      } catch (error) {
        console.error('Error in admin transfer:', error);
        await ctx.answerCbQuery('Error starting transfer', {
          show_alert: true,
        });
      }
    });

    NotificationService.instance = this;
  }

  async sendTransactionNotification(transaction) {
    try {
      const {
        name,
        groupId,
        serviceName,
        productName,
        productPrice,
        status,
        SOL,
        USDC,
        accountValue,
        progress,
        solPrice,
        signer,
        transactionHash,
        currency,
        delta,
        transferredBalance,
        publicKey,
      } = transaction;

      // Debug için transaction objesini kontrol edelim
      console.log('Transaction object:', {
        name,
        publicKey,
        signer,
        transactionHash,
        currency,
      });

      // publicKey kontrolü ekleyelim
      if (!publicKey) {
        console.error('Public key is missing in transaction:', transaction);
        // Eğer publicKey yoksa signer'ı kullanabiliriz
        publicKey = signer; // Fallback olarak signer'ı kullan
      }

      const escapeMarkdown = (text) => {
        return (
          text?.toString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') || ''
        );
      };

      const progressBar = createProgressBar(progress, 20);

      // Currency ve transfer yönünü belirle
      const currencyIcon =
        currency === 'SOL' ? ICONS.SOL_ICON : ICONS.USDC_ICON;
      const isReceived = delta > 0;
      const transferIcon = isReceived ? ICONS.RECEIVED : ICONS.SENT;
      const amountIcon = isReceived ? ICONS.PLUS : ICONS.MINUS;
      const transferType = isReceived ? 'Received' : 'Sent';
      const absAmount = Math.abs(delta);

      const message = `
${transferIcon} *${currencyIcon} ${escapeMarkdown(currency)} Transaction*
${amountIcon} *${escapeMarkdown(
        formatNumber(absAmount, currency)
      )} ${currency}* ${isReceived ? 'Received' : 'Sent'}
${
  currency === 'SOL'
    ? `${ICONS.EXCHANGE_RATE} \\(≈ $${escapeMarkdown(
        formatNumber(Math.abs(delta * solPrice))
      )}\\)`
    : ''
}
${isReceived ? ICONS.FROM : ICONS.TO} ${
        isReceived ? 'From' : 'To'
      }: \`${escapeMarkdown(signer)}\`
${ICONS.HASH} [View Transaction](${escapeMarkdown(
        getSolscanTxLink(transactionHash)
      )})

${ICONS.CAMPAIGN} *Campaign Details*
${ICONS.NEW_TX} Name: \`${escapeMarkdown(name)}\`
${ICONS.WALLET} Public Key: \`${escapeMarkdown(publicKey)}\`
[View Wallet in Solscan](${escapeMarkdown(getSolscanAccountLink(publicKey))})
${ICONS.SERVICE} Service: \`${escapeMarkdown(serviceName)}\`
${ICONS.PRODUCT} Product: \`${escapeMarkdown(productName)}\`
${ICONS.PRICE} Price: \`$${escapeMarkdown(formatNumber(productPrice))}\`
${ICONS.STATUS} Status: \`${escapeMarkdown(status)}\`
${ICONS.INITIAL_FUND} Initial Fund: \`$${escapeMarkdown(
        formatNumber(transferredBalance)
      )}\`

${ICONS.BALANCE} *Current Balance*
${ICONS.SOL} SOL: \`${escapeMarkdown(
        formatNumber(SOL, 'SOL')
      )}\` \\(≈ $${escapeMarkdown(formatNumber(SOL * solPrice))}\\)
${ICONS.USDC} USDC: \`$${escapeMarkdown(formatNumber(USDC))}\`
${ICONS.TOTAL} Total Value: \`$${escapeMarkdown(formatNumber(accountValue))}\`

${ICONS.PROGRESS} Progress: \`${escapeMarkdown(formatNumber(progress))}%\`
\`${escapeMarkdown(progressBar)}\``;

      await this.bot.telegram.sendMessage(groupId, message, {
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      });
    } catch (error) {
      console.error('Error sending transaction notification:', error);
    }
  }

  async sendTargetReachedNotification(campaign) {
    try {
      console.log('Starting target reached notification with campaign:', {
        id: campaign._id?.toString(),
        publicKey: campaign.publicKey,
        status: campaign.status,
      });

      const {
        name,
        groupId,
        serviceName,
        productName,
        productPrice,
        SOL,
        USDC,
        accountValue,
        progress,
        solPrice,
        transferredBalance,
        publicKey,
        portalLink,
      } = campaign;

      // Debug için campaign objesini kontrol edelim
      console.log('Campaign object for target reached:', {
        publicKey,
        name,
        serviceName,
      });

      const escapeMarkdown = (text) => {
        return (
          text?.toString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') || ''
        );
      };

      const progressBar = createProgressBar(progress, 20);

      // Callback data'yı kısalt ve doğru formatta oluştur
      const shortCallbackData = `transfer:${
        campaign._id
      }:${campaign.publicKey.slice(0, 8)}`;

      console.log('Preparing admin message with callback data:', {
        callbackData: shortCallbackData,
        length: shortCallbackData.length,
        adminGroupId: process.env.ADMIN_GROUP_ID,
      });

      // Kampanya grubuna mesajı gönder
      const sentMessage = await this.bot.telegram.sendMessage(
        groupId,
        `
${ICONS.SUCCESS} *Target Reached\\!*
${
  ICONS.ALERT
} Campaign is now in pending state and will be processed by our team soon\\.

${ICONS.CAMPAIGN} *Campaign Details*
${ICONS.NEW_TX} Name: \`${escapeMarkdown(name)}\`
${ICONS.WALLET} Public Key: \`${escapeMarkdown(publicKey)}\`
[View Wallet in Solscan](${escapeMarkdown(
          getSolscanAccountLink(campaign.publicKey)
        )})
${ICONS.SERVICE} Service: \`${escapeMarkdown(serviceName)}\`
${ICONS.PRODUCT} Product: \`${escapeMarkdown(productName)}\`
${ICONS.PRICE} Price: \`$${escapeMarkdown(formatNumber(productPrice))}\`
${ICONS.STATUS} Status: \`pending\`
${ICONS.INITIAL_FUND} Initial Fund: \`$${escapeMarkdown(
          formatNumber(transferredBalance)
        )}\`

${ICONS.BALANCE} *Current Balance*
${ICONS.SOL} SOL: \`${escapeMarkdown(
          formatNumber(SOL, 'SOL')
        )}\` \\(≈ $${escapeMarkdown(formatNumber(SOL * solPrice))}\\)
${ICONS.USDC} USDC: \`$${escapeMarkdown(formatNumber(USDC))}\`
${ICONS.TOTAL} Total Value: \`$${escapeMarkdown(formatNumber(accountValue))}\`

${ICONS.PROGRESS} Progress: \`${escapeMarkdown(formatNumber(progress))}%\`
\`${escapeMarkdown(progressBar)}\``,
        {
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        }
      );

      // Kampanya grubundaki mesajı pinlemeyi dene
      try {
        await this.bot.telegram.pinChatMessage(
          groupId,
          sentMessage.message_id,
          {
            disable_notification: false,
          }
        );
        console.log('Target reached message pinned successfully');
      } catch (pinError) {
        console.log('Could not pin message:', pinError.message);
      }

      // Admin grubuna mesajı gönder
      if (process.env.ADMIN_GROUP_ID) {
        const adminMessage = `
${ICONS.ALERT} *New Target Reached Notification\\!*

${ICONS.CAMPAIGN} *Campaign Details*
${ICONS.NEW_TX} Name: \`${escapeMarkdown(name)}\`
${ICONS.WALLET} Public Key: \`${escapeMarkdown(publicKey)}\`
[View Wallet in Solscan](${escapeMarkdown(
          getSolscanAccountLink(campaign.publicKey)
        )})
${ICONS.SERVICE} Service: \`${escapeMarkdown(serviceName)}\`
${ICONS.PRODUCT} Product: \`${escapeMarkdown(productName)}\`
${ICONS.PRICE} Price: \`$${escapeMarkdown(formatNumber(productPrice))}\`
${ICONS.STATUS} Status: \`pending\`
${
  campaign.portalLink
    ? `\n${ICONS.LINK} Join Group: [Click Here](${escapeMarkdown(
        campaign.portalLink
      )})`
    : ''
}

${ICONS.WARNING} This campaign from Group ID: \`${escapeMarkdown(
          groupId
        )}\` has reached its target\\. 
Please start the manual processing for ${escapeMarkdown(
          serviceName
        )} service\\.`;

        await this.bot.telegram.sendMessage(
          process.env.ADMIN_GROUP_ID,
          adminMessage,
          {
            parse_mode: 'MarkdownV2',
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: '🔄 Transfer Funds to Admin',
                    callback_data: shortCallbackData,
                  },
                ],
              ],
            },
          }
        );

        console.log('Admin message sent successfully with button');
      }
    } catch (error) {
      console.error('Error sending target reached notification:', error);
    }
  }

  async startNotificationConsumer() {
    try {
      console.log('Starting notification consumer...');
      const channel = await connectQueue();

      await channel.consume('campaign_notifications', async (message) => {
        try {
          console.log(
            'Received notification message:',
            message.content.toString()
          );
          const notification = JSON.parse(message.content.toString());

          if (notification.type === 'target_reached') {
            console.log('Processing target reached notification:', {
              campaignId: notification.data._id,
              publicKey: notification.data.publicKey,
            });

            await this.sendTargetReachedNotification(notification.data);
            console.log('Target reached notification processed successfully');
          }

          // Hata olsa bile mesajı acknowledge et, infinite loop'u önle
          channel.ack(message);
        } catch (error) {
          console.error('Notification consumer error:', {
            error: error.message,
            stack: error.stack,
            messageContent: message?.content?.toString(),
          });
          // Hata durumunda da mesajı acknowledge et
          channel.ack(message);
        }
      });

      console.log('Notification consumer started successfully');
    } catch (error) {
      console.error('Error starting notification consumer:', error);
      throw error;
    }
  }

  // Admin transfer işlemi için yeni helper fonksiyon
  async handleAdminTransfer(campaignId, publicKey, ctx) {
    try {
      // Transfer işlemini başlat
      await publishMessage('campaign_transfers', {
        campaignId,
        publicKey,
        adminTransfer: true,
        chatId: ctx.chat.id,
        messageId: ctx.callbackQuery.message.message_id,
      });

      console.log('Admin transfer request published:', {
        campaignId,
        publicKey,
        chatId: ctx.chat.id,
      });
    } catch (error) {
      console.error('Error publishing admin transfer:', error);
      throw error;
    }
  }
}

export default NotificationService;
