// Fixed sendFunctionResult method with correct JSON structure
// The issue was that the field should be "response" not "response"

async sendFunctionResult(functionName, functionResult, originalContents) {
    try {
      console.log('📤 Sending function result back to Gemini...');
      
      const functionResponse = {
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: functionName,
              response: functionResult
            }
          }
        ]
      };
      
      // Create new request with function result
      const followUpContents = [...originalContents, functionResponse];
      
      const followUpRequestBody = {
        contents: followUpContents,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      };
      
      const followUpResponse = await fetch(`${this.config.baseUrl}/${this.config.model}:generateContent`, {
        method: 'POST',
        headers: this.config.getAuthHeaders(),
        body: JSON.stringify(followUpRequestBody)
      });
      
      if (!followUpResponse.ok) {
        const error = await followUpResponse.json();
        throw new Error(`Gemini API Error: ${error.error?.message || followUpResponse.statusText}`);
      }
      
      const followUpData = await followUpResponse.json();
      return followUpData;
      
    } catch (error) {
      console.error('❌ Function result failed:', error);
      throw error;
    }
  }
