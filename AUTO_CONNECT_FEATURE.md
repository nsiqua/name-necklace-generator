# Auto-Connect Adjacent Letters Feature

## Overview
Automatic geometry-based spacing enforcement that ensures adjacent characters overlap by at least a minimum amount, preventing disconnected letters in the final necklace design.

## Problem Solved
With cursive/script fonts like Pacifico, certain letter combinations (e.g., "Gh", "SOFIA") may not overlap enough, resulting in disconnected pieces that would fall apart when laser cut. Manual pair spacing overrides work but require knowing hundreds of problematic pairs.

## Solution
The auto-connect feature:
1. Analyzes each adjacent letter pair using Paper.js boolean geometry
2. Detects when overlap is insufficient
3. Automatically tightens spacing (moves letters closer) until minimum overlap is achieved
4. Preserves manual pair overrides (they remain highest priority)
5. Works across arbitrary names without manual configuration

## UI Controls (Expert Section Only)

### Main Toggle
**"Enable Auto-Connect"** - Checkbox (default: OFF)
- Enables the automatic spacing enforcement algorithm
- When OFF, spacing behaves as before (manual overrides + kerning + letter spacing)

### Parameters

#### Min Overlap (mm)
- **Default**: 0.4mm
- **Range**: 0.1mm to 2.0mm
- **Purpose**: Minimum required overlap between adjacent glyph outlines
- Measured as the maximum dimension (width or height) of the intersection bounds

#### Max Tighten (mm)
- **Default**: 3.0mm
- **Range**: 0.5mm to 10.0mm
- **Purpose**: Safety limit - maximum amount a pair can be tightened
- Prevents extreme adjustments that could cause visual distortion

### Debug Tools

#### Debug: Log Auto-Adjustments
- Logs detailed information to console (F12)
- Shows which pairs were adjusted and by how much
- Useful for understanding what the algorithm is doing

#### Debug: Draw Overlap Markers
- Visual markers in preview (not exported)
- Shows where overlaps were detected/adjusted
- Helps diagnose problematic pairs

## How It Works

### Algorithm Overview
1. **Import Phase**: Each letter is imported as a separate Paper.js Path/CompoundPath
2. **Analysis Phase** (if auto-connect enabled):
   - For each adjacent pair (left, right):
     - Quick bounds check: Do bounding boxes overlap?
     - Geometric check: Compute boolean intersection
     - Measure intersection dimensions
     - Compare to `minOverlapMm` requirement
3. **Adjustment Phase** (if overlap insufficient):
   - Move right glyph left in small steps (0.1mm increments)
   - Apply **suffix shifting**: When moving one glyph, move all subsequent glyphs by the same amount
   - Re-check overlap after each step
   - Stop when:
     - Overlap requirement is met, OR
     - Max tighten limit is reached
4. **Continuation**: Proceed with existing pipeline (i-dot connection, union/weld, loops, strengthen, export)

### Suffix Shifting
Critical for correctness:
- When tightening pair (i, i+1), the algorithm shifts glyph[i+1] to the left
- **All subsequent glyphs** (i+2, i+3, ..., end) are also shifted by the same amount
- This preserves relative spacing of later pairs and prevents collisions

### Overlap Detection Method
Uses Paper.js boolean intersection:
```javascript
const intersection = leftGlyph.intersect(rightGlyph);
const overlapWidth = intersection.bounds.width;
const overlapHeight = intersection.bounds.height;
const maxDim = Math.max(overlapWidth, overlapHeight);

// Pass if maxDim >= minOverlapMm (converted to Paper units)
```

This is more reliable than advance-width math because it uses actual glyph geometry.

### Priority Order for Spacing
For each adjacent pair:
1. **OpenType kerning** - Applied first (from font metrics)
2. **Manual pair override** - If exists in Expert textarea, use it
3. **Default letter spacing** - From slider if no manual override
4. **Auto-connect adjustment** - Applied last, only if enabled and overlap insufficient

**Key**: Manual overrides are applied in initial placement. Auto-connect only further tightens when needed.

## Performance Optimizations

### Quick Bounds Rejection
Before computing expensive boolean intersection:
```javascript
if (left.bounds.right < right.bounds.left) {
  // Bounds don't even touch → definitely need tightening
  // Skip intersection computation for this check
}
```

### Temporary Object Cleanup
```javascript
const inter = left.intersect(right);
// Use inter...
inter.remove(); // Clean up immediately to avoid memory buildup
```

This is critical when processing many pairs.

## Settings Integration

### Default Settings (`currentSettings`)
```javascript
autoConnect: false,           // Disabled by default (Expert feature)
autoConnectMinOverlap: 0.4,   // mm
autoConnectMaxTighten: 3.0,   // mm
autoConnectDebugLog: false,   // Console logging
autoConnectDebugMarkers: false // Visual markers
```

### DOM References
```javascript
const autoConnectCheckbox = document.getElementById('autoConnectCheckbox');
const autoConnectMinOverlapInput = document.getElementById('autoConnectMinOverlapInput');
const autoConnectMaxTightenInput = document.getElementById('autoConnectMaxTightenInput');
const autoConnectDebugLogCheckbox = document.getElementById('autoConnectDebugLogCheckbox');
const autoConnectDebugMarkersCheckbox = document.getElementById('autoConnectDebugMarkersCheckbox');
```

### Event Listeners
All controls trigger `generatePreview()` when changed (if auto-connect is enabled).

## Code Location

### Main Function
**`applyAutoConnect(glyphItems, options)`** (Lines ~2318-2486 in `main.js`)
- Parameters:
  - `glyphItems`: Array of `{char, index, item: Paper.Path}`
  - `options`: `{minOverlapMm, maxTightenMm, debugLog, debugMarkers}`
- Returns: Adjusted `glyphItems` with updated positions

### Integration Point
In `applyPaperJsUnion()` (Lines ~2570-2578):
```javascript
// After importing all letter paths
if (currentSettings.autoConnect) {
  console.log('🔗 Auto-connect enabled: checking adjacent letter overlaps...');
  applyAutoConnect(glyphItems, {
    minOverlapMm: currentSettings.autoConnectMinOverlap,
    maxTightenMm: currentSettings.autoConnectMaxTighten,
    debugLog: currentSettings.autoConnectDebugLog,
    debugMarkers: currentSettings.autoConnectDebugMarkers
  });
}
```

## Example Usage

### Scenario 1: "Sofia" with Disconnected "So"
**Without auto-connect:**
- "S" and "o" have small gap
- Exported SVG has two separate pieces
- Would fall apart when cut

**With auto-connect (min overlap 0.4mm):**
- Algorithm detects insufficient overlap
- Moves "o" (and all subsequent letters) left by ~0.6mm
- "S" and "o" now overlap by 0.4mm
- Final SVG is one connected piece

### Scenario 2: Manual Override Present
**User enters in Expert textarea:**
```
So=-0.80
```

**Behavior:**
1. Initial spacing uses -0.80em (manual override)
2. Auto-connect checks overlap
3. If still insufficient, further tightens
4. Final spacing might be -0.80em - 0.2mm (auto adjustment)

Manual override is **starting point**, auto-connect is **final enforcement**.

### Scenario 3: Already Overlapping
**Pair "fi" in "Sofia":**
- Letters already overlap by 1.2mm naturally
- Auto-connect checks, sees 1.2mm > 0.4mm required
- ✓ PASS - no adjustment needed
- Spacing unchanged

## Debug Output Example

With `debugLog` enabled:
```
🔗 === AUTO-CONNECT: Checking adjacent letter overlaps ===
Min overlap required: 0.4mm (1.51 units)
Max tighten per pair: 3.0mm (11.34 units)
  Pair "So": overlap 0.32 units ✗ FAIL (too small)
    ✓ Auto-tightened by 0.623mm
  Pair "of": overlap 2.14 units ✓ PASS
  Pair "fi": overlap 3.87 units ✓ PASS
  Pair "ia": overlap 1.92 units ✓ PASS

📊 Auto-connect summary:
  Total pairs adjusted: 1
    So: 0.623mm (SUCCESS)
🔗 === AUTO-CONNECT COMPLETE ===
```

## Acceptance Tests

### Test 1: Disconnected Pairs
- **Input**: "SOFIA" (all caps, known to have disconnected "SO")
- **Expected**: With auto-connect ON, all letters connected
- **Verify**: Export SVG, import to LightBurn, check piece count = 1

### Test 2: Manual Override Preserved
- **Setup**: Enter `So=-0.50` in Expert textarea
- **Input**: "Sofia"
- **Expected**: Initial spacing uses -0.50em, then auto-connect further tightens if needed
- **Verify**: Console log shows "So" started with manual override, then adjusted

### Test 3: Safety Limit
- **Setup**: Set min overlap to 2.0mm, max tighten to 1.0mm
- **Input**: "SOFIA" (impossible to achieve 2mm overlap with only 1mm tighten)
- **Expected**: Algorithm applies 1.0mm max, logs "MAX_REACHED" warning
- **Verify**: Console shows warning, export still succeeds (partial improvement)

### Test 4: Disabled State
- **Setup**: Auto-connect checkbox OFF
- **Input**: Any name
- **Expected**: Behavior identical to before feature existed
- **Verify**: No auto-connect logs, spacing matches manual/kerning/letter spacing only

## Future Enhancements (Optional)

### Visual Debug Markers
Currently planned but not implemented:
- Green dots where overlap is sufficient
- Red dots where auto-tightening was applied
- Yellow dots where max tighten was reached but still insufficient

### Adaptive Min Overlap
Different letter pairs might need different overlap amounts:
- Large letters (capitals): 0.6mm
- Small letters (lowercase): 0.3mm
- Could be made automatic based on glyph size

### Per-Pair Min Overlap Overrides
Allow users to specify:
```
So:minOverlap=0.8
fi:minOverlap=0.2
```

### Performance: Parallel Processing
For very long names (>20 chars), could process pairs in parallel batches.

## Troubleshooting

### Problem: Auto-connect not working
**Check:**
- Is checkbox enabled?
- Is Expert section visible (Ctrl+Shift+X)?
- Check console for errors

### Problem: Letters too close/overlapping too much
**Solution:**
- Increase `minOverlapMm` to 0.6-0.8mm
- Or use manual pair overrides for specific pairs

### Problem: Algorithm too slow
**Likely cause:** Many pairs need tightening with small `minOverlapMm` and large `maxTighten`
**Solution:**
- Reduce `maxTighten` to 2.0mm
- Increase step size (currently hardcoded to 0.1mm, could be made configurable)

### Problem: Warnings "MAX_REACHED"
**Meaning:** Some pairs couldn't achieve required overlap within safety limit
**Options:**
1. Increase `maxTighten`
2. Decrease `minOverlapMm`
3. Use manual pair overrides for those specific pairs

## Technical Notes

### Paper.js Coordinate System
- Y-axis is inverted (0 at top, positive downward)
- Units are in pixels at 96 DPI
- Conversion: `mmToPaperPixels(mm)` helper function

### Boolean Intersection Accuracy
- Paper.js intersection is generally reliable for simple paths
- Can fail for very complex self-intersecting paths
- Error handling catches these cases and continues

### Memory Management
Critical to call `.remove()` on temporary intersection items:
```javascript
const inter = left.intersect(right);
// ... use inter ...
inter.remove(); // Prevents memory leak
```

Without cleanup, Paper.js project accumulates thousands of items.

## Compatibility

### Works With
✅ Manual pair spacing overrides (highest priority)
✅ OpenType kerning
✅ Default letter spacing slider
✅ i-dot connection
✅ Loop attachment
✅ Strengthen offset
✅ All existing features

### Limitations
- Only checks adjacent pairs (not tri-grams or longer sequences)
- Requires Paper.js (already a dependency)
- Performance scales O(n) with name length (acceptable for typical names < 20 chars)

## Summary

The auto-connect feature provides **robust, automatic** prevention of disconnected letters, while remaining:
- **Optional** (Expert section, default OFF)
- **Transparent** (preserves manual overrides)
- **Configurable** (min overlap, max tighten, debug options)
- **Compatible** (works with all existing features)

For users who never enable it, behavior is unchanged. For power users, it eliminates the need for hundreds of manual pair overrides.

