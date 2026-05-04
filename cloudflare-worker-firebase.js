// Cloudflare Worker for Firebase API Proxy
// This worker hides your Firebase API key and provides secure endpoints for your extension

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;
      
      // Get API keys from environment variables
      const firebaseApiKey = env.FIREBASE_API_KEY;
      const projectId = env.FIREBASE_PROJECT_ID || 'ophelia-bd2e0';
      
      if (!firebaseApiKey) {
        return new Response('FIREBASE_API_KEY not configured', { status: 500 });
      }

      // Handle different Firebase operations
      if (path === '/save-session') {
        return await saveSession(request, firebaseApiKey, projectId);
      } else if (path === '/save-tutorial') {
        return await saveTutorial(request, firebaseApiKey, projectId);
      } else if (path === '/load-tutorial') {
        return await loadTutorial(request, firebaseApiKey, projectId);
      } else {
        return new Response('Invalid endpoint', { status: 404 });
      }

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};

async function saveSession(request, apiKey, projectId) {
  try {
    const body = await request.json();
    const firebaseData = body.firebaseData;
    
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/ophelia_sessions?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(firebaseData)
    });
    
    if (!response.ok) {
      const error = await response.json();
      return new Response(JSON.stringify(error), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    throw error;
  }
}

async function saveTutorial(request, apiKey, projectId) {
  try {
    const body = await request.json();
    const firebaseData = body.firebaseData;
    
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/recording_session?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(firebaseData)
    });
    
    if (!response.ok) {
      const error = await response.json();
      return new Response(JSON.stringify(error), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    throw error;
  }
}

async function loadTutorial(request, apiKey, projectId) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    
    if (!sessionId) {
      return new Response('sessionId required', { status: 400 });
    }
    
    console.log('🔍 Loading tutorial for session_id:', sessionId);
    
    // Use Firebase structured query to filter by session_id
    const firebaseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
    
    const requestBody = {
      structuredQuery: {
        from: [{ collectionId: 'recording_session' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'session_id' },
            op: 'EQUAL',
            value: { stringValue: sessionId }
          }
        }
      }
    };
    
    console.log('🔍 Firebase query:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(firebaseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    console.log('🔍 Firebase response status:', response.status);
    
    if (!response.ok) {
      const error = await response.json();
      console.error('🔍 Firebase error:', error);
      return new Response(JSON.stringify(error), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    const data = await response.json();
    console.log('🔍 Firebase response data:', JSON.stringify(data, null, 2));
    
    // Get the first matching document
    let tutorial = null;
    if (data && data.length > 0 && data[0].document) {
      tutorial = data[0].document;
      console.log('✅ Tutorial found:', tutorial.name);
    } else {
      console.log('❌ No tutorial found in response');
    }
    
    return new Response(JSON.stringify({ tutorial }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('❌ Load tutorial error:', error);
    throw error;
  }
}

function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
