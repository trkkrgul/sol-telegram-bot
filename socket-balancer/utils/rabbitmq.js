import amqp from 'amqplib';

let channel = null;
const QUEUE_NAME = 'campaign_transactions';

export async function connectQueue() {
  try {
    const connection = await amqp.connect('amqp://user:password@rabbitmq:5672');
    channel = await connection.createChannel();

    await channel.assertQueue(QUEUE_NAME, {
      durable: true,
    });

    console.log('Connected to RabbitMQ');
    return channel;
  } catch (error) {
    console.error('RabbitMQ connection error:', error);
    throw error;
  }
}

export async function sendToQueue(data) {
  try {
    if (!channel) {
      throw new Error('RabbitMQ channel not initialized');
    }
    await channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(data)), {
      persistent: true,
    });
  } catch (error) {
    console.error('Error sending to queue:', error);
    throw error;
  }
}
