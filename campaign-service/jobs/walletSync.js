import { Campaign } from '../models/Campaign.js';
import { redisClient } from '../utils/redis.js';

async function updateWallets() {
  try {
    const campaigns = await Campaign.find({
      status: 'active',
    }).select('publicKey');
    const wallets = campaigns.map((campaign) => campaign.publicKey);

    // Redis'teki mevcut cüzdanları temizle
    await redisClient.del('wallets');

    if (wallets.length > 0) {
      // Yeni cüzdanları ekle
      await redisClient.sAdd('wallets', wallets);
    }

    // Her durumda wallet updates event'ini tetikle
    await redisClient.publish('wallet-updates', 'updated');

    console.log(`Updated Redis wallets: ${wallets.length} wallets`);
  } catch (error) {
    console.error('Error updating wallets:', error);
  }
}

export async function startWalletSync() {
  try {
    // İlk wallet güncellemesi
    await updateWallets();

    // Campaign koleksiyonunu izlemeye başla
    const changeStream = Campaign.watch();

    changeStream.on('change', async () => {
      console.log('Campaign collection changed, updating wallets...');
      await updateWallets();
    });

    console.log('Wallet sync job started');
    return changeStream;
  } catch (error) {
    console.error('Error starting wallet sync:', error);
    throw error;
  }
}
