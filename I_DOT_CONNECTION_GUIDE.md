# I-Dot Connection Guide

## Problem

When laser cutting stainless steel name necklaces, the dot on lowercase **"i"** (and **"j"**) is typically a separate shape that doesn't touch the letter stem. During laser cutting, **the dot will fall out** because it's not physically connected to the main pendant.

## Solution

The **Connect i-dot** feature automatically detects dots and moves them downward to overlap with their stems. When combined with the **Weld (Union)** operation, the dot and stem merge into a single connected shape that won't fall apart.

## How It Works

### Process Flow

```
1. Generate text outlines → opentype.js creates separate paths for dots and stems
2. Import into Paper.js → All paths available for manipulation
3. Connect i-dots → Detect dots and shift them down to overlap stems
4. Weld (Union) → Merge overlapping shapes into single path
5. Export → Final SVG with connected dots
```

### Detection Algorithm

**A) Identify Dot Candidates:**
- **Small area**: Less than 5% of median glyph area
- **Round shape**: Aspect ratio between 0.6 and 1.6
- **Upper position**: Located in top 70% of text height

**B) Match Dots to Stems:**
- Find larger paths below each dot
- Check horizontal alignment (within search radius)
- Score by vertical gap + horizontal distance
- Pick best match

**C) Apply Translation:**
- Calculate gap between dot bottom and stem top
- Move dot down by: `gap + overlap`
- Clamp to maximum shift for safety
- Verify intersection after move

## UI Controls

### Connect i-dot (Checkbox)
- **Default**: ON (checked)
- **Purpose**: Enable/disable the feature
- Turn OFF if you want disconnected dots (not recommended for laser cutting)

### Overlap (mm)
- **Default**: 0.4mm
- **Range**: 0.1mm to 2.0mm
- **Purpose**: How much the dot should overlap the stem
- **Recommendation**: 
  - 0.3-0.5mm for thin letters
  - 0.5-0.8mm for bold letters
  - Higher values = stronger connection but more visible overlap

### Max Shift (mm)
- **Default**: 2.0mm
- **Range**: 0.5mm to 5.0mm
- **Purpose**: Safety limit on how far dots can move
- **Purpose**: Prevents dots from being moved too far if detection fails
- **Recommendation**: Keep at 2.0mm unless you have very tall letters

### Search Radius (mm)
- **Default**: 6.0mm
- **Range**: 1.0mm to 10.0mm
- **Purpose**: How far to search for matching stems horizontally and vertically
- **Recommendation**:
  - 4-6mm for normal spacing
  - 8-10mm for very loose letter spacing
  - 2-4mm for very tight spacing

## Usage Examples

### Example 1: Simple Name "Mia"
**Settings:**
```
Connect i-dot: ON
Overlap: 0.4mm
Max Shift: 2.0mm
Search Radius: 6.0mm
Weld: ON
```

**Result:**
- Dot above "i" detected
- Dot moved down 0.4mm to overlap stem
- Union merges dot and stem
- Final SVG: One connected shape ✓

### Example 2: Multiple i's "Fiji"
**Settings:**
```
Connect i-dot: ON
Overlap: 0.5mm
Weld: ON
Debug: ON (check console)
```

**Result:**
- Two dots detected (both i's)
- Both moved down to overlap stems
- Console shows details for each dot
- Final SVG: Dots welded to stems ✓

### Example 3: Tight Cursive with "Sofia"
**Settings:**
```
Letter Spacing: -0.85em (tight)
Connect i-dot: ON
Overlap: 0.6mm (extra overlap for visibility)
Search Radius: 4.0mm (tighter search)
```

**Result:**
- Dot detected even with tight spacing
- Successfully matched to stem
- Strong connection for laser cutting ✓

## Debug Mode

Enable **Debug Mode** checkbox and press **F12** to see detailed logging:

```
🔵 Starting i-dot connection process...
Options: {overlapMm: 0.4, maxShiftMm: 2, searchRadiusMm: 6}
Found 12 total paths
Overall bounds: {x: 10, y: 20, width: 200, height: 60}
Median path area: 450.25

✓ Dot candidate #1: {area: 35.20, aspectRatio: 1.15, center: {x: 125.50, y: 35.20}}

🎯 Matched dot to stem: {
  dotCenter: {x: 125.50, y: 35.20},
  stemCenter: {x: 126.00, y: 50.30},
  verticalGap: 5.20,
  horizontalDistance: 0.50,
  score: 5.30
}

Moving dot down by 6.71px (gap 5.20 + overlap 1.51)
✓ Dot shifted down by 6.71px
Intersection check: YES ✓

✅ Connected 1/1 dots to stems
```

## Troubleshooting

### Dot Not Connecting?

**Check:**
1. Is **Connect i-dot** checkbox enabled?
2. Is **Weld (Union)** checkbox enabled?
3. Enable Debug Mode - check if dot was detected
4. Increase **Search Radius** if stem not found
5. Check console for warnings

**Common Issues:**
- Search radius too small → Increase to 8-10mm
- Overlap too small → Increase to 0.6-0.8mm
- Font not supported → Feature tuned for Pacifico

### Dot Moved Too Far?

**Solution:**
- Reduce **Max Shift** to 1.0-1.5mm
- Check Debug Mode output for actual shift amount
- Verify stem detection is correct (might be matching wrong path)

### Multiple Dots Behaving Differently?

**Cause:**
Each dot is processed independently based on local geometry.

**Solution:**
- Enable Debug Mode to see why
- Adjust Search Radius for consistency
- Check if letter spacing affects detection

### Dot Still Falls Out?

**Check:**
1. Is **Weld (Union)** enabled? (Must be ON)
2. Is overlap sufficient? (Try 0.6-0.8mm)
3. Check Debug Mode: Does it say "Intersection check: YES"?
4. Download SVG and inspect in Inkscape/Illustrator

## Technical Details

### Coordinate System

- Paper.js uses same units as SVG (pixels at 96 DPI)
- Positive Y is downward
- Shifting "down" = adding to Y coordinate

### Conversion Formula

```javascript
mmToPaperUnits(mm) = mm × (96 / 25.4) ≈ mm × 3.7795
```

### Detection Thresholds

**Dot criteria:**
- Area < min(medianArea × 0.05, 300px²)
- Aspect ratio: 0.6 to 1.6
- Y position < (top + height × 0.7)

**Stem criteria:**
- Area > dotArea × 5
- Vertical gap < searchRadius
- Horizontal distance < searchRadius

### Safety Features

- Maximum shift limit prevents extreme translations
- Only moves dots, never stems
- Skips if no confident match
- Warns if connection fails
- No effect if already overlapping

## Font Compatibility

**Optimized for:**
- ✓ Pacifico (cursive, separate dots)
- ✓ Most script/cursive fonts

**May work with:**
- Fonts where i/j dots are separate paths
- Fonts with round dots

**Won't work with:**
- Fonts where dot is already part of stem path
- Fonts with square or decorative dots
- Sans-serif fonts (dots usually connected)

**Test first** with any new font!

## Laser Cutting Tips

### Material Considerations

**Stainless Steel:**
- Use overlap: 0.4-0.6mm
- Strong welds essential
- Test cut recommended

**Acrylic:**
- Use overlap: 0.3-0.5mm
- Less critical than metal
- May not need feature if glued

**Wood:**
- Use overlap: 0.5-0.8mm
- Burn can strengthen connection
- Higher overlap recommended

### Pre-Flight Check

Before sending to laser cutter:

1. ✓ Enable **Connect i-dot**
2. ✓ Enable **Weld (Union)**
3. ✓ Set appropriate **Overlap** for material
4. ✓ Download SVG
5. ✓ Open in LightBurn/laser software
6. ✓ Verify: Single connected path (not multiple objects)
7. ✓ Do test cut on scrap material

### Test Pattern

Create test word: **"iii"** (three i's)

- Should show 3 connected stems
- All dots welded
- Single continuous outline
- No loose pieces

## Examples by Name

| Name | i/j Count | Settings | Notes |
|------|-----------|----------|-------|
| Mia | 1 i | Default | Simple, works perfectly |
| Fiji | 2 i, 1 j | Overlap 0.5mm | Multiple dots, all connect |
| Sofia | 1 i | Radius 4mm | Tight spacing, reduce radius |
| Kristina | 2 i | Default | Well separated, easy |
| Julia | 1 j | Default | J dot works same as i |

---

**Remember**: Always do a test cut on scrap material before cutting your final necklace!

