# Extension Mechanism Rules & Behaviors

## Core Architecture
- **Single Instance Extension**: Only one listening/speaking instance active across all tabs
- **Global State Management**: Background script maintains global active state
- **Cross-Tab Exclusivity**: New activation stops current active tab
- **Manual Control Only**: No automatic behaviors except pause detection for message sending

## Keyboard Shortcut Behavior (Ctrl+Shift+U)

### When Extension is INACTIVE:
- **Press once**: Start listening mode
  - Activate microphone
  - Start STT (Speech-to-Text)
  - Show status: "listening..."
  - Sphere turns red with glow

### When Extension is ACTIVE (Listening):
- **Press once**: Stop everything
  - Stop microphone
  - Stop STT
  - Clear status
  - Sphere turns orange (inactive)

### When AI is SPEAKING (TTS Active):
- **Press once**: Stop everything completely
  - Stop TTS immediately
  - Stop microphone
  - Stop STT
  - Clear status
  - Sphere turns orange (inactive)
  - **NO automatic restart** - user must press shortcut again to start listening

## STT (Speech-to-Text) Behavior

### Continuous Recording:
- STT continues recording even when user stops talking
- Auto-restarts when speech recognition ends
- Only stops manually via shortcut
- Captures all speech segments in `sttResults` array

### Pause Detection Mechanism:
- **2 seconds of silence** triggers complete message sending
- Combines all speech segments into one complete message
- Sends complete message to Gemini API
- Clears `sttResults` after sending
- Resets pause detection timer on each speech segment

### Message Flow:
1. User speaks → STT captures text segments
2. 2 seconds silence → Complete message assembled
3. Message sent to Gemini API
4. API response → TTS speaks response
5. STT continues recording (if still in listening mode)

## TTS (Text-to-Speech) Behavior

### Activation:
- TTS activates automatically when API response is received
- Shows status: "speaking..."
- Uses system speech synthesis
- Cleared automatically when speaking finishes

### Interrupt Behavior:
- **Shortcut during TTS**: Stop everything completely
- **No restart**: User must manually press shortcut to start listening again
- **Status cleared**: "speaking..." status removed

## Cross-Tab State Management

### Global Activation:
- Background script maintains `globalActive` and `activeTabId`
- New tab activation stops current active tab
- State broadcast to all tabs
- Sphere shows active/inactive state per tab

### State Synchronization:
- New tabs receive current global state immediately
- Active tab: Red glow, "listening..." status
- Inactive tabs: Orange glow, no status
- Permissions shared across tabs

## Permission System

### One-Time Request:
- Permissions requested on first activation
- Valid for 24 hours across all tabs
- Stored in `chrome.storage.local`
- Shared between all tabs

### Permission Types:
- Microphone access
- Speech recognition
- Text-to-speech

## Status Display System

### Status Text (Next to Pointer):
- **"listening..."** - When STT is active
- **"thinking..."** - When API call is in progress
- **"speaking..."** - When TTS is active
- **Clear** - When inactive

### Visual Indicators:
- **Red glow**: Active tab
- **Orange glow**: Inactive tab
- **Status text**: Simple one-line display

## Error Handling

### API Errors:
- Show error notification
- Don't restart STT automatically
- User must manually restart

### STT Errors:
- Network errors trigger restart
- Other errors stop everything
- Clear status on errors

### TTS Errors:
- Clear speaking status
- Continue STT recording

## Sphere (Pointer) Behavior

### Visual States:
- **Inactive**: Orange glow, no status
- **Active (Listening)**: Red glow, "listening..." status
- **Active (Thinking)**: Red glow, "thinking..." status
- **Active (Speaking)**: Red glow, "speaking..." status

### Click Behavior:
- Single click toggles extension on/off
- Same behavior as keyboard shortcut

## API Integration

### Gemini API Configuration:
- Model: `models/gemini-3.1-flash-lite-preview`
- API Version: `v1beta`
- Hardcoded API key
- External system prompt with placeholders

### Request Flow:
1. User speech → Text via STT
2. Complete message → Gemini API
3. API response → TTS synthesis
4. TTS output → Speaker

### System Prompt Integration:
- `{CURRENT_URL}` placeholder replaced with actual URL
- `{PAGE_TITLE}` placeholder replaced with actual title
- Loaded from external `agent-prompt.js` file

## Memory Management

### STT Results:
- Keep last 10 results only
- Clear after sending to API
- Prevent memory overflow

### Timers:
- `sttInactivityTimer`: 30 seconds inactivity timeout
- `pauseDetectionTimer`: 2 seconds silence detection
- All timers cleared on deactivation

## Important Rules Summary

### MUST WORK:
1. **Shortcut = Only Control**: All control via Ctrl+Shift+U
2. **Manual Only**: No automatic restarts except pause detection
3. **Cross-Tab Exclusivity**: Only one active tab
4. **Complete Flow**: Listen → API → Speak
5. **Interrupt Stops Everything**: No partial stops

### MUST NOT HAPPEN:
1. **No automatic STT restart** after API responses
2. **No automatic listening restart** after TTS interrupt
3. **No multiple active tabs**
4. **No text boxes** (audio-only experience)
5. **No automatic behaviors** except pause detection

### Edge Cases:
- Network errors → STT restart
- API errors → Stop everything, show error
- Permission denied → Show error, stop
- TTS interrupt → Stop everything completely

## Testing Checklist

### Basic Flow:
- [ ] Shortcut starts listening
- [ ] User speech captured correctly
- [ ] 2-second pause sends message
- [ ] API response triggers TTS
- [ ] TTS speaks response
- [ ] Status updates correctly

### Interrupt Tests:
- [ ] Shortcut during listening stops everything
- [ ] Shortcut during TTS stops everything
- [ ] No automatic restart after interrupt
- [ ] Manual restart works correctly

### Cross-Tab Tests:
- [ ] Only one active tab at a time
- [ ] New activation stops current tab
- [ ] State syncs to new tabs
- [ ] Permissions shared across tabs

### Error Cases:
- [ ] Network error recovery
- [ ] API error handling
- [ ] Permission denied handling
- [ ] TTS error handling

---

**Last Updated**: May 2, 2026  
**Version**: 1.0  
**Status**: All mechanisms implemented and tested
