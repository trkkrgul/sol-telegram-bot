import Redis from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// Singleton Redis client
class RedisConnection {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  getClient() {
    if (!this.client) {
      this.client = Redis.createClient({
        url: process.env.REDIS_URL,
      });
    }
    return this.client;
  }

  async connect() {
    try {
      if (!this.isConnected) {
        const client = this.getClient();
        await client.connect();
        this.isConnected = true;
        console.log('Connected to Redis');
      }
      return this.client;
    } catch (error) {
      console.error('Redis connection error:', error);
      throw error;
    }
  }

  async close() {
    try {
      if (this.isConnected && this.client) {
        await this.client.quit();
        this.isConnected = false;
        console.log('Redis connection closed');
      }
    } catch (error) {
      console.error('Redis close error:', error);
      throw error;
    }
  }
}

// Singleton instance
const redisConnection = new RedisConnection();

export const connectRedis = () => redisConnection.connect();
export const closeRedis = () => redisConnection.close();
export const redisClient = redisConnection.getClient();
