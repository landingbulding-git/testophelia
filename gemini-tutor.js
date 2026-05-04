// Simple Gemini API Tutor - Basic API Call Only

class GeminiTutor {
  constructor(config) {
    this.config = config;
    this.conversationHistory = []; // Store conversation history
    this.maxHistoryLength = 10; // Keep last 10 messages for context
  }

  // Initialize tutor system
  async initialize() {
    await this.config.initialize();
    if (!this.config.isConfigured) {
      console.log('⚠️ Gemini tutor requires API key configuration');
      return false;
    }
    console.log('✅ Gemini tutor initialized');
    return true;
  }
  
  // Add message to conversation history
  addToHistory(role, message) {
    this.conversationHistory.push({
      role: role,
      parts: [{ text: message }]
    });
    
    // Keep only last maxHistoryLength messages
    if (this.conversationHistory.length > this.maxHistoryLength) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistoryLength);
    }
    
    console.log(`📝 Added to history (${this.conversationHistory.length}/${this.maxHistoryLength}):`, role);
    
    // Save to chrome.storage for cross-tab persistence
    this.saveHistoryToStorage();
  }
  
  // Save conversation history to chrome.storage
  saveHistoryToStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ 'opheliaChatHistory': this.conversationHistory }, () => {
        console.log('💾 Chat history saved to storage');
      });
    }
  }
  
  // Load conversation history from chrome.storage
  loadHistoryFromStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['opheliaChatHistory'], (result) => {
        if (result.opheliaChatHistory && Array.isArray(result.opheliaChatHistory)) {
          this.conversationHistory = result.opheliaChatHistory;
          console.log(`📂 Loaded chat history from storage (${this.conversationHistory.length} messages)`);
        }
      });
    }
  }
  
  // Clear conversation history
  clearHistory() {
    this.conversationHistory = [];
    // Also clear from storage
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.remove('opheliaChatHistory');
    }
    console.log('🗑️ Conversation history cleared');
  }
  
  // Get current history length
  getHistoryLength() {
    return this.conversationHistory.length;
  }

  // Simple API call - just send user message and get response
  async getTutoringResponse(userMessage) {
    if (!this.config.isConfigured) {
      throw new Error('Gemini API not configured');
    }

    try {
      // Add user message to history
      this.addToHistory('user', userMessage);
      
      // Build contents array with conversation history
      const contents = [...this.conversationHistory];
      
      const requestBody = {
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      };

      console.log('🤖 Sending request to Gemini via Cloudflare Worker...');

      const response = await fetch(this.config.workerUrl, {
        method: 'POST',
        headers: this.config.getAuthHeaders(),
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Gemini API Error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      const aiResponse = candidate?.content?.parts?.[0]?.text || 'I apologize, but I couldn\'t generate a response.';

      // Add AI response to history
      this.addToHistory('model', aiResponse);

      console.log('✅ Tutor response generated');
      return aiResponse;

    } catch (error) {
      console.error('❌ Tutor response failed:', error);
      throw error;
    }
  }
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeminiTutor;
} else {
  window.GeminiTutor = GeminiTutor;
}
