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
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// API Routes for Pricing Plans Management
app.get('/api/pricing', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pricingplans ORDER BY price ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.post('/api/pricing', async (req, res) => {
  try {
    const { plan_name, price, term, description, features, is_best_value } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO pricingplans(plan_name, price, term, description, features, is_best_value) VALUES($1, $2, $3, $4, $5, $6) RETURNING *',
      [plan_name, price, term, description, features, is_best_value]
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
    const { plan_name, price, term, description, features, is_best_value } = req.body;
    const { rows } = await pool.query(
      'UPDATE pricingplans SET plan_name = $1, price = $2, term = $3, description = $4, features = $5, is_best_value = $6 WHERE id = $7 RETURNING *',
      [plan_name, price, term, description, features, is_best_value, id]
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
app.get('/api/roles', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, role, permissions FROM adminusers');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.post('/api/roles', async (req, res) => {
  try {
    const { username, password, role, permissions } = req.body;
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const { rows } = await pool.query(
      'INSERT INTO adminusers(username, hashed_password, role, permissions) VALUES($1, $2, $3, $4) RETURNING id, username, role, permissions',
      [username, hashedPassword, role, permissions]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error creating new user:', err);
    if (err.code === '23505') {
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

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const { rows } = await pool.query('SELECT * FROM adminusers WHERE username = $1', [username]);
        if (rows.length > 0) {
            const user = rows[0];
            const match = await bcrypt.compare(password, user.hashed_password);
            if (match) {
                res.status(200).json({
                    message: 'Login successful',
                    user: { id: user.id, username: user.username, role: user.role, permissions: user.permissions }
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
app.get('/api/performances', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM performancesignals ORDER BY date DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
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

// API routes for PNL Proofs
app.get('/api/pnlproofs', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pnlproofs');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

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

// API routes for the users table
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
    const todayQuery = await pool.query('SELECT COUNT(*) FROM users WHERE registration_date = $1', [today]);
    const weekQuery = await pool.query('SELECT COUNT(*) FROM users WHERE registration_date >= $1', [firstDayOfWeek]);
    const monthQuery = await pool.query('SELECT COUNT(*) FROM users WHERE registration_date >= $1', [firstDayOfMonth]);

    res.json({
      daily: parseInt(todayQuery.rows[0].count, 10),
      weekly: parseInt(weekQuery.rows[0].count, 10),
      monthly: parseInt(monthQuery.rows[0].count, 10),
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Endpoint for OPay payment initiation
app.post('/api/payments/opay', async (req, res) => {
    try {
        const { fullname, email, telegram, plan } = req.body;
        const USD_TO_NGN_RATE = 1500;
        const prices = { monthly: 35, quarterly: 89, yearly: 210 };
        const amountUSD = prices[plan];
        if (!amountUSD) return res.status(400).json({ message: 'Invalid plan selected.' });
        
        const amountNGN = amountUSD * USD_TO_NGN_RATE;
        const transactionRef = crypto.randomBytes(16).toString('hex');

        const registrationDate = new Date().toISOString().split('T')[0];
        await pool.query(
            `INSERT INTO users (full_name, email, telegram_handle, plan_name, subscription_status, registration_date, order_id)
             VALUES ($1, $2, $3, $4, 'pending', $5, $6)
             ON CONFLICT (email) DO UPDATE SET full_name = $1, telegram_handle = $2, plan_name = $4, subscription_status = 'pending', order_id = $6`,
            [fullname, email, telegram, plan, registrationDate, transactionRef]
        );
        
        const mockRedirectUrl = `https://mock-opay.com/pay?ref=${transactionRef}&amount=${amountNGN}`;
        res.status(200).json({ message: 'Payment initiated.', redirectUrl: mockRedirectUrl });

    } catch (err) {
        console.error('Error initiating OPay payment:', err);
        res.status(500).json({ message: 'Server Error during payment initiation.' });
    }
});


// =================================================================
// --- NOWPayments API Routes ---
// =================================================================

app.post('/api/payments/nowpayments/create', async (req, res) => {
    try {
        const { fullname, email, telegram, plan } = req.body;
        
        const prices = { monthly: 35, quarterly: 89, yearly: 210 };
        const amountUSD = prices[plan];

        if (!amountUSD) {
            return res.status(400).json({ message: 'Invalid plan selected.' });
        }
        
        const order_id = `nexxtrade-${telegram.replace('@', '')}-${Date.now()}`;
        
        const registrationDate = new Date().toISOString().split('T')[0];
        await pool.query(
            `INSERT INTO users (full_name, email, telegram_handle, plan_name, subscription_status, registration_date, order_id)
             VALUES ($1, $2, $3, $4, 'pending', $5, $6)
             ON CONFLICT (email) DO UPDATE SET full_name = $1, telegram_handle = $2, plan_name = $4, subscription_status = 'pending', order_id = $6`,
            [fullname, email, telegram, plan, registrationDate, order_id]
        );

        const payload = {
            price_amount: amountUSD,
            price_currency: 'usd',
            pay_currency: 'usdttrc20',
            ipn_callback_url: `${process.env.APP_BASE_URL}/api/payments/nowpayments/webhook`,
            order_id: order_id,
            order_description: `NexxTrade ${plan} plan for ${telegram}`
        };

        const nowPaymentsResponse = await fetch('https://api.nowpayments.io/v1/payment', {
            method: 'POST',
            headers: {
                'x-api-key': process.env.NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!nowPaymentsResponse.ok) {
            const errorText = await nowPaymentsResponse.text();
            throw new Error(`NOWPayments API error: ${errorText}`);
        }

        const paymentData = await nowPaymentsResponse.json();
        res.status(200).json(paymentData);

    } catch (err) {
        console.error('Error creating NOWPayments payment:', err);
        res.status(500).json({ message: 'Server Error during payment creation.' });
    }
});

// Webhook to receive payment status updates from NOWPayments
app.post('/api/payments/nowpayments/webhook', async (req, res) => {
    const ipnData = req.body;
    const hmac = req.headers['x-nowpayments-sig'];

    try {
        const sortedData = JSON.stringify(ipnData, Object.keys(ipnData).sort());
        const calculatedHmac = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET)
            .update(Buffer.from(sortedData, 'utf-8'))
            .digest('hex');

        if (hmac !== calculatedHmac) {
            console.warn('Invalid HMAC signature received.');
            return res.status(401).send('Invalid HMAC signature');
        }

        if (['finished', 'confirmed'].includes(ipnData.payment_status)) {
            const { order_id } = ipnData;
            
            const userResult = await pool.query('SELECT * FROM users WHERE order_id = $1', [order_id]);
            if (userResult.rows.length === 0) {
                console.error(`User with order_id ${order_id} not found.`);
                return res.status(404).send('User not found.');
            }
            
            const user = userResult.rows[0];
            
            let expirationDate = new Date();
            if (user.plan_name === 'monthly') expirationDate.setMonth(expirationDate.getMonth() + 1);
            else if (user.plan_name === 'quarterly') expirationDate.setMonth(expirationDate.getMonth() + 3);
            else if (user.plan_name === 'yearly') expirationDate.setMonth(expirationDate.getMonth() + 6);

            await pool.query(
                `UPDATE users SET subscription_status = 'active', subscription_expiration = $1 WHERE order_id = $2`,
                [expirationDate.toISOString().split('T')[0], order_id]
            );

            console.log(`Subscription for ${user.email} activated. Expires: ${expirationDate.toISOString().split('T')[0]}`);
        }
        
        res.status(200).send('IPN received.');

    } catch (err) {
        console.error('Error processing NOWPayments webhook:', err);
        res.status(500).send('Server Error');
    }
});

// Endpoint for the frontend to poll for payment status
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


// Endpoint to find a user's status by Telegram handle
app.get('/api/users/status-by-telegram-handle/:telegram_handle', async (req, res) => {
    try {
        const { telegram_handle } = req.params;
        const { rows } = await pool.query(
            'SELECT subscription_status, subscription_expiration FROM users WHERE telegram_handle = $1',
            [`@${telegram_handle}`]
        );
        if (rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error('Error finding user status by Telegram handle:', err);
        res.status(500).json({ message: 'Server Error' });
    }
});


// Telegram Webhook
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
app.post(`/bot${telegramToken}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});


// --- Routes for Clean URLs ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, 'public', 'registration.html')));
app.get('/performance', (req, res) => res.sendFile(path.join(__dirname, 'public', 'performance.html')));
app.get('/blog', (req, res) => res.sendFile(path.join(__dirname, 'public', 'blog.html')));

// Admin Routes
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin_dashboard.html')));
app.get('/admin/blogs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin_blogs.html')));
app.get('/admin/performance', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin_performance.html')));
app.get('/admin/pricing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin_pricing.html')));
app.get('/admin/roles', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin_roles.html')));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Start the server
app.listen(port, async () => {
  console.log(`Server is running on http://localhost:${port}`);
  await setupWebhook();
});
