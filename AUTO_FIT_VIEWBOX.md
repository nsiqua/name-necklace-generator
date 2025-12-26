# Automatic ViewBox Fitting

## Overview
The preview SVG now automatically centers and fits the design with proper padding after every update, eliminating the need for a manual "Reset ViewBox" button.

## Changes Made

### 1. JavaScript (`main.js`)

#### New Function: `autoFitViewBox()`
Renamed from `resetViewBox()` to better reflect its automatic nature.

**What it does:**
- Gets the bounding box of the rendered SVG path
- Calculates 10% padding around the content
- Updates the SVG viewBox to center and fit the design
- Guards against empty or invalid bounds
- Logs to console in debug mode

**Code:**
```javascript
function autoFitViewBox() {
  const name = nameInput.value;
  if (!name || name.trim().length === 0 || !pacificoFont) return;
  
  try {
    const bbox = namePath.getBBox();
    
    if (bbox.width === 0 || bbox.height === 0) {
      console.warn('Cannot auto-fit viewBox: path has no dimensions');
      return;
    }
    
    // Add 10% padding for visual breathing room
    const padding = Math.max(bbox.width, bbox.height) * 0.1;
    const newX = bbox.x - padding;
    const newY = bbox.y - padding;
    const newWidth = bbox.width + (padding * 2);
    const newHeight = bbox.height + (padding * 2);
    
    previewSvg.setAttribute('viewBox', 
      `${newX.toFixed(2)} ${newY.toFixed(2)} ${newWidth.toFixed(2)} ${newHeight.toFixed(2)}`);
    
    if (currentSettings.debugMode) {
      console.log('✓ Auto-fit viewBox:', ...);
    }
  } catch (error) {
    console.error('Error auto-fitting viewBox:', error);
  }
}
```

#### Auto-call in `generatePreview()`
Added automatic call after every design update:

```javascript
// Update the path element
namePath.setAttribute('d', finalPathData);

// Auto-fit preview viewBox (center and fit the design with padding)
autoFitViewBox();

// Enable download button
downloadBtn.disabled = false;
```

#### Removed Manual Button Logic
- Removed `resetViewBoxBtn` DOM reference
- Removed button click event listener
- Removed all `.disabled` state management for the button

### 2. HTML (`index.html`)

#### Removed Reset ViewBox Button
```html
<!-- Before -->
<div class="preview-header">
  <h2>Preview</h2>
  <button id="resetViewBoxBtn" class="reset-btn" disabled>
    Reset ViewBox
  </button>
</div>

<!-- After -->
<div class="preview-header">
  <h2>Preview</h2>
  <!-- Reset ViewBox button removed - auto-fit is now automatic -->
</div>
```

## Behavior

### Automatic Centering Triggers
The viewBox auto-fits after ANY design change:
- ✅ Name input changes
- ✅ Pendant Height slider changes
- ✅ Letter spacing adjustments
- ✅ Font size changes
- ✅ Loop parameters changes
- ✅ Strengthen offset toggle
- ✅ Any Advanced or Expert setting changes

### Padding Logic
- **10% padding** calculated as: `Math.max(bbox.width, bbox.height) * 0.1`
- Applied equally on all sides
- Prevents design from touching preview edges
- Provides consistent visual breathing room

### Edge Cases Handled
1. **Empty name**: Function returns early, no viewBox update
2. **Zero dimensions**: Guards with `bbox.width === 0 || bbox.height === 0` check
3. **Missing font**: Returns early if `!pacificoFont`
4. **Error handling**: Try-catch logs errors without breaking the app
5. **Debug mode**: Logs viewBox updates only when debug is enabled

## Benefits

### User Experience
✅ **Always centered**: No manual adjustment needed  
✅ **Consistent framing**: Every design properly framed with padding  
✅ **Less UI clutter**: One less button to understand  
✅ **Immediate feedback**: Changes instantly centered  

### Developer Experience
✅ **Simpler code**: One less button state to manage  
✅ **Automatic behavior**: Works for all design updates  
✅ **Easy maintenance**: Single function handles all centering  

## Testing Checklist
- [x] Preview centers on page load (with default name)
- [x] Preview centers when typing a name
- [x] Preview centers when changing Pendant Height
- [x] Preview centers when changing Letter Spacing
- [x] Preview centers when toggling Strengthen
- [x] Preview centers when changing Loop parameters
- [x] Empty name doesn't cause errors
- [x] Very short names (1-2 chars) center correctly
- [x] Very long names center and fit properly
- [x] No console errors
- [x] No visual flicker on updates
- [x] Download button still works correctly

## CSS Notes
The `.reset-btn` CSS class remains in `style.css` but is no longer used. It can be safely removed in a future cleanup if desired, or kept for potential future use.

## Future Enhancements (Optional)
If needed, you could add:
- Zoom/pan controls for manual inspection
- Min/max viewBox constraints
- Animation/transition when viewBox changes
- User preference for padding amount

