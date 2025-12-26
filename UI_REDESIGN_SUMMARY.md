# UI Redesign Summary

## Overview
The UI has been reorganized into 3 sections to reduce cognitive load and provide a streamlined experience for stainless steel name necklaces.

## New Structure

### 1. BASIC Section (Always Visible)
This is the minimal interface shown by default:
- **Enter Name** - Text input for the name
- **Target Height (mm)** - Slider to set pendant height (default: 15mm)
- **Preview** - Large, centered SVG preview
- **Download SVG** - Prominent primary action button

### 2. ADVANCED Section (Collapsible, Default: Collapsed)
Click to expand for optional tuning:

#### Chain Attachment Loops (Enabled by default)
- Enable/disable loops checkbox
- Inner Diameter: 3.0mm (default)
- Outer Diameter: 5.5mm (default)
- Offset from Text: 0.6mm (default)
- Loop Overlap: 1.6mm (default for reliable welding)

#### Strengthen Offset (Enabled by default)
- Enable/disable strengthen checkbox
- Offset Amount: 0.25mm (default for stainless steel durability)
- Controls are disabled when strengthen is OFF

#### Typography Tuning
- Letter Spacing slider (-0.9 to 1.0 em)
- Font Size slider (20 to 200 px)
- Weld (Union) toggle

### 3. EXPERT / DEBUG Section (Collapsible, Default: Collapsed)
For advanced troubleshooting and fine-tuning:

#### Pair Spacing Overrides
- Custom spacing per letter pair textarea
- Load Preset button

#### Debug Visualization
- Debug Mode toggle (console logging)
- Show Loop Anchor Points toggle

#### i-Dot Connection
- Connect i-dot toggle (enabled by default)
- Overlap, Max Shift, Search Radius controls

## Default Behavior (for Stainless Steel)

The app now ships with production-ready defaults:

| Feature | Default State | Default Values |
|---------|--------------|----------------|
| **Loops** | ✅ Enabled | Inner: 3.0mm, Outer: 5.5mm, Offset: 0.6mm, Overlap: 1.6mm |
| **Strengthen** | ✅ Enabled | Amount: 0.25mm |
| **Weld** | ✅ Enabled | - |
| **i-Dot Connection** | ✅ Enabled | Overlap: 0.4mm, Max Shift: 2.0mm, Radius: 6.0mm |
| **Letter Spacing** | 0.00em | - |
| **Target Height** | 15mm | - |

## Key Benefits

1. **Reduced Complexity**: Users see only essential controls by default
2. **Production-Ready Defaults**: No configuration needed for typical stainless steel pendants
3. **Progressive Disclosure**: Advanced features available when needed
4. **All Features Preserved**: Nothing was removed, just reorganized

## Technical Notes

### Files Modified
- `index.html` - Restructured into BASIC/ADVANCED/EXPERT sections using `<details>` elements
- `style.css` - Added styling for collapsible sections, preserved all existing control styles
- `main.js` - Updated `currentSettings` defaults, added `initializeUI()` function

### Initialization
- `initializeUI()` is called after font load to sync HTML elements with `currentSettings`
- All existing event listeners preserved and functional
- Strengthen amount controls are automatically disabled when strengthen checkbox is OFF

### No Logic Changes
- All geometry generation, welding, offsetting, and export logic remains unchanged
- Only UI structure and default values were modified

