require('dotenv').config({ quiet: true });

module.exports = {
  aiProvider: 'groq', //"groq (ollama en cloud)" ou "ollama"
  geminiApiKey: process.env.GEMINI_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  port: process.env.PORT || 3000
};

