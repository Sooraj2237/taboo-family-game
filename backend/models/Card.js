const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  targetWord: { type: String, required: true, unique: true, trim: true },
  tabooWords: { type: [String], required: true }, 
  category: { type: String, default: 'General' }
});

module.exports = mongoose.model('Card', cardSchema);