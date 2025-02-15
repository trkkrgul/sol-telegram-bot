export const formatAddress = (address, length = 4) => {
  if (!address) return '';
  return `${address.slice(0, length)}...${address.slice(-length)}`;
};

// Para birimi formatları
export const CURRENCY_FORMATS = {
  SOL: {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
    notation: 'standard',
  },
  USD: {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    notation: 'standard',
  },
};

export const formatNumber = (number, currency = 'USD') => {
  const defaults = CURRENCY_FORMATS[currency] || CURRENCY_FORMATS.USD;

  // 1M'den büyük sayılar için compact notation
  if (Math.abs(number) > 1000000) {
    defaults.notation = 'compact';
  }

  return Number(number).toLocaleString('en-US', defaults);
};

export const createProgressBar = (progress, length = 20) => {
  // Progress'i 100 ile sınırla
  const cappedProgress = Math.min(progress, 100);

  // Dolu ve boş karakterlerin sayısını hesapla
  const filledLength = Math.round((cappedProgress / 100) * length);
  const emptyLength = length - filledLength;

  // Progress bar'ı oluştur
  const filled = '█'.repeat(Math.max(0, Math.min(filledLength, length)));
  const empty = '░'.repeat(Math.max(0, Math.min(emptyLength, length)));

  return `${filled}${empty}`;
};

// Emoji ve semboller
export const ICONS = {
  NEW_TX: '🔔',
  ALERT: '🚨',
  CAMPAIGN: '📊',
  SERVICE: '⚡️',
  PRODUCT: '🎯',
  PRICE: '💰',
  STATUS: '📌',
  TX_DETAILS: '📝',
  TYPE: '💎',
  AMOUNT: '💵',
  FROM: '👤',
  TO: '👤',
  HASH: '🔗',
  BALANCE: '💼',
  SOL: '◎',
  USDC: '💵',
  TOTAL: '🏦',
  PROGRESS: '📈',
  SUCCESS: '✅',
  WARNING: '⚠️',
  ERROR: '❌',
  INITIAL_FUND: '🏁',
  SOL_ICON: '◎',
  USDC_ICON: '💲',
  RECEIVED: '📥',
  SENT: '📤',
  PLUS: '➕',
  MINUS: '➖',
  EXCHANGE_RATE: '💱',
  WALLET: '🔑',
};
