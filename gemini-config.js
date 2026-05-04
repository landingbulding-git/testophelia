// Gemini 3 Flash Configuration and API Management
// Now uses Cloudflare Worker for secure API key handling

class GeminiConfig {
  constructor() {
    // Cloudflare Worker URL for secure API calls
    this.workerUrl = 'https://ophelia-gemini-worker.norbertb-consulting.workers.dev'; // Replace with your actual worker URL
    this.model = 'models/gemini-3.1-flash-lite-preview';
    this.isConfigured = false;
  }

  async initialize() {
    // Cloudflare Worker handles API keys securely
    try {
      this.isConfigured = true;
      console.log('✅ Gemini API configured via Cloudflare Worker');
    } catch (error) {
      console.error('❌ Failed to initialize API config:', error);
    }
  }

  // Cloudflare Worker handles API key authentication
  getAuthHeaders() {
    if (!this.isConfigured) {
      throw new Error('Gemini API not configured');
    }
    return {
      'Content-Type': 'application/json'
    };
  }

  async testConnection() {
    if (!this.isConfigured) {
      throw new Error('API key not configured');
    }

    try {
      const response = await fetch(this.workerUrl, {
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
