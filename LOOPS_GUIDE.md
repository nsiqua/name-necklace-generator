# Attachment Loops Feature Guide

## Overview

The attachment loops feature adds donut-shaped connection points to the left and right top edges of your name necklace design. These loops are essential for attaching the necklace to a chain using jump rings.

## Why Loops Are Important

When laser cutting a name necklace, you need attachment points for the chain. The loops feature:
- Creates properly sized holes for jump rings (default 3.0mm inner diameter)
- Ensures structural integrity with minimum 0.8mm thickness
- Automatically welds loops to the text for a single, unified shape
- Positions loops optimally at the top left and right edges

## UI Controls

### Loops Checkbox
- **Location:** Below the "Connect i-dot" controls
- **Default:** ON (checked)
- **Purpose:** Toggle loops on/off
- When unchecked, no loops are added to the design

### Inner Diameter (mm)
- **Range:** 1.0 - 10.0mm
- **Default:** 3.0mm
- **Step:** 0.1mm
- **Purpose:** Sets the size of the hole in the loop
- **Typical values:**
  - 2.5-3.0mm: For small jump rings
  - 3.0-4.0mm: Standard jump rings (recommended)
  - 4.0-6.0mm: Large jump rings or heavy chains

### Offset from Text (mm)
- **Range:** 0.0 - 5.0mm
- **Default:** 0.6mm
- **Step:** 0.1mm
- **Purpose:** Visual distance between the text and the loops
- **Important:** Loops automatically overlap the text by 0.5mm internally to ensure proper welding, regardless of this offset value
- **Typical values:**
  - 0.0-0.5mm: Minimal visual gap (loops appear close to text)
  - 0.6-1.0mm: Small visual gap (recommended for most designs)
  - 1.5-3.0mm: Larger visual gap for aesthetic spacing

### Outer Diameter (display only)
- **Formula:** Inner Diameter + 2 × 0.8mm
- **Default:** 4.6mm (when inner = 3.0mm)
- **Purpose:** Ensures minimum 0.8mm thickness for structural strength
- This value is automatically calculated and cannot be manually adjusted

## How It Works

### Technical Process

1. **Text Generation:** Your text is converted to vector paths using opentype.js
2. **i-Dot Connection:** If enabled, dots are connected to stems (happens first)
3. **Loop Creation:**
   - Calculate text bounding box
   - Position loops at `bounds.left` and `bounds.right`
   - Position loops at `bounds.top - offset - outerRadius`
   - Create outer circle (outer diameter)
   - Create inner circle (inner diameter)
   - Subtract inner from outer to create donut shape
4. **Welding:** All paths (text + loops) are united into a single shape using Paper.js
5. **Export:** Final SVG is generated with proper mm dimensions

### Loop Position Calculation

```
Left Loop X = Text Bounds Left
Right Loop X = Text Bounds Right
Loop Y = Text Bounds Top - Offset - Outer Radius
```

This ensures:
- Loops are at the outermost left/right edges
- Loops are positioned above the text
- Loops have proper clearance from the text

## Usage Examples

### Example 1: Standard Necklace
**Settings:**
- Inner Diameter: 3.0mm
- Offset: 0.6mm
- Result: Outer Diameter = 4.6mm

**Use Case:** Most common setup for standard jump rings and chains.

### Example 2: Delicate Design
**Settings:**
- Inner Diameter: 2.5mm
- Offset: 1.0mm
- Result: Outer Diameter = 4.1mm

**Use Case:** Smaller, more delicate loops with extra spacing from text.

### Example 3: Heavy Chain
**Settings:**
- Inner Diameter: 5.0mm
- Offset: 0.5mm
- Result: Outer Diameter = 6.6mm

**Use Case:** Larger loops for thick chains or heavy-duty jump rings.

### Example 4: No Gap
**Settings:**
- Inner Diameter: 3.0mm
- Offset: 0.0mm
- Result: Outer Diameter = 4.6mm, loops touch text

**Use Case:** Maximum material usage, loops directly connected to text.

## Important Notes

### ⚠️ Welding Required
- Loops **only appear when "Weld (Union)" is enabled**
- This is intentional - loops must be welded to the text to create a single cuttable shape
- Without welding, the loops would be separate pieces

### Material Considerations
- The 0.8mm minimum thickness is designed for stainless steel
- For thinner materials (e.g., acrylic), you may want larger loops
- For thicker materials (e.g., wood), standard settings work well

### Jump Ring Sizing
Common jump ring sizes and recommended inner diameters:
- 3mm jump ring → 3.5mm inner diameter
- 4mm jump ring → 4.5mm inner diameter
- 5mm jump ring → 5.5mm inner diameter
- 6mm jump ring → 6.5mm inner diameter

Always add ~0.5mm clearance for easy attachment.

## Troubleshooting

### Loops Not Appearing
**Problem:** Preview doesn't show loops
**Solutions:**
1. Check that "Loops" checkbox is enabled
2. Verify "Weld (Union)" is enabled (required for loops)
3. Check browser console (F12) for errors
4. Ensure text is not empty

### Loops Too Small/Large
**Problem:** Loops don't fit jump rings or look disproportionate
**Solutions:**
1. Adjust "Inner Diameter" to match your jump ring size + 0.5mm
2. Remember: outer diameter = inner + 1.6mm (automatic)
3. Test with actual jump rings after cutting

### Loops Too Close/Far from Text
**Problem:** Loops overlap text or are too spaced out
**Solutions:**
1. Adjust "Offset from Text" value
2. Start at 0.6mm and adjust up/down by 0.1mm increments
3. Preview updates in real-time

### Loops Not at Exact Corners
**Problem:** Loops seem offset from expected position
**Explanation:** 
- Loops are positioned at the **leftmost** and **rightmost** points of the text **bounds**
- For cursive fonts like Pacifico, these may not be at letter corners
- This is intentional for balanced attachment points
- The design will hang correctly when attached to a chain

## Debug Mode

Enable "Debug Mode" to see detailed console logs about loop generation:

```
🔵 Generating attachment loops...
  Inner diameter: 3.0mm
  Offset from text: 0.6mm
  Loop thickness: 0.8mm
  Inner radius: 5.67px
  Outer radius: 8.74px
  Offset: 2.27px
  Text bounds: x=10.50, y=15.20, w=285.60, h=75.30
  Left loop center: (10.50, 4.73)
  Right loop center: (296.10, 4.73)
  ✓ Created left loop
  ✓ Created right loop
✅ Generated 2 loops
```

This helps verify:
- Loop dimensions are calculated correctly
- Loop positions are as expected
- Both loops are created successfully

## Technical Details

### Units and Conversion
- UI inputs are in millimeters (mm)
- Internally converted to pixels using 96 DPI standard
- Conversion: 1mm = 3.7795 pixels (96 DPI)
- Final SVG export uses mm for width/height attributes

### Paper.js Implementation
Loops use Paper.js for precise geometric operations:
1. Create outer circle at calculated position
2. Create inner circle at same position
3. Use `subtract()` boolean operation to create donut
4. Add to path items for union with text

### SVG Export
- Loops are part of the final unified path
- Single `<path>` element contains text + loops
- No separate loop elements in output
- Ready for laser cutting without further processing

## Related Features

- **Weld (Union):** Required for loops functionality
- **i-Dot Connection:** Runs before loop generation in the pipeline
- **Target Height:** Affects final loop size in exported SVG
- **Debug Mode:** Shows loop generation details in console

## Best Practices

1. **Start with defaults:** 3.0mm inner diameter, 0.6mm offset works for most cases
2. **Test cut:** Do a test cut with scrap material to verify jump ring fit
3. **Consider chain weight:** Heavier chains need larger, stronger loops
4. **Check proportions:** Loops should look balanced with the text size
5. **Preview before export:** Always check the preview with loops visible
6. **Enable welding:** Loops won't show without welding enabled

## Common Workflows

### Workflow 1: First Time User
1. Type name in input field
2. Keep default loop settings (3.0mm inner, 0.6mm offset)
3. Verify "Loops" and "Weld" are both checked
4. Preview looks good → Download SVG
5. Test with actual jump rings after cutting

### Workflow 2: Custom Loop Size
1. Measure your jump ring inner diameter
2. Add 0.5mm for clearance
3. Set "Inner Diameter" to this value
4. Adjust "Offset" if needed for aesthetics
5. Check "Outer Diameter" display (auto-calculated)
6. Download SVG

### Workflow 3: No Loops Needed
1. Uncheck "Loops" checkbox
2. Design updates without loops
3. Useful for testing text layout
4. Or if adding loops manually in other software

---

**Need help?** Enable Debug Mode (F12 → Console) to see detailed loop generation logs!

