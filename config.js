require('dotenv').config({ quiet: true });

module.exports = {
  aiProvider: 'gemini', //"gemini" ou "ollama"
  geminiApiKey: process.env.GEMINI_API_KEY
};

