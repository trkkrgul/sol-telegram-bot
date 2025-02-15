import { connectMongo, closeMongo } from './utils/mongo.js';
import { connectRedis, closeRedis } from './utils/redis.js';
import { connectQueue, startConsumer } from './utils/rabbitmq.js';
import { startWalletSync } from './jobs/walletSync.js';
import { parseCampaignTransaction } from './utils/solana.js';
import TelegramBot from './telegram/bot.js';
import NotificationService from './services/notification.js';
import TransferService from './services/transfer.js';

let changeStream;

async function main() {
  try {
    // Bağlantıları kur
    await connectMongo();
    await connectRedis();
    const channel = await connectQueue();

    // Telegram botu başlat
    const telegramBot = new TelegramBot();
    telegramBot.launch();

    // Notification service'i başlat
    const notificationService = new NotificationService();
    console.log('Starting notification service...');
    await notificationService.startNotificationConsumer();
    console.log('Notification service started');

    // RabbitMQ consumer'ı başlat
    await startConsumer(async (message) => {
      try {
        const result = await parseCampaignTransaction(message);
        console.log('Processed campaign transaction:', result);

        // Telegram'a bildirim gönder
        await notificationService.sendTransactionNotification(result);
      } catch (error) {
        console.error('Error processing campaign transaction:', error);
      }
    });

    // Wallet sync job'ını başlat
    changeStream = await startWalletSync();

    // Transfer service'i başlat
    const transferService = new TransferService();
    console.log('Starting transfer service...');
    await transferService.startTransferConsumer();
    console.log('Transfer service started');

    console.log('Campaign service started');
  } catch (error) {
    console.error('Error starting campaign service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  if (changeStream) {
    await changeStream.close();
  }
  await closeMongo();
  await closeRedis();
  process.exit(0);
});

main().catch(console.error);
