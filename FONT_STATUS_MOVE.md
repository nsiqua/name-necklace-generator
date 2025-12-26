# Font Status Banner Relocation

## Summary
Moved the font loading status banner from the top of the page (BASIC view) into the **Expert / Debug** collapsible section to reduce visual clutter for typical users.

## Changes Made

### 1. HTML (`index.html`)
**Removed:**
- Status banner from between subtitle and BASIC section (lines ~14-17)

**Added:**
- Status banner as the first subsection inside Expert/Debug section
- Added `id="expertSection"` to the `<details>` element for JavaScript access

**New structure:**
```html
<details class="expert-section" id="expertSection">
  <summary class="section-header">Expert / Debug (for tuning & troubleshooting)</summary>
  
  <div class="section-content">
    <!-- FONT LOADING STATUS (moved from top) -->
    <div class="subsection">
      <h3>Font Loading Status</h3>
      <div id="statusBar" class="status-bar loading">
        <span id="statusText">Loading font...</span>
      </div>
    </div>
    
    <!-- other expert controls... -->
  </div>
</details>
```

### 2. JavaScript (`main.js`)
**Added auto-expand on error:**
- When font loading fails, the Expert section automatically opens so the user can see the error message
- No changes to font loading logic itself

**Code added:**
```javascript
// Auto-expand Expert section so user can see the error
const expertSection = document.getElementById('expertSection');
if (expertSection) {
  expertSection.open = true;
}
```

### 3. CSS (`style.css`)
**Adjusted spacing:**
- Changed `.status-bar` `margin-bottom` from `25px` to `0` since it's now inside a subsection that provides its own spacing
- Status bar now uses the subsection's standard margins

## Behavior

### Normal Operation (Success)
1. App loads
2. Font loads successfully
3. Status shows "Font loaded successfully!" inside collapsed Expert section
4. User only sees BASIC interface
5. User can expand Expert section if curious about status

### Error Scenario
1. App loads
2. Font fails to load (e.g., 404 error)
3. Error message shows "Error: Font file not found..."
4. **Expert section auto-expands** to make error visible
5. User can see diagnostic information

## Benefits
- **Cleaner BASIC view**: No technical status messages cluttering the interface
- **Error visibility**: Errors are automatically shown by expanding Expert section
- **Diagnostic access**: Power users can still check font status when needed
- **No logic changes**: Font loading works exactly as before

## Testing Checklist
- [x] Status banner no longer visible in BASIC view
- [x] Status banner visible when Expert section is expanded
- [x] Success message updates correctly
- [x] Error message updates correctly
- [x] Expert section auto-opens on font loading error
- [x] No duplicate IDs
- [x] No console errors
- [x] CSS styling looks correct inside Expert section

