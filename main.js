import * as makerjsNS from 'makerjs';

// Normalize CommonJS/ESM interop
const makerjs = makerjsNS.default ?? makerjsNS;

/**
 * Name Necklace SVG Generator - v2.1 (Auto-connect fix applied)
 * 
 * ARCHITECTURE OVERVIEW:
 * 
 * 1. FONT LOADING (opentype.js)
 *    - Loads Pacifico-Regular.ttf from /public/fonts/
 *    - Provides glyph access and kerning data
 * 
 * 2. TEXT LAYOUT (layoutTextWithPairSpacing)
 *    - Computes glyph positions with:
 *      a) OpenType kerning (font.getKerningValue)
 *      b) Default letter spacing (slider value)
 *      c) Pair-specific overrides (from textarea)
 *    - Returns array of {glyph, x, y} placements
 * 
 * 3. PATH GENERATION (generatePathWithKerning)
 *    - Uses layoutTextWithPairSpacing for positioning
 *    - Builds SVG path data from glyph outlines
 *    - Can return combined path or individual letter paths
 * 
 * 4. BOOLEAN OPERATIONS (applyPaperJsUnion - Paper.js)
 *    - Imports individual letter paths
 *    - i-DOT CONNECTION: Moves i/j dots down to overlap stems
 *    - LOOPS: Adds attachment points (donut shapes) at left/right top edges
 *    - Applies unite() operation iteratively to merge all paths
 *    - Exports merged path back to SVG format
 * 
 * 5. EXPORT (generateLaserCutSVG)
 *    - Scales to target height in mm
 *    - Uses 96 DPI for px↔mm conversion
 *    - Generates final SVG with proper dimensions
 * 
 * DATA FLOW:
 * User Input → layoutTextWithPairSpacing → Path Generation → 
 * [Optional: i-dot connection + Loops + Welding] → Export
 */

import opentype from 'opentype.js';
import paper from 'paper';
import ClipperLib from 'clipper-lib';
import { initAuth, appState, refreshCredits } from './auth.js';
import { supabase } from './supabaseClient.js';
import { persistFont, getPersistedFonts } from './fontStorage.js';

// Track which userId we have already restored fonts for,
// so we don't re-restore on every credits-refresh event.
let _restoredForUserId = null;

// ── Reddit Pixel helper ───────────────────────────────────────────────────────
function _rdtInit(email, userId) {
  if (typeof rdt !== 'function') return;
  try {
    rdt('init', 'a2_igpkzcqz976k', {
      email: email || undefined,
      externalId: userId || undefined,
    });
  } catch (e) { /* ignore */ }
}
function _rdtTrack(event, data) {
  if (typeof rdt !== 'function') return;
  try { rdt('track', event, data); } catch (e) { /* ignore */ }
}

initAuth(async (identity) => {
  if (identity.type === 'user' && identity.userId && identity.userId !== _restoredForUserId) {
    // ── Logged-in user detected (first time or after account switch) ──
    _restoredForUserId = identity.userId;

    // ── Reddit Pixel: upgrade to advanced matching + fire SignUp event ────────
    _rdtInit(identity.email, identity.userId);
    // conversionId = stable per user → deduplicates across tabs / retries
    _rdtTrack('SignUp', { conversionId: `signup_${identity.userId}` });

    try {
      const saved = await getPersistedFonts(identity.userId);
      for (const record of saved) {
        _addFontOptionFromBuffer(record.fontName, record.buffer, { userFont: true });
      }
      if (saved.length > 0) {
        console.log(`[fonts] Restored ${saved.length} persisted font(s) for user ${identity.userId.slice(-6)}.`);
      }
    } catch (err) {
      console.warn('[fonts] Could not restore persisted fonts:', err);
    }
  } else if (identity.type === 'guest' && _restoredForUserId !== null) {
    // ── User signed out ── remove their persisted fonts from the selector
    _restoredForUserId = null;
    fontSelect.querySelectorAll('option[data-user-font]').forEach(opt => {
      if (activeFontKey === opt.value) {
        activeFontKey = 'pacifico';
        fontSelect.value = 'pacifico';
      }
      customFontsById.delete(opt.value);
      opt.remove();
    });
  }
});

// ── Dev helper (DEV builds only) ──────────────────────────────────────────────
// Usage in console:
//   window.__auth.getState()
//   await window.__auth.refreshCredits()
//   await window.__auth.supabase.auth.getSession()
if (import.meta.env.DEV) {
  import('./supabaseClient.js').then(({ supabase }) => {
    window.__auth = {
      supabase,
      getState: () => ({ ...appState }),
      refreshCredits: () => refreshCredits(),
    };
    console.log('[dev] 🛠️  window.__auth available.',
      '\n  window.__auth.getState()         → current identity + credits',
      '\n  await window.__auth.refreshCredits() → re-fetch from edge function');
  });
}


// Get DOM elements
const nameInput = document.getElementById('nameInput');
const namePath = document.getElementById('namePath');
const previewSvg = document.getElementById('previewSvg');
const downloadBtn = document.getElementById('downloadBtn');
const formatSelect = document.getElementById('formatSelect');
// resetViewBoxBtn removed - auto-fit is now automatic
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');

// Sliders and controls
const fontSizeSlider = document.getElementById('fontSizeSlider');
const fontSizeValue = document.getElementById('fontSizeValue');
const letterSpacingSlider = document.getElementById('letterSpacingSlider');
const letterSpacingValue = document.getElementById('letterSpacingValue');
const targetHeightInput = document.getElementById('targetHeightInput');
const targetHeightValue = document.getElementById('targetHeightValue');
const weldCheckbox = document.getElementById('weldCheckbox');
const debugCheckbox = document.getElementById('debugCheckbox');
const debugAnchorsCheckbox = document.getElementById('debugAnchorsCheckbox');
const connectIDotsCheckbox = document.getElementById('connectIDotsCheckbox');
const iDotOverlapInput = document.getElementById('iDotOverlapInput');
const iDotMaxShiftInput = document.getElementById('iDotMaxShiftInput');
const iDotSearchRadiusInput = document.getElementById('iDotSearchRadiusInput');
const autoConnectCheckbox = document.getElementById('autoConnectCheckbox');
const autoConnectMinOverlapInput = document.getElementById('autoConnectMinOverlapInput');
const autoConnectMaxTightenInput = document.getElementById('autoConnectMaxTightenInput');
const autoConnectDebugLogCheckbox = document.getElementById('autoConnectDebugLogCheckbox');
const autoConnectDebugMarkersCheckbox = document.getElementById('autoConnectDebugMarkersCheckbox');
const loopsCheckbox = document.getElementById('loopsCheckbox');
const loopInnerDiameterInput = document.getElementById('loopInnerDiameterInput');
const loopOuterDiameterInput = document.getElementById('loopOuterDiameterInput');
const loopThicknessDisplay = document.getElementById('loopThicknessDisplay');
const loopOffsetInput = document.getElementById('loopOffsetInput');
const loopOverlapInput = document.getElementById('loopOverlapInput');
const strengthenOffsetToggle = document.getElementById('strengthenOffsetToggle');
const strengthenAmountSlider = document.getElementById('strengthenAmountSlider');
const strengthenAmountInput = document.getElementById('strengthenAmountInput');
const strengthenAmountValue = document.getElementById('strengthenAmountValue');
const strengthenAmountControls = document.getElementById('strengthenAmountControls');
const pairSpacingTextarea = document.getElementById('pairSpacingTextarea');
const pairSpacingWarnings = document.getElementById('pairSpacingWarnings');
const loadPresetBtn = document.getElementById('loadPresetBtn');
const fontSelect = document.getElementById('fontSelect');
const fontUpload = document.getElementById('fontUpload');

// Paper.js canvas setup
const paperCanvas = document.getElementById('paperCanvas');
paper.setup(paperCanvas);

// PX to MM conversion constants
// Assumption: 96 DPI (CSS/Web standard)
// 1 inch = 96 pixels (CSS pixel definition)
// 1 inch = 25.4 mm
// Therefore: 1 px = 25.4 / 96 mm ≈ 0.264583 mm
// And: 1 mm = 96 / 25.4 px ≈ 3.7795 px
const MM_PER_PX = 25.4 / 96;  // ~0.264583
const PX_PER_MM = 96 / 25.4;  // ~3.7795

// ============================================
// BUILT-IN PAIR SPACING OVERRIDES
// ============================================
// These spacing overrides are ALWAYS applied for better typographic results.
// They work even when the Expert section is hidden or the textarea is empty.
// User overrides in the textarea will take precedence over these defaults.
//
// Current built-in overrides (in em units):
//   So=-0.15  : Tighten "So" pair (e.g., in "Sofia") for better cursive flow
//   IA=-0.21  : Tighten "IA" pair (e.g., in "SOFIA") to ensure connection
//   o-=-0.25  : Tighten "o" followed by hyphen for better spacing
//   -b=-0.21  : Tighten hyphen followed by "b" for better spacing
const BUILTIN_PAIR_OVERRIDES = {
  "So": 0,
  "IA": 0,
  "o-": 0,
  "-b": 0
};

// ============================================
// MULTI-FONT SYSTEM
// ============================================

// Configuration for built-in (preloaded) fonts
const BUILTIN_FONTS = {
  'pacifico': { file: 'Pacifico-Regular.ttf', name: 'Pacifico' },
  'cookie': { file: 'Cookie-Regular.ttf', name: 'Cookie' },
  'dancing-script': { file: 'DancingScript-Regular.ttf', name: 'Dancing Script' },
  'norican': { file: 'Norican-Regular.ttf', name: 'Norican' },
  'rochester': { file: 'Rochester-Regular.ttf', name: 'Rochester' },
  'satisfy': { file: 'Satisfy-Regular.ttf', name: 'Satisfy' },
  'sriracha': { file: 'Sriracha-Regular.ttf', name: 'Sriracha' },
  'style-script': { file: 'StyleScript-Regular.ttf', name: 'Style Script' }
};

// Font storage object (will be populated as fonts are loaded)
const fonts = {
  pacifico: null,
  cookie: null,
  'dancing-script': null,
  norican: null,
  rochester: null,
  satisfy: null,
  sriracha: null,
  'style-script': null
};

// Store multiple custom fonts
const customFontsById = new Map();
let customFontCounter = 0;

// Track active font (can be 'pacifico' or a custom font id like 'custom:1')
let activeFontKey = 'pacifico';

function getActiveFont() {
  // Check if it's a builtin font
  if (BUILTIN_FONTS[activeFontKey]) {
    return fonts[activeFontKey];
  }
  // Check if it's a custom font
  if (customFontsById.has(activeFontKey)) {
    return customFontsById.get(activeFontKey);
  }
  // Fallback to Pacifico if something went wrong
  return fonts.pacifico;
}

/**
 * Parse a raw ArrayBuffer as a font, register it in customFontsById,
 * and add an <option> to the font selector.
 *
 * @param {string}      fontName - Display name for the selector
 * @param {ArrayBuffer} buffer   - Raw TTF/OTF bytes
 * @param {object}      [opts]
 * @param {boolean}     [opts.userFont=false]  - Mark option as data-user-font (persisted/owned by logged-in user)
 * @param {boolean}     [opts.switchTo=false]  - Immediately activate the font and regenerate preview
 * @returns {string|null} The assigned fontId, or null on parse failure
 */
function _addFontOptionFromBuffer(fontName, buffer, { userFont = false, switchTo = false } = {}) {
  try {
    const fontObject = opentype.parse(buffer);
    customFontCounter++;
    const fontId = `custom:${customFontCounter}`;
    customFontsById.set(fontId, fontObject);

    const uploadOption = fontSelect.querySelector('option[value="custom_upload"]');
    const newOption = document.createElement('option');
    newOption.value = fontId;
    newOption.textContent = fontName;
    if (userFont) newOption.dataset.userFont = 'true';

    if (uploadOption) {
      fontSelect.insertBefore(newOption, uploadOption);
    } else {
      fontSelect.appendChild(newOption);
    }

    if (switchTo) {
      activeFontKey = fontId;
      fontSelect.value = fontId;
      generatePreview();
    }

    return fontId;
  } catch (err) {
    console.warn(`[fonts] Could not parse font "${fontName}":`, err);
    return null;
  }
}

// ============================================
// DEFAULT SETTINGS (for stainless steel)
// ============================================
let currentSettings = {
  fontSize: 80,
  letterSpacing: 0,
  targetHeight: 15,  // in mm
  weldPaths: true,   // boolean union enabled by default
  pairSpacingMap: { ...BUILTIN_PAIR_OVERRIDES }, // pair-specific spacing overrides (start with built-in defaults)
  connectIDots: true, // connect i/j dots to stems
  iDotOverlap: 0.4,   // mm of overlap to create
  iDotMaxShift: 2.0,  // mm maximum downward shift
  iDotSearchRadius: 6.0, // mm search radius for matching stems

  // LOOPS: enabled by default for stainless steel
  addLoops: true,
  loopInnerDiameter: 3.0,  // mm (default for stainless)
  loopOuterDiameter: 5.5,  // mm (default for stainless)
  loopOffset: 0.6,         // mm offset from text
  loopOverlap: 1.6,        // mm overlap for welding (increased default)

  // STRENGTHEN: enabled by default for stainless steel
  strengthenOffset: true,  // apply outward offset for durability
  strengthenAmount: 0.25,  // mm (default for stainless)

  // AUTO-CONNECT: geometry-based spacing enforcement (Expert feature)
  autoConnect: true,            // enable auto-connect adjacent letters (enabled by default)
  autoConnectMinOverlap: 1.0,   // mm minimum overlap required (balanced for natural script connections)
  autoConnectMaxTighten: 10.0,  // mm maximum tightening per pair (increased for script fonts with larger gaps)
  autoConnectDebugLog: true,    // log auto-adjustments to console (ENABLED FOR DEBUGGING)
  autoConnectDebugMarkers: false, // draw overlap markers in preview

  debugMode: false,        // enable debug logging and visualization
  debugAnchors: false      // show loop anchor points
};

// ============================================
// INITIALIZE UI TO MATCH DEFAULT SETTINGS
// ============================================
function initializeUI() {
  // Set all HTML elements to match currentSettings
  fontSizeSlider.value = currentSettings.fontSize;
  fontSizeValue.textContent = currentSettings.fontSize;

  letterSpacingSlider.value = currentSettings.letterSpacing;
  letterSpacingValue.textContent = currentSettings.letterSpacing.toFixed(2);

  targetHeightInput.value = currentSettings.targetHeight;
  targetHeightValue.textContent = currentSettings.targetHeight;

  weldCheckbox.checked = currentSettings.weldPaths;
  connectIDotsCheckbox.checked = currentSettings.connectIDots;
  debugCheckbox.checked = currentSettings.debugMode;
  debugAnchorsCheckbox.checked = currentSettings.debugAnchors;

  // i-dot controls
  iDotOverlapInput.value = currentSettings.iDotOverlap;
  iDotMaxShiftInput.value = currentSettings.iDotMaxShift;
  iDotSearchRadiusInput.value = currentSettings.iDotSearchRadius;

  // AUTO-CONNECT: disabled by default (Expert feature)
  autoConnectCheckbox.checked = currentSettings.autoConnect;
  autoConnectMinOverlapInput.value = currentSettings.autoConnectMinOverlap;
  autoConnectMaxTightenInput.value = currentSettings.autoConnectMaxTighten || 6.0;
  autoConnectDebugLogCheckbox.checked = currentSettings.autoConnectDebugLog;
  autoConnectDebugMarkersCheckbox.checked = currentSettings.autoConnectDebugMarkers;

  // LOOPS: enabled by default with stainless steel defaults
  loopsCheckbox.checked = currentSettings.addLoops;
  loopInnerDiameterInput.value = currentSettings.loopInnerDiameter;
  loopOuterDiameterInput.value = currentSettings.loopOuterDiameter;
  loopOffsetInput.value = currentSettings.loopOffset;
  loopOverlapInput.value = currentSettings.loopOverlap;

  // Calculate and display loop thickness
  const thickness = (currentSettings.loopOuterDiameter - currentSettings.loopInnerDiameter) / 2;
  loopThicknessDisplay.textContent = thickness.toFixed(2);

  // STRENGTHEN: enabled by default with stainless steel defaults
  strengthenOffsetToggle.checked = currentSettings.strengthenOffset;
  strengthenAmountSlider.value = currentSettings.strengthenAmount;
  strengthenAmountInput.value = currentSettings.strengthenAmount;
  strengthenAmountValue.textContent = currentSettings.strengthenAmount.toFixed(2);

  // Set initial state of strengthen amount controls
  if (currentSettings.strengthenOffset) {
    strengthenAmountControls.classList.remove('disabled');
  } else {
    strengthenAmountControls.classList.add('disabled');
  }

  console.log('✓ UI initialized with defaults (loops ON, strengthen ON for stainless steel)');
}

// Helper function to load a built-in font by key
async function loadBuiltinFont(fontKey) {
  const fontConfig = BUILTIN_FONTS[fontKey];

  if (!fontConfig) {
    throw new Error(`Unknown font key: ${fontKey}`);
  }

  // If already loaded, return immediately
  if (fonts[fontKey]) {
    return fonts[fontKey];
  }

  // Load font from public folder
  const response = await fetch(`/fonts/${fontConfig.file}`);

  if (!response.ok) {
    throw new Error(`Font file not found (HTTP ${response.status}). Please ensure ${fontConfig.file} is in the /public/fonts/ folder.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fonts[fontKey] = opentype.parse(arrayBuffer);

  console.log(`✓ ${fontConfig.name} font loaded:`, fonts[fontKey].names.fullName.en);

  return fonts[fontKey];
}

// Load the default font (Pacifico) at startup
async function loadFont() {
  try {
    statusBar.className = 'status-bar loading';
    statusText.textContent = 'Loading Pacifico font...';

    // Load Pacifico as the default font
    await loadBuiltinFont('pacifico');

    // Font loaded successfully
    statusBar.className = 'status-bar success';
    statusText.textContent = 'Font loaded successfully! Ready to create your necklace.';

    // Initialize UI to match default settings
    initializeUI();

    // Enable the input
    nameInput.disabled = false;
    nameInput.focus();

  } catch (error) {
    console.error('Font loading error:', error);
    statusBar.className = 'status-bar error';
    statusText.textContent = `Error: ${error.message}`;

    // Auto-expand Expert section so user can see the error (if visible)
    if (expertSection && !expertSection.classList.contains('dev-only-hidden')) {
      expertSection.open = true;
    }

    // Keep input disabled if font fails to load
    nameInput.disabled = true;
    downloadBtn.disabled = true;
    formatSelect.disabled = true;
  }
}

// ============================================
// FONT SELECTOR AND UPLOAD HANDLERS
// ============================================

// Handle font selection changes
fontSelect.addEventListener('change', async (e) => {
  const selectedValue = e.target.value;

  if (selectedValue === 'custom_upload') {
    // User clicked the upload action - trigger file picker
    fontUpload.click();
    // Revert selection to current font while file picker is open
    e.target.value = activeFontKey;
    return;
  }

  // Check if this is a builtin font
  if (BUILTIN_FONTS[selectedValue]) {
    try {
      // Show loading status
      statusBar.className = 'status-bar loading';
      statusText.textContent = `Loading ${BUILTIN_FONTS[selectedValue].name} font...`;

      // Load the font (will use cache if already loaded)
      await loadBuiltinFont(selectedValue);

      // Switch to the loaded font
      activeFontKey = selectedValue;
      console.log(`✓ Switched to ${BUILTIN_FONTS[selectedValue].name} font`);

      // Update status
      statusBar.className = 'status-bar success';
      statusText.textContent = `${BUILTIN_FONTS[selectedValue].name} font loaded successfully!`;

      // Regenerate preview with new font
      generatePreview();

    } catch (error) {
      console.error('Font loading error:', error);
      statusBar.className = 'status-bar error';
      statusText.textContent = `Error loading font: ${error.message}`;

      // Revert to previous font
      e.target.value = activeFontKey;
    }
    return;
  }

  // Otherwise it's a custom font ID - switch to it
  activeFontKey = selectedValue;
  console.log(`✓ Switched to custom font ${selectedValue}`);
  generatePreview();
});

// Handle custom font upload
fontUpload.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) {
    // User cancelled - selection already reverted in change handler
    return;
  }

  try {
    statusBar.className = 'status-bar loading';
    statusText.textContent = `Loading ${file.name}...`;

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Resolve display name from font metadata, falling back to filename
    let fontName = 'Custom Font';
    {
      const tempFont = opentype.parse(arrayBuffer);
      if (tempFont.names.fullName?.en) fontName = tempFont.names.fullName.en;
      else if (tempFont.names.fontFamily?.en) fontName = tempFont.names.fontFamily.en;
      else fontName = file.name.replace(/\.(ttf|otf)$/i, '');
    }

    // Register + add to selector (marks as data-user-font if logged in, and auto-switches)
    const isLoggedIn = appState.type === 'user' && !!appState.userId;
    const fontId = _addFontOptionFromBuffer(fontName, arrayBuffer, {
      userFont: isLoggedIn,
      switchTo: true,
    });

    if (!fontId) throw new Error('Font could not be parsed.');

    // ── Persist for logged-in users ──────────────────────────────────────────
    if (isLoggedIn) {
      persistFont(appState.userId, fontId, fontName, arrayBuffer)
        .then(() => console.log(`[fonts] Persisted "${fontName}" for user ${appState.userId.slice(-6)}.`))
        .catch(err => console.warn('[fonts] Could not persist font:', err));
    }

    // Update status bar
    statusBar.className = 'status-bar success';
    statusText.textContent = `✓ Custom font "${fontName}" loaded successfully!`;

    console.log(`✓ Custom font loaded: ${fontName} (ID: ${fontId})`);

    // Clear the file input so same file can be uploaded again if needed
    e.target.value = '';

  } catch (error) {
    console.error('Custom font loading error:', error);
    statusBar.className = 'status-bar error';
    statusText.textContent = `Error loading font: ${error.message}`;
    e.target.value = '';
  }
});


// Update preview when user types
nameInput.addEventListener('input', (e) => {
  generatePreview();
});

// Update preview when sliders change
fontSizeSlider.addEventListener('input', (e) => {
  currentSettings.fontSize = parseFloat(e.target.value);
  fontSizeValue.textContent = Math.round(currentSettings.fontSize);
  generatePreview();
});

letterSpacingSlider.addEventListener('input', (e) => {
  currentSettings.letterSpacing = parseFloat(e.target.value);
  letterSpacingValue.textContent = currentSettings.letterSpacing.toFixed(2);
  generatePreview();
});

targetHeightInput.addEventListener('input', (e) => {
  currentSettings.targetHeight = parseFloat(e.target.value);
  targetHeightValue.textContent = Math.round(currentSettings.targetHeight);
  // Note: Target height only affects the downloaded SVG, not the preview
});

weldCheckbox.addEventListener('change', (e) => {
  currentSettings.weldPaths = e.target.checked;
  generatePreview();
});

debugCheckbox.addEventListener('change', (e) => {
  currentSettings.debugMode = e.target.checked;
  window.DEBUG_PAIR_SPACING = e.target.checked;
  window.DEBUG_I_DOTS = e.target.checked;
  if (e.target.checked) {
    console.log('🔍 Debug mode enabled - generating preview with detailed logs...');
  }
  generatePreview();
});

debugAnchorsCheckbox.addEventListener('change', (e) => {
  window.DEBUG_LOOP_ANCHORS = e.target.checked;
  if (e.target.checked) {
    console.log('🎨 Loop anchor visualization enabled - red=left, blue=right');
  }
  generatePreview();
});

connectIDotsCheckbox.addEventListener('change', (e) => {
  currentSettings.connectIDots = e.target.checked;
  generatePreview();
});

iDotOverlapInput.addEventListener('input', (e) => {
  currentSettings.iDotOverlap = parseFloat(e.target.value) || 0.4;
  generatePreview();
});

iDotMaxShiftInput.addEventListener('input', (e) => {
  currentSettings.iDotMaxShift = parseFloat(e.target.value) || 2.0;
  generatePreview();
});

iDotSearchRadiusInput.addEventListener('input', (e) => {
  currentSettings.iDotSearchRadius = parseFloat(e.target.value) || 6.0;
  generatePreview();
});

// Auto-connect controls
autoConnectCheckbox.addEventListener('change', (e) => {
  currentSettings.autoConnect = e.target.checked;
  console.log(`Auto-connect ${e.target.checked ? 'ENABLED' : 'DISABLED'}`);
  generatePreview();
});

autoConnectMinOverlapInput.addEventListener('input', (e) => {
  currentSettings.autoConnectMinOverlap = parseFloat(e.target.value) || 0.4;
  if (currentSettings.autoConnect) {
    generatePreview();
  }
});

autoConnectMaxTightenInput.addEventListener('input', (e) => {
  currentSettings.autoConnectMaxTighten = parseFloat(e.target.value) || 3.0;
  if (currentSettings.autoConnect) {
    generatePreview();
  }
});

autoConnectDebugLogCheckbox.addEventListener('change', (e) => {
  currentSettings.autoConnectDebugLog = e.target.checked;
  if (currentSettings.autoConnect) {
    generatePreview();
  }
});

autoConnectDebugMarkersCheckbox.addEventListener('change', (e) => {
  currentSettings.autoConnectDebugMarkers = e.target.checked;
  if (currentSettings.autoConnect) {
    generatePreview();
  }
});

// Loop controls
loopsCheckbox.addEventListener('change', (e) => {
  currentSettings.addLoops = e.target.checked;
  generatePreview();
});

loopInnerDiameterInput.addEventListener('input', (e) => {
  currentSettings.loopInnerDiameter = parseFloat(e.target.value) || 3.0;

  // Ensure outer diameter is always larger than inner diameter
  if (currentSettings.loopOuterDiameter <= currentSettings.loopInnerDiameter) {
    currentSettings.loopOuterDiameter = currentSettings.loopInnerDiameter + 0.2;
    loopOuterDiameterInput.value = currentSettings.loopOuterDiameter.toFixed(1);
  }

  updateLoopThicknessDisplay();
  generatePreview();
});

loopOuterDiameterInput.addEventListener('input', (e) => {
  currentSettings.loopOuterDiameter = parseFloat(e.target.value) || 4.6;

  // Ensure outer diameter is always larger than inner diameter
  if (currentSettings.loopOuterDiameter <= currentSettings.loopInnerDiameter) {
    currentSettings.loopOuterDiameter = currentSettings.loopInnerDiameter + 0.2;
    loopOuterDiameterInput.value = currentSettings.loopOuterDiameter.toFixed(1);
  }

  updateLoopThicknessDisplay();
  generatePreview();
});

loopOffsetInput.addEventListener('input', (e) => {
  currentSettings.loopOffset = parseFloat(e.target.value) || 0.6;
  generatePreview();
});

loopOverlapInput.addEventListener('input', (e) => {
  currentSettings.loopOverlap = parseFloat(e.target.value) || 0.4;
  generatePreview();
});

// Strengthen offset checkbox
strengthenOffsetToggle.addEventListener('change', (e) => {
  currentSettings.strengthenOffset = e.target.checked;
  console.log(`Strengthen offset ${e.target.checked ? 'ENABLED' : 'DISABLED'} (${currentSettings.strengthenAmount}mm)`);

  // Enable/disable the amount controls based on checkbox state
  if (e.target.checked) {
    strengthenAmountControls.classList.remove('disabled');
  } else {
    strengthenAmountControls.classList.add('disabled');
  }

  generatePreview();
});

// Strengthen offset amount slider
strengthenAmountSlider.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value) || 0.12;
  currentSettings.strengthenAmount = value;
  strengthenAmountInput.value = value.toFixed(2);
  strengthenAmountValue.textContent = value.toFixed(2);
  generatePreview();
});

// Strengthen offset amount numeric input
strengthenAmountInput.addEventListener('input', (e) => {
  let value = parseFloat(e.target.value);
  if (isNaN(value)) value = 0.12;
  if (value < 0) value = 0;
  if (value > 1.0) value = 1.0;

  currentSettings.strengthenAmount = value;
  strengthenAmountSlider.value = value;
  strengthenAmountValue.textContent = value.toFixed(2);
  generatePreview();
});

// Update loop thickness display (calculated from outer - inner)
function updateLoopThicknessDisplay() {
  const thickness = (currentSettings.loopOuterDiameter - currentSettings.loopInnerDiameter) / 2;
  loopThicknessDisplay.textContent = thickness.toFixed(2);
}

// Initialize display
updateLoopThicknessDisplay();

// Pair spacing textarea handler with debounce
let pairSpacingTimeout;
pairSpacingTextarea.addEventListener('input', (e) => {
  clearTimeout(pairSpacingTimeout);
  pairSpacingTimeout = setTimeout(() => {
    const result = parsePairSpacingMap(e.target.value);

    // Merge built-in overrides with user overrides (user wins on conflicts)
    currentSettings.pairSpacingMap = { ...BUILTIN_PAIR_OVERRIDES, ...result.map };

    // Show warnings if any
    if (result.warnings.length > 0) {
      pairSpacingWarnings.textContent = result.warnings.join('; ');
      pairSpacingWarnings.className = 'warnings visible';
    } else {
      pairSpacingWarnings.className = 'warnings';
    }

    generatePreview();
  }, 500); // 500ms debounce
});

// Load preset button
loadPresetBtn.addEventListener('click', () => {
  const preset = `So=-0.60
of=-0.90
fi=-0.85
ia=-0.70`;
  pairSpacingTextarea.value = preset;
  pairSpacingTextarea.dispatchEvent(new Event('input'));
});

// Note: Auto-fit viewBox is now called automatically after each design update
// Manual "Reset ViewBox" button has been removed from the UI

// =====================================================
// STRENGTHEN OFFSET (Clipper-based, PolyTree)
// =====================================================

// Clipper scaling: units per Paper.js pixel
const CLIPPER_SCALE = 10000;

// Helper: Convert mm to Paper.js pixels
// We use the same conversion as for SVG export: 1mm = PX_PER_MM pixels
function mmToPaperPixels(mm) {
  // PX_PER_MM is defined based on 96 DPI: 96 / 25.4 ≈ 3.7795
  const PX_PER_MM = 96 / 25.4;
  return mm * PX_PER_MM;
}

/**
 * Convert a Paper.js item (Path/CompoundPath/Group) into Clipper polygon rings.
 * Simple extraction - let PolyTree+EvenOdd handle hole hierarchy automatically.
 * @param {paper.Item} item - The Paper.js item to convert
 * @param {number} flattenTolPixels - Tolerance for flattening curves (in Paper pixels)
 * @returns {Array<Array<{X:number, Y:number}>>} Array of Clipper rings (closed point arrays)
 */
function paperItemToClipperRings(item, flattenTolPixels) {
  const rings = [];

  // Extract all leaf paths from the item (no hole detection needed)
  const paths = [];

  if (item instanceof paper.Path) {
    paths.push(item);
  } else if (item instanceof paper.CompoundPath) {
    item.children.forEach(child => {
      if (child instanceof paper.Path) {
        paths.push(child);
      }
    });
  } else if (item instanceof paper.Group) {
    item.children.forEach(child => {
      if (child instanceof paper.Path) {
        paths.push(child);
      } else if (child instanceof paper.CompoundPath) {
        child.children.forEach(subChild => {
          if (subChild instanceof paper.Path) {
            paths.push(subChild);
          }
        });
      }
    });
  }

  // Convert each path to a Clipper ring
  for (const path of paths) {
    if (!path.closed) continue; // Skip open paths

    // Clone and flatten to get a polygonal approximation
    const clonedPath = path.clone();
    clonedPath.flatten(flattenTolPixels);

    const ring = [];
    for (let i = 0; i < clonedPath.segments.length; i++) {
      const seg = clonedPath.segments[i];
      const pt = {
        X: Math.round(seg.point.x * CLIPPER_SCALE),
        Y: Math.round(seg.point.y * CLIPPER_SCALE)
      };

      // Skip duplicate consecutive points
      if (ring.length === 0 || ring[ring.length - 1].X !== pt.X || ring[ring.length - 1].Y !== pt.Y) {
        ring.push(pt);
      }
    }

    clonedPath.remove(); // Clean up

    // Only add rings with >= 3 points
    if (ring.length >= 3) {
      rings.push(ring);
    }
  }

  return rings;
}

/**
 * Use Clipper to union all rings into a PolyTree (preserves hole hierarchy).
 * Uses EvenOdd fill rule to avoid winding order sensitivity.
 * @param {Array<Array<{X:number, Y:number}>>} rings - Array of Clipper rings
 * @returns {ClipperLib.PolyTree} Unified PolyTree with hierarchy
 */
function clipperUnionToPolyTree(rings) {
  const clipper = new ClipperLib.Clipper();

  // Simplify each ring before union
  const simplifiedRings = [];
  for (const ring of rings) {
    const simplified = ClipperLib.Clipper.SimplifyPolygon(ring, ClipperLib.PolyFillType.pftEvenOdd);
    if (simplified && simplified.length > 0) {
      for (const s of simplified) {
        if (s.length >= 3) {
          simplifiedRings.push(s);
        }
      }
    }
  }

  // Add all rings as subjects
  clipper.AddPaths(simplifiedRings, ClipperLib.PolyType.ptSubject, true);

  // Execute union into PolyTree with EvenOdd fill rule
  const tree = new ClipperLib.PolyTree();
  const succeeded = clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    tree,
    ClipperLib.PolyFillType.pftEvenOdd,
    ClipperLib.PolyFillType.pftEvenOdd
  );

  if (!succeeded) {
    throw new Error('Clipper union failed');
  }

  return tree;
}

/**
 * Apply offset to a PolyTree using ClipperOffset.
 * @param {ClipperLib.PolyTree} polyTree - Input PolyTree
 * @param {number} deltaClipperUnits - Offset amount in Clipper units (positive = outward)
 * @returns {ClipperLib.PolyTree} Offset result as PolyTree
 */
function clipperOffsetPolyTree(polyTree, deltaClipperUnits) {
  const co = new ClipperLib.ClipperOffset(2, Math.abs(deltaClipperUnits) * 0.25);

  // Convert PolyTree to Paths for offsetting
  const paths = ClipperLib.Clipper.PolyTreeToPaths(polyTree);

  // Add all paths to the offsetter
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);

  // Execute offset into PolyTree
  const outTree = new ClipperLib.PolyTree();
  co.Execute(outTree, deltaClipperUnits);

  return outTree;
}

/**
 * Convert Clipper PolyTree back to a Paper.js CompoundPath.
 * NO smoothing or simplification - preserves exact offset shape.
 * @param {ClipperLib.PolyTree} polyTree - Input PolyTree
 * @returns {paper.CompoundPath} Result as Paper.js CompoundPath with evenodd fill rule
 */
function polyTreeToPaperCompoundPath(polyTree) {
  // Convert PolyTree to flat Paths (preserves holes via winding)
  const paths = ClipperLib.Clipper.PolyTreeToPaths(polyTree);

  const compoundPath = new paper.CompoundPath({
    fillColor: 'black',
    fillRule: 'evenodd'  // Critical for hole rendering
  });

  for (const clipperPath of paths) {
    if (clipperPath.length >= 3) {
      // Convert Clipper points back to Paper.js coordinates
      const points = clipperPath.map(pt => {
        return new paper.Point(pt.X / CLIPPER_SCALE, pt.Y / CLIPPER_SCALE);
      });

      // Create a Paper.js path WITHOUT smoothing/simplification
      const path = new paper.Path({
        segments: points,
        closed: true
      });

      // DO NOT smooth() or simplify() - this distorts small offsets!

      compoundPath.addChild(path);
    }
  }

  return compoundPath;
}

/**
 * Apply a strengthen offset to a Paper.js item.
 * Uses Clipper PolyTree with EvenOdd fill rule for proper hole preservation.
 * @param {paper.Item} item - The final pendant shape
 * @param {number} offsetMm - Outward offset amount in mm (e.g., 0.12)
 * @param {boolean} debug - Enable debug logging
 * @returns {paper.CompoundPath} Strengthened result
 */
function applyStrengthenOffset(item, offsetMm, debug) {
  try {
    const PX_PER_MM = 96 / 25.4;

    if (debug) {
      console.log('\n🔧 === STRENGTHEN OFFSET START ===');
      console.log(`Offset amount: ${offsetMm}mm`);
      console.log(`Conversion: 1mm = ${PX_PER_MM.toFixed(4)}px`);
    }

    // Convert offset to Paper.js pixels, then to Clipper units
    const offsetPixels = mmToPaperPixels(offsetMm);
    const offsetClipperUnits = offsetPixels * CLIPPER_SCALE;

    if (debug) {
      console.log(`Offset in pixels: ${offsetPixels.toFixed(4)}px`);
      console.log(`Offset in Clipper units: ${offsetClipperUnits.toFixed(0)}`);
    }

    // Step 1: Convert Paper.js item to Clipper rings
    const flattenTolMm = 0.03; // Fine tolerance for smooth curves
    const flattenTolPixels = mmToPaperPixels(flattenTolMm);

    if (debug) {
      console.log(`Flatten tolerance: ${flattenTolMm}mm (${flattenTolPixels.toFixed(4)}px)`);
    }

    const rings = paperItemToClipperRings(item, flattenTolPixels);

    if (debug) {
      console.log(`Extracted ${rings.length} ring(s) from Paper.js item`);
    }

    if (rings.length === 0) {
      console.warn('⚠️ No valid rings extracted; returning original item');
      return item;
    }

    // Step 2: Union into PolyTree (preserves hole hierarchy with EvenOdd)
    const unionTree = clipperUnionToPolyTree(rings);

    // Validation: Convert to paths to count
    const unionPaths = ClipperLib.Clipper.PolyTreeToPaths(unionTree);

    if (debug) {
      console.log(`✓ Union PolyTree created with ${unionPaths.length} path(s)`);

      // Sanity check for holes (for text with "o" or loops, expect multiple paths)
      if (unionPaths.length === 1) {
        console.warn('  ⚠️ WARNING: Only 1 path after union - holes may have collapsed!');
      }
    }

    if (unionPaths.length === 0) {
      console.warn('⚠️ Union produced empty PolyTree; returning original item');
      return item;
    }

    // Step 3: Apply offset to the PolyTree
    const offsetTree = clipperOffsetPolyTree(unionTree, offsetClipperUnits);

    // Validation: Convert to paths to count
    const offsetPaths = ClipperLib.Clipper.PolyTreeToPaths(offsetTree);

    if (debug) {
      console.log(`✓ Offset PolyTree created with ${offsetPaths.length} path(s)`);

      // Hole preservation check
      if (unionPaths.length > 1 && offsetPaths.length === 1) {
        console.warn('  ⚠️ WARNING: Holes may have collapsed during offset!');
      }
    }

    if (offsetPaths.length === 0) {
      console.warn('⚠️ Offset produced empty result; returning original item');
      return item;
    }

    // Step 4: Convert back to Paper.js CompoundPath with EvenOdd fill rule
    const strengthenedItem = polyTreeToPaperCompoundPath(offsetTree);

    if (debug) {
      console.log(`✓ Converted to Paper.js CompoundPath with ${strengthenedItem.children.length} child path(s)`);
      console.log(`  fillRule: ${strengthenedItem.fillRule}`);
      console.log('🔧 === STRENGTHEN OFFSET COMPLETE ===\n');
    }

    return strengthenedItem;

  } catch (error) {
    console.error('❌ Strengthen offset error:', error);
    console.error('Stack:', error.stack);
    console.warn('⚠️ Returning original item due to error');
    return item;
  }
}

// Generate preview with opentype.js paths
function generatePreview() {
  const name = nameInput.value.trim();

  if (!name || name.trim().length === 0 || !getActiveFont()) {
    namePath.setAttribute('d', '');
    downloadBtn.disabled = true;
    return;
  }

  try {
    // Apply Paper.js operations if weld is enabled
    let finalPathData;
    if (currentSettings.weldPaths) {
      finalPathData = applyPaperJsUnion(name, currentSettings.fontSize, currentSettings.letterSpacing, currentSettings.pairSpacingMap);
    } else {
      const result = generatePathWithKerning(name, currentSettings.fontSize, currentSettings.letterSpacing, false, currentSettings.pairSpacingMap);
      finalPathData = result.pathData;
    }

    // Update the path element
    namePath.setAttribute('d', finalPathData);

    // Use nonzero for correct cursive joins and overlapping strokes
    namePath.setAttribute('fill-rule', 'nonzero');

    // Auto-fit preview viewBox (center and fit the design with padding)
    autoFitViewBox();

    // Enable download button
    downloadBtn.disabled = false;
    formatSelect.disabled = false;
  } catch (error) {
    console.error('Error generating preview:', error);
    // Show error in status bar
    statusBar.className = 'status-bar error';
    statusText.textContent = `Preview Error: ${error.message}`;
    // Disable download button on error
    downloadBtn.disabled = true;
    formatSelect.disabled = true;
  }
}

/**
 * Parse pair spacing overrides from textarea input
 * Format: "AB=-0.90" where AB is the two-character pair and -0.90 is the spacing in em
 * @param {string} input - Raw textarea content
 * @returns {Object} - {map: Object, warnings: Array}
 */
function parsePairSpacingMap(input) {
  const map = {};
  const warnings = [];

  if (!input || input.trim().length === 0) {
    return { map, warnings };
  }

  const lines = input.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (line.length === 0 || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }

    // Expected format: "AB=-0.90" or "AB = -0.90"
    const match = line.match(/^(.{2})\s*=\s*(-?\d+\.?\d*)$/);

    if (!match) {
      warnings.push(`Line ${i + 1}: Invalid format "${line}"`);
      continue;
    }

    const pairKey = match[1];
    const spacingValue = parseFloat(match[2]);

    if (isNaN(spacingValue)) {
      warnings.push(`Line ${i + 1}: Invalid number "${match[2]}"`);
      continue;
    }

    // Check if pair key is exactly 2 characters
    if (pairKey.length !== 2) {
      warnings.push(`Line ${i + 1}: Pair must be exactly 2 characters`);
      continue;
    }

    map[pairKey] = spacingValue;
  }

  return { map, warnings };
}

/**
 * Layout text with pair-specific spacing overrides
 * This function computes glyph placements considering:
 * - OpenType kerning
 * - Default letter spacing
 * - Pair-specific spacing overrides
 * 
 * @param {Object} font - opentype.js font object
 * @param {string} text - Text to layout
 * @param {number} fontSizePx - Font size in pixels
 * @param {number} defaultSpacingEm - Default letter spacing in em units
 * @param {Object} pairSpacingMap - Map of "AB" -> spacing in em units
 * @returns {Array} - Array of {glyph, x, y} objects
 * 
 * TEST ASSERTIONS:
 * 
 * Test 1: Empty pair map should match old uniform-spacing output
 * - Input: text="AB", fontSize=80, defaultSpacing=-0.5, pairMap={}
 * - Expected: All pairs use -0.5em spacing
 * - Verification: x positions should match legacy generatePathWithKerning (within 0.1px)
 * 
 * Test 2: Pair override changes specific gap
 * - Input: text="ABC", fontSize=80, defaultSpacing=-0.5, pairMap={"AB": -0.8}
 * - Expected: Gap between A-B uses -0.8em, B-C uses -0.5em
 * - Verification: Distance(A,B) ≠ Distance(B,C) by expected delta
 * 
 * Test 3: Unknown pairs fall back to default
 * - Input: text="XYZ", fontSize=80, defaultSpacing=-0.3, pairMap={"AB": -0.9}
 * - Expected: All XY, YZ pairs use -0.3em (fallback)
 * - Verification: No pair uses -0.9em since "AB" not present in text
 */
function layoutTextWithPairSpacing(font, text, fontSizePx, defaultSpacingEm, pairSpacingMap) {
  if (!font || !text || text.length === 0) {
    return { placements: [], glyphBounds: [] };
  }

  const placements = [];
  const glyphBounds = []; // Store bounding box for each glyph
  const scale = fontSizePx / font.unitsPerEm;
  const baselineY = 0; // Baseline at y=0

  let x = 0; // Current x position

  // Debug logging
  const debugLog = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Skip space characters - they have zero geometry but nonzero advance
    // which corrupts positioning, auto-connect, and loop attachment
    if (char === " ") {
      continue;
    }

    const glyph = font.charToGlyph(char);

    // Place current glyph at current x position
    placements.push({
      glyph: glyph,
      char: char,
      x: x,
      y: baselineY
    });

    // Compute glyph bounds (for anchor region filtering)
    // getPath() and getBoundingBox() give us the actual glyph outline bounds
    const glyphPath = glyph.getPath(x, baselineY, fontSizePx);
    const glyphBBox = glyphPath.getBoundingBox();

    // Store bounds (x1, y1, x2, y2) or null for empty glyphs (e.g., spaces)
    if (glyphBBox.x1 !== undefined && glyphBBox.x2 !== undefined) {
      glyphBounds.push({
        x1: glyphBBox.x1,
        y1: glyphBBox.y1,
        x2: glyphBBox.x2,
        y2: glyphBBox.y2,
        char: char,
        index: i
      });
    } else {
      glyphBounds.push(null); // Space or empty glyph
    }

    // Calculate advance for next glyph
    const glyphAdvance = glyph.advanceWidth * scale;

    // If there's a next character, apply kerning and spacing
    if (i < text.length - 1) {
      const nextChar = text[i + 1];
      const nextGlyph = font.charToGlyph(nextChar);

      // 1. Apply OpenType kerning
      const kerningValue = font.getKerningValue(glyph, nextGlyph) * scale;

      // 2. Determine spacing for this pair
      const pairKey = char + nextChar;
      let spacingEm = defaultSpacingEm;

      // Check if pair override exists
      if (pairSpacingMap.hasOwnProperty(pairKey)) {
        spacingEm = pairSpacingMap[pairKey];
      }

      const spacingPx = spacingEm * fontSizePx;

      // 3. Total advance = glyph advance + kerning + spacing
      const totalAdvance = glyphAdvance + kerningValue + spacingPx;

      // Debug logging
      debugLog.push({
        pair: pairKey,
        kerning: kerningValue.toFixed(2),
        spacingEm: spacingEm.toFixed(3),
        spacingPx: spacingPx.toFixed(2),
        advance: glyphAdvance.toFixed(2),
        total: totalAdvance.toFixed(2),
        x: x.toFixed(2)
      });

      x += totalAdvance;
    } else {
      // Last character - just add its advance
      x += glyphAdvance;

      debugLog.push({
        pair: char + '(end)',
        kerning: '0.00',
        spacingEm: '0.000',
        spacingPx: '0.00',
        advance: glyphAdvance.toFixed(2),
        total: glyphAdvance.toFixed(2),
        x: x.toFixed(2)
      });
    }
  }

  // Console debug output
  if (window.DEBUG_PAIR_SPACING) {
    console.table(debugLog);
  }

  return { placements, glyphBounds };
}

/**
 * Build SVG path data from glyph placements
 * @param {Array} placements - Array of {glyph, x, y} from layoutTextWithPairSpacing
 * @param {number} fontSizePx - Font size in pixels
 * @returns {string} - SVG path data
 */
function buildPathFromPlacements(placements, fontSizePx) {
  let pathData = '';

  for (const placement of placements) {
    const glyphPath = placement.glyph.getPath(placement.x, placement.y, fontSizePx);

    // Append glyph path commands
    const commands = glyphPath.commands;
    for (const cmd of commands) {
      switch (cmd.type) {
        case 'M':
          pathData += `M${cmd.x.toFixed(2)},${cmd.y.toFixed(2)} `;
          break;
        case 'L':
          pathData += `L${cmd.x.toFixed(2)},${cmd.y.toFixed(2)} `;
          break;
        case 'Q':
          pathData += `Q${cmd.x1.toFixed(2)},${cmd.y1.toFixed(2)} ${cmd.x.toFixed(2)},${cmd.y.toFixed(2)} `;
          break;
        case 'C':
          pathData += `C${cmd.x1.toFixed(2)},${cmd.y1.toFixed(2)} ${cmd.x2.toFixed(2)},${cmd.y2.toFixed(2)} ${cmd.x.toFixed(2)},${cmd.y.toFixed(2)} `;
          break;
        case 'Z':
          pathData += 'Z ';
          break;
      }
    }
  }

  return pathData.trim();
}

/**
 * Generate SVG path with kerning and letter spacing (with pair-specific overrides)
 * Returns either a single path string or an array of individual letter paths
 * 
 * @param {string} text - Text to render
 * @param {number} fontSize - Font size in pixels
 * @param {number} letterSpacing - Default letter spacing in em units
 * @param {boolean} separateLetters - If true, return array of individual letter paths
 * @param {Object} pairSpacingMap - Optional pair-specific spacing overrides
 * @returns {string|Array} - SVG path data or array of path data strings
 */
function generatePathWithKerning(text, fontSize, letterSpacing, separateLetters = false, pairSpacingMap = {}) {
  if (!getActiveFont() || !text) {
    const emptyResult = separateLetters ? [] : '';
    return { pathData: emptyResult, glyphBounds: [] };
  }

  // Use the new pair-aware layout system
  const { placements, glyphBounds } = layoutTextWithPairSpacing(
    getActiveFont(),
    text,
    fontSize,
    letterSpacing,
    pairSpacingMap
  );

  if (placements.length === 0) {
    const emptyResult = separateLetters ? [] : '';
    return { pathData: emptyResult, glyphBounds: [] };
  }

  // If separateLetters is true, return array of individual letter paths
  if (separateLetters) {
    const letterPaths = [];

    for (const placement of placements) {
      const glyph = placement.glyph;
      const glyphPath = glyph.getPath(placement.x, placement.y, fontSize);

      let pathData = '';
      const commands = glyphPath.commands;
      for (const cmd of commands) {
        switch (cmd.type) {
          case 'M':
            pathData += `M${cmd.x.toFixed(2)},${cmd.y.toFixed(2)} `;
            break;
          case 'L':
            pathData += `L${cmd.x.toFixed(2)},${cmd.y.toFixed(2)} `;
            break;
          case 'Q':
            pathData += `Q${cmd.x1.toFixed(2)},${cmd.y1.toFixed(2)} ${cmd.x.toFixed(2)},${cmd.y.toFixed(2)} `;
            break;
          case 'C':
            pathData += `C${cmd.x1.toFixed(2)},${cmd.y1.toFixed(2)} ${cmd.x2.toFixed(2)},${cmd.y2.toFixed(2)} ${cmd.x.toFixed(2)},${cmd.y.toFixed(2)} `;
            break;
          case 'Z':
            pathData += 'Z ';
            break;
        }
      }

      letterPaths.push(pathData.trim());
    }

    return { pathData: letterPaths, glyphBounds };
  }

  // Build combined path data using the new helper function
  const combinedPath = buildPathFromPlacements(placements, fontSize);
  return { pathData: combinedPath, glyphBounds };
}

// Reset viewBox to fit the path content
/**
 * Auto-fit the preview viewBox to center and fit the design with padding.
 * Called automatically after every design update.
 */
function autoFitViewBox() {
  const name = nameInput.value.trim();
  if (!name || name.trim().length === 0 || !getActiveFont()) return;

  try {
    // Get the bounding box of the rendered path
    const bbox = namePath.getBBox();

    // Guard against empty or invalid bounds
    if (bbox.width === 0 || bbox.height === 0) {
      console.warn('Cannot auto-fit viewBox: path has no dimensions');
      return;
    }

    // Add 10% padding around the content for visual breathing room
    const padding = Math.max(bbox.width, bbox.height) * 0.1;
    const newX = bbox.x - padding;
    const newY = bbox.y - padding;
    const newWidth = bbox.width + (padding * 2);
    const newHeight = bbox.height + (padding * 2);

    // Update SVG viewBox to center and fit the design
    previewSvg.setAttribute('viewBox', `${newX.toFixed(2)} ${newY.toFixed(2)} ${newWidth.toFixed(2)} ${newHeight.toFixed(2)}`);

    if (currentSettings.debugMode) {
      console.log('✓ Auto-fit viewBox:', `${newX.toFixed(2)} ${newY.toFixed(2)} ${newWidth.toFixed(2)} ${newHeight.toFixed(2)}`);
    }
  } catch (error) {
    console.error('Error auto-fitting viewBox:', error);
  }
}

// Download file based on selected format
// ── Paywall modal wiring ──────────────────────────────────────────────────────
// (DOM is ready by the time this module executes)
const _paywallModal = document.getElementById('paywallModal');
const _paywallClose = document.getElementById('paywallClose');
const _paywallGuest = document.getElementById('paywallGuest');
const _paywallUser = document.getElementById('paywallUser');
const _paywallAlreadyClaimed = document.getElementById('paywallAlreadyClaimed');
const _paywallSignIn = document.getElementById('paywallSignIn');
const _paywallAlreadyClaimedBuy = document.getElementById('paywallAlreadyClaimedBuy');

// variant: 'guest' | 'user' | 'already_claimed'
function _showPaywall(variant) {
  _paywallGuest.style.display = variant === 'guest' ? '' : 'none';
  _paywallUser.style.display = variant === 'user' ? '' : 'none';
  _paywallAlreadyClaimed.style.display = variant === 'already_claimed' ? '' : 'none';
  _paywallModal.style.display = 'flex';
}

function _hidePaywall() {
  _paywallModal.style.display = 'none';
}

_paywallClose.addEventListener('click', _hidePaywall);
_paywallModal.addEventListener('click', e => { if (e.target === _paywallModal) _hidePaywall(); });

// "Sign in / Create account" in the guest paywall — open the auth modal
_paywallSignIn.addEventListener('click', () => {
  _hidePaywall();
  document.getElementById('authBtn').click(); // reuse existing auth modal trigger
});

// "Buy credits" in the already-claimed paywall — open the shop modal
_paywallAlreadyClaimedBuy.addEventListener('click', () => {
  _hidePaywall();
  _openShop();
});

// "Buy Credits" badge-button in the account widget header
// Appears when credits === 0 and feedback bonus is exhausted.
// Routes to the correct paywall variant based on identity type.
const _headerBuyCreditsBtn = document.getElementById('buyCreditsBtn');
if (_headerBuyCreditsBtn) {
  _headerBuyCreditsBtn.addEventListener('click', () => {
    if (appState.type === 'guest') {
      // Guest: prompt them to create a free account for 10 credits
      _showPaywall('guest');
    } else {
      // Logged-in user who has already claimed feedback: go straight to shop
      _showPaywall('already_claimed');
    }
  });
}

// ── Toast helper ──────────────────────────────────────────────────────────────
const _toast = document.getElementById('creditToast');
let _toastTimer = null;

function showToast(message, durationMs = 4000) {
  _toast.textContent = message;
  _toast.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    _toast.classList.remove('visible');
  }, durationMs);
}

// ── Feedback bonus wiring ─────────────────────────────────────────────────────
const FEEDBACK_LS_KEY = 'feedback_started_at';
const FEEDBACK_CLAIMED_KEY = 'feedback_claimed_ever'; // set after any successful claim (guest or user) for cross-identity dupe detection
const FEEDBACK_DELAY_MS = 30_000; // must wait 30s before claiming

const _feedbackLink = document.getElementById('feedbackLink');
const _feedbackClaimBtn = document.getElementById('feedbackClaimBtn');
let _feedbackRevealTimer = null;

/** Save timestamp when user clicks the feedback link. */
_feedbackLink.addEventListener('click', () => {
  localStorage.setItem(FEEDBACK_LS_KEY, String(Date.now()));
  console.log('[feedback] link clicked — feedback_started_at saved');
  _scheduleFeedbackReveal();
});

// Also intercept the feedback link inside the paywall modal (same behaviour)
const _paywallFeedbackLink = document.getElementById('paywallFeedbackLink');
if (_paywallFeedbackLink) {
  _paywallFeedbackLink.addEventListener('click', () => {
    localStorage.setItem(FEEDBACK_LS_KEY, String(Date.now()));
    console.log('[feedback] paywall feedback link clicked — feedback_started_at saved');
    _scheduleFeedbackReveal();
    _hidePaywall(); // close the modal so user can see the claim button later
  });
}

/** Show/hide claim button based on localStorage + 30s elapsed. */
function showClaimBtnIfEligible() {
  const ts = Number(localStorage.getItem(FEEDBACK_LS_KEY) ?? 0);
  if (!ts) {
    _feedbackClaimBtn.style.display = 'none';
    return;
  }
  const elapsed = Date.now() - ts;
  if (elapsed >= FEEDBACK_DELAY_MS) {
    _feedbackClaimBtn.style.display = '';  // show immediately
  } else {
    _feedbackClaimBtn.style.display = 'none';
    _scheduleFeedbackReveal(FEEDBACK_DELAY_MS - elapsed);
  }
}

function _scheduleFeedbackReveal(remainingMs) {
  clearTimeout(_feedbackRevealTimer);
  const delay = remainingMs ?? FEEDBACK_DELAY_MS;
  _feedbackRevealTimer = setTimeout(() => {
    showClaimBtnIfEligible();
  }, delay);
}

/** Handle claim button click. */
_feedbackClaimBtn.addEventListener('click', async () => {
  _feedbackClaimBtn.disabled = true;
  _feedbackClaimBtn.textContent = 'Claiming…';

  try {
    const isGuest = appState.type === 'guest';

    // If a logged-in user previously claimed as a guest (same device/browser),
    // skip the EF call and show the already-claimed popup with a buy button.
    if (!isGuest && localStorage.getItem(FEEDBACK_CLAIMED_KEY)) {
      localStorage.removeItem(FEEDBACK_LS_KEY);
      _feedbackClaimBtn.style.display = 'none';
      _showPaywall('already_claimed');
      return;
    }

    const { data, error } = await supabase.functions.invoke('claim_feedback_bonus', {
      body: { guest_id: isGuest ? appState.guestId : undefined },
    });

    if (error) {
      console.warn('[feedback] invoke error:', error.message);
      showToast('⚠️ Could not claim credits — please try again.');
      return;
    }

    if (data?.ok) {
      localStorage.removeItem(FEEDBACK_LS_KEY);
      _feedbackClaimBtn.style.display = 'none';
      // Mark as claimed so logged-in session on same device sees "already claimed"
      localStorage.setItem(FEEDBACK_CLAIMED_KEY, '1');
      showToast('🎉 +5 credits added — thanks for your feedback!');
      console.log('[analytics] feedback_awarded', { identity: isGuest ? appState.guestId : appState.userId });
      refreshCredits().catch(() => { });
    } else if (data?.code === 'ALREADY_GRANTED') {
      localStorage.removeItem(FEEDBACK_LS_KEY);
      _feedbackClaimBtn.style.display = 'none';
      // Show the popup with a buy-credits button instead of just a toast
      _showPaywall('already_claimed');
    } else if (data?.code === 'UNAUTHENTICATED') {
      showToast('⚠️ Please sign in or wait for your session to load, then try again.');
    } else {
      console.warn('[feedback] unexpected response:', data);
      showToast('⚠️ Something went wrong — please try again.');
    }
  } catch (err) {
    console.error('[feedback] claim threw:', err.message);
    showToast('⚠️ Could not claim credits — please try again.');
  } finally {
    _feedbackClaimBtn.disabled = false;
    _feedbackClaimBtn.textContent = 'Claim +5 feedback credits';
  }
});

// Check on page load (in case user clicked the link in a prior session)
showClaimBtnIfEligible();

// ── Credits shop modal ────────────────────────────────────────────────────────
const _shopModal = document.getElementById('shopModal');
const _shopClose = document.getElementById('shopClose');
const _paywallBuy = document.getElementById('paywallBuy');

function _openShop() {
  _shopModal.style.display = 'flex';
}
function _closeShop() {
  _shopModal.style.display = 'none';
}

_shopClose.addEventListener('click', _closeShop);
_shopModal.addEventListener('click', e => { if (e.target === _shopModal) _closeShop(); });

// "Buy credits" in paywall (registered-user variant) → open shop
_paywallBuy.addEventListener('click', () => {
  _hidePaywall();
  _openShop();
});

// Pack card clicks → call create_checkout_session → redirect to Stripe
_shopModal.addEventListener('click', async (e) => {
  const card = e.target.closest('[data-pack]');
  if (!card || card.disabled) return;

  const pack = card.dataset.pack;
  const originalLabel = card.textContent;
  console.log('[analytics] purchase_started', { pack, identity: appState.type === 'guest' ? appState.guestId : appState.userId });

  // Disable all cards while calling the EF
  const allCards = [..._shopModal.querySelectorAll('.pack-card')];
  allCards.forEach(c => { c.disabled = true; c.style.opacity = '0.6'; });
  card.textContent = 'Redirecting…';

  const restoreCards = () => {
    allCards.forEach(c => { c.disabled = false; c.style.opacity = ''; });
    card.textContent = originalLabel;
  };

  try {
    const isGuest = appState.type === 'guest';
    const { data, error } = await supabase.functions.invoke('create_checkout_session', {
      body: { pack, guest_id: isGuest ? appState.guestId : undefined },
    });

    // supabase-js puts non-2xx EF responses into `error` — try to extract body
    if (error) {
      let errMsg = error.message;
      try {
        const errBody = await error?.context?.json?.();
        if (errBody?.message) errMsg = errBody.message;
        if (errBody?.code) errMsg = `${errBody.code}: ${errMsg}`;
      } catch { /* ignore */ }
      console.error('[shop] checkout session error (invoke):', errMsg);
      showToast(`⚠️ Could not start checkout — ${errMsg}`);
      restoreCards();
      return;
    }

    if (!data?.url) {
      const msg = data?.message ?? data?.code ?? 'No checkout URL returned';
      console.error('[shop] checkout session error (no url):', data);
      showToast(`⚠️ Could not start checkout — ${msg}`);
      restoreCards();
      return;
    }

    // ── Reddit Pixel: track AddToCart + generate a purchase conversionId ───────
    // Store the ID in sessionStorage so Purchase can use the same one on return.
    const purchaseConvId = 'purchase_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    sessionStorage.setItem('rdt_purchase_conv_id', purchaseConvId);
    _rdtTrack('AddToCart', { conversionId: purchaseConvId });

    // Redirect to Stripe Checkout
    console.log('[shop] redirecting to Stripe:', data.url);
    window.location.href = data.url;

  } catch (err) {
    console.error('[shop] unexpected error:', err.message);
    showToast('⚠️ Could not start checkout — please try again.');
    restoreCards();
  }
});


// ── Handle return from Stripe Checkout (URL params) ───────────────────────────
(function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');

  if (payment === 'success') {
    // Clean URL immediately so user doesn't see raw params
    const clean = window.location.pathname + window.location.hash;
    history.replaceState(null, '', clean);

    showToast('🎉 Payment successful — loading your credits…', 4000);

    // The Stripe webhook is async: it may arrive 1-10 seconds after the user lands here.
    // Poll refreshCredits until the balance increases (up to ~12 seconds).
    const balanceBefore = appState.credits_balance ?? 0;
    const unlimitedBefore = appState.unlimited_until;
    let attempts = 0;
    const MAX_ATTEMPTS = 8;
    const INTERVAL_MS = 1500;

    const poll = setInterval(async () => {
      attempts++;
      try {
        await refreshCredits();
        const balanceNow = appState.credits_balance ?? 0;
        const unlimitedNow = appState.unlimited_until;
        const creditsAdded = balanceNow > balanceBefore;
        const unlimitedAdded = unlimitedNow && (!unlimitedBefore || unlimitedNow !== unlimitedBefore);

        if (creditsAdded || unlimitedAdded) {
          clearInterval(poll);
          // Match the conversionId to the AddToCart event fired before the Stripe redirect
          const convId = sessionStorage.getItem('rdt_purchase_conv_id') || ('purchase_' + Date.now());
          sessionStorage.removeItem('rdt_purchase_conv_id');
          if (unlimitedAdded) {
            showToast('✅ Unlimited access activated! Enjoy unlimited downloads.', 6000);
            _rdtTrack('Purchase', { value: 20, currency: 'USD', conversionId: convId });
          } else {
            const added = balanceNow - balanceBefore;
            showToast(`✅ ${added} credits added! Balance: ${balanceNow}`, 6000);
            const packPrice = added >= 50 ? 5 : added >= 20 ? 3 : 1;
            _rdtTrack('Purchase', { value: packPrice, currency: 'USD', conversionId: convId });
          }
          return;
        }
      } catch { /* ignore individual poll errors */ }

      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(poll);
        showToast("✅ Payment received! Please refresh if credits haven't appeared yet.", 6000);
        // Best-effort: use stored conversionId if poll hit the limit before webhook arrived
        const convIdFallback = sessionStorage.getItem('rdt_purchase_conv_id') || ('purchase_' + Date.now());
        sessionStorage.removeItem('rdt_purchase_conv_id');
        _rdtTrack('Purchase', { currency: 'USD', conversionId: convIdFallback });
      }
    }, INTERVAL_MS);

  } else if (payment === 'cancelled') {
    showToast('Payment cancelled — no charge made.', 4000);
    const clean = window.location.pathname + window.location.hash;
    history.replaceState(null, '', clean);
  }
})();


// ── requestDownloadPermission ─────────────────────────────────────────────────
/**
 * Call consume_download_credit Edge Function before every download.
 *
 * Returns true  → credit consumed (or unlimited), caller may proceed.
 * Returns false → no credits or error, caller must abort; paywall already shown.
 *
 * @param {string} format  'svg' | 'png' | 'pdf' | 'dxf'
 * @returns {Promise<boolean>}
 */
async function requestDownloadPermission(format) {
  const isGuest = appState.type === 'guest';
  const identity = isGuest ? appState.guestId : appState.userId;

  // ── Guard: identity must be resolved ─────────────────────────────────────
  if (!identity) {
    console.warn('[credits] no identity yet — blocking');
    _showPaywall(isGuest ? 'guest' : 'user');
    return false;
  }

  // ── LOCAL PRE-CHECK: use the last-known server balance as a fast gate ─────
  // appState is refreshed from the server after every successful download, so
  // credits_balance here always reflects real server state.
  // If we KNOW they're at 0 (and no unlimited pass), skip the EF call and
  // block immediately.  This is the primary guard against bypasses.
  const hasUnlimited = appState.unlimited_until
    && new Date(appState.unlimited_until) > new Date();

  if (!hasUnlimited && appState.credits_balance !== null && appState.credits_balance <= 0) {
    console.log('[analytics] download_blocked', { format, identity, reason: 'local_zero_credits', isGuest });
    _showPaywall(isGuest ? 'guest' : 'user');
    return false;
  }

  // ── Remote check: consume_download_credit Edge Function ──────────────────
  // We only reach here when appState says credits are available (or unknown).
  // The EF is the authoritative transaction; it debits the credit atomically.
  let data, error;
  try {
    ({ data, error } = await supabase.functions.invoke('consume_download_credit', {
      body: {
        format,
        guest_id: isGuest ? appState.guestId : undefined,
      },
    }));
  } catch (err) {
    console.warn('[credits] invoke threw:', err.message);
    // We thought they had credits (pre-check passed), but EF is unreachable.
    // Block and ask them to retry — don't silently allow.
    console.log('[analytics] download_blocked', { format, identity, reason: 'invoke_exception' });
    showToast('⚠️ Could not reach the server — please try again in a moment.');
    return false;
  }

  // ── Defensive: supabase-js puts non-2xx EF responses into `error` ────────
  if (error) {
    console.warn('[credits] invoke error:', error.message, error);

    let errCode;
    try {
      const errBody = await error?.context?.json?.();
      errCode = errBody?.code;
    } catch { /* ignore */ }

    if (errCode === 'NO_CREDITS') {
      // Server confirmed no credits — show paywall
      console.log('[analytics] download_blocked', { format, identity, reason: 'NO_CREDITS_in_error_body', isGuest });
      // Also update local balance so next click hits the fast path
      appState.credits_balance = 0;
      _showPaywall(isGuest ? 'guest' : 'user');
      return false;
    }

    // Genuine infra error — block with retry prompt
    console.log('[analytics] download_blocked', { format, identity, reason: `invoke_error:${errCode ?? error.message}` });
    showToast('⚠️ Could not verify credits — please try again.');
    return false;
  }

  // ── Server explicitly grants the download ────────────────────────────────
  if (data?.ok) {
    console.log('[analytics] download_allowed', { format, identity, reason: data.reason ?? 'ok', credits_balance: data.credits_balance });
    // Update local balance so the next fast-path check is correct
    if (typeof data.credits_balance === 'number') appState.credits_balance = data.credits_balance;
    refreshCredits().catch(() => { });
    return true;
  }

  // ── Server says no credits ────────────────────────────────────────────────
  if (data?.code === 'NO_CREDITS') {
    console.log('[analytics] download_blocked', { format, identity, reason: 'NO_CREDITS', isGuest });
    appState.credits_balance = 0; // update fast-path for next click
    _showPaywall(isGuest ? 'guest' : 'user');
    return false;
  }

  // ── Session not found ─────────────────────────────────────────────────────
  if (data?.code === 'NOT_FOUND') {
    console.warn('[credits] identity not found in DB:', identity);
    console.log('[analytics] download_blocked', { format, identity, reason: 'NOT_FOUND' });
    _showPaywall(isGuest ? 'guest' : 'user');
    return false;
  }

  // ── Server-side DB / internal error ──────────────────────────────────────
  if (data?.code === 'DB_ERROR' || data?.code === 'INTERNAL_ERROR') {
    console.warn('[credits] server error:', data?.code, data?.message);
    console.log('[analytics] download_blocked', { format, identity, reason: data?.code });
    showToast('⚠️ Server error — please try again in a moment.');
    return false;
  }

  // ── Catch-all: anything unexpected → block ────────────────────────────────
  console.warn('[credits] unexpected response — blocking:', data);
  console.log('[analytics] download_blocked', { format, identity, reason: 'unexpected' });
  showToast('⚠️ Could not verify credits — please try again.');
  return false;
}



// ── Download button handler (async) ──────────────────────────────────────────
downloadBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name || !getActiveFont()) return;

  const selectedFormat = formatSelect.value;

  // Gate on credits — returns false and shows paywall if no credits left
  const allowed = await requestDownloadPermission(selectedFormat);
  if (!allowed) return;

  // Existing download logic — completely unchanged
  if (selectedFormat === 'png') {
    downloadPNG();
  } else if (selectedFormat === 'pdf') {
    downloadPDF();
  } else if (selectedFormat === 'dxf') {
    downloadDXF();
  } else {
    downloadSVG();
  }
});


// Download SVG function
function downloadSVG() {
  const name = nameInput.value.trim();
  if (!name || !getActiveFont()) return;

  // Create a clean SVG for laser cutting
  const svgContent = generateLaserCutSVG(name);

  // Create blob and download
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/\s+/g, '_')}_necklace.svg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  console.log('✓ SVG downloaded:', link.download);
}

// Download PNG at 300 DPI with white background
function downloadPNG() {
  const name = nameInput.value.trim();
  if (!name || !getActiveFont()) return;

  const svg = previewSvg;
  const svgString = new XMLSerializer().serializeToString(svg);

  // Create blob and URL
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();

  img.onload = () => {
    try {
      // Calculate scale for 300 DPI (SVG is at 96 DPI)
      const scale = 300 / 96; // ~3.125

      // Use the SVG's display dimensions (how it appears in the browser)
      // The browser already handles viewBox rendering when converting to Image
      const svgWidth = svg.clientWidth || svg.getBoundingClientRect().width;
      const svgHeight = svg.clientHeight || svg.getBoundingClientRect().height;

      // Create canvas at 300 DPI using display dimensions
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(svgWidth * scale);
      canvas.height = Math.round(svgHeight * scale);

      const ctx = canvas.getContext('2d');

      // Fill white background
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Scale for 300 DPI and draw
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, svgWidth, svgHeight);

      // Convert to PNG blob and download
      canvas.toBlob((pngBlob) => {
        const pngUrl = URL.createObjectURL(pngBlob);
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = `${name.replace(/\s+/g, '_')}_necklace.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(pngUrl);

        console.log('✓ PNG downloaded:', link.download, `(${canvas.width}x${canvas.height}px at 300 DPI)`);
      }, 'image/png');

    } catch (error) {
      console.error('Error generating PNG:', error);
      alert('Failed to generate PNG. Please try again.');
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  img.onerror = () => {
    console.error('Failed to load SVG image');
    alert('Failed to load SVG for PNG export. Please try again.');
    URL.revokeObjectURL(url);
  };

  img.src = url;
}

// Download PDF at 300 DPI with white background
function downloadPDF() {
  const name = nameInput.value.trim();
  if (!name || !getActiveFont()) return;

  const svg = previewSvg;
  const svgString = new XMLSerializer().serializeToString(svg);

  // Create blob and URL
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();

  img.onload = () => {
    try {
      // Calculate scale for 300 DPI (SVG is at 96 DPI)
      const scale = 300 / 96; // ~3.125

      // Use the SVG's display dimensions
      const svgWidth = svg.clientWidth || svg.getBoundingClientRect().width;
      const svgHeight = svg.clientHeight || svg.getBoundingClientRect().height;

      // Create canvas at 300 DPI
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(svgWidth * scale);
      canvas.height = Math.round(svgHeight * scale);

      const ctx = canvas.getContext('2d');

      // Fill white background
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Scale for 300 DPI and draw
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, svgWidth, svgHeight);

      // Convert canvas to image and create PDF
      const imgData = canvas.toDataURL('image/png');

      // Calculate PDF dimensions in inches (300 DPI)
      const widthInches = canvas.width / 300;
      const heightInches = canvas.height / 300;

      // Create jsPDF instance with custom size
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        orientation: widthInches > heightInches ? 'landscape' : 'portrait',
        unit: 'in',
        format: [widthInches, heightInches]
      });

      // Add image to PDF (fill entire page)
      pdf.addImage(imgData, 'PNG', 0, 0, widthInches, heightInches);

      // Save PDF
      pdf.save(`${name.replace(/\s+/g, '_')}_necklace.pdf`);

      console.log('✓ PDF downloaded:', `${name.replace(/\s+/g, '_')}_necklace.pdf`, `(${canvas.width}x${canvas.height}px at 300 DPI)`);

    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  img.onerror = () => {
    console.error('Failed to load SVG image for PDF');
    alert('Failed to load SVG for PDF export. Please try again.');
    URL.revokeObjectURL(url);
  };

  img.src = url;
}

// Download DXF format
function downloadDXF() {
  const name = nameInput.value.trim();
  if (!name || !getActiveFont()) return;

  try {
    // Select the SVG and path elements
    const svgEl = document.querySelector('svg');

    if (!svgEl) {
      throw new Error('SVG element not found');
    }

    // Get SVG bounding box
    const bbox = svgEl.getBBox();
    const svgHeightUnits = bbox.height;

    const pathEl = svgEl.querySelector('path');

    if (!pathEl) {
      throw new Error('Path element not found in SVG');
    }

    // Get the path data
    const d = pathEl.getAttribute('d');

    if (!d) {
      throw new Error('Path data not found');
    }

    // Get target height in millimeters from input
    const targetHeightMM = parseFloat(document.getElementById('targetHeightInput').value);

    console.log('Converting SVG path to DXF...');
    console.log('SVG height (units):', svgHeightUnits);
    console.log('Target height (mm):', targetHeightMM);
    console.log('Maker.js importer:', makerjs.importer);
    console.log('Maker.js exporter:', makerjs.exporter);


    // Convert SVG path data to Maker.js model
    const model = makerjs.importer.fromSVGPathData(d);

    if (!model) {
      throw new Error('Failed to convert path data to Maker.js model');
    }

    // Scale to match target height in millimeters
    const scale = targetHeightMM / svgHeightUnits;
    console.log('Scale factor:', scale);
    makerjs.model.scale(model, scale);
    model.units = makerjs.unitType.Millimeter;


    // Export to DXF
    const dxf = makerjs.exporter.toDXF(model);

    // Create blob and download
    const blob = new Blob([dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/\s+/g, '_')}_necklace.dxf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log('✓ DXF downloaded:', link.download);

  } catch (error) {
    console.error('Error generating DXF:', error);
    alert('Failed to generate DXF. Please try again.');
  }
}

// Generate laser-cut friendly SVG with proper mm scaling
function generateLaserCutSVG(name) {
  if (!getActiveFont()) return '';

  // Generate path with current settings (in px coordinates)
  // Apply Paper.js union if enabled
  let pathData;
  if (currentSettings.weldPaths) {
    pathData = applyPaperJsUnion(name, currentSettings.fontSize, currentSettings.letterSpacing, currentSettings.pairSpacingMap);
  } else {
    const result = generatePathWithKerning(name, currentSettings.fontSize, currentSettings.letterSpacing, false, currentSettings.pairSpacingMap);
    pathData = result.pathData;
  }

  // Calculate bounding box from the path (in px)
  // Create a temporary SVG to measure
  const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tempSvg.style.position = 'absolute';
  tempSvg.style.visibility = 'hidden';
  document.body.appendChild(tempSvg);

  const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  tempPath.setAttribute('d', pathData);
  tempSvg.appendChild(tempPath);

  const bbox = tempPath.getBBox();
  document.body.removeChild(tempSvg);

  // Original dimensions in px (from font rendering)
  const originalWidthPx = bbox.width;
  const originalHeightPx = bbox.height;

  // Calculate scale factor to match target height in mm
  // 1. Convert original height from px to mm using 96 DPI standard
  const originalHeightMm = originalHeightPx * MM_PER_PX;

  // 2. Calculate scale factor to reach target height
  const scaleFactor = currentSettings.targetHeight / originalHeightMm;

  // 3. Calculate final dimensions in mm
  const finalHeightMm = currentSettings.targetHeight;
  const finalWidthMm = (originalWidthPx * MM_PER_PX) * scaleFactor;

  // 4. Add padding in mm
  const paddingMm = 2;  // 2mm padding
  const totalWidthMm = finalWidthMm + (paddingMm * 2);
  const totalHeightMm = finalHeightMm + (paddingMm * 2);

  // 5. Create viewBox that includes the path with padding
  // ViewBox is in the original px coordinate system
  const viewBoxX = bbox.x - (paddingMm / MM_PER_PX / scaleFactor);
  const viewBoxY = bbox.y - (paddingMm / MM_PER_PX / scaleFactor);
  const viewBoxWidth = originalWidthPx + (2 * paddingMm / MM_PER_PX / scaleFactor);
  const viewBoxHeight = originalHeightPx + (2 * paddingMm / MM_PER_PX / scaleFactor);

  // Generate clean SVG for laser cutting with filled path
  // The width/height in mm define the physical size
  // The viewBox defines the coordinate system (in px from the font)
  // The browser/laser cutter scales the viewBox content to fit the mm dimensions
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${totalWidthMm.toFixed(2)}mm" height="${totalHeightMm.toFixed(2)}mm" viewBox="${viewBoxX.toFixed(2)} ${viewBoxY.toFixed(2)} ${viewBoxWidth.toFixed(2)} ${viewBoxHeight.toFixed(2)}" xmlns="http://www.w3.org/2000/svg">
  <!-- 
    Width/Height: Physical dimensions for laser cutting (in mm)
    ViewBox: Original font coordinate system (in px at 96 DPI)
    Target height: ${currentSettings.targetHeight}mm (scale factor: ${scaleFactor.toFixed(4)}x)
  -->
  <path 
    d="${pathData}" 
    fill="#000000"
    fill-rule="nonzero"
  />
</svg>`;

  return svg;
}

/**
 * Convert millimeters to Paper.js units
 * Paper.js uses the same coordinate system as our SVG (px at 96 DPI)
 * @param {number} mm - Value in millimeters
 * @returns {number} - Value in Paper.js units (px)
 */
function mmToPaperUnits(mm) {
  // Using the same conversion as our main pipeline
  // 1 mm = 96 / 25.4 px ≈ 3.7795 px
  return mm * PX_PER_MM;
}

/**
 * Extract all individual paths from a Paper.js item
 * Recursively flattens Groups and CompoundPaths into an array of simple Paths
 * @param {paper.Item} item - Paper.js item to flatten
 * @returns {Array<paper.Path>} - Array of individual path objects
 */
function extractAllPaths(item) {
  const paths = [];

  function traverse(obj) {
    if (obj instanceof paper.Path) {
      paths.push(obj);
    } else if (obj instanceof paper.CompoundPath) {
      // CompoundPath has children that are Paths
      obj.children.forEach(child => traverse(child));
    } else if (obj instanceof paper.Group) {
      // Group can contain any items
      obj.children.forEach(child => traverse(child));
    }
  }

  traverse(item);
  return paths;
}

/**
 * Connect i-dots to stems by moving dots downward to create overlap
 * This prevents dots from falling out during laser cutting
 * 
 * @param {paper.Item} paperItem - The imported Paper.js item containing all text paths
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether to apply this transformation
 * @param {number} options.overlapMm - Desired overlap in mm
 * @param {number} options.maxShiftMm - Maximum downward shift in mm
 * @param {number} options.searchRadiusMm - Search radius for matching stems in mm
 * 
 * REGRESSION TEST:
 * Input "Mia" should produce:
 * - One dot detected above the i stem
 * - Dot moved down to overlap stem
 * - After union: single connected shape with no loose dot
 */

/**
 * Adds attachment loops to the text
 * 
 * Creates donut-shaped loops (outer circle minus inner circle) at the leftmost and rightmost
 * top edges of the text bounding box, suitable for attaching a chain to the necklace.
 * 
 * @param {paper.Group} paperGroup - Group containing all text paths
 * @param {Object} options - Loop generation options
 * @param {number} options.innerDiameterMm - Inner diameter of loop in mm
 * @param {number} options.offsetMm - Distance from text bounds to loop in mm
 * @param {number} options.minThicknessMm - Minimum thickness of loop material (default 0.8mm)
 * @returns {Array<paper.CompoundPath>} Array of loop paths (left and right)
 */
/**
 * Attach loops to the ends of text outline using robust geometry sampling.
 * This ensures loops always overlap and weld properly.
 * 
 * @param {paper.Item} textItem - The welded text shape (Path, CompoundPath, or Group)
 * @param {Object} options - Loop configuration
 * @param {boolean} debugMode - Enable debug visualization and logging
 * @returns {paper.Item} The text with loops attached and welded
 */
function attachLoopsToEnds(textItem, options = {}, debugMode = false) {
  const {
    innerDiameterMm = 3.0,
    outerDiameterMm = 4.6,
    offsetFromTextMm = 0.6,
    loopOverlapMm = 0.4,  // How much the loop's OUTER ring overlaps the text
    glyphBounds = null    // Array of glyph bounding boxes for anchor region filtering
  } = options;

  console.log('🔵 Attaching loops to text ends using geometry sampling...');
  if (debugMode) {
    console.log('  Options:', { innerDiameterMm, outerDiameterMm, offsetFromTextMm, loopOverlapMm });
  }

  // Calculate dimensions in Paper.js units (px)
  const innerRadiusPx = (innerDiameterMm / 2) * PX_PER_MM;
  const outerRadiusPx = (outerDiameterMm / 2) * PX_PER_MM;
  const outerRadiusMm = outerDiameterMm / 2;  // For margin calculation in findAnchorPoints
  const thicknessMm = (outerDiameterMm - innerDiameterMm) / 2;
  const offsetPx = offsetFromTextMm * PX_PER_MM;
  const overlapPx = loopOverlapMm * PX_PER_MM;
  const sampleStepMm = 0.5; // Sample every 0.5mm
  const sampleStepPx = sampleStepMm * PX_PER_MM;

  if (debugMode) {
    console.log('  Calculated dimensions:');
    console.log(`    Inner diameter: ${innerDiameterMm}mm (radius: ${innerRadiusPx.toFixed(2)}px)`);
    console.log(`    Outer diameter: ${outerDiameterMm}mm (radius: ${outerRadiusPx.toFixed(2)}px)`);
    console.log(`    Loop thickness: ${thicknessMm.toFixed(2)}mm`);
    console.log(`    Offset from text: ${offsetPx.toFixed(2)}px (${offsetFromTextMm}mm)`);
    console.log(`    Target overlap: ${overlapPx.toFixed(2)}px (${loopOverlapMm}mm)`);
    console.log(`    Sample step: ${sampleStepPx.toFixed(2)}px (${sampleStepMm}mm)`);
  }

  // STEP 1: Find anchor points on the text outline
  const anchors = findAnchorPoints(textItem, sampleStepPx, debugMode, glyphBounds, outerRadiusMm);

  if (!anchors.left || !anchors.right) {
    console.error('❌ Could not find anchor points on text outline');
    return textItem;
  }

  if (debugMode) {
    console.log('  Found anchor points:');
    console.log(`    Left:  (${anchors.left.point.x.toFixed(2)}, ${anchors.left.point.y.toFixed(2)})`);
    console.log(`    Right: (${anchors.right.point.x.toFixed(2)}, ${anchors.right.point.y.toFixed(2)})`);
  }

  // STEP 2: Create and attach left loop
  const leftLoop = createAndPlaceLoop({
    anchorPoint: anchors.left.point,
    outwardDir: anchors.left.outwardDir,
    innerRadiusPx,
    outerRadiusPx,
    offsetPx,
    overlapPx,
    textItem,
    side: 'left',
    debugMode
  });

  // STEP 3: Weld left loop to text
  if (leftLoop) {
    try {
      const newTextItem = textItem.unite(leftLoop);
      if (newTextItem) {
        textItem.remove();
        leftLoop.remove();
        textItem = newTextItem;
        console.log('  ✓ Left loop welded successfully');
      } else {
        console.warn('  ⚠️ Left loop unite returned null');
        leftLoop.remove();
      }
    } catch (error) {
      console.error('  ❌ Error welding left loop:', error);
      leftLoop.remove();
    }
  }

  // STEP 4: Create and attach right loop
  const rightLoop = createAndPlaceLoop({
    anchorPoint: anchors.right.point,
    outwardDir: anchors.right.outwardDir,
    innerRadiusPx,
    outerRadiusPx,
    offsetPx,
    overlapPx,
    textItem,
    side: 'right',
    debugMode
  });

  // STEP 5: Weld right loop to text
  if (rightLoop) {
    try {
      const newTextItem = textItem.unite(rightLoop);
      if (newTextItem) {
        textItem.remove();
        rightLoop.remove();
        textItem = newTextItem;
        console.log('  ✓ Right loop welded successfully');
      } else {
        console.warn('  ⚠️ Right loop unite returned null');
        rightLoop.remove();
      }
    } catch (error) {
      console.error('  ❌ Error welding right loop:', error);
      rightLoop.remove();
    }
  }

  // STEP 6: Validate connectivity
  const componentCount = countComponents(textItem);
  if (componentCount > 1) {
    console.warn(`⚠️ Warning: Final design has ${componentCount} separate components. Loops may not be fully attached.`);
    console.warn('   Try increasing "Loop Overlap" or reducing "Loop Offset from Text".');
  } else {
    console.log(`✅ Final design is a single connected component`);
  }

  console.log('✅ Loop attachment complete');

  return textItem;
}

/**
 * Find anchor points on the text outline for loop attachment
 * @param {paper.Item} textItem - The text shape
 * @param {number} sampleStepPx - Step size for sampling points along paths
 * @param {boolean} debugMode - Enable debug logging
 * @param {Array} glyphBounds - Array of {x1,y1,x2,y2,char,index} for each glyph
 * @param {number} outerRadiusMm - Outer radius of loop for margin calculation
 */
function findAnchorPoints(textItem, sampleStepPx, debugMode, glyphBounds = null, outerRadiusMm = 0) {
  if (debugMode) {
    console.log('  📍 Sampling points along text outline...');
  }

  // Get all leaf paths
  const paths = extractAllPaths(textItem);

  if (paths.length === 0) {
    console.error('    ❌ No paths found in text item');
    return { left: null, right: null };
  }

  // Sample points along all paths
  const sampledPoints = [];
  const flattenTolerance = 0.2 * PX_PER_MM; // 0.2mm tolerance

  for (const path of paths) {
    // Flatten path for stable sampling
    const flattened = path.clone();
    flattened.flatten(flattenTolerance);

    const pathLength = flattened.length;
    const numSamples = Math.ceil(pathLength / sampleStepPx);

    for (let i = 0; i <= numSamples; i++) {
      const offset = (i / numSamples) * pathLength;
      const point = flattened.getPointAt(offset);
      if (point) {
        sampledPoints.push(point);
      }
    }

    flattened.remove();
  }

  if (debugMode) {
    console.log(`    Sampled ${sampledPoints.length} points from ${paths.length} paths`);
  }

  if (sampledPoints.length === 0) {
    console.error('    ❌ No points sampled');
    return { left: null, right: null };
  }

  // ============================================================================
  // QUANTILE-BASED ANCHOR SELECTION (robust for descenders)
  // ============================================================================
  // Instead of using bounds height (which fails with descenders like "Sophia"),
  // we use Y-quantiles to find points in the TOP ENVELOPE of the text.
  // Paper.js: smaller Y = higher position

  // ============================================================================
  // GLYPH-REGION FILTERING FIRST (prevents "i-dot steals anchor" bug)
  // ============================================================================
  // NEW APPROACH: Filter by glyph region FIRST, then apply quantile selection WITHIN each region.
  // This ensures anchors are always from the correct glyphs, even if those glyphs are lower than the global top quantile.

  let leftRegionPoints = sampledPoints;
  let rightRegionPoints = sampledPoints;
  let firstRect = null;
  let lastRect = null;

  if (glyphBounds && glyphBounds.length > 0) {
    // Find first and last non-null glyph bounds
    const firstGlyphBounds = glyphBounds.find(b => b !== null);
    const lastGlyphBounds = [...glyphBounds].reverse().find(b => b !== null);

    if (firstGlyphBounds && lastGlyphBounds) {
      // Calculate margin: generous so we capture terminal flourishes
      const marginMm = Math.max(2.0, outerRadiusMm);
      const marginPx = marginMm * PX_PER_MM;

      // Create rectangles for first and last glyph regions (with margin)
      firstRect = new paper.Rectangle(
        firstGlyphBounds.x1 - marginPx,
        firstGlyphBounds.y1 - marginPx,
        (firstGlyphBounds.x2 - firstGlyphBounds.x1) + 2 * marginPx,
        (firstGlyphBounds.y2 - firstGlyphBounds.y1) + 2 * marginPx
      );

      lastRect = new paper.Rectangle(
        lastGlyphBounds.x1 - marginPx,
        lastGlyphBounds.y1 - marginPx,
        (lastGlyphBounds.x2 - lastGlyphBounds.x1) + 2 * marginPx,
        (lastGlyphBounds.y2 - lastGlyphBounds.y1) + 2 * marginPx
      );

      // Filter points by glyph region FIRST
      leftRegionPoints = sampledPoints.filter(p => firstRect.contains(p));
      rightRegionPoints = sampledPoints.filter(p => lastRect.contains(p));

      if (debugMode) {
        console.log(`    Glyph-region filtering FIRST (margin: ${marginMm.toFixed(1)}mm):`);
        console.log(`      First glyph "${firstGlyphBounds.char}": ${leftRegionPoints.length} points`);
        console.log(`      Last glyph "${lastGlyphBounds.char}": ${rightRegionPoints.length} points`);
      }

      // If too few points, expand margin before applying quantiles
      const minPointsPerRegion = 20;
      if (leftRegionPoints.length < minPointsPerRegion || rightRegionPoints.length < minPointsPerRegion) {
        const marginsToTry = [4.0, 6.0, 8.0, 10.0];

        for (const tryMarginMm of marginsToTry) {
          if (leftRegionPoints.length >= minPointsPerRegion && rightRegionPoints.length >= minPointsPerRegion) {
            break;
          }

          const tryMarginPx = tryMarginMm * PX_PER_MM;

          if (leftRegionPoints.length < minPointsPerRegion) {
            const expandedFirstRect = new paper.Rectangle(
              firstGlyphBounds.x1 - tryMarginPx,
              firstGlyphBounds.y1 - tryMarginPx,
              (firstGlyphBounds.x2 - firstGlyphBounds.x1) + 2 * tryMarginPx,
              (firstGlyphBounds.y2 - firstGlyphBounds.y1) + 2 * tryMarginPx
            );
            leftRegionPoints = sampledPoints.filter(p => expandedFirstRect.contains(p));
            firstRect = expandedFirstRect;
          }

          if (rightRegionPoints.length < minPointsPerRegion) {
            const expandedLastRect = new paper.Rectangle(
              lastGlyphBounds.x1 - tryMarginPx,
              lastGlyphBounds.y1 - tryMarginPx,
              (lastGlyphBounds.x2 - lastGlyphBounds.x1) + 2 * tryMarginPx,
              (lastGlyphBounds.y2 - lastGlyphBounds.y1) + 2 * tryMarginPx
            );
            rightRegionPoints = sampledPoints.filter(p => expandedLastRect.contains(p));
            lastRect = expandedLastRect;
          }

          if (debugMode) {
            console.log(`      Expanded margin to ${tryMarginMm}mm: Left=${leftRegionPoints.length}, Right=${rightRegionPoints.length}`);
          }
        }
      }

      // Debug visualization: Draw glyph boxes
      if (debugMode && window.DEBUG_LOOP_ANCHORS && firstRect && lastRect) {
        // Draw first glyph box (red)
        new paper.Path.Rectangle({
          rectangle: firstRect,
          strokeColor: 'rgba(255,0,0,0.5)',
          strokeWidth: 0.5,
          name: 'debugGlyphBoxFirst'
        });

        // Draw last glyph box (blue)
        new paper.Path.Rectangle({
          rectangle: lastRect,
          strokeColor: 'rgba(0,0,255,0.5)',
          strokeWidth: 0.5,
          name: 'debugGlyphBoxLast'
        });
      }
    }
  }

  // ============================================================================
  // QUANTILE SELECTION WITHIN EACH REGION
  // ============================================================================
  // Apply quantile-based filtering separately within left and right regions

  // Helper: Get Y value at quantile for a set of points
  const getYQuantileForPoints = (points, q) => {
    if (points.length === 0) return null;
    const yValues = points.map(p => p.y);
    yValues.sort((a, b) => a - b);
    const index = Math.floor(q * (yValues.length - 1));
    return yValues[Math.max(0, Math.min(index, yValues.length - 1))];
  };

  // Select top candidates from left region
  let leftCandidates = [];
  if (leftRegionPoints.length > 0) {
    const quantilesToTry = [0.30, 0.40, 0.50, 0.75, 1.0];  // Start at 30% since we already filtered by region
    for (const q of quantilesToTry) {
      const yThreshold = getYQuantileForPoints(leftRegionPoints, q);
      leftCandidates = leftRegionPoints.filter(p => p.y <= yThreshold);
      if (debugMode) {
        console.log(`      Left region quantile ${(q * 100).toFixed(0)}%: ${leftCandidates.length} candidates`);
      }
      if (leftCandidates.length >= 10 || q === 1.0) break;
    }
  }

  // Select top candidates from right region
  let rightCandidates = [];
  if (rightRegionPoints.length > 0) {
    const quantilesToTry = [0.30, 0.40, 0.50, 0.75, 1.0];
    for (const q of quantilesToTry) {
      const yThreshold = getYQuantileForPoints(rightRegionPoints, q);
      rightCandidates = rightRegionPoints.filter(p => p.y <= yThreshold);
      if (debugMode) {
        console.log(`      Right region quantile ${(q * 100).toFixed(0)}%: ${rightCandidates.length} candidates`);
      }
      if (rightCandidates.length >= 10 || q === 1.0) break;
    }
  }

  // Fallback if still no candidates
  if (leftCandidates.length === 0) {
    if (debugMode) console.log(`      ⚠️ No left candidates, using all left region points`);
    leftCandidates = leftRegionPoints.length > 0 ? leftRegionPoints : sampledPoints;
  }
  if (rightCandidates.length === 0) {
    if (debugMode) console.log(`      ⚠️ No right candidates, using all right region points`);
    rightCandidates = rightRegionPoints.length > 0 ? rightRegionPoints : sampledPoints;
  }

  if (debugMode) {
    console.log(`    ✓ Final candidates: Left=${leftCandidates.length}, Right=${rightCandidates.length}`);
  }

  // 3. Find leftmost and rightmost points from candidates
  let leftPoint = leftCandidates[0];
  let rightPoint = rightCandidates[0];

  for (const p of leftCandidates) {
    if (p.x < leftPoint.x) leftPoint = p;
  }

  for (const p of rightCandidates) {
    if (p.x > rightPoint.x) rightPoint = p;
  }

  if (debugMode) {
    console.log(`    ✓ Final anchors: Left=(${leftPoint.x.toFixed(2)}, ${leftPoint.y.toFixed(2)}), Right=(${rightPoint.x.toFixed(2)}, ${rightPoint.y.toFixed(2)})`);
  }

  // Calculate outward directions from text center
  const center = textItem.bounds.center;

  const leftDir = leftPoint.subtract(center);
  const leftOutward = leftDir.length > 0.01 ? leftDir.normalize() : new paper.Point(-1, 0);

  const rightDir = rightPoint.subtract(center);
  const rightOutward = rightDir.length > 0.01 ? rightDir.normalize() : new paper.Point(1, 0);

  // Add debug visualization if enabled
  if (debugMode && window.DEBUG_LOOP_ANCHORS) {
    // Draw anchor points
    const leftAnchorCircle = new paper.Path.Circle({
      center: leftPoint,
      radius: 2,
      fillColor: 'red',
      name: 'debugAnchorLeft'
    });

    const rightAnchorCircle = new paper.Path.Circle({
      center: rightPoint,
      radius: 2,
      fillColor: 'blue',
      name: 'debugAnchorRight'
    });

    // Draw outward direction arrows
    const arrowLength = 20;
    const leftArrow = new paper.Path.Line({
      from: leftPoint,
      to: leftPoint.add(leftOutward.multiply(arrowLength)),
      strokeColor: 'red',
      strokeWidth: 1,
      name: 'debugArrowLeft'
    });

    const rightArrow = new paper.Path.Line({
      from: rightPoint,
      to: rightPoint.add(rightOutward.multiply(arrowLength)),
      strokeColor: 'blue',
      strokeWidth: 1,
      name: 'debugArrowRight'
    });

    console.log('    🎨 Debug visualization: Red=left anchor, Blue=right anchor');
  }

  return {
    left: { point: leftPoint, outwardDir: leftOutward },
    right: { point: rightPoint, outwardDir: rightOutward }
  };
}

/**
 * Create a loop and place it with verified overlap
 */
function createAndPlaceLoop(config) {
  const {
    anchorPoint,
    outwardDir,
    innerRadiusPx,
    outerRadiusPx,
    offsetPx,
    overlapPx,
    textItem,
    side,
    debugMode
  } = config;

  if (debugMode) {
    console.log(`  🔧 Creating ${side} loop...`);
  }

  // Create donut loop geometry
  const outerCircle = new paper.Path.Circle({
    center: [0, 0],
    radius: outerRadiusPx,
    fillColor: 'black'
  });

  const innerCircle = new paper.Path.Circle({
    center: [0, 0],
    radius: innerRadiusPx
  });

  const loopRing = outerCircle.subtract(innerCircle);
  outerCircle.remove();
  innerCircle.remove();
  loopRing.fillColor = 'black';

  // Calculate initial loop position
  // We want the outer edge to overlap the text by overlapPx
  // So center should be: anchor + outwardDir * (outerRadius - overlap + offset)
  const baseOffset = outerRadiusPx - overlapPx + offsetPx;
  const initialCenter = anchorPoint.add(outwardDir.multiply(baseOffset));

  loopRing.position = initialCenter;

  if (debugMode) {
    console.log(`    Initial position: (${initialCenter.x.toFixed(2)}, ${initialCenter.y.toFixed(2)})`);
    console.log(`    Outward direction: (${outwardDir.x.toFixed(3)}, ${outwardDir.y.toFixed(3)})`);
  }

  // STEP: Verify overlap and adjust if needed
  const overlapResult = ensureOverlap(loopRing, textItem, anchorPoint, outwardDir, overlapPx, debugMode);

  if (!overlapResult.hasOverlap) {
    console.warn(`    ⚠️ ${side} loop: Could not achieve overlap, creating bridge tab...`);

    // Create bridge tab as fallback
    const bridge = createBridgeTab(anchorPoint, loopRing.position, outerRadiusPx * 0.8, debugMode);

    if (bridge) {
      const loopWithBridge = loopRing.unite(bridge);
      loopRing.remove();
      bridge.remove();

      if (loopWithBridge) {
        loopWithBridge.fillColor = 'black';
        return loopWithBridge;
      }
    }
  }

  return loopRing;
}

/**
 * Ensure the loop overlaps the text, adjusting position if needed
 */
function ensureOverlap(loopRing, textItem, anchorPoint, outwardDir, targetOverlapPx, debugMode) {
  const maxSteps = 50;
  const stepPull = 0.2 * PX_PER_MM; // Pull 0.2mm at a time
  const minOverlapArea = 1.0; // Minimum area in px² to consider as overlap

  // Test current overlap
  let overlapTest = loopRing.intersect(textItem, { insert: false });
  let overlapArea = overlapTest ? Math.abs(overlapTest.area) : 0;

  if (debugMode) {
    console.log(`    Initial overlap area: ${overlapArea.toFixed(2)}px²`);
  }

  if (overlapArea > minOverlapArea) {
    if (overlapTest) overlapTest.remove();
    return { hasOverlap: true, finalOverlap: overlapArea };
  }

  // No overlap - try pulling loop toward text
  if (debugMode) {
    console.log(`    No overlap detected, pulling loop toward text...`);
  }

  const pullDir = outwardDir.multiply(-1); // Opposite of outward

  for (let step = 1; step <= maxSteps; step++) {
    loopRing.position = loopRing.position.add(pullDir.multiply(stepPull));

    if (overlapTest) overlapTest.remove();
    overlapTest = loopRing.intersect(textItem, { insert: false });
    overlapArea = overlapTest ? Math.abs(overlapTest.area) : 0;

    if (overlapArea > minOverlapArea) {
      if (debugMode) {
        console.log(`    ✓ Overlap achieved after ${step} pull steps (area: ${overlapArea.toFixed(2)}px²)`);
      }
      if (overlapTest) overlapTest.remove();
      return { hasOverlap: true, finalOverlap: overlapArea };
    }
  }

  if (overlapTest) overlapTest.remove();

  if (debugMode) {
    console.log(`    ✗ Could not achieve overlap after ${maxSteps} steps`);
  }

  return { hasOverlap: false, finalOverlap: 0 };
}

/**
 * Create a bridge tab to connect loop to text
 */
function createBridgeTab(anchorPoint, loopCenter, bridgeWidth, debugMode) {
  // Calculate bridge geometry
  const direction = loopCenter.subtract(anchorPoint);
  const bridgeLength = direction.length;
  const angle = Math.atan2(direction.y, direction.x);

  if (debugMode) {
    console.log(`    Creating bridge tab: length=${bridgeLength.toFixed(2)}px, angle=${(angle * 180 / Math.PI).toFixed(1)}°`);
  }

  // Create rectangle centered between anchor and loop
  const bridgeCenter = anchorPoint.add(loopCenter).divide(2);
  const bridge = new paper.Path.Rectangle({
    center: bridgeCenter,
    size: [bridgeLength, bridgeWidth],
    fillColor: 'black'
  });

  // Rotate to align with direction
  bridge.rotate(angle * 180 / Math.PI);

  return bridge;
}

/**
 * Count the number of separate components in a Paper.js item
 */
function countComponents(item) {
  if (item instanceof paper.CompoundPath) {
    return item.children.length;
  } else if (item instanceof paper.Group) {
    // Count all paths in group
    let count = 0;
    for (const child of item.children) {
      if (child instanceof paper.Path || child instanceof paper.CompoundPath) {
        count++;
      }
    }
    return count;
  } else if (item instanceof paper.Path) {
    return 1;
  }
  return 0;
}

function generateLoops(paperGroup, options = {}, debugMode = false) {
  const {
    innerDiameterMm = 3.0,
    offsetMm = 0.6,
    minThicknessMm = 0.8
  } = options;

  console.log('🔵 Generating attachment loops...');
  console.log(`  Inner diameter: ${innerDiameterMm}mm`);
  console.log(`  Offset from text: ${offsetMm}mm`);
  console.log(`  Loop thickness: ${minThicknessMm}mm`);

  // Calculate dimensions in Paper.js units (px)
  const innerRadiusPx = (innerDiameterMm / 2) * PX_PER_MM;
  const outerRadiusPx = ((innerDiameterMm + 2 * minThicknessMm) / 2) * PX_PER_MM;
  const offsetPx = offsetMm * PX_PER_MM;

  console.log(`  Inner radius: ${innerRadiusPx.toFixed(2)}px`);
  console.log(`  Outer radius: ${outerRadiusPx.toFixed(2)}px`);
  console.log(`  Offset: ${offsetPx.toFixed(2)}px`);

  // Get bounds of all text
  const textBounds = paperGroup.bounds;
  console.log(`  Text bounds: x=${textBounds.x.toFixed(2)}, y=${textBounds.y.toFixed(2)}, w=${textBounds.width.toFixed(2)}, h=${textBounds.height.toFixed(2)}`);

  // Calculate loop positions
  // DESIGN GOAL: Position loops ABOVE the text like jewelry attachment points
  // They should sit at the top edges and just barely touch for welding
  //
  // For cursive fonts like Pacifico:
  //   - LEFT loop: at the start of the first letter (top-left)
  //   - RIGHT loop: at the end of the last letter (top-right)
  //
  // Strategy:
  // 1. Position loops ABOVE the text (higher than text top)
  // 2. Use bounding box left/right for horizontal positioning
  // 3. Ensure minimal overlap (just enough for welding)

  const overlapMm = 0.5; // Minimal overlap - just enough to weld
  const overlapPx = overlapMm * PX_PER_MM;

  // Position loops ABOVE the text
  // The loop center should be positioned so the loop BOTTOM just barely overlaps the text TOP
  // In Paper.js coordinates: more negative Y = higher position
  //
  // Loop bottom position should be slightly below (less negative than) text top
  // Desired: loopBottom = textBounds.top + overlapPx
  // Since: loopBottom = centerY + outerRadiusPx
  // Then: centerY = textBounds.top + overlapPx - outerRadiusPx
  const loopCenterY = textBounds.top + overlapPx - outerRadiusPx;

  // Horizontal positions: use the natural start/end of the cursive text
  const leftX = textBounds.left;
  const rightX = textBounds.right;

  const loopTop = loopCenterY - outerRadiusPx;
  const loopBottom = loopCenterY + outerRadiusPx;

  // Verify positioning
  const loopExtendsAboveText = loopTop < textBounds.top;
  const loopOverlapsText = loopBottom > textBounds.top;
  const actualOverlapPx = loopOverlapsText ? (loopBottom - textBounds.top) : 0;

  console.log(`  Loop positioning strategy: ABOVE text with minimal overlap`);
  console.log(`  Target overlap: ${overlapMm}mm (${overlapPx.toFixed(2)}px)`);
  console.log(`  Text top: ${textBounds.top.toFixed(2)}`);
  console.log(`  Loop center Y: ${loopCenterY.toFixed(2)}`);
  console.log(`  Loop vertical range: ${loopTop.toFixed(2)} to ${loopBottom.toFixed(2)}`);
  console.log(`  ${loopExtendsAboveText ? '✓' : '✗'} Loop extends above text`);
  console.log(`  ${loopOverlapsText ? '✓' : '✗'} Loop overlaps text by ${actualOverlapPx.toFixed(2)}px`);
  console.log(`  Left loop at: (${leftX.toFixed(2)}, ${loopCenterY.toFixed(2)})`);
  console.log(`  Right loop at: (${rightX.toFixed(2)}, ${loopCenterY.toFixed(2)})`);

  const loops = [];

  // Create left loop (donut shape)
  const leftOuter = new paper.Path.Circle({
    center: [leftX, loopCenterY],
    radius: outerRadiusPx
  });

  const leftInner = new paper.Path.Circle({
    center: [leftX, loopCenterY],
    radius: innerRadiusPx
  });

  const leftLoop = leftOuter.subtract(leftInner);
  leftOuter.remove();
  leftInner.remove();

  loops.push(leftLoop);
  console.log(`  ✓ Created LEFT loop (donut)`);

  // Create right loop (donut shape)
  const rightOuter = new paper.Path.Circle({
    center: [rightX, loopCenterY],
    radius: outerRadiusPx
  });

  const rightInner = new paper.Path.Circle({
    center: [rightX, loopCenterY],
    radius: innerRadiusPx
  });

  const rightLoop = rightOuter.subtract(rightInner);
  rightOuter.remove();
  rightInner.remove();

  loops.push(rightLoop);
  console.log(`  ✓ Created RIGHT loop (donut)`);

  if (debugMode) {
    console.log(`  📊 Left loop:  center=(${leftX.toFixed(2)}, ${loopCenterY.toFixed(2)}), bounds: top=${leftLoop.bounds.top.toFixed(2)}, bottom=${leftLoop.bounds.bottom.toFixed(2)}`);
    console.log(`  📊 Right loop: center=(${rightX.toFixed(2)}, ${loopCenterY.toFixed(2)}), bounds: top=${rightLoop.bounds.top.toFixed(2)}, bottom=${rightLoop.bounds.bottom.toFixed(2)}`);
  }

  console.log(`✅ Generated ${loops.length} loops positioned ABOVE text`);

  return loops;
}

/**
 * Connect i-dots to stems using per-glyph analysis (not global scanning).
 * Only processes 'i' and 'j' glyphs to avoid false positives from other letters' counters.
 * 
 * @param {Array} glyphItems - Array of {char, index, item} from applyPaperJsUnion 
 * @param {Object} options - Configuration options
 * @returns {void} - Modifies glyphItems in place
 */
function connectIDotsPerGlyph(glyphItems, options = {}) {
  const {
    enabled = true,
    overlapMm = 0.4,
    maxShiftMm = 2.0,
    searchRadiusMm = 6.0
  } = options;

  if (!enabled) {
    return;
  }

  const debug = window.DEBUG_I_DOTS;

  if (debug) {
    console.log('🔵 Starting per-glyph i-dot connection (dynamic overlap + retry)...');
    console.log('Options:', { overlapMm, maxShiftMm, searchRadiusMm });
  }

  // Convert mm to Paper.js units
  const overlapPx = mmToPaperUnits(overlapMm);
  const maxShiftPx = mmToPaperUnits(maxShiftMm);
  const searchRadiusPx = mmToPaperUnits(searchRadiusMm);

  let totalDotsConnected = 0;
  let totalRetriesUsed = 0;

  // Process only 'i' and 'j' glyphs
  for (const glyphItem of glyphItems) {
    const char = glyphItem.char.toLowerCase();

    // Only process lowercase i and j
    if (char !== 'i' && char !== 'j') {
      continue;
    }

    if (debug) {
      console.log(`\n📍 Processing '${glyphItem.char}' (index ${glyphItem.index})`);
    }

    const item = glyphItem.item;
    const glyphBounds = item.bounds;

    // Extract sub-paths from this glyph
    const subPaths = extractSubPaths(item);

    if (subPaths.length <= 1) {
      if (debug) {
        console.log(`  Single component glyph, skipping`);
      }
      continue;
    }

    if (debug) {
      console.log(`  Found ${subPaths.length} sub-paths`);
    }

    // Find largest subpath (stem/body)
    let stem = null;
    let maxArea = 0;

    for (const path of subPaths) {
      const area = Math.abs(path.area);
      if (area > maxArea) {
        maxArea = area;
        stem = path;
      }
    }

    if (!stem) {
      if (debug) {
        console.log(`  No stem found`);
      }
      continue;
    }

    // Find dot candidates: in top 60% of glyph AND < 35% of stem area
    const top60Y = glyphBounds.top + glyphBounds.height * 0.6;
    const dotCandidates = [];

    for (const path of subPaths) {
      if (path === stem) continue;

      const pathArea = Math.abs(path.area);
      const areaRatio = pathArea / maxArea;
      const isInTopRegion = path.bounds.center.y < top60Y;
      const isSmallEnough = areaRatio < 0.35; // Slightly more lenient

      if (isInTopRegion && isSmallEnough) {
        dotCandidates.push(path);
      }
    }

    if (dotCandidates.length === 0) {
      if (debug) {
        console.log(`  No dot candidates found`);
      }
      continue;
    }

    // Pick the topmost/smallest candidate
    dotCandidates.sort((a, b) => {
      const topDiff = a.bounds.top - b.bounds.top;
      if (Math.abs(topDiff) > 0.1) return topDiff;
      return Math.abs(a.area) - Math.abs(b.area);
    });

    const dot = dotCandidates[0];
    const dotHeight = dot.bounds.height;

    if (debug) {
      console.log(`  ✓ Dot found: area=${Math.abs(dot.area).toFixed(2)}, height=${dotHeight.toFixed(2)}, top=${dot.bounds.top.toFixed(2)}`);
      console.log(`  Stem: area=${maxArea.toFixed(2)}, top=${stem.bounds.top.toFixed(2)}`);
    }

    // Check if already intersecting
    if (dot.intersects(stem)) {
      if (debug) {
        console.log(`  ✓ Dot already intersects stem, skipping`);
      }
      totalDotsConnected++;
      continue;
    }

    // Calculate gap
    const gap = stem.bounds.top - dot.bounds.bottom;

    if (debug) {
      console.log(`  Gap: ${gap.toFixed(2)}px (${(gap / PX_PER_MM).toFixed(2)}mm)`);
    }

    // Calculate target overlap (avoid skinny necks)
    // Use max of configured overlap or 35% of dot height
    const targetOverlapPx = Math.max(overlapPx, dotHeight * 0.35);

    // Calculate dynamic max shift (handle large gaps in decorative fonts)
    // Use max of: configured limit, 2x dot height, or 45% of glyph height
    const dynamicMaxShiftPx = Math.max(
      maxShiftPx,
      dotHeight * 2.0,
      glyphBounds.height * 0.45
    );

    if (debug) {
      console.log(`  Target overlap: ${targetOverlapPx.toFixed(2)}px (max of ${overlapPx.toFixed(2)} or ${(dotHeight * 0.35).toFixed(2)})`);
      console.log(`  Dynamic max shift: ${dynamicMaxShiftPx.toFixed(2)}px (${(dynamicMaxShiftPx / PX_PER_MM).toFixed(2)}mm)`);
    }

    // Calculate initial shift based on gap
    let shiftY = 0;

    if (gap > 0.1) {
      // Gap exists - move to create overlap
      shiftY = gap + targetOverlapPx;
    } else if (gap < -0.1) {
      // Already overlapping
      if (debug) {
        console.log(`  ✓ Already overlapping by ${Math.abs(gap).toFixed(2)}px`);
      }
      totalDotsConnected++;
      continue;
    } else {
      // Touching - just add overlap
      shiftY = targetOverlapPx;
    }

    // Limit to dynamic max
    if (shiftY > dynamicMaxShiftPx) {
      if (debug) {
        console.warn(`  ⚠️ Desired shift ${shiftY.toFixed(2)}px exceeds dynamic limit ${dynamicMaxShiftPx.toFixed(2)}px`);
      }
      shiftY = dynamicMaxShiftPx;
    }

    if (debug) {
      console.log(`  📐 Initial shift: ${shiftY.toFixed(2)}px (${(shiftY / PX_PER_MM).toFixed(2)}mm)`);
    }

    // Apply initial translation
    dot.translate(new paper.Point(0, shiftY));

    // Verify intersection
    let intersects = dot.intersects(stem);

    if (debug) {
      console.log(`  🔍 Intersection after initial shift: ${intersects ? 'YES ✓' : 'NO ✗'}`);
    }

    // Retry loop: if not intersecting, incrementally increase overlap
    if (!intersects) {
      const retryStepPx = mmToPaperUnits(0.2); // 0.2mm per retry
      const maxRetries = 10;

      if (debug) {
        console.log(`  🔁 Starting retry loop (step: ${retryStepPx.toFixed(2)}px, max retries: ${maxRetries})...`);
      }

      for (let retry = 0; retry < maxRetries; retry++) {
        const additionalShift = retryStepPx;
        const newTotalShift = shiftY + (retry + 1) * retryStepPx;

        // Check if exceeding dynamic limit
        if (newTotalShift > dynamicMaxShiftPx) {
          if (debug) {
            console.warn(`  ⚠️ Retry ${retry + 1}: would exceed dynamic limit, stopping retries`);
          }
          break;
        }

        // Apply additional shift
        dot.translate(new paper.Point(0, additionalShift));
        shiftY += additionalShift;

        // Check intersection
        intersects = dot.intersects(stem);

        if (debug) {
          console.log(`  Retry ${retry + 1}: shift +${additionalShift.toFixed(2)}px → total ${shiftY.toFixed(2)}px → ${intersects ? 'YES ✓' : 'NO ✗'}`);
        }

        if (intersects) {
          totalRetriesUsed++;
          break;
        }
      }
    }

    // Final status
    if (intersects) {
      if (debug) {
        console.log(`  ✅ Dot connected! Final shift: ${shiftY.toFixed(2)}px (${(shiftY / PX_PER_MM).toFixed(2)}mm)`);
      }
      totalDotsConnected++;
    } else {
      console.warn(`  ❌ Failed to connect dot after all retries`);
      if (debug) {
        console.warn(`    Dot bounds: top=${dot.bounds.top.toFixed(2)}, bottom=${dot.bounds.bottom.toFixed(2)}`);
        console.warn(`    Stem bounds: top=${stem.bounds.top.toFixed(2)}, bottom=${stem.bounds.bottom.toFixed(2)}`);
        console.warn(`    Final gap: ${(stem.bounds.top - dot.bounds.bottom).toFixed(2)}px`);
      }
    }
  }

  if (debug) {
    console.log(`\n✅ Total dots connected: ${totalDotsConnected}`);
    if (totalRetriesUsed > 0) {
      console.log(`🔁 Glyphs requiring retries: ${totalRetriesUsed}`);
    }
  }
}

/**
 * Extract sub-paths from a Paper.js item (Path, CompoundPath, or Group)
 * @param {paper.Item} item - The glyph item
 * @returns {Array<paper.Path>} Array of sub-paths
 */
function extractSubPaths(item) {
  const paths = [];

  if (item instanceof paper.Path) {
    return [item];
  } else if (item instanceof paper.CompoundPath) {
    item.children.forEach(child => {
      if (child instanceof paper.Path) {
        paths.push(child);
      }
    });
  } else if (item instanceof paper.Group) {
    item.children.forEach(child => {
      if (child instanceof paper.Path) {
        paths.push(child);
      } else if (child instanceof paper.CompoundPath) {
        child.children.forEach(subChild => {
          if (subChild instanceof paper.Path) {
            paths.push(subChild);
          }
        });
      }
    });
  }

  return paths;
}

/**
 * Create a connector bridge between dot and stem
 * @param {paper.Path} dot - The dot path
 * @param {paper.Path} stem - The stem path
 * @param {number} overlapPx - Desired overlap in pixels
 * @returns {paper.Path} The bridge path
 */
function createConnectorBridge(dot, stem, overlapPx) {
  const dotBottom = dot.bounds.bottom;
  const stemTop = stem.bounds.top;
  const gap = stemTop - dotBottom;

  // Calculate bridge dimensions
  const bridgeLength = gap + (2 * overlapPx); // Overlap both ends
  const bridgeWidth = Math.max(
    Math.min(dot.bounds.width * 0.35, mmToPaperUnits(1.2)),
    mmToPaperUnits(0.3)
  );

  // Center horizontally between dot and stem
  const dotCenterX = dot.bounds.center.x;
  const stemCenterX = stem.bounds.center.x;
  const bridgeCenterX = (dotCenterX + stemCenterX) / 2;

  // Position: start at dot.bottom - overlap
  const bridgeTop = dotBottom - overlapPx;

  // Create rounded rectangle (capsule shape)
  const bridge = new paper.Path.Rectangle({
    from: [bridgeCenterX - bridgeWidth / 2, bridgeTop],
    to: [bridgeCenterX + bridgeWidth / 2, bridgeTop + bridgeLength],
    radius: bridgeWidth / 2  // Makes it capsule-shaped
  });

  return bridge;
}

/**
 * Estimate minimum distance between two paths by sampling.
 * Samples points along the rightmost 35% of left path and leftmost 35% of right path.
 * 
 * @param {paper.Path} leftPath - Left glyph path
 * @param {paper.Path} rightPath - Right glyph path
 * @param {number} sampleStepUnits - Sampling step size in Paper units
 * @returns {Object} - { minDistance: number, leftPoint: paper.Point, rightPoint: paper.Point, direction: paper.Point }
 */
function estimateMinDistanceBetweenPaths(leftPath, rightPath, sampleStepUnits) {
  let minDistance = Infinity;
  let bestLeftPoint = null;
  let bestRightPoint = null;

  // Get bounds of both paths
  const leftBounds = leftPath.bounds;
  const rightBounds = rightPath.bounds;

  // Define the rightmost 35% of left path
  const leftSampleThreshold = leftBounds.right - (leftBounds.width * 0.35);

  // Define the leftmost 35% of right path
  const rightSampleThreshold = rightBounds.left + (rightBounds.width * 0.35);

  // Flatten paths for stable sampling
  const leftFlattened = leftPath.clone();
  const rightFlattened = rightPath.clone();
  leftFlattened.flatten(sampleStepUnits * 0.5);
  rightFlattened.flatten(sampleStepUnits * 0.5);

  // Sample points from the rightmost region of left path
  const leftSamplePoints = [];
  const leftLength = leftFlattened.length;
  for (let offset = 0; offset < leftLength; offset += sampleStepUnits) {
    const point = leftFlattened.getPointAt(offset);
    if (point && point.x >= leftSampleThreshold) {
      leftSamplePoints.push(point);
    }
  }

  // Sample points from the leftmost region of right path
  const rightSamplePoints = [];
  const rightLength = rightFlattened.length;
  for (let offset = 0; offset < rightLength; offset += sampleStepUnits) {
    const point = rightFlattened.getPointAt(offset);
    if (point && point.x <= rightSampleThreshold) {
      rightSamplePoints.push(point);
    }
  }

  // Clean up flattened clones
  leftFlattened.remove();
  rightFlattened.remove();

  // Find minimum distance by checking each left sample point against right path
  for (const leftPoint of leftSamplePoints) {
    const nearestOnRight = rightPath.getNearestPoint(leftPoint);
    if (nearestOnRight) {
      const distance = leftPoint.getDistance(nearestOnRight);
      if (distance < minDistance) {
        minDistance = distance;
        bestLeftPoint = leftPoint;
        bestRightPoint = nearestOnRight;
      }
    }
  }

  // Also check each right sample point against left path (bidirectional)
  for (const rightPoint of rightSamplePoints) {
    const nearestOnLeft = leftPath.getNearestPoint(rightPoint);
    if (nearestOnLeft) {
      const distance = rightPoint.getDistance(nearestOnLeft);
      if (distance < minDistance) {
        minDistance = distance;
        bestLeftPoint = nearestOnLeft;
        bestRightPoint = rightPoint;
      }
    }
  }

  // Compute direction vector (from left to right)
  let direction = null;
  if (bestLeftPoint && bestRightPoint) {
    direction = bestRightPoint.subtract(bestLeftPoint).normalize();
  }

  return {
    minDistance,
    leftPoint: bestLeftPoint,
    rightPoint: bestRightPoint,
    direction
  };
}

/**
 * AUTO-CONNECT: Geometry-based spacing enforcement
 * 
 * Automatically tightens spacing between adjacent glyphs to ensure minimum overlap.
 * This prevents disconnected letters in the final design.
 * 
 * @param {Array} glyphItems - Array of {char, index, item: Paper.Path/CompoundPath}
 * @param {Object} options - { minOverlapMm, maxTightenMm, debugLog, debugMarkers }
 * @returns {Array} - Adjusted glyphItems with updated positions
 */
function applyAutoConnect(glyphItems, options) {
  const {
    minOverlapMm = 0.4,
    maxTightenMm = 3.0,
    debugLog = false,
    debugMarkers = false
  } = options;

  if (glyphItems.length < 2) {
    return glyphItems; // Need at least 2 glyphs to check adjacency
  }

  const minOverlapUnits = mmToPaperPixels(minOverlapMm);
  const maxTightenUnits = mmToPaperPixels(maxTightenMm);
  const stepUnits = mmToPaperPixels(0.1); // 0.1mm increments

  if (debugLog) {
    console.log('\n🔗 === AUTO-CONNECT: Checking adjacent letter overlaps ===');
    console.log(`Min overlap required: ${minOverlapMm}mm (${minOverlapUnits.toFixed(2)} units)`);
    console.log(`Max tighten per pair: ${maxTightenMm}mm (${maxTightenUnits.toFixed(2)} units)`);
  }

  const adjustments = [];

  // Process each adjacent pair (left to right)
  for (let i = 0; i < glyphItems.length - 1; i++) {
    const left = glyphItems[i];
    const right = glyphItems[i + 1];

    // Skip if either glyph is missing
    if (!left.item || !right.item) {
      continue;
    }

    // Quick bounds check: if bounds don't overlap at all, definitely need tightening
    const boundsOverlap = left.item.bounds.right >= right.item.bounds.left;

    if (!boundsOverlap) {
      if (debugLog) {
        console.log(`  Pair "${left.char}${right.char}": bounds don't overlap → tightening needed`);
      }
    }

    // For i/j letters, extract only the stem (exclude dot) to prevent false positives
    // When auto-connect runs after i-dot connection, the dot has already been moved,
    // but we still want to avoid false positives from other dot positions
    let leftItem = left.item;
    let rightItem = right.item;


    const isIDotChar = (char) => {
      const c = char.toLowerCase();
      return c === 'i' || c === 'j';
    };

    const getStemOnly = (item, char) => {
      if (!isIDotChar(char)) {
        return item;  // Not an i/j, use full item
      }

      const subPaths = extractSubPaths(item);
      if (subPaths.length <= 1) {
        return item;  // Single path, no dot to exclude
      }

      // Find largest subpath (stem/body)
      let stem = null;
      let maxArea = 0;
      for (const path of subPaths) {
        const area = Math.abs(path.area);
        if (area > maxArea) {
          maxArea = area;
          stem = path;
        }
      }

      return stem || item;
    };

    leftItem = getStemOnly(leftItem, left.char);
    rightItem = getStemOnly(rightItem, right.char);

    if (debugLog && (isIDotChar(left.char) || isIDotChar(right.char))) {
      console.log(`  Using stem-only for overlap check (i/j detected)`);
    }

    // Check actual geometric overlap using boolean intersection
    let currentInter = null;
    let overlapOk = false;

    try {
      currentInter = leftItem.intersect(rightItem, { insert: false });

      if (currentInter && currentInter.area > 0.001) {  // Lowered threshold for thin connections
        // Intersection exists, check if it meets minimum size
        const interW = currentInter.bounds.width;
        const interH = currentInter.bounds.height;
        const maxDim = Math.max(interW, interH);

        overlapOk = maxDim >= minOverlapUnits;

        if (debugLog) {
          console.log(`  Pair "${left.char}${right.char}": overlap ${maxDim.toFixed(2)} units ${overlapOk ? '✓ PASS' : '✗ FAIL (too small)'}`);
        }
      } else {
        // No intersection
        if (debugLog) {
          console.log(`  Pair "${left.char}${right.char}": no intersection → tightening needed`);
        }
        overlapOk = false;
      }

      // Clean up temporary intersection
      if (currentInter) {
        currentInter.remove();
      }
    } catch (error) {
      console.error(`Error checking overlap for "${left.char}${right.char}":`, error);
      overlapOk = false; // Assume fail on error
    }

    // If overlap is insufficient, auto-tighten
    if (!overlapOk) {
      // Measure initial gap
      const gapUnits = right.item.bounds.left - left.item.bounds.right;
      const gapMm = gapUnits / PX_PER_MM;

      // Safety: Skip extremely large gaps (likely intentional spacing, not script connection)
      if (gapMm > 15.0) {
        if (debugLog) {
          console.log(`  Pair "${left.char}${right.char}": gap ${gapMm.toFixed(3)}mm > 15.0mm → SKIPPED (extremely large, likely intentional)`);
        }
        continue;
      }

      if (debugLog) {
        if (gapMm < 0) {
          console.log(`  Pair "${left.char}${right.char}": OVERLAP ${Math.abs(gapMm).toFixed(3)}mm (negative gap) but insufficient → attempting tighten`);
        } else {
          console.log(`  Pair "${left.char}${right.char}": gap ${gapMm.toFixed(3)}mm → attempting tighten`);
        }
      }

      let shiftAccum = 0;
      let finalShift = 0;
      let found = false;

      // Try tightening in small steps
      while (shiftAccum < maxTightenUnits) {
        // Shift right glyph and all subsequent glyphs to the left
        const shiftDelta = Math.min(stepUnits, maxTightenUnits - shiftAccum);

        for (let j = i + 1; j < glyphItems.length; j++) {
          if (glyphItems[j].item) {
            glyphItems[j].item.position.x -= shiftDelta;
          }
        }

        shiftAccum += shiftDelta;
        finalShift += shiftDelta;

        // Re-check overlap (use stem-only for i/j)
        try {
          const testInter = leftItem.intersect(rightItem, { insert: false });

          if (testInter && testInter.area > 0.001) {  // Lowered threshold for thin connections
            const interW = testInter.bounds.width;
            const interH = testInter.bounds.height;
            const maxDim = Math.max(interW, interH);

            if (maxDim >= minOverlapUnits) {
              found = true;
              testInter.remove();
              break;
            }
          }

          if (testInter) {
            testInter.remove();
          }
        } catch (error) {
          // Continue trying
        }
      }

      if (found) {
        const shiftMm = finalShift / PX_PER_MM;
        adjustments.push({
          pair: `${left.char}${right.char}`,
          shiftMm: shiftMm.toFixed(3),
          status: 'SUCCESS'
        });

        if (debugLog) {
          console.log(`    ✓ Auto-tightened by ${shiftMm.toFixed(3)}mm`);
        }
      } else {
        // MAX_REACHED: Try emergency nudge using nearest-distance estimation
        const shiftMm = finalShift / PX_PER_MM;

        if (debugLog) {
          console.warn(`    ⚠ Max tighten reached (${shiftMm.toFixed(3)}mm) - trying emergency nudge...`);
        }

        // Estimate minimum distance between paths
        const sampleStepUnits = mmToPaperPixels(0.5); // 0.5mm sampling step
        const distanceInfo = estimateMinDistanceBetweenPaths(left.item, right.item, sampleStepUnits);

        if (distanceInfo.minDistance < Infinity && distanceInfo.minDistance > 0) {
          const distanceMm = distanceInfo.minDistance / PX_PER_MM;

          if (debugLog) {
            console.log(`      Measured min distance: ${distanceMm.toFixed(3)}mm (${distanceInfo.minDistance.toFixed(2)} units)`);
          }

          // Compute required extra shift for overlap
          // We want to move closer by: distance + desired overlap + small epsilon
          const epsilonUnits = mmToPaperPixels(0.05); // 0.05mm safety margin
          const requiredExtraShift = distanceInfo.minDistance + minOverlapUnits + epsilonUnits;

          // Cap emergency extra to +2.0mm beyond max tighten (increased for script fonts)
          const emergencyCapUnits = mmToPaperPixels(2.0);
          const allowedExtraShift = Math.min(requiredExtraShift, emergencyCapUnits);

          if (allowedExtraShift > 0) {
            const extraShiftMm = allowedExtraShift / PX_PER_MM;

            if (debugLog) {
              console.log(`      Applying emergency nudge: ${extraShiftMm.toFixed(3)}mm`);
            }

            // Apply emergency shift to right glyph and all subsequent glyphs
            for (let j = i + 1; j < glyphItems.length; j++) {
              if (glyphItems[j].item) {
                glyphItems[j].item.position.x -= allowedExtraShift;
              }
            }

            finalShift += allowedExtraShift;

            // Verify the emergency nudge worked
            try {
              const finalInter = left.item.intersect(right.item, { insert: false });

              if (finalInter && finalInter.area > 0.01) {
                const interW = finalInter.bounds.width;
                const interH = finalInter.bounds.height;
                const maxDim = Math.max(interW, interH);

                if (maxDim >= minOverlapUnits) {
                  const totalShiftMm = finalShift / PX_PER_MM;
                  adjustments.push({
                    pair: `${left.char}${right.char}`,
                    shiftMm: totalShiftMm.toFixed(3),
                    status: 'EMERGENCY_NUDGE_SUCCESS'
                  });

                  if (debugLog) {
                    console.log(`      ✓ Emergency nudge SUCCESS! Total shift: ${totalShiftMm.toFixed(3)}mm`);
                  }

                  finalInter.remove();
                } else {
                  const totalShiftMm = finalShift / PX_PER_MM;
                  adjustments.push({
                    pair: `${left.char}${right.char}`,
                    shiftMm: totalShiftMm.toFixed(3),
                    status: 'PARTIAL_SUCCESS'
                  });

                  if (debugLog) {
                    console.warn(`      ⚠ Partial success - overlap improved but still below minimum. Total shift: ${totalShiftMm.toFixed(3)}mm`);
                  }

                  finalInter.remove();
                }
              } else {
                const totalShiftMm = finalShift / PX_PER_MM;
                adjustments.push({
                  pair: `${left.char}${right.char}`,
                  shiftMm: totalShiftMm.toFixed(3),
                  status: 'EMERGENCY_NUDGE_INSUFFICIENT'
                });

                if (debugLog) {
                  console.warn(`      ⚠ Emergency nudge applied but no intersection achieved. Total shift: ${totalShiftMm.toFixed(3)}mm`);
                }

                if (finalInter) finalInter.remove();
              }
            } catch (error) {
              const totalShiftMm = finalShift / PX_PER_MM;
              adjustments.push({
                pair: `${left.char}${right.char}`,
                shiftMm: totalShiftMm.toFixed(3),
                status: 'EMERGENCY_NUDGE_ERROR'
              });

              if (debugLog) {
                console.error(`      ✗ Error verifying emergency nudge:`, error);
              }
            }
          } else {
            const totalShiftMm = finalShift / PX_PER_MM;
            adjustments.push({
              pair: `${left.char}${right.char}`,
              shiftMm: totalShiftMm.toFixed(3),
              status: 'MAX_REACHED'
            });

            if (debugLog) {
              console.warn(`      ⚠ Emergency cap exceeded, no further adjustment. Total shift: ${totalShiftMm.toFixed(3)}mm`);
            }
          }
        } else {
          const totalShiftMm = finalShift / PX_PER_MM;
          adjustments.push({
            pair: `${left.char}${right.char}`,
            shiftMm: totalShiftMm.toFixed(3),
            status: 'MAX_REACHED'
          });

          if (debugLog) {
            console.warn(`      ⚠ Could not measure distance between paths. Total shift: ${totalShiftMm.toFixed(3)}mm`);
          }
        }
      }
    }
  }

  if (debugLog && adjustments.length > 0) {
    console.log(`\n📊 Auto-connect summary:`);
    console.log(`  Total pairs adjusted: ${adjustments.length}`);
    adjustments.forEach(adj => {
      console.log(`    ${adj.pair}: ${adj.shiftMm}mm (${adj.status})`);
    });
  }

  if (debugLog) {
    console.log('🔗 === AUTO-CONNECT COMPLETE ===\n');
  }

  return glyphItems;
}

/**
 * Normalize a Paper.js path for boolean operations.
 * ZERO normalization - preserves EXACT original font geometry.
 * Any manipulation (even tiny segment removal) can cause wobbles.
 */
function normalizePath(path) {
  if (!path) return path;

  if (path instanceof paper.CompoundPath) {
    path.children.forEach(child => {
      if (child instanceof paper.Path) {
        normalizePathInternal(child);
      }
    });
  } else if (path instanceof paper.Path) {
    normalizePathInternal(path);
  }

  return path;
}

/**
 * Internal path normalization for single paths
 */
function normalizePathInternal(path) {
  // COMPLETELY DISABLED - even tiny segment removal causes wobbles
  // Preserve EXACT original font geometry for perfect rendering

  // All normalization disabled:
  // - NO flatten (destroys curves)
  // - NO simplify (removes detail)  
  // - NO tiny segment removal (causes wobbles)
  // - NO winding changes (preserve original)

  // Let Paper.js handle paths as-is from the font
}

/**
 * Normalize CompoundPath winding using containment-based hole classification.
 * 
 * Uses nesting depth to determine if a path is outer/hole/island:
 * - Depth 0 = outer contour (clockwise)
 * - Depth 1 = hole (counter-clockwise)
 * - Depth 2 = island (clockwise)
 * - etc.
 * 
 * CRITICAL: Only call when using fillRule='nonzero' (Sriracha case).
 * For evenodd, winding doesn't matter.
 * 
 * TEST: Sriracha "in", "ci", "cai", "air", "Cain" - i stems visible
 * TEST: Other fonts - counters/holes preserved (not filled)
 * 
 * @param {paper.CompoundPath} compoundPath
 * @returns {paper.CompoundPath}
 */
function normalizeCompoundPathWindingByContainment(compoundPath) {
  if (!compoundPath || !(compoundPath instanceof paper.CompoundPath)) {
    return compoundPath;
  }

  const children = compoundPath.children;
  if (children.length <= 1) return compoundPath;

  // Get a test point inside each child path
  const testPoints = [];
  for (const child of children) {
    let testPoint = child.bounds.center;

    // If center is not inside, sample points along the path
    if (!child.contains(testPoint)) {
      const segments = child.segments;
      for (let i = 0; i < Math.min(10, segments.length); i++) {
        const pt = segments[Math.floor(i * segments.length / 10)].point;
        if (child.contains(pt)) {
          testPoint = pt;
          break;
        }
      }
    }

    testPoints.push(testPoint);
  }

  // Calculate nesting depth for each child
  const depths = [];
  for (let i = 0; i < children.length; i++) {
    let depth = 0;
    const testPoint = testPoints[i];

    for (let j = 0; j < children.length; j++) {
      if (i !== j && children[j].contains(testPoint)) {
        depth++;
      }
    }

    depths.push(depth);
  }

  // Track reversals for debug logging
  const reversed = [];

  // Normalize winding based on depth parity
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const depth = depths[i];

    // Even depth = clockwise (outer/island), Odd depth = counter-clockwise (hole)
    const shouldBeClockwise = (depth % 2 === 0);

    if (child.clockwise !== shouldBeClockwise) {
      child.reverse();
      reversed.push(true);
    } else {
      reversed.push(false);
    }
  }

  // Debug logging
  if (typeof currentSettings !== 'undefined' && currentSettings.debugMode) {
    console.log('Winding normalization by containment:');
    const table = children.map((child, i) => ({
      index: i,
      depth: depths[i],
      shouldBeClockwise: depths[i] % 2 === 0,
      actualClockwise: child.clockwise,
      wasReversed: reversed[i]
    }));
    console.table(table);
  }

  return compoundPath;
}

/**
 * Get the current active font key.
 * @returns {string} - Font key (e.g., 'sriracha', 'pacifico')
 */
function getFontKeyForActiveFont() {
  return activeFontKey || 'pacifico';
}


// Apply Paper.js boolean union operation to merge overlapping paths
// This function takes the text and generates separate paths for each letter,
// then unites them using Paper.js
function applyPaperJsUnion(text, fontSize, letterSpacing, pairSpacingMap = {}) {
  if (!text || !getActiveFont()) {
    return '';
  }

  try {
    // Clear the Paper.js project
    paper.project.clear();

    // Get individual letter paths and glyph bounds
    const { pathData: letterPaths, glyphBounds } = generatePathWithKerning(text, fontSize, letterSpacing, true, pairSpacingMap);

    if (letterPaths.length === 0) {
      console.warn('No letter paths generated');
      const fallback = generatePathWithKerning(text, fontSize, letterSpacing, false, pairSpacingMap);
      return fallback.pathData;
    }

    console.log(`Generated ${letterPaths.length} individual letter paths`);

    // Note: We no longer skip single letters - they still need i-dot connection
    // (removed single-letter bypass that was preventing i/j dots from connecting)

    // Import each letter and extract the actual Path/CompoundPath object
    // Also build glyphItems array with character information for auto-connect
    const pathItems = [];
    const glyphItems = [];

    for (let i = 0; i < letterPaths.length; i++) {
      const svgString = `<svg><path d="${letterPaths[i]}"/></svg>`;
      const imported = paper.project.importSVG(svgString);

      if (!imported) {
        console.warn(`Failed to import letter ${i + 1}`);
        continue;
      }

      // Extract the actual path from the imported item
      let actualPath = null;

      if (imported instanceof paper.Path || imported instanceof paper.CompoundPath) {
        // Already a path
        actualPath = imported;
      } else if (imported instanceof paper.Group && imported.children.length > 0) {
        // It's a group, find the first path child
        for (let child of imported.children) {
          if (child instanceof paper.Path || child instanceof paper.CompoundPath) {
            actualPath = child.clone();
            break;
          }
        }
        imported.remove(); // Remove the group, we cloned what we need
      }

      if (actualPath) {
        pathItems.push(actualPath);

        // Build glyphItems for auto-connect (with character info)
        glyphItems.push({
          char: text[i] || '?',
          index: i,
          item: actualPath
        });

        console.log(`✓ Imported letter ${i + 1} (${text[i]}) as ${actualPath.constructor.name}`);
      } else {
        console.warn(`Could not extract path from letter ${i + 1}`);
      }
    }

    if (pathItems.length === 0) {
      throw new Error('Failed to import any letter paths');
    }

    console.log(`Successfully extracted ${pathItems.length} path objects`);

    // CRITICAL: Connect i-dots FIRST (before auto-connect)
    // This prevents auto-connect from seeing false overlaps from i-dots that will be moved
    if (currentSettings.connectIDots) {
      console.log('🔵 Attempting per-glyph i-dot connection...');

      // Run i-dot connection on glyphItems (character-aware processing)
      connectIDotsPerGlyph(glyphItems, {
        enabled: true,
        overlapMm: currentSettings.iDotOverlap,
        maxShiftMm: currentSettings.iDotMaxShift,
        searchRadiusMm: currentSettings.iDotSearchRadius
      });

      console.log(`After i-dot connection: ${pathItems.length} paths ready for auto-connect`);
    }

    // Apply auto-connect AFTER i-dot connection (uses post-shift geometry)
    if (currentSettings.autoConnect) {
      console.log('🔗 Auto-connect enabled: checking adjacent letter overlaps...');
      applyAutoConnect(glyphItems, {
        minOverlapMm: currentSettings.autoConnectMinOverlap,
        maxTightenMm: currentSettings.autoConnectMaxTighten,
      });
    }

    // === NORMALIZE ALL PATHS BEFORE BOOLEAN OPERATIONS ===
    console.log(`Normalizing ${pathItems.length} paths before union...`);

    // Use default nonzero fillRule for correct font rendering

    const normalizedPaths = [];
    for (let i = 0; i < pathItems.length; i++) {
      try {
        const normalized = normalizePath(pathItems[i].clone());

        // Preserve default nonzero fillRule from font

        normalizedPaths.push(normalized);
        pathItems[i].remove();

        if (currentSettings.debugMode) {
          console.log(`  ✓ Normalized path ${i + 1}/${pathItems.length} (fillRule=evenodd)`);
        }
      } catch (err) {
        console.error(`Error normalizing path ${i + 1}:`, err);
        // Keep original if normalization fails
        // Keep original on normalization failure
        normalizedPaths.push(pathItems[i]);
      }
    }

    console.log(`✓ Normalized ${normalizedPaths.length} paths`);

    // === PERFORM ONE GLOBAL UNION ===
    console.log(`Starting global union of ${normalizedPaths.length} paths...`);

    let result = normalizedPaths[0];

    for (let i = 1; i < normalizedPaths.length; i++) {
      try {
        console.log(`  Uniting path ${i + 1}/${normalizedPaths.length}...`);

        // Preserve nonzero fillRule during unite

        const newResult = result.unite(normalizedPaths[i]);

        if (!newResult) {
          console.error(`Unite operation for path ${i + 1} returned null!`);
          console.warn(`⚠️ Keeping both shapes separately`);
          continue;
        }

        // Clean up
        if (result !== normalizedPaths[0]) {
          result.remove();
        }
        normalizedPaths[i].remove();

        result = newResult;

      } catch (uniteError) {
        console.error(`Error uniting path ${i + 1}:`, uniteError);
        // Continue with next path
      }
    }

    // === VALIDATE GEOMETRY ===
    if (result.children && result.children.length > 1) {
      console.warn(`⚠️ Geometry fragmentation detected: ${result.children.length} separate components`);
      if (currentSettings.debugMode) {
        result.children.forEach((child, i) => {
          console.log(`  Component ${i + 1}: ${child.constructor.name}, area=${Math.abs(child.area).toFixed(2)}`);
        });
      }
    }

    // Preserve nonzero fillRule for export
    result.fillRule = 'nonzero';

    console.log(`✓ Global union complete`);

    // After uniting all text, attach loops if enabled
    if (currentSettings.addLoops) {
      console.log('');
      console.log('═══════════════════════════════════════════════════════');
      console.log('  ATTACHING LOOPS TO TEXT USING GEOMETRY SAMPLING');
      console.log('═══════════════════════════════════════════════════════');
      console.log('');

      result = attachLoopsToEnds(result, {
        innerDiameterMm: currentSettings.loopInnerDiameter,
        outerDiameterMm: currentSettings.loopOuterDiameter,
        offsetFromTextMm: currentSettings.loopOffset,
        loopOverlapMm: currentSettings.loopOverlap || 0.4,
        glyphBounds: glyphBounds  // Pass glyph bounds for anchor region filtering
      }, currentSettings.debugMode);

      console.log('');
      console.log('═══════════════════════════════════════════════════════');
      console.log('');
    }

    // Clean up debug visualization items before export (don't include in final SVG)
    const debugItems = paper.project.activeLayer.children.filter(item =>
      item.name && item.name.startsWith('debug')
    );
    for (const item of debugItems) {
      item.remove();
    }

    // Apply strengthen offset if enabled
    if (currentSettings.strengthenOffset) {
      console.log('');
      console.log('═══════════════════════════════════════════════════════');
      console.log(`  APPLYING STRENGTHEN OFFSET (+${currentSettings.strengthenAmount}mm)`);
      console.log('═══════════════════════════════════════════════════════');

      result = applyStrengthenOffset(result, currentSettings.strengthenAmount, currentSettings.debugMode);
      console.log('═══════════════════════════════════════════════════════');
      console.log('');
    }

    // Ensure nonzero fillRule before export
    result.fillRule = 'nonzero';

    // Export the unified path back to SVG path data
    console.log(`Exporting result (${result.constructor.name})...`);

    const exportedSVG = result.exportSVG({ asString: false });
    console.log('Exported SVG:', exportedSVG);

    if (exportedSVG) {
      let unifiedPathData = null;

      // Try to get the 'd' attribute
      if (exportedSVG.getAttribute) {
        unifiedPathData = exportedSVG.getAttribute('d');
      }

      // If it's a path element directly
      if (!unifiedPathData && exportedSVG.tagName === 'path') {
        unifiedPathData = exportedSVG.getAttribute('d');
      }

      // If it's a group, look for path children
      if (!unifiedPathData && exportedSVG.tagName === 'g') {
        const pathElements = exportedSVG.getElementsByTagName('path');
        if (pathElements && pathElements.length > 0) {
          // Combine all path data
          const pathDataArray = [];
          for (let i = 0; i < pathElements.length; i++) {
            const d = pathElements[i].getAttribute('d');
            if (d) pathDataArray.push(d);
          }
          unifiedPathData = pathDataArray.join(' ');
        }
      }

      if (unifiedPathData) {
        console.log('✓ Successfully unified all letter paths into single shape');
        return unifiedPathData;
      }
    }

    console.error('Could not extract path data from unified result');
    console.warn('Returning combined original path (non-welded)');
    const fallback1 = generatePathWithKerning(text, fontSize, letterSpacing, false, pairSpacingMap);
    return fallback1.pathData;

  } catch (error) {
    console.error('Paper.js union error:', error);
    console.error('Error stack:', error.stack);
    // Return original combined path data on error
    console.warn('Falling back to original combined path data due to error');
    const fallback2 = generatePathWithKerning(text, fontSize, letterSpacing, false, pairSpacingMap);
    return fallback2.pathData;
  }
}

// Initialize - disable input until font loads
nameInput.disabled = true;
downloadBtn.disabled = true;

// ============================================
// DEVELOPER MODE: Toggle Expert section with Ctrl + Shift + X
// ============================================
const EXPERT_STORAGE_KEY = 'showExpert';
const expertSection = document.getElementById('expertSection');

// Check localStorage and apply initial visibility
function initExpertVisibility() {
  const showExpert = localStorage.getItem(EXPERT_STORAGE_KEY);
  if (showExpert === '1') {
    expertSection.classList.remove('dev-only-hidden');
    console.log('🔓 Expert mode: ENABLED');
  } else {
    expertSection.classList.add('dev-only-hidden');
  }
}

// Toggle expert section visibility
function toggleExpertMode() {
  const isCurrentlyHidden = expertSection.classList.contains('dev-only-hidden');

  if (isCurrentlyHidden) {
    // Show expert section
    expertSection.classList.remove('dev-only-hidden');
    localStorage.setItem(EXPERT_STORAGE_KEY, '1');
    console.log('🔓 Expert mode ENABLED');
  } else {
    // Hide expert section
    expertSection.classList.add('dev-only-hidden');
    localStorage.removeItem(EXPERT_STORAGE_KEY);
    console.log('🔒 Expert mode DISABLED');
  }
}

// Keyboard shortcut listener: Ctrl + Shift + X
document.addEventListener('keydown', (event) => {
  // Skip if user is typing in an input or textarea
  const target = event.target;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return;
  }

  // Detect Ctrl + Shift + X
  if (event.ctrlKey && event.shiftKey && (event.key === 'X' || event.key === 'x')) {
    event.preventDefault();
    toggleExpertMode();
  }
});

// Initialize expert visibility on page load
initExpertVisibility();

// Load the font when page loads
loadFont();
