// Gemini 3 Flash Configuration and API Management

class GeminiConfig {
  constructor() {
    // 🔒 YOUR PERSONAL API KEY - HARDCODED FOR YOUR USE ONLY
    this.apiKey = 'YOUR_GEMINI_API_KEY_HERE'; // Replace with your actual API key
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.model = 'models/gemini-3.1-flash-lite-preview';
    this.isConfigured = false;
  }

  async initialize() {
    // Use hardcoded API key for personal use
    try {
      if (this.apiKey && this.apiKey !== 'YOUR_API_KEY_HERE') {
        this.isConfigured = true;
        console.log('✅ Gemini API key loaded from code');
      } else {
        console.log('⚠️ Gemini API key not set in code');
        console.log('💡 Please edit gemini-config.js and replace YOUR_API_KEY_HERE with your actual API key');
      }
    } catch (error) {
      console.error('❌ Failed to initialize API key:', error);
    }
  }

  // API key is hardcoded - no dynamic configuration needed

  getAuthHeaders() {
    if (!this.isConfigured) {
      throw new Error('Gemini API not configured');
    }
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.apiKey
    };
  }

  async testConnection() {
    if (!this.isConfigured) {
      throw new Error('API key not configured');
    }

    try {
      const response = await fetch(`${this.baseUrl}/models/${this.model}:generateContent`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: "Hello, this is a test connection."
            }]
          }]
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`API Error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      console.log('✅ Gemini connection test successful');
      return true;
    } catch (error) {
      console.error('❌ Gemini connection test failed:', error);
      throw error;
    }
  }

  // Method to check if API key is configured
  isApiKeyConfigured() {
    return this.isConfigured;
  }

  // Method to get masked API key for display (never expose full key)
  getMaskedApiKey() {
    if (!this.apiKey) return null;
    return this.apiKey.substring(0, 7) + '***' + this.apiKey.substring(this.apiKey.length - 4);
  }
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeminiConfig;
} else {
  window.GeminiConfig = GeminiConfig;
}
