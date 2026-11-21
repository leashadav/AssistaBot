class RequestBatcher {
  constructor(batchTime = 100) {
    this.batchTime = batchTime;
    this.queue = new Map();
    this.isProcessing = false;
  }

  async enqueue(requestFn, key) {
    if (!this.queue.has(key)) {
      this.queue.set(key, []);
    }
    
    return new Promise((resolve) => {
      this.queue.get(key).push({ requestFn, resolve });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.size > 0) {
      const [key, requests] = this.queue.entries().next().value;
      this.queue.delete(key);

      try {
        const results = await Promise.all(
          requests.map(({ requestFn }) => requestFn())
        );
        results.forEach((result, i) => {
          requests[i].resolve(result);
        });
      } catch (error) {
        console.error('Batch request error:', error);
        requests.forEach(({ resolve }) => resolve(null));
      }

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, this.batchTime));
    }

    this.isProcessing = false;
  }
}

module.exports = new RequestBatcher();
