import axios from 'axios';
import dotenv from 'dotenv';
import { headers } from '../config.js';
dotenv.config();

const { SOLANA_RPC_HTTP } = process.env;
const POOL_ADDRESS = 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const WSOL_VAULT = 'ANP74VNsHwSrq9uUSjiSNyNWvf6ZPrKTmE4gHoNd13Lg';

const USDC_VAULT = '75HgnSvXbWKZBpZHveX68ZzAhDqMzNDS29X6BGLtxMo1';

const getTokenAccountBalance = async (address) => {
  const payload = {
    jsonrpc: '2.0',
    method: 'getTokenAccountBalance',
    params: [address],
    id: 1,
  };

  const response = await axios.post(SOLANA_RPC_HTTP, payload, { headers });
  return response.data.result.value.amount;
};

const calculatePrice = async () => {
  try {
    const [_wsolBalance, _usdcBalance] = await Promise.all([
      getTokenAccountBalance(WSOL_VAULT),
      getTokenAccountBalance(USDC_VAULT),
    ]);

    const wsolBalance = _wsolBalance / 10 ** 9;
    const usdcBalance = _usdcBalance / 10 ** 6;

    // USDC'yi 1 kabul ederek SOL fiyatını hesapla
    // Fiyat = USDC miktarı / WSOL miktarı

    return {
      SOL: usdcBalance / wsolBalance,
      USDC: 1,
    };
  } catch (error) {
    console.error('Error calculating price:', error);
    throw error;
  }
};

export { calculatePrice };
