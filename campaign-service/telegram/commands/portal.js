import { Portal } from '../../models/Portal.js';
import { Campaign } from '../../models/Campaign.js';
import { isAdmin } from '../../utils/middleware.js';

export default function portalCommand(bot) {
  bot.command('portal', isAdmin, async (ctx) => {
    try {
      const groupId = ctx.chat.id.toString();
      const portalLink = ctx.message.text.split(' ')[1]?.trim();

      if (!portalLink) {
        await ctx.reply(
          'Please provide a portal link. Usage: /portal t.me/portallink'
        );
        return;
      }

      // 1. Mevcut kampanyaları güncelle
      const updateResult = await Campaign.updateMany(
        { groupId },
        { portalLink }
      );

      // 2. Portal koleksiyonunu güncelle veya oluştur
      await Portal.findOneAndUpdate(
        { groupId },
        { portalLink },
        { upsert: true, new: true }
      );

      await ctx.reply(
        `✅ Portal link updated successfully!\n\n` +
          `📝 Updated ${updateResult.modifiedCount} existing campaigns\n` +
          `🔗 New portal link: ${portalLink}`
      );
    } catch (error) {
      console.error('Error in portal command:', error);
      await ctx.reply('An error occurred while updating portal link');
    }
  });
}
