# Cross-Tab Utility Chrome Extension

A powerful Chrome Extension that injects a persistent, interactive orange sphere into every browser tab, enabling cross-tab communication and utility features.

## Features

- **Orange Pulsing Sphere**: Interactive UI element injected into every tab
- **Cross-Tab Communication**: Real-time synchronization between tabs
- **Persistent State**: Maintains state across browser sessions
- **Responsive Design**: Adapts to different screen sizes
- **Accessibility Support**: High contrast mode and reduced motion options
- **Modern UI**: Beautiful popup interface with controls and statistics

## Installation

### From Source (Development)

1. **Clone or download** this repository to your local machine
2. **Open Chrome Extensions**:
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)
3. **Load the Extension**:
   - Click "Load unpacked"
   - Select the extension directory containing `manifest.json`
4. **Verify Installation**:
   - The extension icon should appear in your toolbar
   - An orange sphere should appear in the bottom-right corner of web pages

### Permissions Required

- `activeTab`: Access to the currently active tab
- `scripting`: Required for content script injection
- `storage`: For persistence and settings
- `<all_urls>`: To work on all websites

## Usage

### Basic Interaction

1. **Orange Sphere**: Located in the bottom-right corner of every tab
   - **Click**: Triggers cross-tab communication
   - **Hover**: Shows tooltip and enhanced animation
   - **Visual Feedback**: Ripple effects and state changes

2. **Extension Popup**: Click the toolbar icon to access:
   - **Statistics**: Active tab count and total clicks
   - **Controls**: Toggle extension features
   - **Active Tabs**: View all synchronized tabs

### Controls

- **Enable Extension**: Turn the entire extension on/off
- **Show Sphere**: Control sphere visibility
- **Pulse Animation**: Toggle pulsing animation

## File Structure

```
cross-tab-utility/
├── manifest.json          # Extension configuration (Manifest V3)
├── background.js          # Service worker for cross-tab management
├── content.js            # Content script for sphere injection
├── popup.html            # Extension popup interface
├── popup.js              # Popup functionality
├── popup.css             # Popup styling
├── styles.css            # Main sphere and content styles
├── icons/                # Extension icons (16, 32, 48, 128px)
└── README.md             # This file
```

## Technical Details

### Architecture

- **Manifest V3**: Uses modern Chrome Extension standards
- **Service Worker**: Background script for tab management
- **Content Scripts**: Inject UI into web pages
- **Storage API**: Persistent settings and state
- **Message Passing**: Cross-tab communication

### Key Components

#### Background Service Worker (`background.js`)
- Manages active tab tracking
- Handles cross-tab message broadcasting
- Maintains extension state
- Provides tab lifecycle management

#### Content Script (`content.js`)
- Injects orange sphere into DOM
- Handles user interactions
- Communicates with background script
- Manages sphere animations and states

#### Popup Interface (`popup.html`, `popup.js`, `popup.css`)
- Extension control panel
- Real-time statistics
- Settings management
- Active tab monitoring

### Styling Features

- **Responsive Design**: Adapts to mobile and desktop
- **Animations**: Smooth pulsing and hover effects
- **Accessibility**: High contrast and reduced motion support
- **Dark Mode**: Automatic theme detection

## Development

### Building from Source

1. **Modify files** as needed
2. **Reload Extension**:
   - Go to `chrome://extensions/`
   - Click the reload button for the extension
3. **Test Changes**:
   - Refresh web pages to see content script changes
   - Reopen popup for interface changes

### Debugging

- **Background Script**: `chrome://extensions/` → "Service Worker" link
- **Content Script**: Browser DevTools → Console
- **Popup**: Right-click popup → "Inspect"

## Browser Compatibility

- **Chrome**: v88+ (Manifest V3 support)
- **Edge**: v88+ (Chromium-based)
- **Opera**: v74+ (Chromium-based)
- **Firefox**: Not supported (uses Manifest V2)

## Security Considerations

- **Minimal Permissions**: Only requests necessary permissions
- **Content Security**: Follows Chrome Extension security best practices
- **No External Dependencies**: Self-contained implementation
- **Secure Messaging**: Validated message passing between components

## Troubleshooting

### Common Issues

1. **Sphere Not Appearing**:
   - Check if extension is enabled
   - Verify permissions are granted
   - Try refreshing the page

2. **Cross-Tab Communication Not Working**:
   - Check background script status
   - Verify content script injection
   - Try disabling and re-enabling the extension

3. **Popup Not Opening**:
   - Check extension permissions
   - Verify popup files exist
   - Try reloading the extension

### Reset Extension

1. Go to `chrome://extensions/`
2. Find "Cross-Tab Utility"
3. Click "Remove" (or toggle off/on)
4. Reinstall if needed

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is open source and available under the [MIT License](LICENSE).

## Support

For issues, questions, or feature requests, please:
- Check the troubleshooting section
- Review the documentation
- Create an issue in the repository

---

**Extension Version**: 1.0.0  
**Manifest Version**: 3  
**Last Updated**: 2026
