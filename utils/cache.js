class Cache {
  constructor(ttl = 300000) { // 5 minutes default TTL
    this.cache = new Map();
    this.ttl = ttl;
  }

  async get(key, fetchFn) {
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && (now - cached.timestamp < this.ttl)) {
      return cached.data;
    }

    const data = await fetchFn();
    this.cache.set(key, {
      data,
      timestamp: now
    });

    return data;
  }

  // Optional: Add method to manually clear cache
  clear() {
    this.cache.clear();
  }

  // Optional: Add method to remove specific key
  delete(key) {
    return this.cache.delete(key);
  }

  // Optional: Add method to get cache stats
  getStats() {
    return {
      size: this.cache.size,
      ttl: this.ttl
    };
  }
}

module.exports = new Cache();
