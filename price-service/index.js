import { createClient } from 'redis';
import { calculatePrice } from './utils/solana.js';
import dotenv from 'dotenv';

dotenv.config();

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

async function updatePrices() {
  try {
    const prices = await calculatePrice();
    await redisClient.set('prices', JSON.stringify(prices));
    console.log('Prices updated:', prices);
  } catch (error) {
    console.error('Error updating prices:', error);
  }
}

async function main() {
  try {
    await redisClient.connect();
    console.log('Connected to Redis');

    // İlk fiyat güncellemesi
    await updatePrices();

    // Her 10 saniyede bir fiyatları güncelle
    setInterval(updatePrices, 10000);
  } catch (error) {
    console.error('Error in main:', error);
    process.exit(1);
  }
}

main();
