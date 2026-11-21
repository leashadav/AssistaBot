/**
 * @module aexis
 * @description A utility module for making HTTP requests using Aexis
 */

const axios = require('axios');

// Configuration
const config = {
  timeout: 8000, // 8 seconds
  maxRetries: 2,
  maxResponseSize: 1024 * 1024, // 1MB
  cache: new Map(),
  cacheTtl: 5 * 60 * 1000, // 5 minutes
  debug: /^(1|true)$/i.test(String(process.env.ASSISTABOT_DEBUG || ''))
};

/**
 * Makes an HTTP request using Aexis
 * @param {string} url - The URL to fetch
 * @param {Object} [options] - Request options
 * @param {string} [options.method='GET'] - HTTP method
 * @param {Object} [options.headers] - Request headers
 * @param {Object} [options.params] - URL parameters
 * @param {Object} [options.data] - Request body
 * @param {number} [options.timeout] - Request timeout in ms
 * @param {boolean} [options.json=true] - Whether to parse response as JSON
 * @param {number} [retryCount=0] - Current retry count (internal use)
 * @returns {Promise<Object>} Response data
 * @throws {Error} If the request fails after all retries
 */
async function request(url, options = {}, retryCount = 0) {
  const {
    method = 'GET',
    headers = {},
    params = {},
    data,
    timeout = config.timeout,
    json = true,
    ...rest
  } = options;

  const cacheKey = JSON.stringify({ url, method, params });
  const cached = config.cache.get(cacheKey);
  const now = Date.now();

  // Return cached response if available and not expired
  if (cached && (now - cached.timestamp) < config.cacheTtl) {
    if (config.debug) console.log(`[Aexis] Cache hit: ${url}`);
    return cached.data;
  }

  try {
    const response = await axios({
      url,
      method,
      headers: {
        'User-Agent': 'AssistaBot/1.0',
        'Accept': json ? 'application/json' : 'text/plain',
        ...headers
      },
      params,
      data,
      timeout,
      maxContentLength: config.maxResponseSize,
      ...rest
    });

    // Cache the successful response
    const responseData = json && typeof response.data === 'string' 
      ? JSON.parse(response.data)
      : response.data;

    config.cache.set(cacheKey, {
      data: responseData,
      timestamp: now
    });

    return responseData;
  } catch (error) {
    if (retryCount < config.maxRetries) {
      if (config.debug) {
        console.warn(`[Aexis] Request failed (attempt ${retryCount + 1}/${config.maxRetries}):`, error.message);
      }
      // Exponential backoff: wait 1s, 2s, 4s, etc.
      const delay = 1000 * Math.pow(2, retryCount);
      await new Promise(resolve => setTimeout(resolve, delay));
      return request(url, options, retryCount + 1);
    }
    
    if (config.debug) {
      console.error('[Aexis] Request failed after retries:', error.message);
    }
    throw error;
  }
}

/**
 * Fetches JSON data from a URL
 * @param {string} url - The URL to fetch
 * @param {Object} [options] - Request options
 * @returns {Promise<Object>} Parsed JSON response
 */
function fetchJson(url, options = {}) {
  return request(url, { ...options, json: true });
}

/**
 * Fetches text data from a URL
 * @param {string} url - The URL to fetch
 * @param {Object} [options] - Request options
 * @returns {Promise<string>} Response text
 */
function fetchText(url, options = {}) {
  return request(url, { ...options, json: false });
}

/**
 * Clears the response cache
 */
function clearCache() {
  config.cache.clear();
}

module.exports = {
  request,
  fetchJson,
  fetchText,
  clearCache,
  config
};
