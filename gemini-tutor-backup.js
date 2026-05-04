// Gemini 3 Flash Tutor System for Web Tools Guidance

class GeminiTutor {
  constructor(config) {
    this.config = config;
    this.conversationHistory = [];
    this.maxContextLength = 5; // Keep last 5 messages
    this.currentTask = null;
    this.dreamOutcome = null;
    this.isProcessing = false;
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

  // Set up initial tutor prompt from external file
  getSystemPrompt() {
    if (!window.AGENT_SYSTEM_PROMPT) {
      return 'You are a helpful web tools tutor.';
    }
    
    // Replace placeholders with current context
    return window.AGENT_SYSTEM_PROMPT
      .replace('{CURRENT_URL}', window.location.href)
      .replace('{PAGE_TITLE}', document.title);
  }

  // Manage conversation context (keep last 5 messages)
  updateContext(userMessage, aiResponse) {
    // Add new messages without timestamp (not supported by API)
    this.conversationHistory.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });
    
    this.conversationHistory.push({
      role: 'model',
      parts: [{ text: aiResponse }]
    });
    
    // Keep only last 5 exchanges (10 messages total)
    if (this.conversationHistory.length > 10) {
      this.conversationHistory = this.conversationHistory.slice(-10);
    }
    
    console.log('📝 Conversation context updated:', this.conversationHistory.length, 'messages');
  }

  // Check if task is clearly specified
  isTaskSpecified(userMessage) {
    const taskIndicators = [
      'want to', 'need to', 'trying to', 'goal is', 'objective',
      'achieve', 'create', 'build', 'setup', 'configure', 'implement',
      'learn how to', 'figure out', 'solve', 'fix', 'resolve'
    ];

    return taskIndicators.some(indicator => 
      userMessage.toLowerCase().includes(indicator)
    );
  }

  // Extract and store dream outcome
  extractDreamOutcome(userMessage, aiResponse) {
    if (this.isTaskSpecified(userMessage) && !this.currentTask) {
      this.currentTask = {
        description: userMessage,
        timestamp: Date.now(),
        url: window.location.href,
        pageTitle: document.title
      };

      // Extract the desired outcome from AI's understanding
      this.dreamOutcome = {
        task: userMessage,
        guidance: aiResponse,
        timestamp: Date.now(),
        context: this.conversationHistory.slice(-2) // Last exchange
      };

      console.log('🎯 Dream outcome specified:', this.dreamOutcome);
      return true;
    }
    return false;
  }

  // Main tutoring function
  async getTutoringResponse(userMessage) {
    if (!this.config.isConfigured) {
      throw new Error('Gemini API not configured');
    }

    if (this.isProcessing) {
      return "I'm still processing your previous request. Please wait a moment...";
    }

    this.isProcessing = true;

    try {
      // Prepare conversation context with system instruction
      const systemPrompt = this.getSystemPrompt();
      const contents = [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\nUser: ${userMessage}` }]
        },
        ...this.conversationHistory
      ];

      // Add page context for multimodal understanding
      const pageContext = this.getPageContext();

      const requestBody = {
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      };

      // Add page context if available
      if (pageContext) {
        requestBody.contents.push({
          role: 'user',
          parts: [
            { text: `Current page context: ${pageContext}` }
          ]
        });
      }

      console.log('🤖 Sending request to Gemini...');

      const response = await fetch(`${this.config.baseUrl}/${this.config.model}:generateContent`, {
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

      // Update context and check for task specification
      this.updateContext(userMessage, aiResponse);
      this.extractDreamOutcome(userMessage, aiResponse);

      console.log('✅ Tutor response generated');
      return aiResponse;

    } catch (error) {
      console.error('❌ Tutor response failed:', error);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  // Get current page context for better guidance
  getPageContext() {
    const context = {
      url: window.location.href,
      title: document.title,
      domain: window.location.hostname,
      path: window.location.pathname
    };

    // Try to identify common web platforms
    const platformIdentifiers = {
      'github.com': 'GitHub - Code repository platform',
      'figma.com': 'Figma - Design collaboration tool',
      'notion.so': 'Notion - Productivity and note-taking',
      'slack.com': 'Slack - Team communication',
      'trello.com': 'Trello - Project management',
      'asana.com': 'Asana - Task management',
      'jira.atlassian.com': 'Jira - Issue tracking',
      'discord.com': 'Discord - Community platform',
      'linkedin.com': 'LinkedIn - Professional network',
      'twitter.com': 'Twitter - Social media platform'
    };

    const platform = platformIdentifiers[context.domain];
    if (platform) {
      context.platform = platform;
    }

    return JSON.stringify(context);
  }

  // Get current task and dream outcome
  getCurrentTask() {
    return {
      task: this.currentTask,
      dreamOutcome: this.dreamOutcome,
      contextLength: this.conversationHistory.length / 2
    };
  }

  // Clear conversation history
  clearContext() {
    this.conversationHistory = [];
    this.currentTask = null;
    this.dreamOutcome = null;
    console.log('🗑️ Tutor context cleared');
  }

  // Get conversation summary
  getConversationSummary() {
    if (this.conversationHistory.length === 0) {
      return 'No conversation history yet.';
    }

    const summary = {
      exchanges: this.conversationHistory.length / 2,
      currentTask: this.currentTask?.description || 'No task specified yet',
      dreamOutcome: this.dreamOutcome?.task || 'No dream outcome defined',
      lastActivity: new Date(Math.max(...this.conversationHistory.map(m => m.timestamp))).toLocaleString()
    };

    return summary;
  }
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeminiTutor;
} else {
  window.GeminiTutor = GeminiTutor;
}
