/**
 * fontStorage.js — IndexedDB persistence for custom fonts
 *
 * Stores raw font ArrayBuffers keyed per Supabase user ID.
 * Guests never call these functions — their fonts are session-only by design.
 */

const DB_NAME = 'necklace_fonts_v1';
const STORE_NAME = 'custom_fonts';
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Save a font buffer for a logged-in user.
 * @param {string}      userId   - Supabase user UUID
 * @param {string}      fontId   - Internal key, e.g. 'custom:1'
 * @param {string}      fontName - Display name shown in the selector
 * @param {ArrayBuffer} buffer   - Raw TTF/OTF file bytes
 */
export async function persistFont(userId, fontId, fontName, buffer) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
            id: `${userId}::${fontId}`,
            userId,
            fontId,
            fontName,
            buffer,
            savedAt: Date.now(),
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = (e) => { db.close(); reject(e.target.error); };
    });
}

/**
 * Load all persisted fonts for a user, ordered by upload time.
 * @param {string} userId
 * @returns {Promise<Array<{fontId, fontName, buffer, savedAt}>>}
 */
export async function getPersistedFonts(userId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => {
            db.close();
            const records = req.result
                .filter(r => r.userId === userId)
                .sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0));
            resolve(records);
        };
        req.onerror = (e) => { db.close(); reject(e.target.error); };
    });
}
