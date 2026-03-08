import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgres://nexx_trade_db_user:X02fI7qX2mXGat4pWqH7Gk2R0S88Ym5h@dpg-d2n42j8dl3ps73fulelg-a.oregon-postgres.render.com/nexx_trade_db',
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create coupons table
    await client.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        discount_percentage NUMERIC(5,2) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        usage_count INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('Coupons table created.');

    // Add coupon_code to users table
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50);
    `);
    console.log('coupon_code column added to users table.');

    // Insert the initial coupon
    await client.query(`
      INSERT INTO coupons (code, discount_percentage, is_active)
      VALUES ('IBX26', 50.00, true)
      ON CONFLICT (code) DO NOTHING;
    `);
    console.log('Initial coupon IBX26 inserted.');

    await client.query('COMMIT');
    console.log('Migration completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
