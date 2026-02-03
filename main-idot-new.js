// ============================================
// PER-GLYPH I-DOT CONNECTION
// ============================================

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
        console.log('🔵 Starting per-glyph i-dot connection...');
        console.log('Options:', { overlapMm, maxShiftMm, searchRadiusMm });
    }

    // Convert mm to Paper.js units
    const overlapPx = mmToPaperUnits(overlapMm);
    const maxShiftPx = mmToPaperUnits(maxShiftMm);
    const searchRadiusPx = mmToPaperUnits(searchRadiusMm);

    let totalDotsConnected = 0;
    let totalBridgesUsed = 0;

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

        // Find dot candidates: in top 60% of glyph AND < 30% of stem area
        const top60Y = glyphBounds.top + glyphBounds.height * 0.6;
        const dotCandidates = [];

        for (const path of subPaths) {
            if (path === stem) continue;

            const pathArea = Math.abs(path.area);
            const areaRatio = pathArea / maxArea;
            const isInTopRegion = path.bounds.center.y < top60Y;
            const isSmallEnough = areaRatio < 0.30;

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

        if (debug) {
            console.log(`  ✓ Dot found: area=${Math.abs(dot.area).toFixed(2)}, top=${dot.bounds.top.toFixed(2)}`);
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

        // If gap + overlap <= maxShift, translate the dot
        const requiredShift = gap + overlapPx;

        if (requiredShift <= maxShiftPx) {
            // Translate dot downward
            dot.translate(new paper.Point(0, requiredShift));

            if (debug) {
                console.log(`  📐 Translated dot down by ${requiredShift.toFixed(2)}px (${(requiredShift / PX_PER_MM).toFixed(2)}mm)`);
            }

            // Verify intersection
            if (dot.intersects(stem)) {
                if (debug) {
                    console.log(`  ✓ Dot now intersects stem`);
                }
                totalDotsConnected++;
            } else {
                console.warn(`  ⚠️ Dot still doesn't intersect after shift`);
            }
        } else {
            // Gap too large - create connector bridge
            if (debug) {
                console.log(`  🔧 Gap too large (${requiredShift.toFixed(2)}px > ${maxShiftPx.toFixed(2)}px), creating connector bridge...`);
            }

            try {
                const bridge = createConnectorBridge(dot, stem, overlapPx);

                if (bridge) {
                    // Add bridge to the glyph item
                    if (item instanceof paper.CompoundPath) {
                        item.addChild(bridge);
                    } else if (item instanceof paper.Group) {
                        item.addChild(bridge);
                    } else {
                        // Convert to CompoundPath to add bridge
                        const temp = new paper.CompoundPath({
                            children: [item.clone(), bridge],
                            fillRule: 'evenodd'
                        });
                        item.replaceWith(temp);
                        glyphItem.item = temp;
                    }

                    totalBridgesUsed++;
                    totalDotsConnected++;

                    if (debug) {
                        console.log(`  ✓ Connector bridge created and added`);
                    }
                }
            } catch (error) {
                console.error(`  ✗ Bridge creation failed:`, error.message);
            }
        }
    }

    if (debug) {
        console.log(`\n✅ Total dots connected: ${totalDotsConnected}`);
        console.log(`🔧 Connector bridges used: ${totalBridgesUsed}`);
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
