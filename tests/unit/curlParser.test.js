/**
 * cURL body parsing unit tests (regression suite for cURL import)
 * @module tests/unit/curlParser
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractCurlData } from '../../public/curlParser.js';

const CASES = [
  {
    name: 'JSON login body (multiline --data)',
    curl: `curl --location 'https://httpbin.org/post' \\
--header 'Content-Type: application/json' \\
--data '{
    "phone": "15550000002"
}'`,
    expectedBody: `{
  "phone": "15550000002"
}`,
  },
  {
    name: 'simple JSON object',
    curl: `curl -X POST https://reqres.in/api/users -H "Content-Type: application/json" -d '{"name":"John Doe","job":"Developer"}'`,
    expectedBody: `{
  "name": "John Doe",
  "job": "Developer"
}`,
  },
  {
    name: 'nested JSON object',
    curl: `curl -X POST https://api.example.com/users -H "Content-Type: application/json" -d '{"user":{"name":"Jane Smith","address":{"city":"NYC","country":"USA"}}}'`,
    expectedBody: `{
  "user": {
    "name": "Jane Smith",
    "address": {
      "city": "NYC",
      "country": "USA"
    }
  }
}`,
  },
  {
    name: 'JSON array',
    curl: `curl -X POST https://api.example.com/batch -d '[{"id":1,"name":"Item 1"},{"id":2,"name":"Item 2"}]'`,
    expectedBody: `[
  {
    "id": 1,
    "name": "Item 1"
  },
  {
    "id": 2,
    "name": "Item 2"
  }
]`,
  },
  {
    name: 'complex nested structure',
    curl: `curl -X POST https://api.example.com/complex -d '{"data":{"users":[{"id":1,"profile":{"name":"User 1","settings":{"theme":"dark"}}}],"meta":{"total":1}}}'`,
    expectedBody: `{
  "data": {
    "users": [
      {
        "id": 1,
        "profile": {
          "name": "User 1",
          "settings": {
            "theme": "dark"
          }
        }
      }
    ],
    "meta": {
      "total": 1
    }
  }
}`,
  },
  {
    name: '--data flag',
    curl: `curl -X POST https://api.example.com/users --data '{"name":"Test User","email":"test@example.com"}'`,
    expectedBody: `{
  "name": "Test User",
  "email": "test@example.com"
}`,
  },
];

describe('extractCurlData', () => {
  for (const testCase of CASES) {
    it(`parses body: ${testCase.name}`, () => {
      const result = extractCurlData(testCase.curl);
      assert.equal(result.body, testCase.expectedBody);
      assert.ok(result.url.startsWith('http'));
      assert.equal(result.method, 'POST');
    });
  }

  it('throws when URL cannot be extracted', () => {
    assert.throws(() => extractCurlData('curl -d "{}"'), /Could not extract URL/);
  });

  it('defaults method to GET without body flags', () => {
    const result = extractCurlData('curl https://api.example.com/health');
    assert.equal(result.method, 'GET');
    assert.equal(result.body, null);
    assert.equal(result.url, 'https://api.example.com/health');
  });

  it('extracts headers from -H and --header', () => {
    const curl = `curl -X POST 'https://api.example.com/items' \\
  -H 'Authorization: Bearer token123' \\
  --header 'Content-Type: application/json' \\
  -d '{"name":"widget"}'`;
    const result = extractCurlData(curl);
    assert.equal(result.headers.Authorization, 'Bearer token123');
    assert.equal(result.headers['Content-Type'], 'application/json');
  });

  it('honors explicit --request method', () => {
    const result = extractCurlData("curl --request DELETE 'https://api.example.com/items/42'");
    assert.equal(result.method, 'DELETE');
    assert.equal(result.body, null);
  });

  it('parses --data-raw payloads', () => {
    const result = extractCurlData(
      `curl -X POST https://api.example.com/raw --data-raw '{"enabled":true}'`
    );
    assert.equal(result.method, 'POST');
    assert.equal(result.body, '{\n  "enabled": true\n}');
  });

  it('keeps non-JSON body as trimmed text', () => {
    const result = extractCurlData(
      "curl -X POST https://api.example.com/form -d 'plain-text-body'"
    );
    assert.equal(result.body, 'plain-text-body');
  });
});
