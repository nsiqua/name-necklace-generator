# Name Necklace SVG Generator

A simple web app that converts text in Pacifico font to laser-cut friendly SVG files for stainless steel name necklaces.

## 🚀 Quick Setup Guide

### Step 1: Install Node.js

First, install Node.js (which includes npm). Download from:
**https://nodejs.org/**

Choose the **LTS** (Long Term Support) version. After installation, restart your terminal.

### Step 2: Download the Pacifico Font

**This is required!** The app uses a local font file.

1. Go to Google Fonts: **https://fonts.google.com/specimen/Pacifico**
2. Click the **"Download family"** button (top right)
3. Extract the downloaded ZIP file
4. Find **`Pacifico-Regular.ttf`** inside the extracted folder
5. Copy it to: **`C:\Users\Kasutaja\name-necklace-svg\public\fonts\Pacifico-Regular.ttf`**

Your folder structure should look like:
```
name-necklace-svg/
├── public/
│   └── fonts/
│       └── Pacifico-Regular.ttf  ← Put the font file here!
├── index.html
├── main.js
├── style.css
└── package.json
```

### Step 3: Install Dependencies

Open PowerShell or Command Prompt, navigate to the project folder, and run:

```bash
cd C:\Users\Kasutaja\name-necklace-svg
npm install
```

This will install:
- `vite` - Development server and build tool
- `opentype.js` - For loading and processing the font file
- `paper` - For advanced path operations (boolean union, i-dot connection, loop attachment)
- `clipper-lib` - For robust polygon offsetting (strengthen feature)

### Step 4: Run the Development Server

```bash
npm run dev
```

You'll see output like:
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Open **http://localhost:5173/** in your web browser.

## ✅ Verifying the Font Loaded Correctly

### Visual Indicators:

1. **Status Bar** at the top of the page:
   - 🟡 **Yellow** with "Loading font..." = Font is loading
   - 🟢 **Green** with "✓ Font loaded successfully!" = Font loaded correctly
   - 🔴 **Red** with error message = Problem loading the font

2. **Browser Console** (F12 → Console tab):
   - Success: `✓ Pacifico font loaded: Pacifico Regular`
   - Error: Will show specific error message

### Common Issues:

❌ **"Font file not found (HTTP 404)"**
- The font file is not in the correct location
- Verify the file is at: `public/fonts/Pacifico-Regular.ttf`
- File name must be exact (case-sensitive on some systems)

❌ **"Error: Font failed to load"**
- The font file might be corrupted
- Re-download from Google Fonts and try again

## 📖 How to Use the App

1. **Wait for "Font loaded successfully!"** status (green bar)
2. **Type a name** in the text input field
3. **Adjust settings:**
   - **Font Size** - Visual size in preview (20-200px)
   - **Letter Spacing** - Default spacing for all pairs (-0.9 to 1.0 em)
   - **Target Height** - Final laser-cut height (5-100mm)
   - **Weld (Union)** - Merge overlapping letters into single shape
   - **Connect i-dot** - Connects i/j dots to stems (⚠️ Important for laser cutting!)
   - **i-dot controls** - Fine-tune overlap, max shift, and search radius
   - **Loops** - Add attachment points for chain at left & right top edges
   - **Loop controls** - Adjust inner diameter and offset from text
   - **Pair Spacing Overrides** - Custom spacing for specific letter pairs (optional)
4. **See the live preview** - Updates in real-time
5. **Click "Download SVG"** - Save laser-cut ready file
6. **File saved as:** `[Name]_necklace.svg`

### 🔧 Advanced Features

**i-Dot Connection (Important for Laser Cutting!):**
- Prevents dots on "i" and "j" from falling out
- Automatically moves dots down to overlap stems
- Adjust overlap amount, max shift, and search radius
- **See [I_DOT_CONNECTION_GUIDE.md](I_DOT_CONNECTION_GUIDE.md) for details**

**Loops (Chain Attachment Points):**
- Adds donut-shaped loops at the left & right top edges
- Inner Diameter (default 3.0mm) - Size of the hole for jump rings
- Outer Diameter (user editable, default 4.6mm) - Controls loop thickness
- Loop Thickness - Calculated: (Outer - Inner) ÷ 2 (default 0.8mm)
- Offset from Text (default 0.6mm) - Distance above text
- Loop Overlap (default 0.4mm) - How much loop overlaps text for welding
- Loops are automatically welded (united) into the text shape
- **Robust placement:** 
  - Quantile-based selection (works with descenders like g, p, y)
  - Glyph-region filtering (prevents i-dot stealing anchor)
  - Works correctly for any text input!
- ⚠️ **Note:** Loops require "Weld (Union)" to be enabled
- **See [LOOPS_GUIDE.md](LOOPS_GUIDE.md), [ROBUST_LOOP_ATTACHMENT_GUIDE.md](ROBUST_LOOP_ATTACHMENT_GUIDE.md), and [GLYPH_REGION_ANCHOR_FIX.md](GLYPH_REGION_ANCHOR_FIX.md) for details**

**Strengthen Offset (+0.12mm):**
- Applies an outward offset (dilation) to the entire design
- Thickens all strokes by exactly 0.12mm for improved durability
- Uses Clipper library with PolyTree for robust hole preservation
- Preserves smooth curves through fine polygon processing
- Default: OFF (unchecked)
- **Benefits:**
  - Makes thin strokes more durable when laser-cut in metal
  - Prevents fragile details from breaking
  - Minimal visual change, significant structural improvement
- ⚠️ **Note:** Applied AFTER all other operations (text + i-dots + loops welding)
- **See [STRENGTHEN_OFFSET_GUIDE.md](STRENGTHEN_OFFSET_GUIDE.md) for technical details**

**Pair Spacing:**
- Fine control over letter spacing
- Use the **Pair Spacing Overrides** textarea
- Format: `AB=-0.60` (two characters, then = and value in em)
- Click **Load Preset** for examples
- **See [PAIR_SPACING_GUIDE.md](PAIR_SPACING_GUIDE.md) for details**

**Debug Mode:**
- Enable to see detailed calculations (press F12)
- Shows spacing decisions, dot connection, and loop generation

## 🔧 Technical Details

### SVG Output Specifications:
- **Format**: SVG 1.1
- **Paths**: Generated from actual font outlines using opentype.js
- **Stroke**: 0.5mm black outline (no fill)
- **Dimensions**: Millimeters for easy laser cutting
- **Units**: `width` and `height` in mm
- **Precision**: 2 decimal places

### Technologies Used:
- **Vite** - Modern build tool and dev server
- **Vanilla JavaScript** - No framework needed
- **opentype.js** (v1.3.4) - TrueType/OpenType font parser
- **paper.js** (v0.12.17) - Vector graphics library
- **Pacifico Font** - Elegant cursive design

## 📦 Building for Production

To create an optimized build for deployment:

```bash
npm run build
```

Output files will be in the `dist/` folder. Make sure the font file is included in the build!

## 🎨 Features

- ✓ Real-time preview as you type
- ✓ Pacifico cursive font (loaded locally)
- ✓ Laser-cut optimized SVG output
- ✓ **i-dot connection** - Automatically connects dots to stems (prevents dots from falling out!)
- ✓ **Attachment loops** - Add chain connection points at left & right top edges
- ✓ **Robust loop placement** - Quantile-based + glyph-region anchor selection
- ✓ **Smart anchor filtering** - Works with descenders AND i-dot letters!
- ✓ **Pair-specific letter spacing** - Custom spacing for individual letter pairs
- ✓ OpenType kerning preserved
- ✓ Path welding (boolean union) for merged outlines
- ✓ Adjustable font size and letter spacing
- ✓ Target height control (mm) for laser cutting
- ✓ Fine control over i-dot overlap and search parameters
- ✓ Customizable loop size, thickness, and offset
- ✓ Loop overlap control for reliable welding
- ✓ Status indicator for font loading
- ✓ Debug mode for spacing, dot connection, and loop generation
- ✓ Visual anchor point debugging
- ✓ Clean, modern, responsive UI
- ✓ Automatic file naming
- ✓ Error handling and user feedback

## 🐛 Troubleshooting

### Font won't load?
1. Check file location: `public/fonts/Pacifico-Regular.ttf`
2. Verify file name spelling (case-sensitive)
3. Check browser console (F12) for detailed errors
4. Try restarting the dev server (`Ctrl+C`, then `npm run dev`)

### Can't see preview?
1. Make sure the font loaded (green status bar)
2. Type something in the input field
3. Check browser console for JavaScript errors

### Download button disabled?
1. Make sure font is loaded (green status)
2. Type at least one character in the input field

## 📝 File Structure

```
name-necklace-svg/
├── public/
│   └── fonts/
│       ├── Pacifico-Regular.ttf       # Font file (you add this)
│       └── PLACE_FONT_HERE.txt        # Instructions (can delete)
├── index.html                          # Main HTML page
├── main.js                             # JavaScript logic
├── style.css                           # Styling
├── package.json                        # Dependencies
├── README.md                           # This file
├── LOOPS_GUIDE.md                      # Loops feature documentation
├── ROBUST_LOOP_ATTACHMENT_GUIDE.md     # Robust loop placement documentation
├── QUANTILE_ANCHOR_FIX.md              # Quantile-based anchor selection (descenders fix)
├── GLYPH_REGION_ANCHOR_FIX.md          # Glyph-region filtering (i-dot anchor fix)
├── I_DOT_CONNECTION_GUIDE.md           # i-Dot connection documentation
├── I_DOT_IMPLEMENTATION_SUMMARY.md     # i-Dot technical details
├── PAIR_SPACING_GUIDE.md               # Pair spacing documentation
└── IMPLEMENTATION_SUMMARY.md           # Pair spacing technical details
```

---

Need help? Check the status bar and browser console for specific error messages!
