// server.js
// This file sets up a Node.js backend server using Express and a PostgreSQL database.
// It handles API routes for managing blogs, pricing plans, roles, and performance data.

// Import required modules
const express = require('express');
const cors = require('cors'); // Import the cors package
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcrypt'); // Import bcrypt for password hashing
const crypto = require('crypto'); // Import crypto for generating unique tokens
const app = express();
// Load environment variables from .env file
require('dotenv').config();
const port = process.env.PORT || 3000;

// NEW: Import the Telegram bot and webhook setup function
const { bot, setupWebhook } = require('./telegram_bot.js');

// Middleware setup
// Use the CORS middleware to allow cross-origin requests
app.use(cors());
// Use express.json() to parse incoming JSON payloads
app.use(express.json({ limit: '10mb' }));
// Use express.urlencoded() to parse URL-encoded bodies, important for form submissions
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// PostgreSQL database connection pool
// This uses a connection string from an environment variable for security.
// Remember to set DATABASE_URL in your environment before running the server.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // This setting is often needed for cloud-hosted databases that use self-signed certificates.
    // It tells the client to not reject the connection based on the certificate authority.
    rejectUnauthorized: false
  }
});

// Function to connect to the database and handle errors
async function connectToDatabase() {
  try {
    const client = await pool.connect();
    console.log('Successfully connected to the PostgreSQL database.');
    client.release(); // Release the client back to the pool
  } catch (error) {
    console.error('Database connection failed:', error.stack);
  }
}

// Call the function to test the database connection on server start
connectToDatabase();

// API Routes for Blogs Management
// Based on the 'blogposts' table from your SQL dump.
// The columns are: id, title, teaser, content, author, published_date, status, featured_image_url
app.get('/api/blogs', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM blogposts ORDER BY published_date DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.get('/api/blogs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT * FROM blogposts WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).send('Blog post not found.');
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// MODIFIED: POST route to handle JSON body with Base64 image string
app.post('/api/blogs', async (req, res) => {
  try {
    const { title, teaser, content, author, published_date, status, featured_image_url } = req.body;

    const { rows } = await pool.query(
      'INSERT INTO blogposts(title, teaser, content, author, published_date, status, featured_image_url) VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [title, teaser, content, author, published_date, status, featured_image_url]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// MODIFIED: PUT route to handle JSON body with Base64 image string
app.put('/api/blogs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, teaser, content, author, published_date, status, featured_image_url } = req.body;

    const { rows } = await pool.query(
      'UPDATE blogposts SET title = $1, teaser = $2, content = $3, author = $4, published_date = $5, status = $6, featured_image_url = $7 WHERE id = $8 RETURNING *',
      [title, teaser, content, author, published_date, status, featured_image_url, id]
    );
    if (rows.length === 0) {
      return res.status(404).send('Blog post not found.');
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.delete('/api/blogs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query('DELETE FROM blogposts WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).send('Blog post not found.');
    }
    res.status(204).send(); // 204 No Content
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});


// API Routes for Pricing Plans Management
// Now includes the 'telegram_group_id' field
app.get('/api/pricing', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pricingplans ORDER BY price ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// NEWLY ADDED ROUTE TO FIX THE BUG
app.get('/api/pricing/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT * FROM pricingplans WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).send('Pricing plan not found.');
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.post('/api/pricing', async (req, res) => {
  try {
    const { plan_name, price, term, description, features, is_best_value, telegram_group_id } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO pricingplans(plan_name, price, term, description, features, is_best_value, telegram_group_id) VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [plan_name, price, term, description, features, is_best_value, telegram_group_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.put('/api/pricing/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { plan_name, price, term, description, features, is_best_value, telegram_group_id } = req.body;
    const { rows } = await pool.query(
      'UPDATE pricingplans SET plan_name = $1, price = $2, term = $3, description = $4, features = $5, is_best_value = $6, telegram_group_id = $7 WHERE id = $8 RETURNING *',
      [plan_name, price, term, description, features, is_best_value, telegram_group_id, id]
    );
    if (rows.length === 0) {
      return res.status(404).send('Pricing plan not found.');
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.delete('/api/pricing/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query('DELETE FROM pricingplans WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).send('Pricing plan not found.');
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});


// API Routes for User Roles Management
// Based on the 'adminusers' table from your SQL dump.
// The columns are: id, username, hashed_password, role, permissions
app.get('/api/roles', async (req, res) => {
  try {
    // Note: Do not expose sensitive data like hashed_password.
    const { rows } = await pool.query('SELECT id, username, role, permissions FROM adminusers');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// NEW ROUTE: Create a new admin user
app.post('/api/roles', async (req, res) => {
  try {
    const { username, password, role, permissions } = req.body;
    const saltRounds = 10;

    // Hash the password before saving to the database
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert the new user into the adminusers table
    const { rows } = await pool.query(
      'INSERT INTO adminusers(username, hashed_password, role, permissions) VALUES($1, $2, $3, $4) RETURNING id, username, role, permissions',
      [username, hashedPassword, role, permissions]
    );

    // Send a 201 Created status and the new user's info (without password)
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating new user:', err);
    // Handle specific errors, e.g., duplicate username
    if (err.code === '23505') { // PostgreSQL error code for unique violation
        return res.status(409).json({ message: 'Username already exists.' });
    }
    res.status(500).json({ message: 'Server Error' });
  }
});

app.put('/api/roles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { role, permissions } = req.body;
    const { rows } = await pool.query(
      'UPDATE adminusers SET role = $1, permissions = $2 WHERE id = $3 RETURNING id, username, role, permissions',
      [role, permissions, id]
    );
    if (rows.length === 0) {
      return res.status(404).send('User not found.');
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// NEW ROUTE: Handle admin login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Find the user by username
        const { rows } = await pool.query(
            'SELECT * FROM adminusers WHERE username = $1',
            [username]
        );

        if (rows.length > 0) {
            const user = rows[0];
            // Compare the provided password with the stored hashed password
            const match = await bcrypt.compare(password, user.hashed_password);

            if (match) {
                // Return user data including permissions on successful login
                res.status(200).json({
                    message: 'Login successful',
                    user: {
                        id: user.id,
                        username: user.username,
                        role: user.role,
                        permissions: user.permissions
                    }
                });
            } else {
                res.status(401).json({ message: 'Invalid credentials' });
            }
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});


// API Routes for Performance Signals
// Based on the 'performancesignals' table from your SQL dump.
// The columns are: id, date, pair, entry_price, exit_price, pnl_percent, leverage, is_long_position, result_type
app.get('/api/performances', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM performancesignals ORDER BY date DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// *** MODIFIED AND CORRECTED ROUTE ***
// API Route for Performance Statistics
app.get('/api/performances/stats', async (req, res) => {
  try {
    // A single query to get most stats, accounting for 'win' and 'gain' (case-insensitive)
    const statsQuery = await pool.query(`
      SELECT
        COUNT(*) AS "totalSignals",
        SUM(CASE WHEN LOWER(result_type) IN ('win', 'gain') THEN 1 ELSE 0 END) AS "wins",
        SUM(CASE WHEN LOWER(result_type) = 'loss' THEN 1 ELSE 0 END) AS "losses",
        SUM(CAST(REPLACE(pnl_percent, '%', '') AS NUMERIC)) as "cumulativeROI"
      FROM performancesignals
    `);

    // A separate query for the most traded pair
    const mostTradedQuery = await pool.query(`
      SELECT pair FROM performancesignals
      GROUP BY pair
      ORDER BY COUNT(pair) DESC
      LIMIT 1
    `);

    const stats = statsQuery.rows[0];
    const totalSignals = parseInt(stats.wins, 10) + parseInt(stats.losses, 10);

    if (totalSignals === 0) {
      return res.json({
        totalSignals: 0,
        wins: 0,
        losses: 0,
        winRate: "0.00",
        cumulativeROI: "0.00",
        mostTradedPair: "N/A"
      });
    }

    const wins = parseInt(stats.wins, 10);
    const winRate = ((wins / totalSignals) * 100).toFixed(2);
    
    res.json({
      totalSignals: totalSignals,
      wins: wins,
      losses: parseInt(stats.losses, 10),
      winRate: winRate,
      cumulativeROI: parseFloat(stats.cumulativeROI).toFixed(2),
      mostTradedPair: mostTradedQuery.rows.length > 0 ? mostTradedQuery.rows[0].pair : "N/A"
    });

  } catch (err) {
    console.error('Error fetching performance stats:', err);
    res.status(500).send('Server Error');
  }
});


app.get('/api/performances/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { rows } = await pool.query('SELECT * FROM performancesignals WHERE id = $1', [id]);
        if (rows.length === 0) {
            return res.status(404).send('Performance signal not found.');
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.post('/api/performances', async (req, res) => {
  try {
    const { date, pair, entry_price, exit_price, pnl_percent, leverage, is_long_position, result_type } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO performancesignals(date, pair, entry_price, exit_price, pnl_percent, leverage, is_long_position, result_type) VALUES($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [date, pair, entry_price, exit_price, pnl_percent, leverage, is_long_position, result_type]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.put('/api/performances/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, pair, entry_price, exit_price, pnl_percent, leverage, is_long_position, result_type } = req.body;
    const { rows } = await pool.query(
      'UPDATE performancesignals SET date = $1, pair = $2, entry_price = $3, exit_price = $4, pnl_percent = $5, leverage = $6, is_long_position = $7, result_type = $8 WHERE id = $9 RETURNING *',
      [date, pair, entry_price, exit_price, pnl_percent, leverage, is_long_position, result_type, id]
    );
    if (rows.length === 0) {
      return res.status(404).send('Performance signal not found.');
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.delete('/api/performances/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query('DELETE FROM performancesignals WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).send('Performance signal not found.');
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// NEW ROUTES: API routes for PNL Proofs
// The columns are: id, image_url, description
app.get('/api/pnlproofs', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pnlproofs');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// FIXED: Removed 'date' from the INSERT query to match the pnlproofs table schema.
app.post('/api/pnlproofs', async (req, res) => {
  try {
    const { image_url, description } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO pnlproofs(image_url, description) VALUES($1, $2) RETURNING *',
      [image_url, description]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.delete('/api/pnlproofs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query('DELETE FROM pnlproofs WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).send('PNL proof not found.');
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});


// MODIFIED: API routes for the users table to handle the new subscription fields
app.get('/api/users', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY registration_date DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.get('/api/users/stats', async (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const firstDayOfWeek = new Date(now.setDate(now.getDate() - now.getDay())).toISOString().split('T')[0];
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

    // Total users registered today
    const todayQuery = await pool.query('SELECT COUNT(*) FROM users WHERE registration_date = $1', [today]);
    const todayCount = parseInt(todayQuery.rows[0].count, 10);

    // Total users registered this week (Sunday to today)
    const weekQuery = await pool.query('SELECT COUNT(*) FROM users WHERE registration_date >= $1', [firstDayOfWeek]);
    const weekCount = parseInt(weekQuery.rows[0].count, 10);

    // Total users registered this month
    const monthQuery = await pool.query('SELECT COUNT(*) FROM users WHERE registration_date >= $1', [firstDayOfMonth]);
    const monthCount = parseInt(monthQuery.rows[0].count, 10);

    res.json({
      daily: todayCount,
      weekly: weekCount,
      monthly: monthCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});


// =================================================================
// --- START: NOWPayments API Routes ---
// =================================================================

// === START: NowPayments reconciliation helpers & sync endpoint ===

/**
 * Helper: try to extract plan name and telegram from order_description
 * order_description example: "NexxTrade Pro plan for @username"
 */
function parseOrderDescription(order_description = '') {
  const result = { planName: null, telegram: null };
  if (!order_description) return result;
  // try pattern "NexxTrade <Plan> plan for <telegram>"
  const m = order_description.match(/NexxTrade\s+(.+?)\s+plan\s+for\s+(@?\w[\w\-_.]*)/i);
  if (m) {
    result.planName = m[1];
    result.telegram = m[2].startsWith('@') ? m[2] : `@${m[2]}`;
    return result;
  }
  // fallback: look for an @handle
  const at = order_description.match(/(@[A-Za-z0-9_]+)/);
  if (at) result.telegram = at[1];
  // guess plan name as first word
  const p = order_description.match(/(Basic|Pro|Elite|Monthly|Quarterly|Bi-?annual|Annual)/i);
  if (p) result.planName = p[1];
  return result;
}

/**
 * Upsert a payment record returned from NowPayments into payments table.
 * p is the raw payment object from NowPayments GET list or GET payment.
 */
async function upsertPaymentFromNP(p) {
  try {
    const nowpayments_payment_id = p.id || p.payment_id || p.paymentId || null;
    const order_id = p.order_id || p.orderId || null;
    const price_amount = p.price_amount || p.priceAmount || null;
    const price_currency = p.price_currency || p.price_currency || p.priceCurrency || 'usd';
    const pay_amount = p.pay_amount || p.pay_amount || p.payAmount || null;
    const pay_currency = p.pay_currency || p.pay_currency || p.payCurrency || null;
    const payment_status = p.payment_status || p.status || p.paymentStatus || null;
    const order_description = p.order_description || p.orderDescription || '';

    // attempt to parse plan/telegram from description
    const parsed = parseOrderDescription(order_description);

    const insertQuery = `
      INSERT INTO payments
        (nowpayments_payment_id, order_id, telegram_handle, plan_name,
         price_amount, price_currency, pay_amount, pay_currency,
         payment_status, ipn_payload, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
      ON CONFLICT (nowpayments_payment_id) DO UPDATE
        SET order_id = COALESCE(EXCLUDED.order_id, payments.order_id),
            telegram_handle = COALESCE(EXCLUDED.telegram_handle, payments.telegram_handle),
            plan_name = COALESCE(EXCLUDED.plan_name, payments.plan_name),
            price_amount = COALESCE(EXCLUDED.price_amount, payments.price_amount),
            pay_amount = COALESCE(EXCLUDED.pay_amount, payments.pay_amount),
            pay_currency = COALESCE(EXCLUDED.pay_currency, payments.pay_currency),
            payment_status = EXCLUDED.payment_status,
            ipn_payload = EXCLUDED.ipn_payload,
            updated_at = NOW()
      RETURNING *;
    `;

    const values = [
      String(nowpayments_payment_id),
      order_id,
      parsed.telegram || null,
      parsed.planName || null,
      price_amount,
      price_currency,
      pay_amount,
      pay_currency,
      payment_status,
      JSON.stringify(p)
    ];

    const { rows } = await pool.query(insertQuery, values);
    const saved = rows[0];

    // If this payment is confirmed/finished — process subscription
    if (['confirmed', 'finished'].includes((payment_status || '').toLowerCase())) {
      await processConfirmedPayment(saved);
    }
    return saved;
  } catch (err) {
    console.error('upsertPaymentFromNP error', err);
    throw err;
  }
}

/**
 * Process payments that are confirmed/finished:
 * - find a user by order_id OR telegram_handle extracted from the payment.
 * - extend / create subscription in users (or subscriptions table).
 * This re-uses the same extension logic as your webhook.
 */
async function processConfirmedPayment(paymentRow) {
  try {
    // 1) Try to find a user by order_id
    let user = null;
    if (paymentRow.order_id) {
      const uRes = await pool.query('SELECT * FROM users WHERE order_id = $1', [paymentRow.order_id]);
      if (uRes.rows.length) user = uRes.rows[0];
    }

    // 2) fallback: try by telegram_handle in payments row
    if (!user && paymentRow.telegram_handle && paymentRow.plan_name) {
      const uRes = await pool.query('SELECT * FROM users WHERE telegram_handle = $1 AND plan_name = $2', [paymentRow.telegram_handle, paymentRow.plan_name]);
      if (uRes.rows.length > 0) {
          user = uRes.rows[0];
      }
    }

    // If still not found, log and stop (we still keep paymentRow)
    if (!user) {
      console.warn(`Confirmed payment ${paymentRow.nowpayments_payment_id} has no linked user (order_id=${paymentRow.order_id}).`);
      return;
    }
    
    // NEW: Use the plan name from the specific payment record for accurate extension
    const planNameForExtension = (paymentRow.plan_name || user.plan_name || '').toString().toLowerCase();

    if (!planNameForExtension) {
        console.warn(`Could not determine plan name for payment ${paymentRow.nowpayments_payment_id}. Skipping subscription update.`);
        return;
    }
    
    // Compute subscription extension: reuse your webhook approach
    const today = new Date();
    let baseDate = today;
    if (user.subscription_status === 'active' && user.subscription_expiration) {
      const currExp = new Date(user.subscription_expiration);
      if (currExp > today) baseDate = currExp;
    }
    
    let newExpiration = new Date(baseDate);

    if (planNameForExtension.includes('monthly') || planNameForExtension.includes('month')) {
      newExpiration.setMonth(newExpiration.getMonth() + 1);
    } else if (planNameForExtension.includes('quarter') || planNameForExtension.includes('quarterly')) {
      newExpiration.setMonth(newExpiration.getMonth() + 3);
    } else if (planNameForExtension.includes('bi') && planNameForExtension.includes('ann')) {
      newExpiration.setMonth(newExpiration.getMonth() + 6);
    } else if (planNameForExtension.includes('annual') || planNameForExtension.includes('year')) {
      newExpiration.setFullYear(newExpiration.getFullYear() + 1);
    } else {
      // fallback: add 30 days
      newExpiration.setDate(newExpiration.getDate() + 30);
    }

    // Update user's subscription status, expiration, and current plan name
    await pool.query(
      `UPDATE users SET subscription_status = 'active', subscription_expiration = $1, plan_name = $2 WHERE id = $3`,
      [newExpiration.toISOString().split('T')[0], (paymentRow.plan_name || user.plan_name), user.id]
    );

    // Optionally, create a subscriptions entry:
    await pool.query(
      `INSERT INTO subscriptions (user_id, plan_name, start_date, expiration_date, status)
       VALUES ($1,$2,$3,$4,'active')`,
      [user.id, (paymentRow.plan_name || user.plan_name || 'unknown'), new Date().toISOString().split('T')[0], newExpiration.toISOString().split('T')[0]]
    );

    console.log(`Activated/extended subscription for ${user.telegram_handle}. Plan: ${paymentRow.plan_name}. Expires ${newExpiration.toISOString().split('T')[0]}`);
  } catch (err) {
    console.error('processConfirmedPayment error', err);
    throw err;
  }
}

/**
 * POST /api/payments/nowpayments/sync-history
 * body: { dateFrom: 'YYYY-MM-DD', dateTo: 'YYYY-MM-DD' } (dateFrom optional)
 * This endpoint pages through NowPayments list API and upserts every payment.
 */
app.post('/api/payments/nowpayments/sync-history', async (req, res) => {
  try {
    let { dateFrom, dateTo } = req.body || {};
    const limit = 100;
    let page = 0;
    let totalProcessed = 0;

    // defaults
    if (!dateTo) {
      dateTo = new Date().toISOString().split('T')[0];
    }
    if (!dateFrom) {
      dateFrom = '2020-01-01'; // or choose a sane start date
    }

    while (true) {
      const url = `https://api.nowpayments.io/v1/payment/?limit=${limit}&page=${page}&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;
      const r = await fetch(url, { headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY } });
      if (!r.ok) {
        const text = await r.text();
        console.error('NowPayments list error', r.status, text);
        return res.status(500).json({ message: 'NowPayments API error', details: text });
      }
      
      const list = await r.json();
      // FIX: More robust handling of different NOWPayments API response structures.
      let payments = [];
      if (Array.isArray(list)) {
        payments = list;
      } else if (list && Array.isArray(list.data)) {
        payments = list.data;
      } else if (list && Array.isArray(list.payments)) {
        payments = list.payments;
      } else if (list && Array.isArray(list.items)) { 
        payments = list.items;
      }
      
      if (payments.length === 0) break;

      for (const p of payments) {
        await upsertPaymentFromNP(p);
        totalProcessed++;
      }

      // if fewer than limit returned, we've reached the end
      if (payments.length < limit) break;
      page++;
      // safety: don't loop forever
      if (page > 1000) break;
    }

    res.json({ message: 'Sync complete', processed: totalProcessed, dateFrom, dateTo });
  } catch (err) {
    console.error('sync-history error', err);
    res.status(500).json({ message: 'Server error' });
  }
});
// === END: NowPayments reconciliation helpers & sync endpoint ===


app.post('/api/payments/nowpayments/create', async (req, res) => {
    try {
        const { fullname, email, telegram, planName, priceUSD, pay_currency } = req.body;
        
        if (!priceUSD) {
            return res.status(400).json({ message: 'Invalid plan price provided.' });
        }
         if (!pay_currency) {
            return res.status(400).json({ message: 'Crypto network not specified.' });
        }
        
        const order_id = `nexxtrade-${telegram.replace('@', '')}-${Date.now()}`;
        const registrationDate = new Date().toISOString().split('T')[0];

        // This will create a new user record for each unique plan,
        // or update the existing record if they attempt to pay for the same plan again.
        await pool.query(
            `INSERT INTO users (full_name, email, telegram_handle, plan_name, subscription_status, registration_date, order_id, payment_attempts, last_payment_attempt)
             VALUES ($1, $2, $3, $4, 'pending', $5, $6, 1, NOW())
             ON CONFLICT (telegram_handle, plan_name) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                email = EXCLUDED.email,
                order_id = EXCLUDED.order_id,
                subscription_status = 'pending',
                payment_attempts = users.payment_attempts + 1,
                last_payment_attempt = NOW()`,
            [fullname, email, telegram, planName, registrationDate, order_id]
        );

        const nowPaymentsResponse = await fetch('https://api.nowpayments.io/v1/payment', {
            method: 'POST',
            headers: {
                'x-api-key': process.env.NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                price_amount: priceUSD,
                price_currency: 'usd',
                pay_currency: pay_currency,
                ipn_callback_url: `${process.env.APP_BASE_URL}/api/payments/nowpayments/webhook`,
                order_id: order_id,
                order_description: `NexxTrade ${planName} plan for ${telegram}`
            })
        });

        if (!nowPaymentsResponse.ok) {
            const errorText = await nowPaymentsResponse.text();
            console.error('NOWPayments API Error:', errorText)
            return res.status(500).json({ message: `Payment processor error: ${errorText}`});
        }

        const paymentData = await nowPaymentsResponse.json();
        
        // NEW: After creating a payment with NOWPayments, also create a record in our own 'payments' table.
        // This ensures every single attempt is logged with its specific plan details.
        await upsertPaymentFromNP(paymentData);

        res.status(200).json(paymentData);

    } catch (err) {
        console.error('Error creating NOWPayments payment:', err);
        res.status(500).json({ message: 'Server Error during payment creation.' });
    }
});

app.post('/api/payments/nowpayments/webhook', async (req, res) => {
    const ipnData = req.body;
    const hmac = req.headers['x-nowpayments-sig'];

    try {
        // First, verify the webhook signature
        const sortedData = JSON.stringify(ipnData, Object.keys(ipnData).sort());
        const calculatedHmac = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET)
            .update(Buffer.from(sortedData, 'utf-8'))
            .digest('hex');

        if (hmac !== calculatedHmac) {
            console.warn('Invalid HMAC signature received.');
            return res.status(401).send('Invalid HMAC signature');
        }

        // Second, update our 'payments' table with the final payload from the webhook
        await upsertPaymentFromNP(ipnData);
        // The upsertPaymentFromNP function will automatically call processConfirmedPayment 
        // if the status is 'confirmed' or 'finished'.

        res.status(200).send('IPN received.');

    } catch (err) {
        console.error('Error processing NOWPayments webhook:', err);
        res.status(500).send('Server Error');
    }
});

app.get('/api/payments/nowpayments/status/:payment_id', async (req, res) => {
    try {
        const { payment_id } = req.params;
        const response = await fetch(`https://api.nowpayments.io/v1/payment/${payment_id}`, {
            headers: { 'x-api-key': process.env.NOWPAYMENTS_API_KEY }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch payment status from NOWPayments.');
        }

        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('Error fetching payment status:', err.message);
        res.status(500).send('Server Error');
    }
});

// =================================================================
// --- END: NOWPayments API Routes ---
// =================================================================

// NEW: Endpoint to update user details after payment
app.put('/api/users/update-details', async (req, res) => {
    const { telegram_handle, full_name, email } = req.body;
    if (!telegram_handle || !full_name || !email) {
        return res.status(400).json({ message: 'Missing required user details.' });
    }
    try {
        // Find user by telegram_handle and update their name and email.
        const { rows } = await pool.query(
            "UPDATE users SET full_name = $1, email = $2 WHERE telegram_handle = $3 RETURNING *",
            [full_name, email, telegram_handle]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.status(200).json(rows[0]);
    } catch (err) {
        console.error('Error updating user details:', err);
         if (err.code === '23505') { // Handle unique constraint violation for email
            return res.status(409).json({ message: 'This email address is already in use.' });
        }
        res.status(500).json({ message: 'Server Error' });
    }
});


// NEW ROUTE: Endpoint for cleaning up expired subscriptions
app.post('/api/subscriptions/cleanup', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Find all users with active subscriptions that have expired
        const { rows } = await pool.query(
            "SELECT id, telegram_handle FROM users WHERE subscription_status = 'active' AND subscription_expiration < $1",
            [today]
        );

        if (rows.length === 0) {
            return res.status(200).json({ message: 'No expired subscriptions found.' });
        }

        // Update their status to 'expired'
        await pool.query(
            "UPDATE users SET subscription_status = 'expired' WHERE subscription_status = 'active' AND subscription_expiration < $1",
            [today]
        );
        console.log(`Updated ${rows.length} users with expired subscriptions.`);
        res.json({
            message: `Processed ${rows.length} expired subscriptions.`,
            expired_users: rows
        });

    } catch (err) {
        console.error('Error processing subscription cleanup:', err);
        res.status(500).json({ message: 'Server Error' });
    }
});


// NEW ROUTE: Endpoint to find a user's status by Telegram handle
app.get('/api/users/status-by-telegram-handle/:telegram_handle', async (req, res) => {
    try {
        const { telegram_handle } = req.params;

        // First, check if the user has ANY active subscription.
        const activeSubQuery = await pool.query(
            "SELECT subscription_status, subscription_expiration, plan_name FROM users WHERE telegram_handle = $1 AND subscription_status = 'active' ORDER BY subscription_expiration DESC LIMIT 1",
            [`@${telegram_handle}`]
        );
        
        // If an active subscription exists, return that one.
        if (activeSubQuery.rows.length > 0) {
            return res.json(activeSubQuery.rows[0]);
        }
        
        // If no active subscription, find the most recent record for this user (newest attempt).
        const latestAttemptQuery = await pool.query(
            'SELECT subscription_status, subscription_expiration, plan_name FROM users WHERE telegram_handle = $1 ORDER BY id DESC LIMIT 1',
            [`@${telegram_handle}`]
        );
        
        if (latestAttemptQuery.rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        
        res.json(latestAttemptQuery.rows[0]);
    } catch (err) {
        console.error('Error finding user status by Telegram handle:', err);
        res.status(500).json({ message: 'Server Error' });
    }
});

// NEW ROUTE: Endpoint to find a user's ID by Telegram handle
app.get('/api/users/find-by-telegram-handle/:telegram_handle', async (req, res) => {
    try {
        const { telegram_handle } = req.params;
        const { rows } = await pool.query(
            'SELECT id, telegram_handle FROM users WHERE telegram_handle = $1',
            [telegram_handle]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error('Error finding user by Telegram handle:', err);
        res.status(500).json({ message: 'Server Error' });
    }
});

// NEW ENDPOINT: Verify Telegram user and redeem token
app.post('/api/users/verify-telegram', async (req, res) => {
    const { telegram_handle, telegram_invite_token } = req.body;

    if (!telegram_handle || !telegram_invite_token) {
        return res.status(400).json({ message: 'Missing Telegram handle or token.' });
    }

    try {
        const { rows } = await pool.query(
            'SELECT * FROM users WHERE telegram_handle = $1 AND telegram_invite_token = $2',
            [telegram_handle, telegram_invite_token]
        );

        if (rows.length > 0) {
            const user = rows[0];
            await pool.query(
                'UPDATE users SET telegram_invite_token = NULL WHERE id = $1',
                [user.id]
            );
            res.status(200).json({
                message: 'Verification successful. User is active.',
                user: { id: user.id, email: user.email, telegram_handle: user.telegram_handle, plan_name: user.plan_name }
            });
        } else {
            res.status(404).json({ message: 'User not found or token is invalid.' });
        }
    } catch (err) {
        console.error('Error verifying Telegram user:', err);
        res.status(500).json({ message: 'Server Error' });
    }
});

// NEW: Add a POST route to handle Telegram webhooks.
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
app.post(`/bot${telegramToken}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});


// --- UPDATED: Routes for Clean URLs ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/*', (req, res) => {
    // This will catch all routes and redirect to the correct html file.
    const route = req.path.split('/')[1] || '';
    switch(route) {
        case 'join':
            res.sendFile(path.join(__dirname, 'public', 'registration.html'));
            break;
        case 'performance':
            res.sendFile(path.join(__dirname, 'public', 'performance.html'));
            break;
        case 'blog':
            res.sendFile(path.join(__dirname, 'public', 'blog.html'));
            break;
        case 'admin':
            // covers /admin, /admin/login, /admin/dashboard, etc.
            const adminRoute = req.path.split('/')[2] || 'login';
             const adminFiles = {
                'login': 'admin.html',
                'dashboard': 'admin_dashboard.html',
                'blogs': 'admin_blogs.html',
                'performance': 'admin_performance.html',
                'pricing': 'admin_pricing.html',
                'roles': 'admin_roles.html'
            };
            const adminFile = adminFiles[adminRoute] || 'admin.html';
            res.sendFile(path.join(__dirname, 'public', adminFile));
            break;
        default:
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
            break;
    }
});


// Start the server
app.listen(port, async () => {
  console.log(`Server is running on http://localhost:${port}`);
  await setupWebhook();
});

