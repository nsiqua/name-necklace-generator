# Target Height Helper Text

## Overview
Added subtle guidance text under the Target Height slider to help users choose appropriate pendant sizes.

## Changes Made

### 1. HTML (`index.html`)
**Added:**
```html
<small class="helper-text">Typical sizes: Small 6–14mm • Medium 15–25mm • Large 25mm+</small>
```

**Location:**
- Directly under the Target Height slider input
- Inside the same `.control-group` container
- Uses `<small>` tag for semantic meaning

### 2. CSS (`style.css`)
**Added:**
```css
.helper-text {
  display: block;
  margin-top: 5px;
  font-size: 0.8em;
  color: rgba(0, 0, 0, 0.5);
  font-weight: normal;
  font-style: normal;
  line-height: 1.3;
}
```

**Styling approach:**
- **Small font**: 0.8em (smaller than labels)
- **Muted color**: 50% opacity black for subtlety
- **Compact spacing**: 5px top margin
- **Clean appearance**: Normal weight and style (not italic)

### 3. JavaScript
No changes required - helper text is static.

## Size Guidelines Provided

| Category | Range |
|----------|-------|
| **Small** | 6–14mm |
| **Medium** | 15–25mm |
| **Large** | 25mm+ |

## Visual Design

### Readability
- Uses bullet separator (•) between categories for easy scanning
- Compact format keeps it on one line
- Em dashes (–) for ranges, not hyphens

### Subtlety
- Lighter than body text (50% opacity)
- Smaller than control labels
- Positioned naturally under the slider
- Doesn't compete for attention with main controls

## Benefits

1. **User guidance**: Helps users choose appropriate sizes without trial and error
2. **Visual hierarchy**: Subtle enough not to clutter the BASIC interface
3. **No interaction needed**: Passive information, always visible
4. **Contextual help**: Right where users need it (under the slider)

## Testing Checklist
- [x] Helper text visible under Target Height slider
- [x] Text is readable but not dominant
- [x] No layout shifts in BASIC section
- [x] Works on mobile/responsive views
- [x] No console errors
- [x] Doesn't interfere with slider interaction

## Future Enhancements (Optional)
If needed, similar helper text could be added for:
- Letter Spacing slider (Advanced section)
- Loop parameters (Advanced section)
- Other numeric inputs where guidance would help

