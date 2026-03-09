/**
 * exportSTL.js
 * Client-side STL export for the Name Necklace Generator.
 *
 * Takes the final welded SVG path data, extrudes it to 1.5 mm depth
 * using Three.js ExtrudeGeometry, and triggers an STL download.
 *
 * Unit convention: the SVG path coordinates are in the same "font px"
 * space used throughout the app. The SVG exported for laser cutting maps
 * those px to physical mm via:
 *   physicalMm = px * (targetHeightMm / pathBboxHeightPx)
 * We apply that same scale here so that the STL dimensions match
 * the configured pendant size in millimetres.
 */

import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

const EXTRUDE_DEPTH_MM = 1.5;

/**
 * Export the current name-necklace design as an ASCII STL file.
 *
 * @param {string} pathData      - The SVG path `d` attribute (final welded geometry)
 * @param {number} targetHeightMm - Physical pendant height in mm (from the UI setting)
 * @param {string} [filename]    - Filename for the download
 */
export function exportSTLFromPath(pathData, targetHeightMm = 15, filename = 'necklace.stl') {
    // ── Guards ────────────────────────────────────────────────────────────────
    if (!pathData || pathData.trim().length === 0) {
        console.error('[STL] No path data available — generate a design first.');
        alert('Please generate a design before exporting STL.');
        return;
    }

    try {
        // ── 1. Parse the SVG path with Three.js SVGLoader ─────────────────────
        const loader = new SVGLoader();
        const svgString = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${pathData}" /></svg>`;
        const svgData = loader.parse(svgString);

        if (!svgData.paths || svgData.paths.length === 0) {
            throw new Error('SVGLoader returned no paths.');
        }

        // ── 2. Convert SVG paths → Three.js Shapes ───────────────────────────
        const shapes = [];
        for (const svgPath of svgData.paths) {
            const extracted = SVGLoader.createShapes(svgPath);
            shapes.push(...extracted);
        }

        if (shapes.length === 0) {
            throw new Error('No shapes could be extracted from the SVG path.');
        }

        console.log(`[STL] Extracted ${shapes.length} shape(s) from SVG path.`);

        // ── 3. Measure path bounding box so we can scale to physical mm ───────
        // Build a temporary geometry from the shapes at unit scale to measure bounds.
        const tempGeo = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
        tempGeo.computeBoundingBox();
        const bbox = tempGeo.boundingBox;
        const pathHeightPx = bbox.max.y - bbox.min.y;  // Y extent in font-px space
        tempGeo.dispose();

        if (!isFinite(pathHeightPx) || pathHeightPx === 0) {
            throw new Error('Could not determine path bounding box height.');
        }

        // Scale factor: font-px → physical mm
        // physicalMm = px × (targetHeightMm / pathHeightPx)
        const scaleFactor = targetHeightMm / pathHeightPx;
        const extrudeDepthPx = EXTRUDE_DEPTH_MM / scaleFactor; // depth in px-space so it comes out 1.5 mm

        console.log(`[STL] Path height: ${pathHeightPx.toFixed(2)} font-px`);
        console.log(`[STL] Scale factor: ${scaleFactor.toFixed(6)} (px → mm)`);
        console.log(`[STL] Extrude depth in px-space: ${extrudeDepthPx.toFixed(4)} → ${EXTRUDE_DEPTH_MM} mm`);

        // ── 4. Build the final extruded geometry ─────────────────────────────
        const geometry = new THREE.ExtrudeGeometry(shapes, {
            depth: extrudeDepthPx,
            bevelEnabled: false
        });

        // Apply uniform scale so output coordinates are in millimetres.
        // SVG Y-axis points downward; Three.js Y-axis points upward — flip Y so
        // the model faces the correct direction in slicer/CAD tools.
        geometry.applyMatrix4(
            new THREE.Matrix4().makeScale(scaleFactor, -scaleFactor, scaleFactor)
        );

        // Centre the model at the origin on X and Y (standard for slicer import)
        geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        geometry.boundingBox.getCenter(center);
        geometry.translate(-center.x, -center.y, 0); // keep Z base at 0

        // ── 5. Export to STL ─────────────────────────────────────────────────
        const mesh = new THREE.Mesh(geometry);
        const exporter = new STLExporter();
        const stlString = exporter.parse(mesh, { binary: false });

        console.log(`[STL] STL generated. Length: ${stlString.length} chars.`);

        // ── 6. Trigger download ──────────────────────────────────────────────
        const blob = new Blob([stlString], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        console.log(`[STL] ✓ Downloaded: ${filename}`);

    } catch (err) {
        console.error('[STL] Export failed:', err);
        alert(`STL export failed: ${err.message}`);
    }
}
