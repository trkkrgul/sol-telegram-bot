import mongoose from 'mongoose';
import { PublicKey } from '@solana/web3.js';

const validateSolanaAddress = (address) => {
  try {
    const pubkey = new PublicKey(address);
    return pubkey.toBase58() === address;
  } catch (error) {
    console.error('Validation error:', error.message);
    return false;
  }
};

const campaignSchema = new mongoose.Schema(
  {
    name: String,
    publicKey: {
      type: String,
      required: true,
      unique: true,
      validate: {
        validator: validateSolanaAddress,
        message: (props) => `${props.value} is not a valid Solana address!`,
      },
    },
    privateKey: {
      type: String,
      required: true,
      unique: true,
      validate: {
        validator: (value) => {
          // Base58 formatında 64 veya 88 karakterlik private key
          return /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value);
        },
        message: 'Invalid Solana private key format!',
      },
    },
    groupId: {
      type: String,
      required: true,
    },
    serviceName: {
      type: String,
      required: true,
    },
    productName: {
      type: String,
      required: true,
    },

    productPrice: {
      type: Number,
      required: true,
      min: [0, 'Price cannot be negative'],
    },

    status: {
      type: String,
      required: true,
      enum: ['active', 'pending', 'completed', 'cancelled'],
      default: 'pending',
    },
    transferredBalance: {
      type: Number,
      default: 0,
      validate: {
        validator: Number.isFinite,
        message: '{VALUE} is not a valid number',
      },
    },
  },
  {
    timestamps: true,
  }
);

// Kaydetmeden önce public key'i normalize et
campaignSchema.pre('save', function (next) {
  try {
    if (this.publicKey instanceof PublicKey) {
      this.publicKey = this.publicKey.toBase58();
    } else {
      const pubkey = new PublicKey(this.publicKey);
      this.publicKey = pubkey.toBase58();
    }
    next();
  } catch (error) {
    next(error);
  }
});

const Campaign = mongoose.model('Campaign', campaignSchema);

// Test fonksiyonu - sadece development ortamında çalıştırılmalı

export { Campaign };
