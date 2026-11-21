/**
 * @module urlFetcher
 * @description A utility module for making HTTP requests with caching, retries, and rate limiting.
 * Uses the Aexis module for HTTP requests.
 */

const aexis = require('./aexis');

// For backward compatibility with existing code
const debug = aexis.config.debug;

/**
 * Fetches JSON data from a URL with caching support
 * @param {string} url - The URL to fetch JSON from
 * @param {string} [path] - Optional dot-notation path to extract from the JSON response
 * @returns {Promise<Object|string|number|boolean|Array|null>} The parsed JSON data, or null if the request fails
 * @example
 * // Get entire JSON response
 * const data = await fetchJson('https://api.example.com/data');
 * 
 * // Get nested property
 * const name = await fetchJson('https://api.example.com/user/123', 'user.profile.name');
 */
async function fetchJson(url, path) {
    try {
        const data = await aexis.fetchJson(url);
        
        // If a path is provided, extract the nested property
        if (path) {
            return getJsonValue(data, path);
        }
        
        return data;
    } catch (error) {
        if (debug) {
            console.error(`Error fetching JSON from ${url}:`, error.message);
        }
        return null;
    }
}

/**
 * Fetches text content from a URL with caching support
 * @param {string} url - The URL to fetch text content from
 * @returns {Promise<string|null>} The text content, or null if the request fails
 * @example
 * const content = await fetchText('https://example.com/some-text.txt');
 */
async function fetchText(url) {
    try {
        return await aexis.fetchText(url);
    } catch (error) {
        if (debug) {
            console.error(`Error fetching text from ${url}:`, error.message);
        }
        return null;
    }
}

/**
 * Safely gets a nested property from an object using dot notation
 * @param {Object} obj - The object to get the value from
 * @param {string} [path] - The dot-notation path to the property (e.g., 'user.profile.name')
 * @returns {*} The value at the specified path, or undefined if not found
 * @example
 * const obj = { user: { profile: { name: 'John' } }};
 * getJsonValue(obj, 'user.profile.name'); // Returns 'John'
 */
function getJsonValue(obj, path) {
    if (!obj || typeof obj !== 'object') return undefined;
    if (!path) return obj;
    
    return path.split('.').reduce((current, key) => {
        return (current && current[key] !== undefined) ? current[key] : undefined;
    }, obj);
}

module.exports = {
    fetchJson,
    fetchText,
    getJsonValue
};