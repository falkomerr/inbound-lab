/**
 * Request Builder Module for k6
 * Provides fluent interface for building HTTP requests
 * @module requestBuilder
 */

import http from 'k6/http';
import { sleep } from 'k6';
import { config } from '../config/config.js';

/**
 * Rate limiter state
 * Tracks request timestamps for rate limiting
 */
class RateLimiter {
  constructor(maxRequestsPerSecond) {
    this.maxRPS = maxRequestsPerSecond;
    this.requests = [];
  }

  /**
   * Wait if necessary to respect rate limit
   */
  async waitIfNeeded() {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Remove requests older than 1 second
    this.requests = this.requests.filter((timestamp) => timestamp > oneSecondAgo);

    // If we've hit the rate limit, wait
    if (this.requests.length >= this.maxRPS) {
      const oldestRequest = this.requests[0];
      const waitTime = (oldestRequest + 1000 - now) / 1000;
      if (waitTime > 0) {
        sleep(waitTime);
      }
      // Clear old requests after waiting
      this.requests = this.requests.filter((timestamp) => timestamp > Date.now() - 1000);
    }

    // Record this request
    this.requests.push(Date.now());
  }
}

// Global rate limiter instance
let rateLimiter = null;
if (config.RATE_LIMIT_ENABLED) {
  rateLimiter = new RateLimiter(config.RATE_LIMIT_RPS);
}

/**
 * Request Builder Class
 * Provides fluent interface for building and sending HTTP requests
 * @class RequestBuilder
 */
export class RequestBuilder {
  /**
   * Creates a new RequestBuilder instance
   * @param {string} [baseUrl=config.BASE_URL] - Base URL for requests
   */
  constructor(baseUrl = config.BASE_URL) {
    this.baseUrl = baseUrl;
    this.path = '';
    this.method = 'GET';
    this.headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    this.body = null;
    this.params = {};
    this.tags = {};
    this.timeout = config.API_TIMEOUT;
  }

  /**
   * Sets the HTTP method
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE, etc.)
   * @returns {RequestBuilder} this instance for chaining
   */
  setMethod(method) {
    this.method = method.toUpperCase();
    return this;
  }

  /**
   * Sets the API endpoint path
   * @param {string} path - API endpoint path
   * @returns {RequestBuilder} this instance for chaining
   */
  setPath(path) {
    this.path = path;
    return this;
  }

  /**
   * Sets the request body
   * @param {Object|string} body - Request body object or JSON string
   * @returns {RequestBuilder} this instance for chaining
   */
  setBody(body) {
    this.body = typeof body === 'string' ? body : JSON.stringify(body);
    return this;
  }

  /**
   * Sets request headers
   * @param {Object} headers - Headers object
   * @returns {RequestBuilder} this instance for chaining
   */
  setHeaders(headers) {
    this.headers = { ...this.headers, ...headers };
    return this;
  }

  /**
   * Sets the authentication token
   * @param {string} token - JWT token
   * @returns {RequestBuilder} this instance for chaining
   */
  setToken(token) {
    if (token) {
      this.setHeaders({
        Authorization: `Bearer ${token}`,
      });
    }
    return this;
  }

  /**
   * Sets query parameters
   * @param {Object} params - Query parameters object
   * @returns {RequestBuilder} this instance for chaining
   */
  setQuery(params) {
    this.params = { ...this.params, ...params };
    return this;
  }

  /**
   * Sets request tags for metrics
   * @param {Object} tags - Tags object
   * @returns {RequestBuilder} this instance for chaining
   */
  setTags(tags) {
    this.tags = { ...this.tags, ...tags };
    return this;
  }

  /**
   * Sets request timeout
   * @param {number} timeout - Timeout in milliseconds
   * @returns {RequestBuilder} this instance for chaining
   */
  setTimeout(timeout) {
    this.timeout = timeout;
    return this;
  }

  /**
   * Builds the full URL
   * @returns {string} Full URL
   */
  buildUrl() {
    const url = `${this.baseUrl}${this.path}`;
    if (Object.keys(this.params).length > 0) {
      const queryString = new URLSearchParams(this.params).toString();
      return `${url}?${queryString}`;
    }
    return url;
  }

  /**
   * Sends the constructed request
   * @param {Object} [options] - Additional request options
   * @returns {Object} HTTP response object
   */
  send(customOptions = {}) {
    // Apply rate limiting if enabled
    if (rateLimiter) {
      rateLimiter.waitIfNeeded();
    }

    const url = this.buildUrl();
    const requestOptions = {
      headers: this.headers,
      tags: { ...config.TAGS, ...this.tags, method: this.method },
      timeout: `${this.timeout}ms`,
      ...customOptions,
    };

    // Add HTTP/2 support if available
    if (config.ENABLE_HTTP2) {
      requestOptions.http2 = true;
    }

    let response;
    try {
      switch (this.method) {
        case 'GET':
          response = http.get(url, requestOptions);
          break;
        case 'POST':
          response = http.post(url, this.body, requestOptions);
          break;
        case 'PUT':
          response = http.put(url, this.body, requestOptions);
          break;
        case 'PATCH':
          response = http.patch(url, this.body, requestOptions);
          break;
        case 'DELETE':
          response = http.del(url, null, requestOptions);
          break;
        default:
          throw new Error(`Unsupported HTTP method: ${this.method}`);
      }
    } catch (error) {
      console.error(`❌ Request failed: ${error.message}`);
      console.error(`   URL: ${url}`);
      console.error(`   Method: ${this.method}`);
      throw error;
    }

    return response;
  }

  /**
   * Sends request with retry logic
   * @param {number} [maxRetries=config.RETRY_ATTEMPTS] - Maximum retry attempts
   * @returns {Object} HTTP response object
   */
  sendWithRetry(maxRetries = config.RETRY_ATTEMPTS) {
    let lastResponse = null;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        lastResponse = this.send();

        // Check if response is successful
        if (lastResponse.status >= 200 && lastResponse.status < 300) {
          return lastResponse;
        }

        // Retry on server errors (5xx)
        if (lastResponse.status >= 500 && attempt < maxRetries) {
          const waitTime = config.RETRY_DELAY * (attempt + 1); // Exponential backoff
          sleep(waitTime / 1000); // k6 sleep uses seconds
          continue;
        }

        // Don't retry on client errors (4xx)
        return lastResponse;
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          const waitTime = config.RETRY_DELAY * (attempt + 1);
          sleep(waitTime / 1000);
          continue;
        }
        throw error;
      }
    }

    return lastResponse || { status: 0, error: lastError?.message || 'Request failed' };
  }
}

/**
 * Creates an authenticated request builder
 * @param {string} token - Authentication token
 * @returns {RequestBuilder} Authenticated request builder
 */
export function createAuthenticatedRequest(token) {
  return new RequestBuilder().setToken(token);
}

/**
 * Creates a login request
 * @param {string} phone - Phone number
 * @returns {RequestBuilder} Login request builder
 */
export function createLoginRequest(phone) {
  return new RequestBuilder()
    .setMethod('POST')
    .setPath('/auth/login')
    .setBody({ phone })
    .setTags({ endpoint: 'login', operation: 'authentication' });
}

/**
 * Creates a verify OTP request
 * @param {string} phone - Phone number
 * @param {string} otp - OTP code
 * @returns {RequestBuilder} Verify OTP request builder
 */
export function createVerifyOtpRequest(phone, otp) {
  return new RequestBuilder()
    .setMethod('POST')
    .setPath('/auth/verify')
    .setBody({ phone, otp })
    .setTags({ endpoint: 'verify', operation: 'authentication' });
}

/**
 * Creates a get cart request
 * @param {string} token - Authentication token
 * @returns {RequestBuilder} Get cart request builder
 */
export function createGetCartRequest(token) {
  return createAuthenticatedRequest(token)
    .setMethod('GET')
    .setPath('/cart')
    .setTags({ endpoint: 'cart', operation: 'read' });
}

/**
 * Creates an add to cart request
 * @param {string} token - Authentication token
 * @param {Object} productData - Product data
 * @returns {RequestBuilder} Add to cart request builder
 */
export function createAddToCartRequest(token, productData) {
  return createAuthenticatedRequest(token)
    .setMethod('POST')
    .setPath(`/cart/add/${productData.product_id}`)
    .setBody({
      quantity: productData.quantity,
      selected_configurable_option: productData.configurable_option,
      product_id: productData.product_id,
    })
    .setTags({ endpoint: 'cart', operation: 'add' });
}

export default RequestBuilder;
