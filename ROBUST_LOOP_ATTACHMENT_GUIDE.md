# Robust Loop Attachment System - Implementation Guide

## Overview

The loop attachment system has been completely redesigned to use **geometry-based anchor point sampling** instead of bounding box heuristics. This ensures loops **always connect properly** regardless of text input.

## ✨ Key Features

### 1. Geometry-Based Anchor Points
- Samples points along the **actual text outline** (not just bounding box corners)
- Finds the **leftmost and rightmost points** in the top portion of the text
- Calculates **outward directions** from these anchors for natural placement

### 2. Verified Overlap
- Places loops to overlap text by a **controlled amount** (default 0.4mm)
- **Verifies overlap** using Paper.js intersection tests
- **Automatically adjusts** loop position if overlap is insufficient
- Falls back to **bridge tabs** if overlap cannot be achieved

### 3. Connectivity Validation
- Counts **separate components** after welding
- **Warns** if loops didn't fully connect
- Provides guidance to adjust overlap or offset parameters

### 4. Debug Visualization
- Shows **anchor points** (red=left, blue=right)
- Displays **outward direction arrows**
- Extensive **console logging** of the attachment process

## 📊 How It Works

### Step-by-Step Process

```
1. SAMPLE POINTS
   ├─ Flatten all paths in text outline
   ├─ Sample points every 0.5mm along each path
   └─ Collect all Y values for quantile analysis

2. FIND ANCHORS (Quantile-Based)
   ├─ Sort Y values to find top quantiles (20%, 30%, 40%...)
   ├─ Filter candidates to top envelope (robust for descenders)
   ├─ Leftmost point  → Left anchor
   ├─ Rightmost point → Right anchor
   ├─ Validate anchors are truly high (< 60th percentile)
   └─ Calculate outward directions from text center

3. CREATE LOOPS
   ├─ Create donut geometry (outer circle - inner circle)
   ├─ Position using: anchor + outwardDir × (outerRadius - overlap + offset)
   └─ Set fillColor to 'black'

4. VERIFY OVERLAP
   ├─ Test intersection between loop and text
   ├─ If no overlap: Pull loop toward text in small steps
   └─ If still no overlap: Create bridge tab as fallback

5. WELD LOOPS
   ├─ Unite left loop with text
   ├─ Unite right loop with text
   └─ Result: Single connected component

6. VALIDATE
   ├─ Count components in final result
   └─ Warn if > 1 component (loops not fully connected)
```

## 🎛️ UI Controls

### Inner Diameter (mm)
**Default:** 3.0mm  
**Range:** 0.5mm to 10.0mm  
**Purpose:** Controls the inner diameter (hole size) of the attachment loop.

- **Smaller** (1.5-2.5mm): Delicate appearance, smaller chain link
- **Standard** (3.0-3.5mm): Recommended - fits most chain types
- **Larger** (4.0-5.0mm): For thicker chains or cords

### Outer Diameter (mm)
**Default:** 4.6mm  
**Range:** 3.0mm to 10.0mm  
**Purpose:** Controls the outer diameter of the attachment loop.

- Must be **larger than Inner Diameter**
- Automatically validated (cannot be ≤ inner diameter)
- **Loop Thickness** = (Outer - Inner) ÷ 2
- **Thinner loops** (0.5-0.7mm thick): Delicate appearance
- **Standard loops** (0.8-1.0mm thick): Recommended - strong and reliable
- **Thicker loops** (1.1-2.0mm thick): Maximum strength

### Loop Thickness (calculated, display only)
**Purpose:** Shows the calculated wall thickness of the loop.

- Calculated as: `(Outer Diameter - Inner Diameter) ÷ 2`
- **Minimum recommended:** 0.5mm for laser cutting
- **Standard:** 0.8mm (default)
- **Maximum strength:** 1.0mm or more

### Offset from Text (mm)
**Default:** 0.6mm  
**Range:** 0.0mm to 5.0mm  
**Purpose:** Distance between loop and text edge.

- **Closer** (0.2-0.4mm): Loops sit tighter to text
- **Standard** (0.6-0.8mm): Recommended spacing
- **Further** (1.0-2.0mm): More visible separation

### Loop Overlap (mm)
**Default:** 0.4mm  
**Range:** 0.1mm to 2.0mm  
**Purpose:** Controls how much the loop's outer ring overlaps the text before welding.

- **Lower values** (0.1-0.3mm): Minimal contact, more elegant appearance
- **Medium values** (0.4-0.6mm): Recommended - reliable welding
- **Higher values** (0.7-2.0mm): Maximum robustness, more visible connection

### Show Loop Anchor Points
**Type:** Checkbox  
**Purpose:** Visualize where loops will attach

- **Red circle + arrow:** Left anchor point and outward direction
- **Blue circle + arrow:** Right anchor point and outward direction
- **Note:** Debug markers are NOT included in exported SVG

## 🔧 Technical Implementation

### Core Functions

#### `attachLoopsToEnds(textItem, options, debugMode)`
Main function that orchestrates the entire loop attachment process.

**Parameters:**
- `textItem` - The unified text shape (Path, CompoundPath, or Group)
- `options` - Configuration object
  - `innerDiameterMm` - Loop inner diameter (default: 3.0mm)
  - `offsetFromTextMm` - Distance from text (default: 0.6mm)
  - `minThicknessMm` - Loop thickness (default: 0.8mm)
  - `loopOverlapMm` - Overlap amount (default: 0.4mm)
- `debugMode` - Enable detailed logging and visualization

**Returns:** The text item with loops attached and welded

---

#### `findAnchorPoints(textItem, sampleStepPx, debugMode)`
Samples the text outline to find optimal anchor points using **quantile-based selection** (robust for descenders).

**Algorithm:**
1. Extract all leaf paths from text item
2. Flatten each path (0.2mm tolerance)
3. Sample points every 0.5mm along path length
4. **Sort all Y values** and use quantiles to define "top envelope"
5. Start with **top 20% quantile**, progressively widen if needed (30%, 40%, 50%)
6. Filter candidates to top quantile region
7. Find leftmost and rightmost points from candidates
8. **Safety validation:** Ensure anchors are truly high (< 60th percentile)
9. Calculate outward directions from text center

**Why quantiles?** Works correctly for words with descenders (Sophia, Poppy, jumpy) by using the distribution of actual outline points instead of bounding box dimensions.

**Returns:** `{ left: {point, outwardDir}, right: {point, outwardDir} }`

See `QUANTILE_ANCHOR_FIX.md` for detailed explanation of the quantile-based algorithm.

---

#### `createAndPlaceLoop(config)`
Creates a loop and positions it with verified overlap.

**Process:**
1. Create donut geometry (outer - inner circles)
2. Calculate initial position: `anchor + outwardDir × (outerRadius - overlap + offset)`
3. Call `ensureOverlap()` to verify/adjust
4. Fall back to `createBridgeTab()` if needed

**Returns:** The positioned loop (Path or CompoundPath)

---

#### `ensureOverlap(loopRing, textItem, ...)`
Verifies overlap and adjusts loop position if needed.

**Algorithm:**
1. Test intersection: `loopRing.intersect(textItem)`
2. If overlap area < 1px²:
   - Pull loop toward text (0.2mm steps)
   - Test intersection after each step
   - Max 50 steps
3. Return `{ hasOverlap: boolean, finalOverlap: number }`

---

#### `createBridgeTab(anchorPoint, loopCenter, bridgeWidth, debugMode)`
Creates a rectangular bridge to connect loop to text as fallback.

**Geometry:**
- Width: 80% of outer radius
- Length: Distance between anchor and loop center
- Rotation: Aligned with connection direction

---

#### `countComponents(item)`
Counts separate components to validate connectivity.

**Logic:**
- `CompoundPath`: Count children
- `Group`: Count all Path/CompoundPath children
- `Path`: Return 1

## 📝 Usage Examples

### Basic Usage (Default Settings)
```javascript
// In applyPaperJsUnion function:
result = attachLoopsToEnds(result, {
  innerDiameterMm: 3.0,
  offsetFromTextMm: 0.6,
  minThicknessMm: 0.8,
  loopOverlapMm: 0.4
}, false);
```

### Debug Mode
```javascript
// Enable debug logging and visualization:
result = attachLoopsToEnds(result, {
  innerDiameterMm: 3.0,
  offsetFromTextMm: 0.6,
  minThicknessMm: 0.8,
  loopOverlapMm: 0.4
}, true);

// Also enable anchor visualization in UI:
window.DEBUG_LOOP_ANCHORS = true;
```

### Increase Overlap for Difficult Cases
```javascript
// If loops aren't connecting, increase overlap:
result = attachLoopsToEnds(result, {
  innerDiameterMm: 3.0,
  offsetFromTextMm: 0.6,
  minThicknessMm: 0.8,
  loopOverlapMm: 1.0  // Increased from 0.4mm
}, true);
```

## 🧪 Testing

### Test Cases

The system has been tested with:
- **Short names:** "Mia", "Sofia", "Noah" ✓
- **Long names:** "Victoria", "Alexander" ✓
- **Names with descenders:** "Jeffrey", "Gregory" ✓
- **Single letters:** "V", "i", "M" ✓

**Descender stress tests (quantile-based anchor selection):**
- **"Sophia"** - Loops attach to top (NOT bottom flourish of 'S') ✓
- **"Poppy"** - Loops attach to 'P' and 'y' tops (NOT 'p'/'y' descenders) ✓
- **"yaya"** - Both loops attach to top of 'y' stems ✓
- **"gigi"** - Loops attach to top of 'g' bodies (NOT tails) ✓
- **"happy"** - Loops attach to 'h' and 'y' tops ✓
- **"jumpy"** - Loops attach to 'j' and 'y' tops (NOT descenders) ✓
- **"Gregory"** - Right loop attaches to 'y' top (NOT descender) ✓
- **"James"** - Still works correctly with standard text ✓

### How to Test

1. **Enable Debug Mode:**
   - Check "Debug Mode" checkbox
   - Check "Show Loop Anchor Points" checkbox

2. **Enter Test Text:**
   - Type "Victoria" or any name

3. **Check Console Logs:**
   ```
   ═══════════════════════════════════════════
     ATTACHING LOOPS TO TEXT USING GEOMETRY SAMPLING
   ═══════════════════════════════════════════
   
   🔵 Attaching loops to text ends using geometry sampling...
   📍 Sampling points along text outline...
       Sampled 542 points from 14 paths
       Y-value range: -89.23 (top) to 15.67 (bottom)
       Trying quantile 20%: y <= -75.42 → 108 candidates
       ✓ Selected quantile: 20% (108 candidates)
       Left anchor Y-percentile: 18.5%
       Right anchor Y-percentile: 22.1%
       ✓ Final anchors: Left=(12.34, -87.56), Right=(234.56, -84.12)
   
   🔧 Creating left loop...
       Initial position: (12.34, -56.78)
       ✓ Overlap achieved after 3 pull steps (area: 15.42px²)
   
   ✓ Left loop welded successfully
   
   🔧 Creating right loop...
       Initial position: (234.56, -56.78)
       ✓ Overlap achieved after 2 pull steps (area: 18.91px²)
   
   ✓ Right loop welded successfully
   
   ✅ Final design is a single connected component
   ```

4. **Check Visual Output:**
   - Red circle at left anchor point
   - Blue circle at right anchor point
   - Red/blue arrows showing outward directions
   - Loops positioned at anchors

5. **Download and Verify:**
   - Download SVG
   - Open in LightBurn or other laser software
   - Verify loops are connected (no floating pieces)

### Expected Results

✓ **Success indicators:**
- Console shows "Final design is a single connected component"
- Visual preview shows loops touching text
- No warning messages about failed connection
- Exported SVG has no floating pieces

✗ **Failure indicators:**
- Warning: "Final design has X separate components"
- Console shows "Could not achieve overlap after 50 steps"
- Loops appear floating in preview

**If loops don't connect:**
1. Increase "Loop Overlap" (try 0.6mm, 0.8mm, or 1.0mm)
2. Decrease "Offset from Text" (try 0.4mm or 0.2mm)
3. Check console logs for specific error messages

## 🎨 Debug Visualization

When enabled, the system adds visual markers to the preview:

### Anchor Points
- **Red circle:** Left anchor (leftmost point in top portion)
- **Blue circle:** Right anchor (rightmost point in top portion)

### Direction Arrows
- **Red arrow:** Left outward direction (20px length)
- **Blue arrow:** Right outward direction (20px length)

### Console Output
- Sampling statistics
- Anchor coordinates
- Overlap test results
- Adjustment steps taken
- Final connectivity status

**Note:** Debug markers are automatically removed before SVG export.

## ⚙️ Configuration Reference

### Default Settings
```javascript
currentSettings = {
  // ... other settings ...
  addLoops: true,           // Enable loop attachment
  loopInnerDiameter: 3.0,   // mm (user editable)
  loopOuterDiameter: 4.6,   // mm (user editable)
  loopOffset: 0.6,          // mm
  loopOverlap: 0.4,         // mm
  debugMode: false          // Enable debug logging
};
```

### Recommended Values

| Scenario | Inner Ø | Outer Ø | Thickness | Offset | Overlap | Notes |
|----------|---------|---------|-----------|--------|---------|-------|
| **Standard** | 3.0mm | 4.6mm | 0.8mm | 0.6mm | 0.4mm | Reliable, elegant |
| **Thin/Delicate** | 3.0mm | 4.0mm | 0.5mm | 0.4mm | 0.3mm | Subtle appearance |
| **Thick/Robust** | 3.0mm | 5.0mm | 1.0mm | 0.8mm | 0.6mm | Maximum reliability |
| **Large Loop** | 4.0mm | 6.0mm | 1.0mm | 0.8mm | 0.5mm | For larger designs |
| **Troubleshooting** | 3.0mm | 5.5mm | 1.25mm | 0.3mm | 1.0mm | For difficult fonts |

**Note:** Thickness is automatically calculated as `(Outer Ø - Inner Ø) ÷ 2`

## 🚨 Troubleshooting

### Problem: "Final design has 3 separate components"
**Cause:** Loops didn't weld to text (insufficient overlap)

**Solutions:**
1. Increase "Loop Overlap" to 0.8mm or 1.0mm
2. Decrease "Offset from Text" to 0.3mm or 0.4mm
3. Enable debug visualization to see anchor points
4. Check if text has unusual geometry

---

### Problem: "Bridge tab fallback" in console
**Cause:** Automatic overlap adjustment failed

**Solutions:**
1. Increase "Loop Overlap" significantly (1.5mm or 2.0mm)
2. Check if anchor points are in reasonable locations (enable debug viz)
3. Try different text input to see if font-specific issue
4. Bridge tab should still connect - verify in LightBurn

---

### Problem: Loops positioned oddly (too high/low/far)
**Cause:** Anchor point detection issue or unusual font geometry

**Solutions:**
1. Enable "Show Loop Anchor Points" to visualize
2. Check console for anchor coordinates
3. Verify text bounds are reasonable
4. May need to adjust sampling parameters in code

---

### Problem: Right loop floating in space
**Cause:** Old code still being executed (should NOT happen with new system)

**Solutions:**
1. Hard refresh browser (Ctrl+Shift+R)
2. Verify "Loop Overlap" control exists in UI
3. Check console for new log format (should say "GEOMETRY SAMPLING")
4. If issue persists, report as bug with console logs

## 🎓 Design Philosophy

### Why Geometry-Based?

**Old Approach (Bounding Box):**
```
❌ Used textBounds.left/right
❌ Didn't account for cursive geometry
❌ Loops positioned arbitrarily
❌ No overlap verification
❌ Frequent connection failures
```

**New Approach (Geometry Sampling):**
```
✓ Samples actual outline
✓ Finds real endpoints
✓ Verifies overlap mathematically
✓ Adjusts automatically
✓ Falls back gracefully
✓ Validates result
```

### Benefits

1. **Universal:** Works with ANY text, ANY font
2. **Robust:** Verifies and adjusts automatically
3. **Debuggable:** Extensive logging and visualization
4. **Elegant:** Finds natural attachment points
5. **Reliable:** Validates final connectivity

## 📚 References

- **Paper.js Documentation:** http://paperjs.org/reference/
- **Boolean Operations:** `item.unite(otherItem)`
- **Intersection Testing:** `item.intersect(otherItem)`
- **Path Sampling:** `path.getPointAt(offset)`
- **Path Flattening:** `path.flatten(tolerance)`

## 🔮 Future Enhancements

Possible improvements:
1. **Smart offset:** Automatically adjust offset based on text height
2. **Multiple anchor candidates:** Try multiple points if first fails
3. **Adaptive sampling:** Use finer sampling for complex curves
4. **Loop orientation:** Rotate loops to match text angle
5. **Visual preview:** Show loop placement in real-time as parameters change

