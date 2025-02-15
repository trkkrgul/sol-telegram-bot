import amqp from 'amqplib';
import dotenv from 'dotenv';
dotenv.config();

const { RABBITMQ_URL } = process.env;

let connection = null;
let channel = null;
const QUEUE_NAME = 'campaign_transactions';
const NOTIFICATION_QUEUE = 'campaign_notifications';
const TRANSFER_QUEUE = 'campaign_transfers';

async function connectQueue() {
  try {
    if (!connection) {
      connection = await amqp.connect(RABBITMQ_URL);

      connection.on('error', (err) => {
        console.error('RabbitMQ connection error:', err);
        connection = null;
        setTimeout(connectQueue, 5000);
      });

      connection.on('close', () => {
        console.warn('RabbitMQ connection closed, attempting to reconnect...');
        connection = null;
        setTimeout(connectQueue, 5000);
      });
    }

    if (!channel) {
      channel = await connection.createChannel();

      // Kuyrukları tanımla
      await channel.assertQueue(QUEUE_NAME, { durable: true });
      await channel.assertQueue(NOTIFICATION_QUEUE, { durable: true });
      await channel.assertQueue(TRANSFER_QUEUE, { durable: true });

      // Prefetch ayarı
      await channel.prefetch(1);

      channel.on('error', (err) => {
        console.error('RabbitMQ channel error:', err);
        channel = null;
      });

      channel.on('close', () => {
        console.warn('RabbitMQ channel closed');
        channel = null;
      });
    }

    console.log('Connected to RabbitMQ');
    return channel;
  } catch (error) {
    console.error('Error connecting to RabbitMQ:', error);
    connection = null;
    channel = null;
    throw error;
  }
}

// channel'ı export et
export { channel };

export async function startConsumer(messageHandler) {
  try {
    if (!channel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    await channel.consume(QUEUE_NAME, async (data) => {
      try {
        const message = JSON.parse(data.content);
        await messageHandler(message);
        channel.ack(data);
      } catch (error) {
        console.error('Error processing message:', error);
        // Mesajı queue'ya geri koy
        channel.nack(data);
      }
    });

    console.log('RabbitMQ consumer started');
  } catch (error) {
    console.error('Error starting consumer:', error);
    throw error;
  }
}

async function publishMessage(queue, message) {
  try {
    if (!channel) {
      await connectQueue();
    }

    await channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
      persistent: true,
    });

    console.log('Message published successfully');
  } catch (error) {
    console.error('Error publishing message:', error);
    throw error;
  }
}

async function publishTransfer(transferData) {
  try {
    if (!channel) {
      await connectQueue();
    }

    console.log('Publishing transfer request:', {
      campaignId: transferData.campaignId,
      publicKey: transferData.publicKey,
    });

    await channel.sendToQueue(
      TRANSFER_QUEUE,
      Buffer.from(JSON.stringify(transferData)),
      { persistent: true }
    );

    console.log('Transfer request published successfully');
  } catch (error) {
    console.error('Error publishing transfer request:', error);
    throw error;
  }
}

export {
  connectQueue,
  publishMessage,
  publishTransfer,
  TRANSFER_QUEUE,
  NOTIFICATION_QUEUE,
};
