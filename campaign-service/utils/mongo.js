import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

export async function connectMongo() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 60000,
      heartbeatFrequencyMS: 2000,
      retryWrites: true,
      w: 'majority',
      readPreference: 'primary',
      directConnection: true,
      bufferCommands: true,
      bufferTimeoutMS: 30000,
    });
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

export async function closeMongo() {
  await mongoose.connection.close();
  console.log('Closed MongoDB connection');
}
