/**
 * Robust rate limiter for GoPlus API calls
 * Manages 30 calls per minute limit with proactive throttling
 */
export class RateLimiter {
  constructor(maxCalls = 30, windowMs = 60000) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
    this.calls = [];
    this.isThrottled = false;
    this.throttleEndTime = 0;
    this.queue = [];
    this.processing = false;
  }

  /**
   * Check if we can make a call right now
   * @returns {boolean}
   */
  canMakeCall() {
    const now = Date.now();

    // Check if we're currently throttled due to 429 error
    if (this.isThrottled && now < this.throttleEndTime) {
      return false;
    }

    // Clear throttle if time has passed
    if (this.isThrottled && now >= this.throttleEndTime) {
      this.isThrottled = false;
      this.throttleEndTime = 0;
    }

    // Remove calls outside the current window
    this.calls = this.calls.filter(
      (callTime) => now - callTime < this.windowMs
    );

    // Check if we're under the limit
    return this.calls.length < this.maxCalls;
  }

  /**
   * Record a successful API call
   */
  recordCall() {
    this.calls.push(Date.now());
  }

  /**
   * Handle a 429 rate limit error
   * @param {number} retryAfter - Seconds to wait (optional)
   */
  handleRateLimit(retryAfter = 60) {
    const now = Date.now();
    this.isThrottled = true;
    this.throttleEndTime = now + retryAfter * 1000;
    console.log(
      `Rate limited. Throttled until ${new Date(
        this.throttleEndTime
      ).toISOString()}`
    );
  }

  /**
   * Get time until next available call slot
   * @returns {number} Milliseconds to wait
   */
  getWaitTime() {
    const now = Date.now();

    // If throttled, return time until throttle ends
    if (this.isThrottled) {
      return Math.max(0, this.throttleEndTime - now);
    }

    // If we're at capacity, return time until oldest call expires
    if (this.calls.length >= this.maxCalls) {
      const oldestCall = Math.min(...this.calls);
      return Math.max(0, this.windowMs - (now - oldestCall));
    }

    return 0;
  }

  /**
   * Execute an API call with rate limiting
   * @param {Function} apiCall - The API function to call
   * @param {...any} args - Arguments to pass to the API function
   * @returns {Promise} Result of the API call
   */
  async executeWithRateLimit(apiCall, ...args) {
    return new Promise((resolve, reject) => {
      // Add to queue
      this.queue.push({ apiCall, args, resolve, reject });

      // Process queue if not already processing
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the queue of API calls
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const waitTime = this.getWaitTime();

      if (waitTime > 0) {
        console.log(`Rate limiter waiting ${waitTime}ms before next call`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      if (!this.canMakeCall()) {
        // Double-check after waiting
        continue;
      }

      const { apiCall, args, resolve, reject } = this.queue.shift();

      try {
        this.recordCall();
        const result = await apiCall(...args);
        resolve(result);
      } catch (error) {
        reject(error);
      }

      // Small delay between calls to avoid overwhelming the API
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.processing = false;
  }

  /**
   * Get current rate limiter status
   * @returns {Object} Status information
   */
  getStatus() {
    const now = Date.now();
    const recentCalls = this.calls.filter(
      (callTime) => now - callTime < this.windowMs
    );

    return {
      callsInWindow: recentCalls.length,
      maxCalls: this.maxCalls,
      isThrottled: this.isThrottled,
      throttleEndTime: this.throttleEndTime,
      queueLength: this.queue.length,
      canMakeCall: this.canMakeCall(),
      waitTime: this.getWaitTime(),
      nextAvailableSlot: now + this.getWaitTime(),
    };
  }

  /**
   * Clear all rate limiting state (use with caution)
   */
  reset() {
    this.calls = [];
    this.isThrottled = false;
    this.throttleEndTime = 0;
    this.queue = [];
    this.processing = false;
  }
}
