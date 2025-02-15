import axios from 'axios';
import { headers } from '../config.js';
import dotenv from 'dotenv';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
dotenv.config();

const { SOLANA_RPC_HTTP, USDC_MINT } = process.env;

const getSOLBalance = async (address) => {
  const payload = {
    jsonrpc: '2.0',
    method: 'getBalance',
    params: [address, { commitment: 'confirmed' }],
    id: 1,
  };

  const data = await axios.post(SOLANA_RPC_HTTP, payload, { headers });
  return data.data.result.value / LAMPORTS_PER_SOL;
};

const getUSDCBalance = async (address) => {
  let ata;
  try {
    ata = getAssociatedTokenAddressSync(
      new PublicKey(USDC_MINT),
      new PublicKey(address),
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  } catch (error) {}
  if (!ata) return 0;
  const payload = {
    jsonrpc: '2.0',
    method: 'getTokenAccountBalance',
    params: [ata, { commitment: 'confirmed' }],
    id: 1,
  };

  const data = await axios.post(SOLANA_RPC_HTTP, payload, { headers });
  return data.data.result?.value?.uiAmount || 0;
};

const getAssociatedUSDCAddress = (address) => {
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(USDC_MINT),
    new PublicKey(address),
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata.toString();
};

const getBalance = async (address) => {
  const [solBalance, usdcBalance] = await Promise.all([
    getSOLBalance(address),
    getUSDCBalance(address),
  ]);
  return { SOL: solBalance, USDC: usdcBalance };
};

const getLatestTransactionReceipt = async (address) => {
  const payloadForTx = {
    jsonrpc: '2.0',
    method: 'getSignaturesForAddress',
    params: [address, { limit: 1, commitment: 'confirmed' }],
    id: 1,
  };
  const data = await axios.post(SOLANA_RPC_HTTP, payloadForTx, { headers });
  const tx = data.data.result[0].signature;
  const payload = {
    jsonrpc: '2.0',
    method: 'getTransaction',
    params: [tx, { commitment: 'confirmed' }],
    id: 1,
  };
  const res = await axios.post(SOLANA_RPC_HTTP, payload, { headers });
  return res.data.result;
};

const parseSolChange = async (receipt, address) => {
  if (!receipt) return { delta: 0, notify: false };
  const transactionHash = receipt.transaction.signatures[0];
  const accountIndex = receipt.transaction.message.accountKeys.findIndex(
    (key) => key.toString() === address
  );

  if (accountIndex === -1) {
    return {
      delta: 0,
      notify: false,
      transactionHash,
    };
  }

  const delta =
    (receipt.meta.postBalances[accountIndex] -
      receipt.meta.preBalances[accountIndex]) /
    LAMPORTS_PER_SOL;

  if (delta === 0) {
    return {
      delta: 0,
      notify: false,
      transactionHash,
    };
  }
  return {
    delta,
    notify: true,
    currency: 'SOL',
    publicKey: address,
    signer: receipt.transaction.message.accountKeys[0],
    transactionHash,
  };
};

const parseUSDCChange = async (receipt, address) => {
  if (!receipt || !receipt.meta) return { delta: 0, balance: 0, notify: false };
  const transactionHash = receipt.transaction.signatures[0];
  const preTokenBalances = receipt.meta.preTokenBalances.find(
    (e) => e.owner === address
  )?.uiTokenAmount?.uiAmount;
  const postTokenBalances = receipt.meta.postTokenBalances.find(
    (e) => e.owner === address
  )?.uiTokenAmount?.uiAmount;

  const delta = (postTokenBalances || 0) - (preTokenBalances || 0);

  if (delta === 0) {
    return {
      delta: 0,
      balance: 0,
      notify: false,
    };
  }
  return {
    delta,
    notify: true,
    currency: 'USDC',
    publicKey: address,
    signer: receipt.transaction.message.accountKeys[0],
    transactionHash,
  };
};

const parseSolTransaction = async (receipt, address) => {
  const [balances, solChange] = await Promise.all([
    getBalance(address),
    parseSolChange(receipt, address),
  ]);
  return { ...balances, ...solChange };
};

const parseUSDCTransaction = async (receipt, address) => {
  const [balances, usdcChange] = await Promise.all([
    getBalance(address),
    parseUSDCChange(receipt, address),
  ]);
  return { ...balances, ...usdcChange };
};

const processLatestSolTransaction = async (address) => {
  const latestTransaction = await getLatestTransactionReceipt(address);
  const res = await parseSolTransaction(latestTransaction, address);
  return res;
};

const processLatestUSDCTransaction = async (address) => {
  const usdcAddress = getAssociatedUSDCAddress(address);
  const latestTransaction = await getLatestTransactionReceipt(usdcAddress);
  const res = await parseUSDCTransaction(latestTransaction, address);
  return res;
};

// TESTING
// const usdtTransaction =
//   '4Kgmh8A5LnxDfGRoALxAXSUFeSBiyo3HTqRga6NmkjBvF4PvRserwfcpp6KS17QgmdBj7CJNHe4udh6UC7gok3DA';
// const receipt = await axios
//   .post(
//     SOLANA_RPC_HTTP,
//     {
//       jsonrpc: '2.0',
//       method: 'getTransaction',
//       params: [usdtTransaction, { commitment: 'confirmed' }],
//       id: 1,
//     },
//     { headers }
//   )
//   .then((res) => res.data.result);

// const address = '9EaCA2u9exs44if2xPgSSgUmHXdWvqiProYZLo1Vrsmq';
// const parsed = await parseUSDCTransaction(receipt, address);
// console.log(parsed);

export {
  getAssociatedUSDCAddress,
  processLatestSolTransaction,
  processLatestUSDCTransaction,
};
