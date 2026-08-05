# k6 Load Testing Best Practices

This document outlines the best practices implemented in this load testing suite, following industry
standards and k6 recommendations.

## 🎯 Core Best Practices

### 1. Test Execution Order

Always execute tests in this order:

1. **Smoke Test** - Verify system is ready (1-5 VUs, 1-5 min)
2. **Load Test** - Validate normal performance (10-50 VUs, 5-15 min)
3. **Stress Test** - Find breaking points (50-200+ VUs, 15-30 min)
4. **Spike Test** - Test spike handling (sudden increases)
5. **Soak Test** - Test long-term stability (1-4 hours)
6. **Volume Test** - Test data throughput

### 2. Thresholds Configuration

**Always define performance thresholds:**

```javascript
export const options = {
  thresholds: {
    // Response time thresholds
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],

    // Error rate thresholds
    http_req_failed: ['rate<0.01'],

    // Throughput thresholds
    http_reqs: ['rate>100'],

    // Custom metric thresholds
    cart_operation_time: ['p(95)<2000'],
  },
};
```

**Best Practices:**

- Use percentiles (p95, p99) for response times
- Set error rate thresholds (< 1% for production)
- Define throughput expectations
- Set thresholds for custom metrics

### 3. Think Time

**Always include realistic think time:**

```javascript
import { randomThinkTime } from '../../utils/helpers.js';

// Simulate user thinking between actions
randomThinkTime(1000, 3000); // 1-3 seconds
```

**Best Practices:**

- Use random think times (not fixed)
- Match think times to real user behavior
- Vary think times based on operation complexity
- Don't skip think time (creates unrealistic load)

### 4. Error Handling

**Always check responses and handle errors:**

```javascript
import { check } from 'k6';
import { trackError } from '../../utils/metrics.js';

const response = http.get(url);
const success = check(response, {
  'status is 200': (r) => r.status === 200,
  'response time < 2s': (r) => r.timings.duration < 2000,
  'has valid data': (r) => {
    try {
      const body = JSON.parse(r.body);
      return body.success === true;
    } catch {
      return false;
    }
  },
});

trackError(!success, { operation: 'get_cart' });
```

**Best Practices:**

- Always validate response status
- Check response times
- Validate response structure
- Track errors with custom metrics
- Don't ignore errors

### 5. Custom Metrics

**Use custom metrics to track specific behaviors:**

```javascript
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';

// Response time tracking
const responseTime = new Trend('response_time', true);

// Error tracking
const errorRate = new Rate('errors');

// Throughput tracking
const throughput = new Counter('throughput');

// System state tracking
const activeUsers = new Gauge('active_users');
```

**Best Practices:**

- Track business metrics (not just HTTP)
- Use tags for metric organization
- Track both success and failure metrics
- Monitor system state (VUs, memory, etc.)

### 6. Grouping Operations

**Use groups to organize related operations:**

```javascript
import { group } from 'k6';

group('Cart Operations', () => {
  // Get cart
  const cart = http.get('/cart');

  // Add to cart
  const add = http.post('/cart/add');
});

group('Checkout Operations', () => {
  // Get addresses
  const addresses = http.get('/addresses');

  // Create order
  const order = http.post('/order');
});
```

**Best Practices:**

- Group related operations
- Use descriptive group names
- Organize by user journey
- Track metrics per group

### 7. Tags for Organization

**Use tags for better metric filtering:**

```javascript
http.get(url, {
  tags: {
    name: 'get-cart', // Operation name
    endpoint: 'cart', // API endpoint
    operation: 'read', // Operation type
    user_type: 'premium', // User segment
    environment: 'staging', // Environment
  },
});
```

**Best Practices:**

- Tag all requests
- Use consistent tag names
- Tag by endpoint, operation, user type
- Enable filtering in reports

### 8. Response Validation

**Always validate response structure:**

```javascript
import { validateResponse } from '../../utils/responseValidator.js';

const response = http.get(url);

const isValid = validateResponse(response, {
  status: 200,
  maxDuration: 2000,
  schema: {
    success: (val) => val === true,
    data: 'object',
    items: 'array',
  },
  minSize: 100,
  maxSize: 100000,
});
```

**Best Practices:**

- Validate status codes
- Check response times
- Validate JSON structure
- Check response sizes
- Validate headers when needed

### 9. Retry Logic

**Implement retry logic for transient failures:**

```javascript
import { RequestBuilder } from '../../utils/requestBuilder.js';

const request = new RequestBuilder().setPath('/api/endpoint').setMethod('GET');

// Retry with exponential backoff
const response = request.sendWithRetry(3);
```

**Best Practices:**

- Retry on 5xx errors
- Don't retry on 4xx errors
- Use exponential backoff
- Limit retry attempts
- Track retry metrics

### 10. Realistic User Behavior

**Simulate real user workflows:**

```javascript
// User journey simulation
export default function () {
  // 1. Browse products (80% of users)
  if (Math.random() > 0.2) {
    http.get('/products');
    randomThinkTime(2000, 5000);
  }

  // 2. View product details (60% of users)
  if (Math.random() > 0.4) {
    http.get('/products/123');
    randomThinkTime(3000, 8000);
  }

  // 3. Add to cart (40% of users)
  if (Math.random() > 0.6) {
    http.post('/cart/add');
    randomThinkTime(1000, 3000);
  }

  // 4. Checkout (20% of users)
  if (Math.random() > 0.8) {
    http.post('/checkout');
  }
}
```

**Best Practices:**

- Model real user journeys
- Use probability-based flows
- Include realistic think times
- Vary user behavior
- Don't make all users do the same thing

### 11. Setup and Teardown

**Use setup for authentication and data preparation:**

```javascript
export function setup() {
  // Authenticate once per VU
  const token = getAuthToken();

  // Prepare test data
  const testData = prepareTestData();

  return { token, testData };
}

export default function (data) {
  // Use data from setup
  const { token, testData } = data;
  // ... test logic
}

export function teardown(data) {
  // Cleanup if needed
  console.log('Test completed');
}
```

**Best Practices:**

- Authenticate in setup (not in default function)
- Prepare test data in setup
- Reuse setup data across iterations
- Clean up in teardown if needed

### 12. Staging Configuration

**Use gradual ramp-up and ramp-down:**

```javascript
export const options = {
  stages: [
    { duration: '2m', target: 10 }, // Ramp up
    { duration: '5m', target: 10 }, // Stay at load
    { duration: '2m', target: 20 }, // Increase load
    { duration: '5m', target: 20 }, // Stay at load
    { duration: '2m', target: 0 }, // Ramp down
  ],
};
```

**Best Practices:**

- Always ramp up gradually
- Include steady state periods
- Ramp down gradually
- Avoid sudden load changes
- Test recovery after load changes

### 13. Data Management

**Use realistic and varied test data:**

```javascript
import { getRandomProduct, generateRandomPhone } from '../../utils/testData.js';

// Vary test data
const product = getRandomProduct();
const phone = generateRandomPhone(__VU);
```

**Best Practices:**

- Use realistic data
- Vary data per VU
- Avoid hardcoded values
- Generate data dynamically
- Use data pools for variety

### 14. Monitoring and Reporting

**Track comprehensive metrics:**

```javascript
import { trackOperation, trackError, trackDataVolume } from '../../utils/metrics.js';

// Track operation
trackOperation('cart', duration, { operation: 'get_cart' });

// Track errors
trackError(isError, { operation: 'get_cart' });

// Track data volume
trackDataVolume(response.body.length, 'response');
```

**Best Practices:**

- Track all operations
- Monitor error rates
- Track data volumes
- Monitor system metrics
- Generate comprehensive reports

### 15. Performance Optimization

**Optimize test scripts for performance:**

```javascript
// ✅ Good: Reuse parsed data
const body = JSON.parse(response.body);
const items = body.data.items;

// ❌ Bad: Parse multiple times
const items1 = JSON.parse(response.body).data.items;
const items2 = JSON.parse(response.body).data.items;
```

**Best Practices:**

- Cache parsed responses
- Minimize string operations
- Avoid unnecessary loops
- Use efficient data structures
- Profile script performance

## 🚫 Common Mistakes to Avoid

1. **No think time** - Creates unrealistic load
2. **Fixed think time** - Doesn't simulate real users
3. **No error handling** - Misses failures
4. **No thresholds** - Can't detect performance issues
5. **Hardcoded data** - Doesn't test variety
6. **No grouping** - Hard to analyze results
7. **No tags** - Can't filter metrics
8. **Sudden load changes** - Doesn't test gradual scaling
9. **No retry logic** - Fails on transient errors
10. **No validation** - Doesn't verify correctness

## 📊 Metrics to Track

### Essential Metrics

- **Response Time**: p50, p95, p99
- **Error Rate**: Percentage of failed requests
- **Throughput**: Requests per second
- **Iteration Duration**: Time per user journey

### Business Metrics

- **Successful Operations**: Count of successful operations
- **Failed Operations**: Count of failed operations
- **Data Volume**: Amount of data transferred
- **User Journeys**: Completion rate of user flows

### System Metrics

- **Active VUs**: Number of active virtual users
- **Memory Usage**: System memory consumption
- **CPU Usage**: System CPU consumption
- **Network I/O**: Network throughput

## 🎓 Advanced Best Practices

### 1. Distributed Execution

```bash
# Run on multiple machines
k6 run --out cloud script.js
```

### 2. Performance Budgets

```javascript
export const options = {
  thresholds: {
    // Performance budgets
    http_req_duration: ['p(95)<2000'], // Budget: 2s
    http_req_failed: ['rate<0.01'], // Budget: 1% errors
  },
};
```

### 4. A/B Testing

```javascript
// Test different endpoints
const endpoint = Math.random() > 0.5 ? '/v1/api' : '/v2/api';
http.get(endpoint, { tags: { version: endpoint.includes('v1') ? 'v1' : 'v2' } });
```

## 📚 References

- [k6 Documentation](https://k6.io/docs/)
- [k6 Best Practices](https://k6.io/docs/using-k6/best-practices/)
- [Load Testing Guide](https://k6.io/docs/test-types/load-testing/)
- [Performance Testing Guide](https://k6.io/docs/test-types/performance-testing/)
