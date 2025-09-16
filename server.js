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
    // This setting is often needed for cloud-based PostgreSQL providers
    rejectUnauthorized: false
  }
});

// Serve static files from the 'public' directory (CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));


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
    if (!nowpayments_payment_id) {
        console.error("Could not determine nowpayments_payment_id from payload", p);
        return;
    }
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
    // The original logic tied order_id directly to a user, which was problematic.
    // Now, order_id is in payments. We find the user via the telegram_handle stored in the payment record.
    if (paymentRow.telegram_handle) {
        const uRes = await pool.query('SELECT * FROM users WHERE telegram_handle = $1', [paymentRow.telegram_handle]);
        if (uRes.rows.length) user = uRes.rows[0];
    }

    // If still not found, log and stop (we still keep paymentRow)
    if (!user) {
      console.warn(`Confirmed payment ${paymentRow.nowpayments_payment_id} has no linked user (telegram=${paymentRow.telegram_handle}).`);
      return;
    }

    // Compute subscription extension: reuse your webhook approach
    const today = new Date();
    let baseDate = today;
    if (user.subscription_status === 'active' && user.subscription_expiration) {
      const currExp = new Date(user.subscription_expiration);
      if (currExp > today) baseDate = currExp;
    }

    // planName from paymentRow.plan_name or user.plan_name or fallback to parsing order_description
    let planName = paymentRow.plan_name || user.plan_name || '';
    planName = (planName || '').toString();

    let newExpiration = new Date(baseDate);
    const lower = planName.toLowerCase();

    if (lower.includes('monthly') || lower.includes('month')) {
      newExpiration.setMonth(newExpiration.getMonth() + 1);
    } else if (lower.includes('quarter') || lower.includes('quarterly')) {
      newExpiration.setMonth(newExpiration.getMonth() + 3);
    } else if (lower.includes('bi') && lower.includes('ann')) {
      newExpiration.setMonth(newExpiration.getMonth() + 6);
    } else if (lower.includes('annual') || lower.includes('year')) {
      newExpiration.setFullYear(newExpiration.getFullYear() + 1);
    } else {
      // fallback: add 30 days
      newExpiration.setDate(newExpiration.getDate() + 30);
    }

    // Update user's subscription status and expiration
    await pool.query(
      `UPDATE users SET subscription_status = 'active', subscription_expiration = $1, plan_name = $2 WHERE id = $3`,
      [newExpiration.toISOString().split('T')[0], planName, user.id]
    );

    // Optionally, create a subscriptions entry:
    await pool.query(
      `INSERT INTO subscriptions (user_id, plan_name, start_date, expiration_date, status)
       VALUES ($1,$2,$3,$4,'active')
       ON CONFLICT (user_id, plan_name, start_date) DO NOTHING`, // A user might rebuy the same plan, avoid unique constraint errors.
      [user.id, planName || user.plan_name || 'unknown', new Date().toISOString().split('T')[0], newExpiration.toISOString().split('T')[0]]
    );

    console.log(`Activated/extended subscription for ${user.telegram_handle}. Expires ${newExpiration.toISOString().split('T')[0]}`);
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
  // IMPORTANT: Protect this endpoint in a production environment (e.g., with an admin token or IP restriction)
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
      
      const payments = list.data || [];
      if (!payments || payments.length === 0) break;

      for (const p of payments) {
        await upsertPaymentFromNP(p);
        totalProcessed++;
      }

      if (payments.length < limit) break;
      page++;
      if (page > 1000) break; // safety break
    }

    res.json({ message: 'Sync complete', processed: totalProcessed, dateFrom, dateTo });
  } catch (err) {
    console.error('sync-history error', err);
    res.status(500).json({ message: 'Server error' });
  }
});
// === END: NowPayments reconciliation helpers & sync endpoint ===


// NOWPayments API Integration

// MODIFIED: Endpoint to create a payment with NOWPayments
app.post('/api/payments/nowpayments/create', async (req, res) => {
    try {
        const { telegram_handle, plan_name, price_usd } = req.body;
        if (!telegram_handle || !plan_name || !price_usd) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const order_id = `nexxtrade_${telegram_handle.replace('@','')}_${Date.now()}`;
        const order_description = `NexxTrade ${plan_name} plan for ${telegram_handle}`;

        // Ensure a user profile exists, but do not overwrite payment-related info.
        // This query now only ensures the user exists and updates their plan_name if needed.
        await pool.query(
            `INSERT INTO users (telegram_handle, registration_date, plan_name)
             VALUES ($1, NOW(), $2)
             ON CONFLICT (telegram_handle) DO UPDATE SET plan_name = EXCLUDED.plan_name`,
            [telegram_handle, plan_name]
        );

        const nowPaymentsPayload = {
            price_amount: parseFloat(price_usd),
            price_currency: 'usd',
            order_id: order_id,
            order_description: order_description,
            ipn_callback_url: `${process.env.APP_BASE_URL}/api/payments/nowpayments/webhook`,
        };

        const nowPaymentsResponse = await fetch('https://api.nowpayments.io/v1/payment', {
            method: 'POST',
            headers: {
                'x-api-key': process.env.NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(nowPaymentsPayload),
        });

        if (!nowPaymentsResponse.ok) {
            const errorText = await nowPaymentsResponse.text();
            console.error('NOWPayments API error:', errorText);
            return res.status(nowPaymentsResponse.status).json({ message: 'Failed to create payment with NOWPayments', details: errorText });
        }

        const paymentData = await nowPaymentsResponse.json();

        // NEW: Insert the new payment into our payments table.
        // We pass the full context so the telegram handle and plan can be correctly parsed and stored.
        await upsertPaymentFromNP({ ...paymentData, order_id: order_id, order_description: order_description, telegram_handle: telegram_handle, plan_name: plan_name});

        res.status(200).json(paymentData);

    } catch (error) {
        console.error('Error creating payment:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


// MODIFIED: Webhook endpoint to receive updates from NOWPayments
app.post('/api/payments/nowpayments/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-nowpayments-sig'];
        const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;

        if (!ipnSecret) {
            console.error('NOWPAYMENTS_IPN_SECRET is not set.');
            return res.status(500).send('IPN secret not configured');
        }

        // Verify the signature
        const hmac = crypto.createHmac('sha512', ipnSecret);
        const sortedBody = JSON.stringify(req.body, Object.keys(req.body).sort());
        hmac.update(sortedBody);
        const expectedSignature = hmac.digest('hex');

        if (signature !== expectedSignature) {
            console.warn('Invalid IPN signature received.');
            return res.status(401).send('Invalid signature');
        }

        // If signature is valid, process the payment update using the shared helper
        await upsertPaymentFromNP(req.body);

        res.sendStatus(200);
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).send('Error processing webhook');
    }
});


// API Routes
// GET /api/blogs - Fetches all blog posts
app.get('/api/blogs', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM blogs ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching blogs:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// POST /api/blogs - Creates a new blog post
app.post('/api/blogs', async (req, res) => {
    try {
        const { title, content, author, image_url } = req.body;
        const result = await pool.query(
            'INSERT INTO blogs (title, content, author, image_url) VALUES ($1, $2, $3, $4) RETURNING *',
            [title, content, author, image_url]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating blog post:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// PUT /api/blogs/:id - Updates an existing blog post
app.put('/api/blogs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, author, image_url } = req.body;
        const result = await pool.query(
            'UPDATE blogs SET title = $1, content = $2, author = $3, image_url = $4 WHERE id = $5 RETURNING *',
            [title, content, author, image_url, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating blog post:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// DELETE /api/blogs/:id - Deletes a blog post
app.delete('/api/blogs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM blogs WHERE id = $1', [id]);
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting blog post:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// GET /api/pricing - Fetches all pricing plans
app.get('/api/pricing', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pricing_plans ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching pricing plans:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// POST /api/pricing - Creates a new pricing plan
app.post('/api/pricing', async (req, res) => {
    try {
        const { plan_name, price_usd, features, telegram_group_id } = req.body;
        const result = await pool.query(
            'INSERT INTO pricing_plans (plan_name, price_usd, features, telegram_group_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [plan_name, price_usd, features, telegram_group_id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating pricing plan:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// PUT /api/pricing/:id - Updates an existing pricing plan
app.put('/api/pricing/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { plan_name, price_usd, features, telegram_group_id } = req.body;
        const result = await pool.query(
            'UPDATE pricing_plans SET plan_name = $1, price_usd = $2, features = $3, telegram_group_id = $4 WHERE id = $5 RETURNING *',
            [plan_name, price_usd, features, telegram_group_id, id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating pricing plan:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// DELETE /api/pricing/:id - Deletes a pricing plan
app.delete('/api/pricing/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM pricing_plans WHERE id = $1', [id]);
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting pricing plan:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// GET /api/roles - Fetches all admin roles
app.get('/api/roles', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM admin_roles ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching roles:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// POST /api/roles - Creates a new admin role
app.post('/api/roles', async (req, res) => {
    try {
        const { username, password, role } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO admin_roles (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
            [username, hashedPassword, role]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating role:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// PUT /api/roles/:id - Updates an existing admin role
app.put('/api/roles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { username, password, role } = req.body;
        let query;
        let values;
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            query = 'UPDATE admin_roles SET username = $1, password_hash = $2, role = $3 WHERE id = $4 RETURNING id, username, role';
            values = [username, hashedPassword, role, id];
        } else {
            query = 'UPDATE admin_roles SET username = $1, role = $2 WHERE id = $3 RETURNING id, username, role';
            values = [username, role, id];
        }
        const result = await pool.query(query, values);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating role:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// DELETE /api/roles/:id - Deletes an admin role
app.delete('/api/roles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM admin_roles WHERE id = $1', [id]);
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting role:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// GET /api/performance - Fetches all performance records
app.get('/api/performance', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM performance_data ORDER BY date DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching performance data:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// POST /api/performance - Creates a new performance record
app.post('/api/performance', async (req, res) => {
    try {
        const { pair, entry_price, exit_price, date, notes } = req.body;
        const result = await pool.query(
            'INSERT INTO performance_data (pair, entry_price, exit_price, date, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [pair, entry_price, exit_price, date, notes]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating performance data:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// DELETE /api/performance/:id - Deletes a performance record
app.delete('/api/performance/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM performance_data WHERE id = $1', [id]);
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting performance data:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// Admin login route
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM admin_roles WHERE username = $1', [username]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const match = await bcrypt.compare(password, user.password_hash);
            if (match) {
                // In a real app, you would create a session/token here
                res.json({ success: true, message: 'Login successful', user: { id: user.id, username: user.username, role: user.role } });
            } else {
                res.status(401).json({ success: false, message: 'Invalid credentials' });
            }
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (err) {
        console.error('Admin login error:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// Root route - serves the main landing page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/join', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'registration.html'));
});

app.get('/performance', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'performance.html'));
});

app.get('/blog', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'blog.html'));
});

// Admin Routes
app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin_dashboard.html'));
});

app.get('/admin/blogs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin_blogs.html'));
});

app.get('/admin/performance', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin_performance.html'));
});

app.get('/admin/pricing', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin_pricing.html'));
});

app.get('/admin/roles', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin_roles.html'));
});

// Telegram Bot Webhook
// This single endpoint receives all updates from the Telegram bot.
app.post(`/bot${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    // Setup the Telegram webhook when the server starts
    setupWebhook();
});

