/**
 * Authentication Helper Module
 * Provides authentication utilities for load tests
 * @module authHelper
 */

import { check, sleep } from 'k6';
import { createLoginRequest, createVerifyOtpRequest } from './requestBuilder.js';
import { config } from '../config/config.js';

/**
 * Performs authentication flow
 * @param {string} phone - Phone number for authentication
 * @param {Function} [getOtpFn] - Optional function to get OTP (for testing)
 * @returns {Object|null} Authentication result with token, or null if failed
 */
export function performAuthentication(phone = config.TEST_USER.phone, getOtpFn = null) {
  // Step 1: Send OTP
  const loginRequest = createLoginRequest(phone);
  const loginResponse = loginRequest.send();

  const loginSuccess = check(loginResponse, {
    'login status is 200': (r) => r.status === 200,
    'login response has success': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true;
      } catch {
        return false;
      }
    },
  });

  if (!loginSuccess) {
    console.error(`❌ Login failed: ${loginResponse.status} - ${loginResponse.body}`);
    return null;
  }

  // Step 2: Get OTP (in real scenario, this would come from external source)
  let otp;
  if (getOtpFn && typeof getOtpFn === 'function') {
    otp = getOtpFn(phone);
  } else {
    // For load testing, require TEST_OTP to be set in environment variables
    // SECURITY: Never use hardcoded OTP values
    otp = __ENV.TEST_OTP;
  }

  if (!otp) {
    console.error('❌ TEST_OTP environment variable is required for authentication');
    console.error('💡 Set TEST_OTP in your environment configuration file');
    return null;
  }

  // Step 3: Verify OTP
  const verifyRequest = createVerifyOtpRequest(phone, otp);
  const verifyResponse = verifyRequest.send();

  const verifySuccess = check(verifyResponse, {
    'verify status is 200': (r) => r.status === 200,
    'verify response has token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true && body.data && body.data.token;
      } catch {
        return false;
      }
    },
  });

  if (!verifySuccess) {
    console.error(`❌ OTP verification failed: ${verifyResponse.status} - ${verifyResponse.body}`);
    return null;
  }

  try {
    const body = JSON.parse(verifyResponse.body);
    const token = body.data?.token;

    if (!token) {
      console.error('❌ No token in verification response');
      return null;
    }

    return {
      success: true,
      token,
      phone,
      expiresAt: body.data?.expires_at || null,
    };
  } catch (error) {
    console.error(`❌ Failed to parse verification response: ${error.message}`);
    return null;
  }
}

/**
 * Authenticates a user and returns token
 * @param {string} [phone] - Phone number (defaults to config)
 * @returns {string|null} Authentication token or null
 */
export function getAuthToken(phone = config.TEST_USER.phone) {
  const authResult = performAuthentication(phone);
  return authResult ? authResult.token : null;
}

/**
 * Authenticates multiple users (for VU scenarios)
 * @param {number} count - Number of users to authenticate
 * @param {Function} [phoneGenerator] - Function to generate phone numbers
 * @returns {Array<Object>} Array of authentication results
 */
export function authenticateMultipleUsers(count, phoneGenerator = null) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const phone = phoneGenerator ? phoneGenerator(i) : `${config.TEST_USER.phone}${i}`;
    const authResult = performAuthentication(phone);
    if (authResult) {
      results.push(authResult);
    }
    // Add small delay between authentications
    sleep(0.1);
  }
  return results;
}

/**
 * Validates authentication token
 * @param {string} token - Token to validate
 * @returns {boolean} True if token is valid
 */
export function validateToken(token) {
  if (!token || typeof token !== 'string' || token.length < 20) {
    return false;
  }
  // Additional validation can be added here (JWT decode, expiry check, etc.)
  return true;
}

export default {
  performAuthentication,
  getAuthToken,
  authenticateMultipleUsers,
  validateToken,
};
