import { beforeAll, afterAll } from 'vitest';

beforeAll(() => {
  // Ensure test environment variables
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_key_minimum_32_characters_long_for_hmac';
  process.env.NOTIFICATION_PROVIDER = 'mock';
});

afterAll(() => {
  // Cleanup test resources if necessary
});
