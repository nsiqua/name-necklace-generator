# Built-in Pair Spacing Overrides

## Overview
The app now includes hard-coded default pair spacing overrides that are **always applied**, even when the Expert section is hidden or the Pair Spacing Overrides textarea is empty.

## Default Override

### "So" = -0.15em
Tightens the spacing between "S" and "o" for better cursive flow in names like:
- **Sofia**
- **Sophie**
- **Solomon**

This override improves the visual connection between these letters in the Pacifico script font, making the design flow more naturally.

## Implementation

### 1. Constant Definition (`main.js`)
```javascript
const BUILTIN_PAIR_OVERRIDES = {
  "So": -0.15  // Tighten "So" pair (e.g., in "Sofia") for better cursive flow
};
```

**Location:** Near the top of `main.js`, after the MM/PX conversion constants

### 2. Default Settings Initialization
```javascript
let currentSettings = {
  // ...
  pairSpacingMap: { ...BUILTIN_PAIR_OVERRIDES }, // Start with built-in defaults
  // ...
};
```

This ensures the built-in overrides are active from the moment the app loads.

### 3. User Override Merging
```javascript
// In pairSpacingTextarea event handler
const result = parsePairSpacingMap(e.target.value);

// Merge built-in overrides with user overrides (user wins on conflicts)
currentSettings.pairSpacingMap = { ...BUILTIN_PAIR_OVERRIDES, ...result.map };
```

The merge strategy: `{ ...BUILTIN, ...USER }` ensures:
- Built-in overrides are always present
- User-specified values override built-ins

## Behavior

### Default State (Empty Textarea)
- "So" pair uses -0.15em spacing
- All other pairs use default letter spacing
- Works even when Expert section is hidden

### User Override Wins
If a user enters in the Pair Spacing Overrides textarea:
```
So=-0.40
```

Then:
- "So" pair uses **-0.40em** (user's value)
- Built-in -0.15em is ignored for "So"
- All other built-in overrides remain active

### Multiple Overrides Example
Built-in:
```javascript
{ "So": -0.15 }
```

User enters:
```
So=-0.40
of=-0.90
fi=-0.85
```

Final merged map:
```javascript
{
  "So": -0.40,  // User value wins
  "of": -0.90,  // User added
  "fi": -0.85   // User added
}
```

## Testing Examples

### Test 1: "Sofia" with Empty Textarea
**Expected:** "So" pair uses -0.15em tighter spacing
**Verify:** Compare with "Victoria" (no "So" pair)

### Test 2: User Override "So=-0.60"
**Expected:** "So" pair uses -0.60em (much tighter)
**Verify:** Visual difference from default -0.15em

### Test 3: Clear Textarea After Override
**Expected:** "So" pair returns to -0.15em (built-in)
**Verify:** Not back to 0em, but to -0.15em

## Benefits

### User Experience
✅ **Better defaults**: "Sofia" and similar names look better out of the box  
✅ **No configuration needed**: Works for typical users who never open Expert  
✅ **Still customizable**: Power users can override if desired  

### Developer Experience
✅ **Easy to extend**: Add more pairs to `BUILTIN_PAIR_OVERRIDES`  
✅ **Centralized**: Single constant defines all built-in overrides  
✅ **Clear precedence**: User overrides always win  

## Future Enhancements

### Additional Built-in Overrides
If testing reveals other problematic pairs in Pacifico, add them:

```javascript
const BUILTIN_PAIR_OVERRIDES = {
  "So": -0.15,  // Sofia, Sophie
  "of": -0.10,  // Potential: Sofia (if "of" appears)
  "ia": -0.08,  // Potential: Victoria, Olivia
  // Add more as needed
};
```

### UI Indicator (Optional)
In the Expert section, you could show which built-in overrides are active:

```html
<small class="helper-text">
  Built-in overrides active: So=-0.15em
</small>
```

This helps users understand what's happening by default.

## Acceptance Criteria
- [x] "Sofia" with empty textarea applies So=-0.15em
- [x] User entering "So=-0.40" uses -0.40em
- [x] Clearing textarea returns to So=-0.15em (not 0em)
- [x] Other names without "So" pair unaffected
- [x] Works when Expert section is hidden
- [x] No console errors
- [x] No change to export behavior

## Code Location Summary
- **Constant definition**: Lines ~100-102 in `main.js`
- **Default settings init**: Line ~114 in `main.js`
- **User merge logic**: Line ~394 in `main.js`
- **Usage**: All `layoutTextWithPairSpacing()` calls use merged map

