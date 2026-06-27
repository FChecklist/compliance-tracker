// Test setup — set required env vars
process.env.JWT_SECRET = "test-secret-key-for-vitest-min-32chars!!";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";