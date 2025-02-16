const dexscreenerBoostPackages = [
  {
    name: "DexScreener Boost",
    packages: [
      { name: "10 Boost", price: 100 },
      { name: "30 Boost", price: 250 },
      { name: "50 Boost", price: 400 },
      { name: "100 Boost", price: 900 },
      { name: "500 Boost", price: 4000 },
    ],
  },
];

const dexscreenerAdsPackages = [
  {
    name: "DexScreener Ads",
    packages: [
      { price: 299, name: "20k Views" },
      { price: 699, name: "50k Views" },
      { price: 999, name: "100k Views" },
      { price: 1999, name: "200k Views" },
      { price: 3999, name: "400k Views" },
      { price: 6999, name: "800k Views" },
    ],
  },
];

const soltrendPackages = [
  {
    name: "SolTrend",
    packages: [
      { price: 5.6, name: "Top 3 (3h)" },
      { price: 9.92, name: "Top 3 (6h)" },
      { price: 17.92, name: "Top 3 (12h)" },
      { price: 29.92, name: "Top 3 (24h)" },
      { price: 4.65, name: "Top 8 (3h)" },
      { price: 8.37, name: "Top 8 (6h)" },
      { price: 15.12, name: "Top 8 (12h)" },
      { price: 25.32, name: "Top 8 (24h)" },
      { price: 3.85, name: "Any Position (3h)" },
      { price: 6.82, name: "Any Position (6h)" },
      { price: 12.32, name: "Any Position (12h)" },
      { price: 21.56, name: "Any Position (24h)" },
    ],
  },
];

const coinmarketcapPackages = [
  {
    name: "CoinMarketCap",
    packages: [{ name: "Fasttrack Listing", price: 5000 }],
  },
];

const coingeckoPackages = [
  {
    name: "CoinGecko",
    packages: [{ name: "Fasttrack Listing", price: 1000 }],
  },
];

const marketing = {
  dexscreenerBoostPackages,
  dexscreenerAdsPackages,
  soltrendPackages,
  coinmarketcapPackages,
  coingeckoPackages,
};

// Tüm servisleri tek bir array'de birleştir
export const services = [
  ...dexscreenerBoostPackages,
  ...dexscreenerAdsPackages,
  ...coinmarketcapPackages,
  ...coingeckoPackages,
];

export default marketing;
