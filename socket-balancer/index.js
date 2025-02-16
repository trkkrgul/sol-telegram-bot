import { headers } from './config.js';
import dotenv from 'dotenv';
import redisClient from './utils/redis.js';
import {
  getAssociatedUSDCAddress,
  processLatestSolTransaction,
  processLatestUSDCTransaction,
} from './utils/solana.js';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { connectQueue, sendToQueue } from './utils/rabbitmq.js';

dotenv.config();

const { SOLANA_RPC_WS, WALLETS_PER_BALANCER } = process.env;
// Task slot string olarak gelecek, parseInt ile sayıya çevirelim
const BALANCER_INDEX = parseInt(process.env.BALANCER_INDEX || '0', 10);

const processMap = new Map();
let ws; // Global WebSocket instance

// Redis subscriber instance'ı redisClient'dan oluştur
const subscriber = redisClient.duplicate();

function generateUUID() {
  return uuidv4();
}

// getAssignedWallets fonksiyonunu güncelle
async function getAssignedWallets() {
  const allWallets = await redisClient.sMembers('wallets');
  // Task.Slot 1'den başladığı için 1 çıkaralım
  const balancerIndex = BALANCER_INDEX - 1;
  const startIndex = balancerIndex * WALLETS_PER_BALANCER;
  const endIndex = startIndex + WALLETS_PER_BALANCER;

  const assignedWallets = allWallets.slice(startIndex, endIndex);
  console.log(`Balancer #${BALANCER_INDEX} assigned wallets:`, assignedWallets);

  return assignedWallets;
}

function getWalletOfSolSubscriptionId(map, subscriptionId) {
  for (let [key, value] of map.entries()) {
    if (value.solanaSubscriptionId === subscriptionId) {
      return key;
    }
  }
}
function getWalletOfUSDCSubscriptionId(map, subscriptionId) {
  for (let [key, value] of map.entries()) {
    if (value.usdcSubscriptionId === subscriptionId) {
      return key;
    }
  }
}
function subscribeToWalletForSolanaUpdates(wallet) {
  const id = 'sol-' + wallet;
  const payload = {
    jsonrpc: '2.0',
    id,
    method: 'accountSubscribe',
    params: [wallet, { encoding: 'jsonParsed', commitment: 'confirmed' }],
  };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    console.error('WebSocket is not connected');
  }
  return id;
}

function unsubscribeFromWalletForSolanaUpdates(id) {
  const payload = {
    jsonrpc: '2.0',
    id: generateUUID(),
    method: 'accountUnsubscribe',
    params: [id],
  };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    console.error('WebSocket is not connected');
  }
}

//2.subscribe to wallet's associated usdc address for usdc updates
function subscribeToWalletForUSDCUpdates(wallet) {
  const id = 'usdc-' + wallet;
  const usdcBalanceAddress = getAssociatedUSDCAddress(wallet);
  const payload = {
    jsonrpc: '2.0',
    id,
    method: 'accountSubscribe',
    params: [
      usdcBalanceAddress,
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ],
  };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    console.error('WebSocket is not connected');
  }
  return id;
}

function unsubscribeFromWalletForUSDCUpdates(id) {
  const payload = {
    jsonrpc: '2.0',
    id: generateUUID(),
    method: 'accountUnsubscribe',
    params: [id],
  };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    console.error('WebSocket is not connected');
  }
}

async function updateWallets() {
  const currentWallets = new Set(processMap.keys());
  const newWallets = new Set(await getAssignedWallets());

  // Yeni eklenen cüzdanları bul
  const walletsToBeSubscribed = [...newWallets].filter(
    (wallet) => !currentWallets.has(wallet)
  );

  // Silinmiş cüzdanları bul
  const walletsToBeUnsubscribed = [...currentWallets].filter(
    (wallet) => !newWallets.has(wallet)
  );

  console.log({
    currentWalletCount: currentWallets.size,
    newWalletCount: newWallets.size,
    toSubscribe: walletsToBeSubscribed.length,
    toUnsubscribe: walletsToBeUnsubscribed.length,
  });

  // Yeni cüzdanları subscribe et
  for (const wallet of walletsToBeSubscribed) {
    subscribeToWalletForSolanaUpdates(wallet);
    subscribeToWalletForUSDCUpdates(wallet);
  }

  // Eski cüzdanları unsubscribe et
  for (const wallet of walletsToBeUnsubscribed) {
    const { solanaSubscriptionId, usdcSubscriptionId } = processMap.get(wallet);
    if (solanaSubscriptionId)
      unsubscribeFromWalletForSolanaUpdates(solanaSubscriptionId);
    if (usdcSubscriptionId)
      unsubscribeFromWalletForUSDCUpdates(usdcSubscriptionId);
    processMap.delete(wallet);
  }
}

async function main() {
  try {
    // Redis bağlantıları
    await redisClient.connect();
    await subscriber.connect();
    console.log('Redis connections established');

    // RabbitMQ bağlantısı
    await connectQueue();
    console.log('RabbitMQ connection established');

    console.log(`Running as balancer #${BALANCER_INDEX}`);

    // SIGTERM handler
    process.on('SIGTERM', async () => {
      console.log('Received SIGTERM signal, starting graceful shutdown...');
      try {
        // Mevcut subscription'ları temizle
        for (const [wallet, subscriptions] of processMap.entries()) {
          if (subscriptions.solanaSubscriptionId) {
            unsubscribeFromWalletForSolanaUpdates(
              subscriptions.solanaSubscriptionId
            );
          }
          if (subscriptions.usdcSubscriptionId) {
            unsubscribeFromWalletForUSDCUpdates(
              subscriptions.usdcSubscriptionId
            );
          }
        }

        // Redis ve WebSocket bağlantılarını kapat
        await redisClient.quit();
        await subscriber.quit();
        if (ws) {
          ws.close();
        }
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    });

    // WebSocket yeniden bağlanma mantığı ekle
    function setupWebSocket() {
      ws = new WebSocket(SOLANA_RPC_WS, { headers });

      ws.on('open', async () => {
        console.log('WebSocket opened');
        // WebSocket bağlantısı açıldığında tüm process map'i temizle
        processMap.clear();
        // Sonra tüm cüzdanları yeniden subscribe et
        await updateWallets();

        // Add ping interval
        const pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                jsonrpc: '2.0',
                method: 'ping',
                id: generateUUID(),
              })
            );
            console.log('Ping sent to WebSocket server');
          } else {
            clearInterval(pingInterval);
            console.log('WebSocket not connected, clearing ping interval');
          }
        }, 120000); // 2 minutes = 120000 ms

        // Clear interval when connection closes
        ws.on('close', () => {
          clearInterval(pingInterval);
        });
      });

      ws.on('close', () => {
        console.log(
          'WebSocket closed, attempting to reconnect in 5 seconds...'
        );
        process.exit(0);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      return ws;
    }

    // Wallet değişikliklerini dinle
    subscriber.subscribe('wallet-updates', async (message) => {
      try {
        console.log(
          `Balancer #${BALANCER_INDEX}: Wallet changes detected, updating subscriptions...`
        );

        const wallets = await getAssignedWallets();
        if (wallets.length === 0) {
          console.log(
            'No wallets assigned to this balancer, waiting for next update'
          );
          return;
        }

        await updateWallets();
      } catch (error) {
        console.error('Error handling wallet updates:', error);
      }
    });

    ws = setupWebSocket();

    ws.on('message', async (message) => {
      const data = JSON.parse(message);
      if (data?.id) {
        console.log(data);
        if (data.id.startsWith('sol-')) {
          const wallet = data.id.split('-')[1];
          const existingProcess = processMap.get(wallet);
          if (existingProcess) {
            existingProcess.solanaSubscriptionId = data.result;
          } else {
            processMap.set(wallet, { solanaSubscriptionId: data.result });
          }
        } else if (data.id.startsWith('usdc-')) {
          const wallet = data.id.split('-')[1];
          const existingProcess = processMap.get(wallet);
          if (existingProcess) {
            existingProcess.usdcSubscriptionId = data.result;
          } else {
            processMap.set(wallet, { usdcSubscriptionId: data.result });
          }
        }
      }
      if (data.method && data.method === 'accountNotification') {
        const subscriptionId = data.params.subscription;
        const walletForSolana = getWalletOfSolSubscriptionId(
          processMap,
          subscriptionId
        );
        const walletForUSDC = getWalletOfUSDCSubscriptionId(
          processMap,
          subscriptionId
        );

        if (walletForSolana) {
          const res = await processLatestSolTransaction(walletForSolana);
          if (res.notify) {
            await sendToQueue({
              type: 'SOL',
              ...res,
            });
          }
          console.log({ res });
        }
        if (walletForUSDC) {
          const res = await processLatestUSDCTransaction(walletForUSDC);
          if (res.notify) {
            await sendToQueue({
              type: 'USDC',
              ...res,
            });
          }
          console.log({ res });
        }
      }
    });
  } catch (error) {
    console.error('Error in main:', error);
    process.exit(1);
  }
}

main().catch(console.error);
