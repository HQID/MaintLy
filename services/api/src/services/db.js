const { Pool } = require('pg');

const connectionString = process.env.POSTGRES_URL || process.env.PG_URL;

if (!connectionString) {
  throw new Error('POSTGRES_URL atau PG_URL wajib diatur untuk menjalankan API');
}

const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
});

module.exports = pool;
