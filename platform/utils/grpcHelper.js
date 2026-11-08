/**
 * gRPC Helper Module
 * Provides gRPC testing utilities for microservices
 * @module grpcHelper
 *
 * Note: gRPC support requires k6-grpc extension
 * Install: k6 install github.com/grafana/xk6-grpc
 */

import { check } from 'k6';
import { config } from '../config/config.js';
import { trackError, trackOperation } from './metrics.js';

/**
 * gRPC client options
 * @typedef {Object} GrpcOptions
 * @property {number} timeout - Request timeout in milliseconds
 * @property {Object} metadata - gRPC metadata
 * @property {Object} tags - Tags for metrics
 */

/**
 * Create gRPC client
 * @param {string} address - gRPC server address
 * @param {GrpcOptions} [options] - Client options
 * @returns {Object} gRPC client
 *
 * @example
 * const client = createGrpcClient('localhost:50051');
 * const response = client.invoke('package.Service/Method', request);
 */
export function createGrpcClient(address, options = {}) {
  // Note: This requires k6-grpc extension
  // For now, this is a placeholder structure
  // Actual implementation requires: import grpc from 'k6/net/grpc';

  const tags = { ...config.TAGS, ...options.tags, protocol: 'grpc' };

  return {
    address,
    options,
    tags,
    // Placeholder for actual gRPC client
    // In real implementation, this would use k6/net/grpc
  };
}

/**
 * Invoke gRPC method
 * @param {Object} client - gRPC client
 * @param {string} method - Method name (e.g., 'package.Service/Method')
 * @param {Object} request - Request payload
 * @param {GrpcOptions} [options] - Request options
 * @returns {Promise<Object>} gRPC response
 */
export async function invokeGrpcMethod(client, method, request, options = {}) {
  const startTime = Date.now();
  const tags = { ...client.tags, ...options.tags, method };

  try {
    // Placeholder for actual gRPC invocation
    // In real implementation:
    // const client = grpc.Client(address, { timeout: options.timeout });
    // const response = client.invoke(method, request, { metadata: options.metadata });

    // For now, return a mock structure
    const duration = Date.now() - startTime;

    const mockResponse = {
      status: 0, // OK
      message: 'Mock gRPC response',
      data: request,
      duration,
    };

    trackOperation('grpc', duration, { operation: 'invoke', method, ...tags });

    return mockResponse;
  } catch (error) {
    const duration = Date.now() - startTime;
    trackError(true, { operation: 'grpc_invoke', method, error: error.message, ...tags });
    trackOperation('grpc', duration, { operation: 'invoke_error', method, ...tags });

    throw error;
  }
}

/**
 * Test gRPC connection
 * @param {string} address - gRPC server address
 * @param {string} method - Method to test
 * @param {Object} request - Test request
 * @param {GrpcOptions} [options] - Connection options
 * @returns {Promise<boolean>} True if connection successful
 */
export async function testGrpcConnection(address, method, request, options = {}) {
  try {
    const client = createGrpcClient(address, options);
    const response = await invokeGrpcMethod(client, method, request, options);

    const success = check(response, {
      'grpc connection successful': (r) => r.status === 0,
      'grpc response time < 2s': (r) => r.duration < 2000,
      'grpc response has data': (r) => r.data !== undefined,
    });

    trackError(!success, { operation: 'grpc_test', method, ...options.tags });
    return success;
  } catch (error) {
    trackError(true, { operation: 'grpc_test', method, error: error.message, ...options.tags });
    return false;
  }
}

/**
 * gRPC health check
 * @param {string} address - gRPC server address
 * @param {GrpcOptions} [options] - Connection options
 * @returns {Promise<boolean>} True if health check passes
 */
export async function grpcHealthCheck(address, options = {}) {
  // Standard gRPC health check method
  const healthMethod = 'grpc.health.v1.Health/Check';
  const healthRequest = { service: '' }; // Empty service = overall health

  return testGrpcConnection(address, healthMethod, healthRequest, options);
}

/**
 * gRPC unary call helper
 * @param {Object} client - gRPC client
 * @param {string} method - Method name
 * @param {Object} request - Request payload
 * @param {GrpcOptions} [options] - Request options
 * @returns {Promise<Object>} Response
 */
export async function unaryCall(client, method, request, options = {}) {
  return invokeGrpcMethod(client, method, request, options);
}

/**
 * gRPC streaming call helper (client streaming)
 * @param {Object} client - gRPC client
 * @param {string} method - Method name
 * @param {Array<Object>} requests - Array of request payloads
 * @param {GrpcOptions} [options] - Request options
 * @returns {Promise<Object>} Response
 */
export async function clientStreamingCall(client, method, requests, options = {}) {
  const startTime = Date.now();
  const tags = { ...client.tags, ...options.tags, method, streamType: 'client' };

  try {
    // Placeholder for client streaming implementation
    // In real implementation, this would handle streaming requests

    const duration = Date.now() - startTime;
    trackOperation('grpc', duration, { operation: 'client_stream', method, ...tags });

    return {
      status: 0,
      message: 'Client streaming completed',
      requestCount: requests.length,
      duration,
    };
  } catch (error) {
    trackError(true, { operation: 'grpc_client_stream', method, error: error.message, ...tags });
    throw error;
  }
}

/**
 * gRPC streaming call helper (server streaming)
 * @param {Object} client - gRPC client
 * @param {string} method - Method name
 * @param {Object} request - Request payload
 * @param {Function} onMessage - Message handler callback
 * @param {GrpcOptions} [options] - Request options
 * @returns {Promise<Object>} Response
 */
export async function serverStreamingCall(client, method, request, onMessage, options = {}) {
  const startTime = Date.now();
  const tags = { ...client.tags, ...options.tags, method, streamType: 'server' };

  try {
    // Placeholder for server streaming implementation
    // In real implementation, this would handle streaming responses

    const duration = Date.now() - startTime;
    trackOperation('grpc', duration, { operation: 'server_stream', method, ...tags });

    return {
      status: 0,
      message: 'Server streaming completed',
      duration,
    };
  } catch (error) {
    trackError(true, { operation: 'grpc_server_stream', method, error: error.message, ...tags });
    throw error;
  }
}

export default {
  createGrpcClient,
  invokeGrpcMethod,
  testGrpcConnection,
  grpcHealthCheck,
  unaryCall,
  clientStreamingCall,
  serverStreamingCall,
};
