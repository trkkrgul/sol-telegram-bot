import redis from 'redis';

const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

// connect() fonksiyonunu kaldırdık, bunu export edip main'de çağıracağız
export default redisClient;
