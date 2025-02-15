import axios from 'axios';
import { Campaign } from '../models/Campaign.js';
import { connectQueue } from '../utils/rabbitmq.js';
import { headers } from '../config.js';
import TelegramBot from '../telegram/bot.js';
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { redisClient } from '../utils/redis.js';
import { formatAddress, ICONS } from '../utils/format.js';
import { getSolscanAccountLink, getSolscanTxLink } from '../utils/solscan.js';

class TransferService {
  constructor() {
    if (TransferService.instance) {
      return TransferService.instance;
    }
    this.bot = new TelegramBot().getInstance();
    this.maxRetries = 3;

    // Transfer için özel RPC bağlantısını kullan
    this.connection = new Connection(
      process.env.TRANSFER_SOLANA_RPC_HTTP,
      'confirmed'
    );

    if (!process.env.TRANSFER_SOLANA_RPC_HTTP) {
      throw new Error('TRANSFER_SOLANA_RPC_HTTP is not configured');
    }

    console.log(
      'Transfer service initialized with RPC:',
      process.env.TRANSFER_SOLANA_RPC_HTTP
    );

    TransferService.instance = this;
  }

  // Telegram MarkdownV2 için özel escape fonksiyonu
  escapeMarkdownV2(text) {
    if (!text) return '';
    return text.toString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  // Mesaj oluşturma fonksiyonu
  createTransferMessage(data) {
    const {
      transferredUSDC,
      transferredSOL,
      usdcTx,
      solTx,
      solPrice,
      publicKey,
      totalValueInUSD,
      campaign,
      totalWithVirtual,
    } = data;

    const parts = [];

    // Header
    parts.push('✅ Transfer completed successfully\\!');
    parts.push('');
    parts.push('💰 \\*Transfer Summary\\*');

    // USDC Transfer
    if (transferredUSDC > 0) {
      parts.push(
        `${ICONS.USDC} USDC: \`\\$${this.escapeMarkdownV2(
          transferredUSDC.toFixed(2)
        )}\``
      );
      parts.push(
        `${ICONS.HASH} [View Transaction](${this.escapeMarkdownV2(
          getSolscanTxLink(usdcTx)
        )})`
      );
      parts.push('');
    }

    // SOL Transfer
    if (transferredSOL > 0) {
      parts.push(
        `${ICONS.SOL} SOL: \`${this.escapeMarkdownV2(
          transferredSOL.toFixed(6)
        )}\` \\(≈ \\$${this.escapeMarkdownV2(
          (transferredSOL * solPrice).toFixed(2)
        )}\\)`
      );
      parts.push(
        `${ICONS.HASH} [View Transaction](${this.escapeMarkdownV2(
          getSolscanTxLink(solTx)
        )})`
      );
      parts.push('');
    }

    // Campaign Details
    parts.push(`${ICONS.CAMPAIGN} \\*Campaign Details\\*`);
    parts.push(
      `${ICONS.WALLET} Public Key: \`${this.escapeMarkdownV2(publicKey)}\``
    );
    parts.push(
      `[View Wallet in Solscan](${this.escapeMarkdownV2(
        getSolscanAccountLink(publicKey)
      )})`
    );
    parts.push('');

    // Total Values
    parts.push(
      `${ICONS.TOTAL} Total Value: \`\\$${this.escapeMarkdownV2(
        totalValueInUSD.toFixed(2)
      )}\``
    );

    if (campaign.transferredBalance) {
      parts.push(
        `${ICONS.PLUS} Virtual Balance: \`\\$${this.escapeMarkdownV2(
          parseFloat(campaign.transferredBalance).toFixed(2)
        )}\``
      );
      parts.push(
        `${ICONS.BALANCE} Total with Virtual: \`\\$${this.escapeMarkdownV2(
          totalWithVirtual.toFixed(2)
        )}\``
      );
    }

    return parts.join('\n');
  }

  async updateAdminMessage(chatId, messageId, text, options = {}) {
    try {
      await this.bot.telegram.editMessageText(chatId, messageId, null, text, {
        parse_mode: 'MarkdownV2',
        ...options,
      });
    } catch (error) {
      console.error('Error updating admin message:', error);
    }
  }

  async transferUSDC(transfer) {
    const { publicKey, privateKey, adminWallet } = transfer;

    try {
      // Keypair'leri oluştur
      const fromKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
      const toPublicKey = new PublicKey(adminWallet);
      const usdcMint = new PublicKey(process.env.USDC_MINT);

      // Token hesaplarını bul
      const fromATA = await getAssociatedTokenAddress(
        usdcMint,
        fromKeypair.publicKey
      );
      const toATA = await getAssociatedTokenAddress(usdcMint, toPublicKey);

      // Bakiyeyi kontrol et
      let fromATAInfo;
      try {
        fromATAInfo = await this.connection.getAccountInfo(fromATA);
      } catch (error) {
        console.error('Error getting from ATA info:', error);
      }

      let toATAInfo;
      try {
        toATAInfo = await this.connection.getAccountInfo(toATA);
      } catch (error) {
        console.error('Error getting to ATA info:', error);
      }

      const transaction = new Transaction();

      // Eğer hedef ATA yoksa oluştur
      if (!toATAInfo) {
        console.log('Creating destination ATA...');
        transaction.add(
          createAssociatedTokenAccountInstruction(
            fromKeypair.publicKey, // payer
            toATA, // ata
            toPublicKey, // owner
            usdcMint // mint
          )
        );
      }

      if (!fromATAInfo) {
        throw new Error('Source token account does not exist');
      }

      // Bakiyeyi kontrol et
      const balance = await this.connection.getTokenAccountBalance(fromATA);
      const amount = BigInt(balance.value.amount);

      if (amount <= 0) {
        throw new Error('No USDC balance to transfer');
      }

      // Transfer talimatını ekle
      transaction.add(
        createTransferInstruction(
          fromATA,
          toATA,
          fromKeypair.publicKey,
          amount,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      // Transaction'ı gönder
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromKeypair.publicKey;

      // İmzala ve gönder
      transaction.sign(fromKeypair);
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize()
      );
      await this.connection.confirmTransaction(signature);

      console.log('USDC transfer successful:', signature);
      return { signature };
    } catch (error) {
      console.error('USDC transfer failed:', error);
      throw error;
    }
  }

  async transferSOL(transfer, gasReserve) {
    const { publicKey, privateKey, adminWallet } = transfer;

    try {
      // Keypair'leri oluştur
      const fromKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
      const toPublicKey = new PublicKey(adminWallet);

      // Bakiyeyi kontrol et
      const balance = await this.connection.getBalance(fromKeypair.publicKey);
      const gasReserveInLamports = gasReserve * 1e9; // SOL to lamports
      const transferAmount = balance - gasReserveInLamports;

      if (transferAmount <= 0) {
        throw new Error('Insufficient SOL balance after gas reserve');
      }

      console.log('SOL Transfer Amount:', transferAmount / 1e9, 'SOL');
      console.log('Gas Reserve:', gasReserve, 'SOL');

      // Transfer talimatını oluştur
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: fromKeypair.publicKey,
          toPubkey: toPublicKey,
          lamports: transferAmount,
        })
      );

      // Transaction'ı gönder
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromKeypair.publicKey;

      // İmzala ve gönder
      transaction.sign(fromKeypair);
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize()
      );
      await this.connection.confirmTransaction(signature);

      console.log('SOL transfer successful:', signature);
      return { signature };
    } catch (error) {
      console.error('SOL transfer failed:', error);
      throw error;
    }
  }

  async processTransfer(transfer) {
    const { campaignId, publicKey, messageId, chatId, gasReserve } = transfer;
    let retryCount = 0;
    let success = false;
    let usdcTx = null;
    let solTx = null;
    let transferredUSDC = 0;
    let transferredSOL = 0;

    try {
      // Admin transfer kontrolü
      if (transfer.adminTransfer) {
        // Sadece admin grubundan gelen transferleri işle
        if (transfer.chatId.toString() !== process.env.ADMIN_GROUP_ID) {
          throw new Error('Unauthorized admin transfer attempt');
        }
      }

      // Redis'ten SOL fiyatını al
      const { SOL: solPrice } = JSON.parse(await redisClient.get('prices'));

      // Kampanyayı transferring durumuna güncelle
      await Campaign.updateOne({ publicKey }, { status: 'transferring' });

      // Admin mesajını güncelle - nokta karakterini escape et
      await this.updateAdminMessage(
        chatId,
        messageId,
        '🔄 Transfer in progress\\.\\.\\.'
      );

      // Bakiyeleri kontrol et
      const fromKeypair = Keypair.fromSecretKey(
        bs58.decode(transfer.privateKey)
      );
      const usdcMint = new PublicKey(process.env.USDC_MINT);
      const fromATA = await getAssociatedTokenAddress(
        usdcMint,
        fromKeypair.publicKey
      );

      // USDC bakiyesini kontrol et
      let usdcBalance;
      try {
        const tokenBalance = await this.connection.getTokenAccountBalance(
          fromATA
        );
        usdcBalance = BigInt(tokenBalance.value.amount);
        console.log('USDC Balance:', usdcBalance.toString());
      } catch (error) {
        console.error('Error getting USDC balance:', error);
        usdcBalance = BigInt(0);
      }

      // SOL bakiyesini kontrol et
      const solBalance = await this.connection.getBalance(
        fromKeypair.publicKey
      );
      console.log('SOL Balance:', solBalance / 1e9, 'SOL');

      // Gas fee için minimum SOL
      const gasReserveInLamports = gasReserve * 1e9;

      while (retryCount < this.maxRetries && !success) {
        try {
          // Önce USDC transferini dene
          if (usdcBalance > 0) {
            const result = await this.transferUSDC(transfer);
            usdcTx = result.signature;
            transferredUSDC = Number(usdcBalance) / 1e6; // USDC decimals
            console.log('USDC transfer completed');
          } else {
            console.log('No USDC balance to transfer, proceeding with SOL');
          }

          // SOL transferini dene
          if (solBalance > gasReserveInLamports) {
            const result = await this.transferSOL(transfer, gasReserve);
            solTx = result.signature;
            transferredSOL = (solBalance - gasReserveInLamports) / 1e9;
            console.log('SOL transfer completed');
          } else {
            console.log('Insufficient SOL balance for transfer');
          }

          success = true;

          // Kampanyayı completed olarak işaretle
          const campaign = await Campaign.findOneAndUpdate(
            { publicKey },
            { status: 'completed' },
            { new: true }
          );

          // Transfer özetini hazırla
          const totalValueInUSD = transferredSOL * solPrice + transferredUSDC;
          const totalWithVirtual =
            totalValueInUSD + parseFloat(campaign.transferredBalance || 0);

          const messageData = {
            transferredUSDC,
            transferredSOL,
            usdcTx,
            solTx,
            solPrice,
            publicKey,
            totalValueInUSD,
            campaign,
            totalWithVirtual,
          };

          const summaryMessage = this.createTransferMessage(messageData);

          // Admin mesajını güncelle
          await this.updateAdminMessage(chatId, messageId, summaryMessage);
        } catch (error) {
          retryCount++;
          console.error(`Transfer attempt ${retryCount} failed:`, error);

          if (retryCount < this.maxRetries) {
            const delay = Math.pow(3, retryCount) * 5000;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      if (!success) {
        // Tüm denemeler başarısız oldu
        await Campaign.updateOne({ publicKey }, { status: 'failed' });

        await this.updateAdminMessage(
          chatId,
          messageId,
          '❌ Transfer failed after multiple attempts\\.'
        );
        throw new Error('Transfer failed after all retry attempts');
      }
    } catch (error) {
      console.error('Error in processTransfer:', error);
      throw error;
    }
  }

  async startTransferConsumer() {
    let channel;
    try {
      console.log('Starting transfer consumer...');
      channel = await connectQueue();

      // Prefetch değerini 1 olarak ayarla
      await channel.prefetch(1);

      await channel.consume('campaign_transfers', async (message) => {
        if (!message) {
          console.warn('Received null message from queue');
          return;
        }

        try {
          console.log('Received transfer request');
          const transfer = JSON.parse(message.content.toString());

          // Transfer işlemini gerçekleştir
          await this.processTransfer(transfer);

          // Başarılı işlem sonrası mesajı onayla
          if (channel) {
            channel.ack(message);
            console.log('Message acknowledged successfully');
          }
        } catch (error) {
          console.error('Error processing transfer:', error);

          // Hata durumunda mesajı kuyruğa geri gönder
          if (channel) {
            channel.nack(message, false, true);
            console.log('Message nacked and requeued');
          }
        }
      });

      // Kanal hata yönetimi
      channel.on('error', (err) => {
        console.error('Channel error:', err);
      });

      channel.on('close', () => {
        console.warn('Channel closed, attempting to reconnect...');
        setTimeout(() => this.startTransferConsumer(), 5000);
      });

      console.log('Transfer consumer started successfully');
    } catch (error) {
      console.error('Error starting transfer consumer:', error);

      // Bağlantı hatası durumunda yeniden deneme
      setTimeout(() => this.startTransferConsumer(), 5000);
    }
  }

  // Transaction hash'ini kısaltmak için yardımcı fonksiyon
  formatTx(hash) {
    if (!hash) return '';
    return `${hash.slice(0, 4)}...${hash.slice(-4)}`;
  }
}

export default TransferService;
