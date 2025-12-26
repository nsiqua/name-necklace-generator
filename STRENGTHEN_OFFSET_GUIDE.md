# Strengthen Offset Feature Guide

## Overview

The **Strengthen +0.12mm Offset** feature applies a uniform outward expansion (dilation) of exactly **0.12mm** to the final pendant design. This thickens all strokes and details slightly, improving the structural durability of thin features when laser-cut in stainless steel.

---

## Why This Feature?

Script fonts like Pacifico often have thin, delicate strokes that may be fragile when cut in metal at small sizes. A small outward offset:
- **Thickens thin areas** without dramatically changing the design's appearance
- **Preserves holes** (like loop centers and letter counters)
- **Maintains smooth curves** through careful polygon processing

---

## UI Controls

### Location
The checkbox appears near the bottom of the controls panel, just above the "Download SVG" button.

### Checkbox
- **Label:** "Strengthen (+0.12mm offset)"
- **Default:** OFF (unchecked)
- **Help Text:** "Applies an outward offset to thicken the design for durability."

### Behavior
- When **unchecked:** The pendant exports with original geometry (no modification)
- When **checked:** An outward offset of exactly **0.12mm** is applied to the final welded shape before export
- The offset is applied to:
  - Text outline
  - Connected i-dots (if enabled)
  - Attachment loops (if enabled)
  - All welded/unified components

---

## How It Works

### High-Level Pipeline

```
Original Design (Paper.js)
   ↓
Clean Debug Markers
   ↓
[IF Strengthen Enabled]
   ↓
Convert to Clipper Polygons (flatten curves with 0.03mm tolerance)
   ↓
Union All Components (PolyTree)
   ↓
Offset by +0.12mm (Clipper round joins)
   ↓
Convert Back to Paper.js (smooth + simplify)
   ↓
Export SVG
```

### Key Implementation Details

#### 1. **Unit Conversion**
- **Paper.js units:** Pixels (at 96 DPI)
- **Conversion:** `1mm = 96/25.4 ≈ 3.7795 pixels`
- **Clipper units:** Integers (scaled by 10,000 per Paper.js pixel)
- **Offset amount:** 0.12mm → ~0.4535 pixels → ~4,535 Clipper units

#### 2. **PolyTree-Based Offset** (Critical for Holes)
The implementation uses **Clipper PolyTree** instead of flat path arrays. This is essential because:
- **Preserves hierarchy:** Outer boundaries vs. holes are maintained correctly
- **Prevents hole collapse:** Without PolyTree, holes (like loop centers) would be treated as independent shapes and might offset incorrectly
- **Handles nested holes:** Complex designs with holes-in-holes work correctly

#### 3. **Polygon Flattening**
- **Tolerance:** 0.03mm (very fine)
- **Why:** Curves must be approximated as polygons for Clipper processing
- **Trade-off:** Finer tolerance = more points = better curve accuracy but slower processing
- **Post-Processing:** After offsetting, curves are restored using `path.smooth()` and `path.simplify(0.3)`

#### 4. **Offset Parameters**
- **Join Type:** `jtRound` (creates smooth, rounded corners/joins)
- **Arc Tolerance:** `delta * 0.25` (controls smoothness of round joins)
- **End Type:** `etClosedPolygon` (all paths are closed shapes)

#### 5. **Cleaning & Simplification**
- **Before union:** `SimplifyPolygon()` removes self-intersections
- **After offset:** `CleanPolygons()` removes tiny artifacts and spikes
- **Back in Paper.js:** `smooth()` restores Bézier curves, `simplify(0.3)` reduces redundant points

---

## Functions Reference

### `mmToPaperPixels(mm)`
Converts millimeters to Paper.js pixels using 96 DPI conversion.

**Returns:** `number` (pixels)

---

### `paperItemToClipperRings(item, flattenTolPixels)`
Extracts all closed paths from a Paper.js item, flattens them, and converts to Clipper integer polygon rings.

**Parameters:**
- `item` (Paper.Item): Path, CompoundPath, or Group
- `flattenTolPixels` (number): Curve approximation tolerance in pixels

**Returns:** `Array<Array<{X, Y}>>` (Clipper polygon rings)

**Details:**
- Handles `Path`, `CompoundPath`, and `Group` items
- Skips open paths
- Removes duplicate consecutive points
- Only returns rings with ≥3 points

---

### `clipperUnionToPolyTree(rings)`
Uses Clipper to union all polygon rings into a single unified PolyTree. This ensures:
- All disconnected components are merged
- Holes are correctly identified by winding order
- The result is a valid single shape

**Parameters:**
- `rings` (Array): Array of Clipper polygon rings

**Returns:** `ClipperLib.PolyTree`

**Details:**
- Simplifies each ring before union
- Uses `ctUnion` operation
- Uses `pftNonZero` fill type

---

### `clipperOffsetPolyTree(polyTree, deltaClipperUnits)`
Applies an offset (dilation/erosion) to a PolyTree using ClipperOffset.

**Parameters:**
- `polyTree` (ClipperLib.PolyTree): Input shape
- `deltaClipperUnits` (number): Offset delta (positive = outward, negative = inward)

**Returns:** `ClipperLib.PolyTree` (offset result)

**Details:**
- Uses `jtRound` for smooth joins
- Arc tolerance set to `delta * 0.25`
- Cleans result with `CleanPolygons()`
- Re-unions result to restore PolyTree hierarchy

---

### `polyTreeToPaperCompoundPath(polyTree)`
Converts a Clipper PolyTree back to a Paper.js CompoundPath, preserving holes.

**Parameters:**
- `polyTree` (ClipperLib.PolyTree): Input PolyTree

**Returns:** `paper.CompoundPath`

**Details:**
- Recursively processes all nodes (outers and holes)
- Converts Clipper integer coords back to Paper.js pixels
- Applies `smooth({ type: 'continuous' })` to restore curves
- Applies `simplify(0.3)` to reduce redundant points

---

### `applyStrengthenOffset(item, offsetMm, debug)`
Main function that applies the strengthen offset to a Paper.js item.

**Parameters:**
- `item` (Paper.Item): The final pendant design
- `offsetMm` (number): Offset amount in millimeters (e.g., 0.12)
- `debug` (boolean): Enable detailed console logging

**Returns:** `paper.CompoundPath` (strengthened result)

**Pipeline:**
1. Convert `item` to Clipper rings (flatten with 0.03mm tolerance)
2. Union all rings into a single PolyTree (ensures unified shape)
3. Apply offset to PolyTree
4. Convert result back to Paper.js CompoundPath
5. Return strengthened item

**Error Handling:**
- If any step fails, logs error and returns original item (fallback)
- Warns if rings, union, or offset produce empty results

---

## Debug Logging

When **Debug Mode** is enabled (separate checkbox), the strengthen offset logs:

```
🔧 === STRENGTHEN OFFSET START ===
Offset amount: 0.12mm
Conversion: 1mm = 3.7795px
Offset in pixels: 0.4535px
Offset in Clipper units: 4535
Flatten tolerance: 0.03mm (0.1134px)
Extracted 8 ring(s) from Paper.js item
✓ Unified into PolyTree with 1 top-level component(s)
✓ Offset complete; result has 1 top-level component(s)
✓ Converted back to Paper.js CompoundPath
🔧 === STRENGTHEN OFFSET COMPLETE ===
```

---

## Common Issues & Troubleshooting

### Issue: Offset distorts the shape
**Symptoms:** Jagged edges, straight lines instead of curves, spikes

**Causes:**
- Flatten tolerance too coarse
- Missing `smooth()` or `simplify()` post-processing

**Fixes:**
- Current implementation uses 0.03mm tolerance (very fine)
- `smooth()` restores curves after polygonal processing
- `simplify(0.3)` removes redundant points without distorting

---

### Issue: Holes collapse or disappear
**Symptoms:** Loop centers fill in, letter counters (e.g., "o", "a") become solid

**Causes:**
- Not using PolyTree (flat path arrays don't preserve hole hierarchy)
- Incorrect winding order classification

**Fixes:**
- Current implementation uses PolyTree throughout
- Union before offset ensures all holes are correctly identified
- Union after offset restores hierarchy

---

### Issue: Multiple disconnected components after offset
**Symptoms:** Warning "Loops not fully attached" after offset

**Causes:**
- The input to strengthen offset had disconnected components (loops not welded)

**Fixes:**
- The offset function always runs a union BEFORE offsetting
- This ensures even if Paper.js unions failed, Clipper will force-merge everything
- If components are still disconnected after offset, it indicates a fundamental geometry issue (e.g., no overlap between loops and text)

---

### Issue: Output looks identical to input when checkbox is ON
**Symptoms:** No visible thickening

**Possible Causes:**
1. Offset amount (0.12mm) is too small to notice at current zoom level
2. Offset failed and returned original item (check console for errors)
3. JavaScript error preventing offset from running

**Debug Steps:**
1. Enable "Debug Mode" checkbox
2. Check console for strengthen offset logs
3. Compare exported SVG file size (strengthened version should be slightly larger/more complex)
4. Measure a stroke in LightBurn before and after enabling strengthen

---

## Acceptance Tests

### Test 1: "Sofia" with Loops
1. Enter "Sofia"
2. Enable loops
3. Enable strengthen offset
4. **Expected:** All strokes slightly thicker, loop outer ring expands, loop hole expands (doesn't collapse)

---

### Test 2: "Victoria" with Loops
1. Enter "Victoria"
2. Enable loops
3. Enable strengthen offset
4. **Expected:** Long cursive strokes thicken uniformly, no spikes, smooth curves maintained

---

### Test 3: Toggle Strengthen On/Off
1. Generate a design
2. Toggle strengthen checkbox ON → should see slight thickening
3. Toggle strengthen checkbox OFF → should return to original
4. **Expected:** Preview updates immediately, no distortion

---

### Test 4: Holes Preserved
1. Enter "Sofia" (has loop holes)
2. Enable strengthen offset
3. Download SVG, open in LightBurn
4. **Expected:** Loop centers remain hollow (not filled), letter counters (like "o") remain hollow

---

### Test 5: Short Word
1. Enter "Mia"
2. Enable loops + strengthen offset
3. **Expected:** Both loops attach and thicken correctly, no disconnected components

---

## Technical Notes

### Why PolyTree?
Standard Clipper operations return flat arrays of paths (`ClipperLib.Paths`). Without hierarchy information, holes and outers are indistinguishable except by winding order (clockwise vs. counter-clockwise). When offsetting:
- A hole must offset **outward** (expand), not inward
- An outer must offset **outward** (expand)
- Without PolyTree, manually classifying winding order is error-prone

**PolyTree** maintains parent-child relationships (hole-in-outer-in-hole...), making offset operations unambiguous.

### Why Not Paper.js `path.offset()`?
Paper.js has a built-in `offset()` method, but:
- It's less robust for complex shapes (can produce self-intersections)
- Doesn't handle CompoundPaths well (must extract and offset each path individually)
- No built-in "union after offset" step to merge results
- Clipper is the industry-standard library for this type of operation

### Scaling Factor (10,000)
Clipper requires integer coordinates. We scale Paper.js pixels by 10,000 to preserve precision:
- 0.12mm = ~0.4535 pixels
- 0.4535 * 10,000 = 4,535 Clipper units
- After processing, divide by 10,000 to get back to pixels
- This ensures sub-pixel precision throughout the pipeline

---

## Future Enhancements (Optional)

### Variable Offset Amount
Replace fixed 0.12mm with a slider:
```html
<input type="range" min="0.05" max="0.30" step="0.01" value="0.12">
```
Update `applyStrengthenOffset(result, currentSettings.strengthenAmount, ...)`.

### Offset Preview Overlay
Show original + offset side-by-side in different colors (preview only, not exported).

### Adaptive Offset Based on Text Size
For very small pendants (< 10mm height), automatically increase offset for durability.

---

## Summary

The strengthen offset feature:
- ✅ **Runs only when enabled** (checkbox OFF = no processing)
- ✅ **Uses PolyTree for correct hole handling**
- ✅ **Preserves smooth curves** via fine flattening + smoothing
- ✅ **Applies exactly 0.12mm outward offset** with round joins
- ✅ **Works with any text/loops/i-dots** (all welded components)
- ✅ **Falls back gracefully on errors** (returns original if offset fails)

This implementation fixes all previous issues (distortion, collapsed holes, unit confusion) by using a robust, proven pipeline with correct coordinate system handling and PolyTree-based hierarchy preservation.

