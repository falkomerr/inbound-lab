/**
 * Test Data Management Module
 * Provides placeholder test data for load testing scenarios
 * @module testData
 */

import { config } from '../config/config.js';

/**
 * Example products for sample checkout-style flows
 */
export const testProducts = {
  default: {
    product_id: 1001,
    configurable_option: 2001,
    quantity: 1,
    name: 'Sample Product',
    category: 'Demo',
  },
  bulk: {
    product_id: 1002,
    configurable_option: 2002,
    quantity: 10,
    name: 'Bulk Sample Product',
    category: 'Demo',
  },
  highValue: {
    product_id: 1003,
    configurable_option: 2003,
    quantity: 1,
    name: 'High Value Sample',
    category: 'Demo',
  },
};

/**
 * Test users for load testing
 */
export const testUsers = {
  default: config.TEST_USER,
  loadTest1: {
    phone: '15550000001',
    mobileFormat: '5550000001',
    email: 'loadtest1@example.com',
  },
  loadTest2: {
    phone: '15550000002',
    mobileFormat: '5550000002',
    email: 'loadtest2@example.com',
  },
  loadTest3: {
    phone: '15550000003',
    mobileFormat: '5550000003',
    email: 'loadtest3@example.com',
  },
};

/**
 * Shipping data for checkout-style flows
 */
export const shippingData = {
  submitTypeId: 1,
  shippingNatureSubmitTypeId: 1,
  methods: {
    standard: 'standard',
    express: 'express',
    pickup: 'pickup',
  },
};

/**
 * Payment data for checkout-style flows
 */
export const paymentData = {
  methods: {
    card: 'card',
    credit: 'credit',
    wallet: 'wallet',
    cash: 'cash',
  },
};

/**
 * Generate random phone number for load testing
 * @param {number} index - Index for generating unique phone
 * @returns {string} Random phone number
 */
export function generateRandomPhone(index = 0) {
  const base = 15550000000;
  return String(base + (index % 1000000));
}

/**
 * Generate random email for load testing
 * @param {number} index - Index for generating unique email
 * @returns {string} Random email
 */
export function generateRandomEmail(index = 0) {
  return `loadtest_${Date.now()}_${index}@example.com`;
}

/**
 * Get random product from test products
 * @returns {Object} Random product
 */
export function getRandomProduct() {
  const products = Object.values(testProducts);
  return products[Math.floor(Math.random() * products.length)];
}

/**
 * Get random user from test users
 * @returns {Object} Random user
 */
export function getRandomUser() {
  const users = Object.values(testUsers);
  return users[Math.floor(Math.random() * users.length)];
}

/**
 * Generate test data for VU
 * @param {number} vuId - Virtual User ID
 * @returns {Object} Test data for VU
 */
export function generateVUTestData(vuId) {
  return {
    user: {
      phone: generateRandomPhone(vuId),
      email: generateRandomEmail(vuId),
    },
    product: getRandomProduct(),
    shipping: shippingData,
    payment: paymentData,
  };
}

export default {
  testProducts,
  testUsers,
  shippingData,
  paymentData,
  generateRandomPhone,
  generateRandomEmail,
  getRandomProduct,
  getRandomUser,
  generateVUTestData,
};
