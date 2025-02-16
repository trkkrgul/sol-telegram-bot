import {
  getCampaigns,
  parseCampaignStatus,
  cancelCampaign,
  transferBiassedBalance,
} from '../../utils/solana.js';
import {
  ICONS,
  formatNumber,
  createProgressBar,
  formatAddress,
} from '../../utils/format.js';
import { Campaign } from '../../models/Campaign.js';
import { getSolscanAccountLink } from '../../utils/solscan.js';
import { isAdmin } from '../../utils/middleware.js';

export default function campaignsCommand(bot) {
  const escapeMarkdown = (text) => {
    return text?.toString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') || '';
  };

  // Ana komut handler
  bot.command('campaigns', async (ctx) => {
    try {
      await showCampaignList(ctx, 1);
    } catch (error) {
      console.error('Error in campaigns command:', error);
      await ctx.reply('Error fetching campaigns');
    }
  });

  // Callback handler
  bot.action(/^c:(l|v|t|c):.*/, async (ctx) => {
    try {
      const [action, type, ...params] = ctx.callbackQuery.data.split(':');

      switch (`${action}:${type}`) {
        case 'c:l': // List
          await handleList(ctx, params);
          break;
        case 'c:v': // View
          await handleView(ctx, params);
          break;
        case 'c:t': // Transfer
          await handleTransfer(ctx, params);
          break;
        case 'c:c': // Cancel
          await handleCancel(ctx, params);
          break;
      }
      await ctx.answerCbQuery();
    } catch (error) {
      console.error('Callback error:', error);
      await ctx.answerCbQuery('An error occurred');
    }
  });

  // Kampanya listesini göster
  async function showCampaignList(ctx, page, fromId = null) {
    const groupId = ctx.chat.id.toString();
    const limit = 5;

    // Transfer modu için sadece active kampanyaları getir ve seçili kampanyayı hariç tut
    let query = { groupId };
    if (fromId) {
      query = {
        ...query,
        status: 'active',
        publicKey: { $ne: fromId }, // Seçili kampanyayı hariç tut
      };
    }

    // Total ve kampanyaları getir
    const total = await Campaign.countDocuments(query);
    const campaigns = await Campaign.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const maxPage = Math.ceil(total / limit);
    const buttons = [];

    // Status ikonları
    const STATUS_ICONS = {
      active: '⏳', // Kum saati - devam eden
      completed: '✅', // Yeşil tik - tamamlanan
      pending: '🎯', // Hedef - bekleyen
      cancelled: '❌', // Çarpı - iptal edilen
    };

    // Eğer transfer modunda ve hiç aktif kampanya yoksa
    if (fromId && total === 0) {
      await ctx.editMessageText(
        `${ICONS.WARNING} *No active campaigns available for transfer\!*`,
        {
          parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '⬅️ Back to Campaign',
                  callback_data: `c:v:${fromId.slice(0, 8)}`,
                },
              ],
            ],
          },
        }
      );
      return;
    }

    // Kampanya butonları
    for (const campaign of campaigns) {
      const statusIcon = STATUS_ICONS[campaign.status] || '⚪️'; // Default beyaz daire
      const buttonText = `${statusIcon} ${campaign.serviceName} - ${
        campaign.productName
      } ($${formatNumber(campaign.productPrice)})`;

      // PublicKey'in ilk 8 karakterini kullan
      const shortKey = campaign.publicKey.slice(0, 8);
      buttons.push([
        {
          text: buttonText,
          callback_data: fromId
            ? `c:t:${fromId.slice(0, 8)}:${shortKey}` // Kısaltılmış format
            : `c:v:${shortKey}`, // Kısaltılmış format
        },
      ]);
    }

    // Pagination butonları
    const paginationButtons = [];
    if (page > 1) {
      paginationButtons.push({
        text: '⬅️ Previous',
        callback_data: fromId
          ? `c:t:${fromId.slice(0, 8)}:p:${page - 1}`
          : `c:l:${page - 1}`,
      });
    }
    if (page < maxPage) {
      paginationButtons.push({
        text: 'Next ➡️',
        callback_data: fromId
          ? `c:t:${fromId.slice(0, 8)}:p:${page + 1}`
          : `c:l:${page + 1}`,
      });
    }
    if (paginationButtons.length > 0) {
      buttons.push(paginationButtons);
    }

    // Back butonu (transfer modunda)
    if (fromId) {
      buttons.push([
        {
          text: '⬅️ Back to Campaign',
          callback_data: `c:v:${fromId.slice(0, 8)}`,
        },
      ]);
    }

    const message = `${ICONS.CAMPAIGN} *Your Campaigns*\nPage ${page} of ${maxPage}\nTotal: ${total}`;

    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: buttons },
      });
    } else {
      await ctx.reply(message, {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: buttons },
      });
    }
  }

  // List handler
  async function handleList(ctx, [page]) {
    await showCampaignList(ctx, parseInt(page));
  }

  // View handler
  async function handleView(ctx, [shortKey]) {
    // Tam publicKey'i bul
    const campaign = await Campaign.findOne({
      publicKey: { $regex: `^${shortKey}` },
    });
    if (!campaign) throw new Error('Campaign not found');

    const status = await parseCampaignStatus(campaign.publicKey);

    const buttons = [[]];

    // Cancel butonu sadece adminler için ve active/pending kampanyalarda
    if (['active', 'pending'].includes(status.status)) {
      const admins = await ctx.getChatAdministrators();
      const isUserAdmin = admins.some((admin) => admin.user.id === ctx.from.id);

      if (isUserAdmin) {
        buttons[0].push({
          text: '❌ Cancel',
          callback_data: `c:c:${campaign.publicKey.slice(0, 8)}`,
        });
      }
    }

    // Transfer butonu sadece adminler için ve active kampanyalarda
    if (status.status === 'active') {
      const admins = await ctx.getChatAdministrators();
      const isUserAdmin = admins.some((admin) => admin.user.id === ctx.from.id);

      if (isUserAdmin) {
        buttons[0].push({
          text: '💸 Transfer Value',
          callback_data: `c:t:${campaign.publicKey.slice(0, 8)}`,
        });
      }
    }

    buttons.push([
      {
        text: '⬅️ Back to List',
        callback_data: 'c:l:1',
      },
    ]);

    const message = `
${ICONS.CAMPAIGN} *Campaign Details*
${ICONS.NEW_TX} Name: \`${escapeMarkdown(campaign.name)}\`
${ICONS.WALLET} Public Key: [${formatAddress(
      campaign.publicKey
    )}](${escapeMarkdown(getSolscanAccountLink(campaign.publicKey))})
${ICONS.SERVICE} Service: \`${escapeMarkdown(campaign.serviceName)}\`
${ICONS.PRODUCT} Product: \`${escapeMarkdown(campaign.productName)}\`
${ICONS.PRICE} Price: \`$${escapeMarkdown(formatNumber(status.productPrice))}\`
${ICONS.STATUS} Status: \`${escapeMarkdown(status.status)}\`

${ICONS.BALANCE} *Balance Details*
${ICONS.SOL} SOL: \`${escapeMarkdown(
      formatNumber(status.SOL, 'SOL')
    )}\` SOL \\(\\$${escapeMarkdown(
      formatNumber(status.SOL * status.solPrice)
    )}\\)
${ICONS.USDC} USDC: \`\\$${escapeMarkdown(formatNumber(status.USDC))}\`
${ICONS.TRANSFER} Transferred: \`\\$${escapeMarkdown(
      formatNumber(status.transferredBalance)
    )}\`
${ICONS.VALUE} Total Value: \`\\$${escapeMarkdown(
      formatNumber(status.accountValue)
    )}\`

${createProgressBar(status.progress)}
Progress: \`${escapeMarkdown(formatNumber(status.progress))}\\%\`

${
  campaign.portalLink
    ? `\n${ICONS.LINK} Join Group: [Click Here](${escapeMarkdown(
        campaign.portalLink
      )})`
    : ''
}`;

    await ctx.editMessageText(message, {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buttons },
    });
  }

  // Transfer handler
  async function handleTransfer(ctx, [fromShortKey, toShortKey, page]) {
    if (toShortKey === 'p') {
      // Pagination request
      const fromCampaign = await Campaign.findOne({
        publicKey: { $regex: `^${fromShortKey}` },
        status: 'active', // Sadece active kampanyalardan transfer yapılabilir
      });
      if (!fromCampaign) {
        await ctx.answerCbQuery('Source campaign is not active anymore!', {
          show_alert: true,
        });
        return;
      }
      await showCampaignList(ctx, parseInt(page), fromCampaign.publicKey);
      return;
    }

    if (toShortKey) {
      // Her iki kampanyayı da bul ve status kontrolü yap
      const [fromCampaign, toCampaign] = await Promise.all([
        Campaign.findOne({
          publicKey: { $regex: `^${fromShortKey}` },
          status: 'active',
        }),
        Campaign.findOne({
          publicKey: { $regex: `^${toShortKey}` },
          status: 'active',
        }),
      ]);

      // Status kontrolü
      if (!fromCampaign || !toCampaign) {
        await ctx.answerCbQuery(
          'One or both campaigns are not active anymore!',
          { show_alert: true }
        );
        return;
      }

      // Transfer işlemini gerçekleştir
      await transferBiassedBalance(
        fromCampaign.publicKey,
        toCampaign.publicKey
      );
      await handleView(ctx, [toShortKey]);
      return;
    }

    // Transfer için kampanya listesini göster
    await showCampaignList(ctx, 1, fromShortKey);
  }

  // Cancel handler
  async function handleCancel(ctx, [shortKey]) {
    try {
      // Tam publicKey'i bul
      const campaign = await Campaign.findOne({
        publicKey: { $regex: `^${shortKey}` },
        status: { $in: ['active', 'pending'] },
      });

      if (!campaign) {
        await ctx.answerCbQuery('Campaign not found or already completed!', {
          show_alert: true,
        });
        return;
      }

      // Kampanyayı iptal et
      campaign.status = 'cancelled';
      await campaign.save();

      // Mesajı güncelle
      await ctx.editMessageText(
        `${ICONS.SUCCESS} Campaign cancelled successfully\\!`, // Ünlem işaretini escape ettik
        {
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        }
      );

      // Log
      console.log('Campaign cancelled:', {
        id: campaign._id.toString(),
        publicKey: campaign.publicKey,
        status: campaign.status,
      });
    } catch (error) {
      console.error('Error cancelling campaign:', error);
      await ctx.answerCbQuery('Error cancelling campaign', {
        show_alert: true,
      });
    }
  }

  // Transfer handler - admin middleware ekleyelim
  bot.action(/^c:t:.*/, isAdmin, async (ctx) => {
    try {
      const [action, type, ...params] = ctx.callbackQuery.data.split(':');
      await handleTransfer(ctx, params);
      await ctx.answerCbQuery();
    } catch (error) {
      console.error('Transfer error:', error);
      await ctx.answerCbQuery('Error during transfer', { show_alert: true });
    }
  });

  // Cancel handler - admin middleware ekleyelim
  bot.action(/^c:c:.*/, isAdmin, async (ctx) => {
    try {
      const [action, type, ...params] = ctx.callbackQuery.data.split(':');
      await handleCancel(ctx, params);
      await ctx.answerCbQuery();
    } catch (error) {
      console.error('Cancel error:', error);
      await ctx.answerCbQuery('Error cancelling campaign', {
        show_alert: true,
      });
    }
  });
}
