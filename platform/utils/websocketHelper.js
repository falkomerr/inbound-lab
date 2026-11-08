/**
 * WebSocket Helper Module
 * Provides WebSocket testing utilities for real-time applications
 * @module websocketHelper
 */

import ws from 'k6/ws';
import { check } from 'k6';
import { config } from '../config/config.js';
import { trackError, trackOperation } from './metrics.js';

/**
 * WebSocket connection options
 * @typedef {Object} WebSocketOptions
 * @property {number} timeout - Connection timeout in milliseconds
 * @property {Object} headers - Additional headers
 * @property {Object} tags - Tags for metrics
 */

/**
 * Connect to WebSocket server
 * @param {string} url - WebSocket URL
 * @param {WebSocketOptions} [options] - Connection options
 * @param {Function} [onMessage] - Message handler callback
 * @returns {Promise<Object>} WebSocket connection result
 */
export function connectWebSocket(url, options = {}, onMessage = null) {
  const startTime = Date.now();
  const timeout = options.timeout || config.API_TIMEOUT;
  const tags = { ...config.TAGS, ...options.tags, protocol: 'websocket' };

  return new Promise((resolve, reject) => {
    const params = {
      tags,
      timeout: `${timeout}ms`,
      ...(options.headers && { headers: options.headers }),
    };

    ws.connect(url, params, (socket) => {
      const connectDuration = Date.now() - startTime;
      trackOperation('websocket', connectDuration, { operation: 'connect', ...tags });

      // Set up message handler
      if (onMessage && typeof onMessage === 'function') {
        socket.on('message', (data) => {
          try {
            onMessage(data, socket);
          } catch (error) {
            trackError(true, { operation: 'websocket_message', error: error.message, ...tags });
          }
        });
      }

      // Set up error handler
      socket.on('error', (error) => {
        trackError(true, { operation: 'websocket_error', error: error.message, ...tags });
      });

      // Set up close handler
      socket.on('close', () => {
        const closeDuration = Date.now() - startTime;
        trackOperation('websocket', closeDuration, { operation: 'close', ...tags });
      });

      resolve({
        socket,
        connected: true,
        duration: connectDuration,
      });
    });

    // Handle connection timeout
    setTimeout(() => {
      reject(new Error('WebSocket connection timeout'));
    }, timeout);
  });
}

/**
 * Send WebSocket message
 * @param {Object} socket - WebSocket socket object
 * @param {string|Object} message - Message to send
 * @param {Object} [tags] - Tags for metrics
 * @returns {boolean} True if message sent successfully
 */
export function sendWebSocketMessage(socket, message, tags = {}) {
  try {
    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    socket.send(messageStr);
    return true;
  } catch (error) {
    trackError(true, { operation: 'websocket_send', error: error.message, ...tags });
    return false;
  }
}

/**
 * Receive WebSocket message with timeout
 * @param {Object} socket - WebSocket socket object
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<string>} Received message
 */
export function receiveWebSocketMessage(socket, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('WebSocket message receive timeout'));
    }, timeout);

    socket.on('message', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * Test WebSocket connection
 * @param {string} url - WebSocket URL
 * @param {WebSocketOptions} [options] - Connection options
 * @returns {Promise<boolean>} True if connection successful
 */
export async function testWebSocketConnection(url, options = {}) {
  try {
    const result = await connectWebSocket(url, options);
    const success = check(result, {
      'websocket connection successful': (r) => r.connected === true,
      'websocket connection time < 2s': (r) => r.duration < 2000,
    });

    if (result.socket) {
      result.socket.close();
    }

    trackError(!success, { operation: 'websocket_test', ...options.tags });
    return success;
  } catch (error) {
    trackError(true, { operation: 'websocket_test', error: error.message, ...options.tags });
    return false;
  }
}

/**
 * WebSocket echo test
 * @param {string} url - WebSocket URL
 * @param {string} testMessage - Test message to send
 * @param {WebSocketOptions} [options] - Connection options
 * @returns {Promise<boolean>} True if echo test successful
 */
export async function testWebSocketEcho(url, testMessage = 'test', options = {}) {
  try {
    const result = await connectWebSocket(url, options, () => {
      // Message handler will be called
    });

    if (!result.socket) {
      return false;
    }

    // Send test message
    const sent = sendWebSocketMessage(result.socket, testMessage, options.tags);
    if (!sent) {
      result.socket.close();
      return false;
    }

    // Wait for echo response
    const received = await receiveWebSocketMessage(result.socket, 5000);
    const echoSuccess = received === testMessage || received === JSON.stringify(testMessage);

    result.socket.close();

    const success = check(
      { echoSuccess },
      {
        'websocket echo test successful': (r) => r.echoSuccess === true,
      }
    );

    trackError(!success, { operation: 'websocket_echo', ...options.tags });
    return success;
  } catch (error) {
    trackError(true, { operation: 'websocket_echo', error: error.message, ...options.tags });
    return false;
  }
}

export default {
  connectWebSocket,
  sendWebSocketMessage,
  receiveWebSocketMessage,
  testWebSocketConnection,
  testWebSocketEcho,
};
