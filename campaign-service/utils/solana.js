import axios from "axios";
import { headers } from "../config.js";
import dotenv from "dotenv";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Keypair } from "@solana/web3.js";
import { redisClient } from "./redis.js";
import { Campaign } from "../models/Campaign.js";
import bs58 from "bs58";
import { publishMessage } from "./rabbitmq.js";
import { Portal } from "../models/Portal.js";
dotenv.config();

const { SOLANA_RPC_HTTP, USDC_MINT } = process.env;

const getSOLBalance = async (address) => {
  const payload = {
    jsonrpc: "2.0",
    method: "getBalance",
    params: [address, { commitment: "confirmed" }],
    id: 1,
  };

  const data = await axios.post(SOLANA_RPC_HTTP, payload, { headers });
  return data.data.result.value / LAMPORTS_PER_SOL;
};

const getUSDCBalance = async (address) => {
  let ata;
  console.log({ addressToCheck: address, usdcMint: USDC_MINT });
  try {
    ata = getAssociatedTokenAddressSync(
      new PublicKey(USDC_MINT),
      new PublicKey(address),
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  } catch (error) {
    console.log({ error });
  }
  if (!ata) return 0;
  const payload = {
    jsonrpc: "2.0",
    method: "getTokenAccountBalance",
    params: [ata, { commitment: "confirmed" }],
    id: 1,
  };

  const data = await axios.post(SOLANA_RPC_HTTP, payload, { headers });
  console.log({ data: data.data.result?.value });
  return data.data.result?.value?.uiAmount || 0;
};

const getBalance = async (address) => {
  const [solBalance, usdcBalance] = await Promise.all([
    getSOLBalance(address),
    getUSDCBalance(address),
  ]);
  return { SOL: solBalance, USDC: usdcBalance };
};

const parseCampaignStatus = async (address) => {
  const campaign = await Campaign.findOne({ publicKey: address });
  if (!campaign) throw new Error("Campaign not found");
  const price = await redisClient.get("prices");
  const { SOL: solPrice } = JSON.parse(price);
  const {
    name,
    groupId,
    serviceName,
    productName,
    productPrice,
    status,
    transferredBalance,
  } = campaign;
  const balance = await getBalance(address);
  const { SOL, USDC } = balance;
  const accountValue = SOL * solPrice + USDC + parseFloat(transferredBalance);
  const progress = (accountValue / productPrice) * 100;

  if (status === "active" && progress >= 100) {
    campaign.status = "pending";
    await campaign.save();

    // Target reached mesajını RabbitMQ'ya gönder
    await publishMessage("campaign_notifications", {
      type: "target_reached",
      data: {
        _id: campaign._id,
        name,
        groupId,
        serviceName,
        productName,
        productPrice,
        SOL,
        USDC,
        accountValue,
        progress,
        solPrice,
        transferredBalance,
        publicKey: campaign.publicKey,
      },
    });
  }

  return {
    name,
    groupId,
    serviceName,
    productName,
    productPrice,
    status: campaign.status, // Güncellenmiş statusu döndür
    transferredBalance,
    SOL,
    USDC,
    accountValue,
    progress,
    solPrice,
  };
};

const parseCampaignTransaction = async (transfer) => {
  const {
    SOL,
    USDC,
    delta,
    currency,
    publicKey,
    signer,
    transactionHash,
    notify,
  } = transfer;

  // Debug için transfer objesini kontrol edelim
  console.log("Transfer object:", {
    publicKey,
    signer,
    transactionHash,
    currency,
  });

  if (!notify) throw new Error("No need to notify");
  const campaign = await Campaign.findOne({ publicKey });
  if (!campaign) throw new Error("Campaign not found");

  const { SOL: solPrice } = JSON.parse(await redisClient.get("prices"));
  const {
    name,
    groupId,
    serviceName,
    productName,
    productPrice,
    status,
    transferredBalance,
  } = campaign;

  const accountValue = SOL * solPrice + USDC + parseFloat(transferredBalance);
  const progress = (accountValue / productPrice) * 100;

  if (status === "active" && progress >= 100) {
    await Campaign.updateOne({ publicKey }, { status: "pending" });

    // Target reached mesajını RabbitMQ'ya gönder
    await publishMessage("campaign_notifications", {
      type: "target_reached",
      data: {
        _id: campaign._id,
        name,
        groupId,
        serviceName,
        productName,
        productPrice,
        SOL,
        USDC,
        accountValue,
        progress,
        solPrice,
        transferredBalance,
        publicKey,
      },
    });
  }

  return {
    name,
    groupId,
    serviceName,
    productName,
    productPrice,
    status,
    transferredBalance,
    SOL,
    USDC,
    accountValue,
    progress,
    solPrice,
    signer,
    transactionHash,
    currency,
    delta,
    publicKey,
  };
};

const createCampaign = async (
  groupId,
  serviceName,
  productName,
  price,
  chat = null
) => {
  try {
    if (!groupId || !serviceName || !productName || !price) {
      throw new Error("Invalid campaign data");
    }
    const keypair = Keypair.generate();

    // Portal linkini bul veya grup username'ini kullan
    const portal = await Portal.findOne({ groupId });
    let portalLink = portal?.portalLink || "";

    // Eğer portal link yoksa ve chat bilgisi varsa, grup linkini kullan
    if (!portalLink && chat?.username) {
      portalLink = `t.me/${chat.username}`;
    }

    // Yeni kampanya oluştur
    const campaign = new Campaign({
      name: `${serviceName}-${productName}-${groupId}`,
      publicKey: keypair.publicKey.toString(),
      privateKey: bs58.encode(keypair.secretKey),
      groupId,
      serviceName,
      productName,
      productPrice: price * 1.1,
      status: "active",
      portalLink,
    });

    await campaign.save();
    return campaign;
  } catch (error) {
    console.error("Error creating campaign:", error);
    throw error;
  }
};

const transferBiassedBalance = async (fromPublicKey, toPublicKey) => {
  const prevCampaign = await Campaign.findOne({
    publicKey: fromPublicKey,
    status: "active",
  });

  const newCampaign = await Campaign.findOne({
    publicKey: toPublicKey,
    status: "active",
  });

  if (!prevCampaign || !newCampaign) {
    throw new Error("Campaign not found");
  }

  const prices = await redisClient.get("prices");
  const { SOL: solPrice } = JSON.parse(prices);
  const { SOL: prevSolBalance, USDC: prevUsdcBalance } = await getBalance(
    prevCampaign.publicKey
  );

  const prevValue =
    prevSolBalance * solPrice +
    prevUsdcBalance +
    parseFloat(prevCampaign.transferredBalance);

  console.log({ prevValue, prevSolBalance, prevUsdcBalance, solPrice });
  prevCampaign.transferredBalance = 0;
  prevCampaign.status = "cancelled";

  newCampaign.transferredBalance = prevValue;

  await Promise.all([prevCampaign.save(), newCampaign.save()]);
};

const cancelCampaign = async (publicKey) => {
  const campaign = await Campaign.findOne({
    publicKey,
    status: "active",
  });
  if (!campaign) throw new Error("Campaign not found");
  campaign.status = "cancelled";
  await campaign.save();
};

const getCampaigns = async (groupId, page, limit) => {
  const total = await Campaign.countDocuments({
    groupId,
  });
  const campaigns = await Campaign.find({
    groupId,
  })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  return { campaigns, total };
};

export {
  getBalance,
  parseCampaignStatus,
  parseCampaignTransaction,
  createCampaign,
  transferBiassedBalance,
  cancelCampaign,
  getCampaigns,
};
