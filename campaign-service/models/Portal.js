import mongoose from 'mongoose';

const portalSchema = new mongoose.Schema(
  {
    groupId: {
      type: String,
      required: true,
      unique: true,
    },
    portalLink: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

const Portal = mongoose.model('Portal', portalSchema);

export { Portal };
