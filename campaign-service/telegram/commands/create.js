import { services } from '../../lib/marketing.js';
import { createCampaign, parseCampaignStatus } from '../../utils/solana.js';
import { ICONS, formatNumber, createProgressBar } from '../../utils/format.js';
import { isAdmin } from '../../utils/middleware.js';

export default function createCommand(bot) {
  const escapeMarkdown = (text) => {
    return text?.toString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') || '';
  };

  // Servis seçim menüsü
  const getServiceMenu = () => {
    return {
      reply_markup: {
        inline_keyboard: [
          ...services.map((service) => [
            {
              text: service.name,
              callback_data: `service:${service.name}`,
            },
          ]),
        ],
      },
    };
  };

  // Product seçim menüsü
  const getProductMenu = (serviceName) => {
    const service = services.find((s) => s.name === serviceName);
    if (!service) return null;

    return {
      reply_markup: {
        inline_keyboard: [
          ...service.packages.map((product) => [
            {
              text: `${product.name} ($${product.price})`,
              callback_data: `product:${serviceName}:${product.name}:${product.price}`,
            },
          ]),
          [
            {
              text: '⬅️ Back to Services',
              callback_data: 'back_to_services',
            },
          ],
        ],
      },
    };
  };

  // Ana komut handler - admin middleware ekle
  bot.command('create', isAdmin, async (ctx) => {
    try {
      // Servis seçim menüsünü göster
      await ctx.reply('Select a service:', getServiceMenu());
    } catch (error) {
      console.error('Error in create command:', error);
      await ctx.reply('Error starting campaign creation');
    }
  });

  // Callback handler - admin middleware ekle
  bot.action(/^(service|product|back_to_services).*/, isAdmin, async (ctx) => {
    try {
      const data = ctx.callbackQuery.data;

      if (data === 'back_to_services') {
        await ctx.editMessageText('Select a service:', getServiceMenu());
      } else if (data.startsWith('service:')) {
        const serviceName = data.split(':')[1];
        await ctx.editMessageText(
          `${ICONS.PRODUCT} *Select a Product for ${escapeMarkdown(
            serviceName
          )}:*`,
          {
            parse_mode: 'MarkdownV2',
            ...getProductMenu(serviceName),
          }
        );
      } else if (data.startsWith('product:')) {
        const [_, serviceName, productName, price] = data.split(':');
        const groupId = ctx.chat.id.toString();

        // Kampanya oluştur
        const campaign = await createCampaign(
          groupId,
          serviceName,
          productName,
          parseFloat(price)
        );

        // Kampanya durumunu getir
        const status = await parseCampaignStatus(campaign.publicKey);

        // Başarı mesajı gönder ve mesaj ID'sini al
        const sentMessage = await ctx.editMessageText(
          `${ICONS.SUCCESS} *Campaign Created Successfully\\!*\n\n` +
            `${ICONS.SERVICE} Service: \`${escapeMarkdown(serviceName)}\`\n` +
            `${ICONS.PRODUCT} Product: \`${escapeMarkdown(productName)}\`\n` +
            `${ICONS.PRICE} Price: \`$${escapeMarkdown(price)}\`\n` +
            `${ICONS.NEW_TX} Address: \`${escapeMarkdown(
              campaign.publicKey
            )}\``,
          {
            parse_mode: 'MarkdownV2',
          }
        );

        // Mesajı pinlemeyi dene
        try {
          await ctx.telegram.pinChatMessage(groupId, sentMessage.message_id, {
            disable_notification: false,
          });
          console.log('Campaign creation message pinned successfully');
        } catch (pinError) {
          // Pin yetkisi yoksa veya başka bir hata olursa sadece loglayıp devam et
          console.log(
            'Could not pin campaign creation message:',
            pinError.message
          );
        }

        // Kampanya durumunu gönder
        await ctx.reply(
          `${ICONS.CAMPAIGN} *Campaign Details*\n\n` +
            `${ICONS.NEW_TX} Name: \`${escapeMarkdown(status.name)}\`\n` +
            `${ICONS.SERVICE} Service: \`${escapeMarkdown(
              status.serviceName
            )}\`\n` +
            `${ICONS.PRODUCT} Product: \`${escapeMarkdown(
              status.productName
            )}\`\n` +
            `${ICONS.PRICE} Price: \`$${escapeMarkdown(
              formatNumber(status.productPrice)
            )}\`\n` +
            `${ICONS.STATUS} Status: \`${escapeMarkdown(status.status)}\`\n` +
            `${ICONS.INITIAL_FUND} Initial Fund: \`$${escapeMarkdown(
              formatNumber(status.transferredBalance)
            )}\`\n\n` +
            `${ICONS.BALANCE} *Current Balance*\n` +
            `${ICONS.SOL} SOL: \`${escapeMarkdown(
              formatNumber(status.SOL, 'SOL')
            )}\` \\(≈ $${escapeMarkdown(
              formatNumber(status.SOL * status.solPrice)
            )}\\)\n` +
            `${ICONS.USDC} USDC: \`$${escapeMarkdown(
              formatNumber(status.USDC)
            )}\`\n` +
            `${ICONS.TOTAL} Total Value: \`$${escapeMarkdown(
              formatNumber(status.accountValue)
            )}\`\n\n` +
            `${ICONS.PROGRESS} Progress: \`${escapeMarkdown(
              formatNumber(status.progress)
            )}%\`\n` +
            `\`${escapeMarkdown(createProgressBar(status.progress, 20))}\``,
          {
            parse_mode: 'MarkdownV2',
          }
        );
      }

      await ctx.answerCbQuery();
    } catch (error) {
      console.error('Error in callback query:', error);
      await ctx.answerCbQuery('An error occurred', { show_alert: true });
    }
  });
}
