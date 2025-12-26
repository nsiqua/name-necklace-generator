# Developer Mode - Hidden Expert Section

## Overview
The Expert / Debug section is now hidden from end users by default and can only be toggled by the developer using a keyboard shortcut.

## Keyboard Shortcut
**Ctrl + Shift + X** - Toggle Expert section visibility

## Behavior

### Default State (End Users)
- Expert / Debug section is completely hidden
- Only BASIC and ADVANCED sections are visible
- No way for end users to access Expert controls

### Developer Toggle
1. Press **Ctrl + Shift + X** anywhere on the page
2. Expert section becomes visible
3. State persists across page reloads (localStorage)
4. Press **Ctrl + Shift + X** again to hide

### Console Messages
- When enabled: `🔓 Expert mode ENABLED`
- When disabled: `🔒 Expert mode DISABLED`
- On page load (if enabled): `🔓 Expert mode: ENABLED`

## Implementation Details

### CSS (`style.css`)
```css
.dev-only-hidden {
  display: none !important;
}
```

### JavaScript (`main.js`)
- **Storage Key**: `'showExpert'`
- **Storage Value**: `'1'` when enabled, removed when disabled
- **Element ID**: `#expertSection`

**Functions:**
- `initExpertVisibility()` - Checks localStorage on page load
- `toggleExpertMode()` - Toggles visibility and updates localStorage

**Keyboard Listener:**
- Listens for `Ctrl + Shift + X` combination
- Skips when user is typing in INPUT or TEXTAREA elements
- Prevents default browser behavior when shortcut is triggered

### Font Loading Error Behavior
- If font loading fails AND Expert mode is enabled, the Expert section auto-expands
- If Expert mode is disabled, error is logged to console but section stays hidden

## Safety Features

### Input Protection
The keyboard shortcut is disabled when the user is typing in:
- Text inputs (`<input>`)
- Text areas (`<textarea>`)

This prevents accidental toggling while entering a name or pair spacing overrides.

### No Security Implications
This is a **UI convenience feature**, NOT a security mechanism:
- Any user with browser DevTools can reveal the Expert section
- The shortcut is not obfuscated
- This is intended to keep the UI clean for end users, not to restrict access

## Testing Checklist

### Normal User Experience
- [x] Expert section is hidden by default
- [x] Only BASIC and ADVANCED sections visible
- [x] No way to access Expert without knowing the shortcut
- [x] All standard functionality works normally

### Developer Mode
- [x] Ctrl + Shift + X toggles visibility
- [x] Console logs "ENABLED" / "DISABLED" messages
- [x] State persists after page reload
- [x] Can toggle on/off multiple times
- [x] Shortcut doesn't trigger when typing in name input
- [x] Shortcut doesn't trigger when typing in pair spacing textarea

### Edge Cases
- [x] Font loading error when Expert hidden: error logged to console only
- [x] Font loading error when Expert visible: section auto-expands
- [x] No console errors when toggling
- [x] No visual glitches on BASIC or ADVANCED sections

## Usage Guide

### For Developers (You)
1. Open the app
2. Press **Ctrl + Shift + X**
3. Expert section appears below Advanced section
4. Make your changes / debug
5. Refresh page - Expert section stays visible
6. Press **Ctrl + Shift + X** to hide again

### For End Users
- They see a clean interface with only essential controls
- BASIC section for quick use
- ADVANCED section for optional tuning
- No clutter from debug/expert controls

## Future Enhancements (Optional)
If needed, you could add:
- Visual indicator when Expert mode is active (e.g., small badge)
- Alternative shortcut combinations
- Developer console command: `window.toggleExpertMode()`
- Admin password protection (though DevTools would bypass it)

