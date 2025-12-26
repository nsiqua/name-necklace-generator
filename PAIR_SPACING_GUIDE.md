# Pair Spacing Guide

## Overview

The **Pair Spacing** feature allows you to define custom spacing adjustments for specific letter pairs, giving you fine control over the visual appearance of your name necklace design.

## How It Works

### The Spacing System

The app applies spacing in this order:

1. **OpenType Kerning** - Built-in font kerning pairs (e.g., "AV", "To")
2. **Default Letter Spacing** - Global spacing from the slider (in em units)
3. **Pair Spacing Override** - Custom spacing for specific pairs (if defined)

**Formula:**
```
Total Advance = Glyph Width + Kerning + (Pair Spacing OR Default Spacing)
```

### Units

- **em units**: Relative to font size
  - `1.0em` = one character width
  - `0.5em` = half character width
  - `-0.5em` = reduce spacing by half character width

### Default Spacing Slider

- Range: `-0.9` to `1.0` em
- Default: `0.0` em (natural font spacing)
- Applies to ALL letter pairs (unless overridden)

## Pair Spacing Overrides

### Format

Each line in the textarea defines one pair:

```
AB=-0.60
```

Where:
- `AB` = Two-character pair (case-sensitive)
- `-0.60` = Spacing in em units (FINAL spacing, not delta)

### Examples

```
So=-0.60
of=-0.90
fi=-0.85
ia=-0.70
```

This means:
- "So" pair will use `-0.60em` spacing
- "of" pair will use `-0.90em` spacing
- All other pairs use the default slider value

### Spaces

You can define spacing for pairs involving spaces:

```
a =-0.30
 a=-0.40
```

Where:
- `a ` = letter 'a' followed by space
- ` a` = space followed by letter 'a'

### Comments

Lines starting with `#` or `//` are ignored:

```
# Tight pairs for cursive flow
So=-0.60
of=-0.90

// Decorative pairs
fi=-0.85
```

## Usage

### Step 1: Set Default Spacing

Use the **Letter Spacing** slider to set the baseline spacing for all pairs.

Example: `-0.83em` for tight cursive look

### Step 2: Define Pair Overrides

In the **Pair Spacing Overrides** textarea, add custom pairs:

```
So=-0.60
fi=-0.85
```

### Step 3: Load Preset (Optional)

Click **Load Preset** to fill the textarea with example pairs. Modify as needed.

### Step 4: Preview

The preview updates automatically. Check the visual result.

### Step 5: Debug (Optional)

Enable **Debug Mode** checkbox and press F12 to open console. You'll see a table:

| pair | kerning | spacingEm | spacingPx | advance | total | x |
|------|---------|-----------|-----------|---------|-------|---|
| So   | -2.34   | -0.600    | -48.00    | 52.80   | 2.46  | 0.00 |
| of   | 0.00    | -0.900    | -72.00    | 48.00   | -24.00| 2.46 |

### Step 6: Download

The downloaded SVG includes all pair spacing adjustments.

## Validation

Invalid lines are shown in the warnings area:

- ✓ Valid: `So=-0.60`
- ✗ Invalid: `S=-0.60` (only 1 character)
- ✗ Invalid: `Sofia=-0.60` (more than 2 characters)
- ✗ Invalid: `So=abc` (not a number)

## Advanced Tips

### Finding Good Values

1. Start with default spacing around `-0.7` to `-0.85em`
2. Identify pairs that look too tight or too loose
3. Add pair overrides incrementally
4. Use Debug Mode to see exact calculations

### Common Pairs for Cursive Fonts

```
So=-0.60   # Capital S to lowercase o
of=-0.90   # Lowercase o to f (tight)
fi=-0.85   # Lowercase f to i
ia=-0.70   # Lowercase i to a
```

### Testing

Enable Debug Mode and type "Sofia" to see:
- Per-pair spacing decisions
- Kerning values
- X positions
- Total advances

## Examples

### Example 1: Tight Cursive
```
Default Spacing: -0.85em
Pair Overrides:
  So=-0.65
  of=-0.95
  fi=-0.90
```

### Example 2: Loose Modern
```
Default Spacing: 0.20em
Pair Overrides:
  (none - all pairs use default)
```

### Example 3: Mixed Style
```
Default Spacing: -0.50em
Pair Overrides:
  So=-0.80  # Extra tight for capital-lowercase
  fi=-0.85  # Tight for ligature-like pair
  ia=0.00   # Normal spacing
```

## Troubleshooting

### Pair Not Working?

1. Check spelling and case (pairs are case-sensitive)
2. Look for validation warnings below the textarea
3. Enable Debug Mode - check if your pair appears in console
4. Make sure the text contains that pair

### Spacing Too Extreme?

- Remember: values are in **em units** (relative to font size)
- At 80px font size: `1.0em` = 80px
- Typical range: `-0.9em` to `0.5em`

### Preview vs Export Different?

Both should match. If not:
1. Check browser console for errors
2. Verify welding is working correctly
3. Try disabling welding temporarily

## Technical Details

### Calculation Order

For text "Sofia" with default spacing `-0.80em`:

1. **S** → placed at x=0
2. **o** → advance = S.width + kerning(S,o) + spacing("So" or default)
3. **f** → advance = o.width + kerning(o,f) + spacing("of" or default)
4. **i** → advance = f.width + kerning(f,i) + spacing("fi" or default)
5. **a** → advance = i.width + kerning(i,a) + spacing("ia" or default)

### Conversion

- `1 em` = `fontSizePx` pixels
- Example: At 80px font size, `-0.80em` = `-64px`

### Compatibility

- Preserves OpenType kerning
- Works with welding (union)
- Works with mm scaling
- Compatible with all export formats

---

**Need Help?** Enable Debug Mode and check the console output to understand exactly what spacing is being applied to each pair!

