const mongoose = require('mongoose');
const Card = require('./models/Card');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to Atlas for seeding...'))
  .catch(err => console.error('Connection failed:', err));

// This is mainly to be used once to get all the data from taboo-game library
// into cards that can be used while running the game.
const seedDatabase = async () => {
  try {
    // clear if out completely to ensure no duplicates
    await Card.deleteMany({});
    console.log('Database cleared. Fetching ALL categories...');

    const dataPath = path.join(__dirname, 'node_modules', 'taboo-data', 'src', 'data', 'en');
    const files = fs.readdirSync(dataPath);

    let allFormattedCards = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        // Grab the raw file name (e.g., 'sports.json') and capitalize it ('Sports')
        const categoryRaw = file.replace('.json', '');
        const categoryName = categoryRaw.charAt(0).toUpperCase() + categoryRaw.slice(1);

        // Fetch the data from that specific file from taboo data library
        const categoryData = require(`taboo-data/src/data/en/${file}`);
        
        // Transform the key-value pairs into our Mongoose schema format
        const formattedCards = Object.entries(categoryData).map(([keyword, buzzwords]) => {
          return {
            targetWord: keyword,
            tabooWords: buzzwords,
            category: categoryName
          };
        });

        // Add this category's cards to our master deck
        allFormattedCards = allFormattedCards.concat(formattedCards);
        console.log(`Loaded ${formattedCards.length} cards from ${categoryName}`);
      }
    }

    await Card.insertMany(allFormattedCards);
    console.log(`\n🎉 Success! Inserted a total of ${allFormattedCards.length} cards into the database.`);

    // Exit cleanly
    mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();