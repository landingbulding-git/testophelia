// Script to check available Gemini models
// Run this in browser console with your API key

const API_KEY = 'AIzaSyDSGTYFrveOUR9id5yuD7CVGv78Wf7bqQU';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1';

async function checkAvailableModels() {
  try {
    console.log('🔍 Checking available Gemini models...');
    
    const response = await fetch(`${BASE_URL}/models?key=${API_KEY}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('✅ Available models:', data);
    
    // Filter for models that support generateContent
    const generateContentModels = data.models.filter(model => 
      model.supportedGenerationMethods && 
      model.supportedGenerationMethods.includes('generateContent')
    );
    
    console.log('🎯 Models supporting generateContent:', generateContentModels);
    
    // Find the cheapest/lightest option
    const flashModels = generateContentModels.filter(model => 
      model.name.includes('flash')
    );
    
    console.log('⚡ Flash models:', flashModels);
    
    // Recommend the best option
    if (flashModels.length > 0) {
      console.log('💡 Recommended model:', flashModels[0].name);
      console.log('📝 Use this in gemini-config.js:', flashModels[0].name.split('/').pop());
    }
    
  } catch (error) {
    console.error('❌ Error checking models:', error);
  }
}

// Run the check
checkAvailableModels();
