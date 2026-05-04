// Popup script for Cross-Tab Utility Extension

class PopupController {
  constructor() {
    this.extensionState = {
      enabled: true,
      sphereVisible: true,
      pulseEnabled: true
    };
    
    this.stats = {
      activeTabCount: 0,
      totalClicks: 0
    };
    
    this.initializeElements();
    this.initializeEventListeners();
    this.loadInitialState();
    this.refreshData();
  }
  
  initializeElements() {
    // Status elements
    this.statusIndicator = document.getElementById('statusIndicator');
    this.statusText = this.statusIndicator.querySelector('.status-text');
    this.statusDot = this.statusIndicator.querySelector('.status-dot');
    
    // Stats elements
    this.activeTabCount = document.getElementById('activeTabCount');
    this.totalClicks = document.getElementById('totalClicks');
    
    // Control elements
    this.enableExtension = document.getElementById('enableExtension');
    this.showSphere = document.getElementById('showSphere');
    this.enablePulse = document.getElementById('enablePulse');
    
    // Tabs list
    this.tabsList = document.getElementById('tabsList');
    
    // Footer buttons
    this.clearDataBtn = document.getElementById('clearData');
    this.openOptionsBtn = document.getElementById('openOptions');
  }
  
  initializeEventListeners() {
    // Handle popup click for simple toggle
    document.addEventListener('click', (e) => {
      // Only toggle if clicking on the main popup area (not controls)
      if (e.target.closest('.popup-container') && !e.target.closest('button, input, .control-item')) {
        this.toggleExtension();
      }
    });
    
    // Control toggles
    this.enableExtension.addEventListener('change', () => {
      this.updateExtensionState('enabled', this.enableExtension.checked);
    });
    
    this.showSphere.addEventListener('change', () => {
      this.updateExtensionState('sphereVisible', this.showSphere.checked);
    });
    
    this.enablePulse.addEventListener('change', () => {
      this.updateExtensionState('pulseEnabled', this.enablePulse.checked);
    });
    
    // Footer buttons
    this.clearDataBtn.addEventListener('click', () => {
      this.clearData();
    });
    
    this.openOptionsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }
  
  async loadInitialState() {
    try {
      const result = await chrome.storage.sync.get([
        'enabled',
        'sphereVisible',
        'pulseEnabled',
        'totalClicks'
      ]);
      
      this.extensionState = {
        enabled: result.enabled !== false,
        sphereVisible: result.sphereVisible !== false,
        pulseEnabled: result.pulseEnabled !== false
      };
      
      this.stats.totalClicks = result.totalClicks || 0;
      
      this.updateUI();
    } catch (error) {
      console.error('Error loading initial state:', error);
    }
  }
  
  async refreshData() {
    try {
      // Get active tabs from background script
      const response = await this.sendMessage({
        action: 'getActiveTabs'
      });
      
      if (response) {
        this.stats.activeTabCount = response.length;
        this.updateTabsList(response);
      }
      
      this.updateStats();
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  }
  
  updateUI() {
    // Update status indicator
    const isActive = this.extensionState.enabled && this.extensionState.sphereVisible;
    this.statusText.textContent = isActive ? 'Active' : 'Inactive';
    this.statusDot.className = isActive ? 'status-dot active' : 'status-dot';
    
    // Update control states
    this.enableExtension.checked = this.extensionState.enabled;
    this.showSphere.checked = this.extensionState.sphereVisible;
    this.enablePulse.checked = this.extensionState.pulseEnabled;
  }
  
  updateStats() {
    this.activeTabCount.textContent = this.stats.activeTabCount;
    this.totalClicks.textContent = this.stats.totalClicks;
  }
  
  updateTabsList(tabs) {
    if (!tabs || tabs.length === 0) {
      this.tabsList.innerHTML = '<div class="no-tabs">No active tabs</div>';
      return;
    }
    
    const tabsHTML = tabs.map(tab => `
      <div class="tab-item">
        <div class="tab-info">
          <div class="tab-title">${this.escapeHtml(tab.title || 'Untitled')}</div>
          <div class="tab-url">${this.escapeHtml(tab.url || '')}</div>
        </div>
        <div class="tab-status ${tab.sphereActive ? 'active' : 'inactive'}">
          ${tab.sphereActive ? '●' : '○'}
        </div>
      </div>
    `).join('');
    
    this.tabsList.innerHTML = tabsHTML;
  }
  
  async toggleExtension() {
    // Toggle the extension enabled state
    const newState = !this.extensionState.enabled;
    this.extensionState.enabled = newState;
    
    try {
      // Save to storage
      await chrome.storage.sync.set({ enabled: newState });
      
      // Send toggle message to all tabs
      await this.sendMessage({
        action: 'toggleListeningMode'
      });
      
      // Update UI
      this.updateUI();
      
      // Show feedback
      this.showFeedback(newState ? 'Extension enabled' : 'Extension disabled');
      
      // Close popup after toggle
      setTimeout(() => {
        window.close();
      }, 500);
      
    } catch (error) {
      console.error('Error toggling extension:', error);
      this.showFeedback('Error toggling extension', 'error');
    }
  }
  
  async updateExtensionState(key, value) {
    this.extensionState[key] = value;
    
    try {
      // Save to storage
      await chrome.storage.sync.set({ [key]: value });
      
      // Update background script
      await this.sendMessage({
        action: 'updateExtensionState',
        state: this.extensionState
      });
      
      this.updateUI();
    } catch (error) {
      console.error('Error updating extension state:', error);
    }
  }
  
  async clearData() {
    if (!confirm('Are you sure you want to clear all extension data?')) {
      return;
    }
    
    try {
      await chrome.storage.sync.clear();
      
      // Reset to defaults
      this.extensionState = {
        enabled: true,
        sphereVisible: true,
        pulseEnabled: true
      };
      
      this.stats = {
        activeTabCount: 0,
        totalClicks: 0
      };
      
      this.updateUI();
      this.updateStats();
      
      // Show feedback
      this.showFeedback('Data cleared successfully');
    } catch (error) {
      console.error('Error clearing data:', error);
      this.showFeedback('Error clearing data', 'error');
    }
  }
  
  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  showFeedback(message, type = 'success') {
    const feedback = document.createElement('div');
    feedback.className = `feedback ${type}`;
    feedback.textContent = message;
    
    document.body.appendChild(feedback);
    
    setTimeout(() => {
      feedback.classList.add('show');
    }, 10);
    
    setTimeout(() => {
      feedback.classList.remove('show');
      setTimeout(() => {
        feedback.remove();
      }, 300);
    }, 2000);
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
