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
// This allows the server to command the bot (e.g., to create invite links).
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
// --- START: Fiat Payment API Routes (Placeholder) ---
// =================================================================

app.post('/api/payments/fiat/create', async (req, res) => {
    try {
        const { fullname, email, telegram, whatsapp_number, planName, priceUSD } = req.body;

        if (!fullname || !email || !telegram || !whatsapp_number || !planName || !priceUSD) {
            return res.status(400).json({ message: 'Missing required fields for payment.' });
        }
        
        const order_id = `nexxtrade-fiat-${telegram.replace('@', '')}-${Date.now()}`;
        
        // In a real application, you would now call your payment provider's API
        // to get a real payment link. For this example, we'll return a placeholder.
        // This simulates redirecting the user to a payment gateway like OPay, Stripe, etc.
        const dummyPaymentGatewayUrl = `https://your-payment-provider.com/checkout?order_id=${order_id}&amount=${priceUSD}`;

        res.status(200).json({ 
            message: 'Payment initiated successfully. Redirecting...',
            redirectUrl: dummyPaymentGatewayUrl 
        });

    } catch (err) {
        console.error('Error creating Fiat payment:', err);
        res.status(500).json({ message: 'Server Error during payment initiation.' });
    }
});


// =================================================================
// --- END: Fiat Payment API Routes ---
// =================================================================


// =================================================================
// --- START: UNIFIED PAYMENT FLOW (WEB + TELEGRAM BOT) ---
// =================================================================

// === Flow 1: User starts payment from the Website ===
app.post('/api/payments/create-from-web', async (req, res) => {
    try {
        const { fullname, email, telegram, planName, pay_currency, whatsapp_number } = req.body;
        
        if (!pay_currency || !fullname || !email || !telegram || !whatsapp_number || !planName) {
            return res.status(400).json({ message: 'Missing required fields for payment.' });
        }

        const planResult = await pool.query('SELECT * FROM pricingplans WHERE plan_name = $1', [planName]);
        if (planResult.rows.length === 0) {
            return res.status(404).json({ message: 'Selected plan not found.' });
        }
        const plan = planResult.rows[0];

        console.log('WEB: PLAN DETAILS FETCHED FOR PAYMENT:', plan);
        if (!plan.price || typeof plan.price !== 'number' || plan.price <= 0) {
            console.error(`WEB: Invalid price for plan ${planName}:`, plan.price);
            return res.status(500).json({ message: `Payment processor error: The price for the selected plan is invalid. Please contact support.` });
        }
        
        const order_id = `nexxtrade-web-${telegram.replace('@', '')}-${Date.now()}`;
        
        // --- LOGIC TO HANDLE EMAIL UNIQUENESS ---
        const existingUserPlanQuery = await pool.query(
            'SELECT * FROM users WHERE telegram_handle = $1 AND plan_name = $2',
            [telegram, planName]
        );
        
        let emailForDb = email; // Default to the provided email

        if (existingUserPlanQuery.rows.length > 0) {
            const userRecord = existingUserPlanQuery.rows[0];
            if (userRecord.subscription_status === 'active') {
                return res.status(409).json({ message: `You already have an active subscription for the ${planName} plan.` });
            }

            // For pending user, check if the updated email conflicts with ANOTHER user.
            const emailConflictQuery = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, userRecord.id]);
            if (emailConflictQuery.rows.length > 0) {
                console.warn(`WEB UPDATE: Email "${email}" conflicts with another user. Keeping original email for user ID ${userRecord.id}.`);
                emailForDb = userRecord.email; // Revert to the old email to avoid conflict and proceed.
            }

            await pool.query(
                `UPDATE users SET full_name = $1, email = $2, whatsapp_number = $3, order_id = $4, subscription_status = 'pending', last_payment_attempt = NOW(), payment_attempts = payment_attempts + 1, registration_source = 'web' WHERE id = $5`,
                [fullname, emailForDb, whatsapp_number, order_id, userRecord.id]
            );
        } else {
            // New user registration for this plan. Check if the email is taken by anyone.
            const emailConflictQuery = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
            if (emailConflictQuery.rows.length > 0) {
                console.warn(`WEB INSERT: Email "${email}" already exists. Generating synthetic email for telegram user "${telegram}".`);
                // Create a synthetic email to allow registration to proceed
                emailForDb = `${telegram.replace('@', '')}.${crypto.randomBytes(3).toString('hex')}@telegram.user`;
            }
            
            const registrationDate = new Date().toISOString().split('T')[0];
            await pool.query(
                `INSERT INTO users (full_name, email, telegram_handle, plan_name, subscription_status, registration_date, order_id, payment_attempts, last_payment_attempt, registration_source, whatsapp_number)
                 VALUES ($1, $2, $3, $4, 'pending', $5, $6, 1, NOW(), 'web', $7)`,
                [fullname, emailForDb, telegram, planName, registrationDate, order_id, whatsapp_number]
            );
        }

        const nowPaymentsResponse = await fetch('https://api.nowpayments.io/v1/payment', {
            method: 'POST',
            headers: {
                'x-api-key': process.env.NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                price_amount: plan.price,
                price_currency: 'usd',
                pay_currency: pay_currency,
                ipn_callback_url: `${process.env.APP_BASE_URL}/api/payments/nowpayments/webhook`,
                order_id: order_id,
                order_description: `NexxTrade ${planName} plan for ${telegram} (Web)`
            })
        });

        if (!nowPaymentsResponse.ok) {
            const errorText = await nowPaymentsResponse.text();
            console.error('NOWPayments API Error:', errorText);
            return res.status(500).json({ message: `Payment processor error: ${errorText}`});
        }

        const paymentData = await nowPaymentsResponse.json();
        
        res.status(200).json(paymentData);

    } catch (err) {
        console.error('Error creating payment from web:', err);
        res.status(500).json({ message: 'Server Error during payment creation.' });
    }
});

// === Flow 2: User starts payment from the Telegram Bot ===
app.post('/api/payments/create-from-bot', async (req, res) => {
    try {
        const { telegram_handle, chat_id, plan_id, pay_currency, whatsapp_number } = req.body;
        if (!telegram_handle || !chat_id || !plan_id || !pay_currency || !whatsapp_number) {
            return res.status(400).json({ message: 'Missing required fields from bot.' });
        }

        // Fetch plan details
        const planResult = await pool.query('SELECT * FROM pricingplans WHERE id = $1', [plan_id]);
        if (planResult.rows.length === 0) {
            return res.status(404).json({ message: 'Plan not found.' });
        }
        const plan = planResult.rows[0];
        console.log('BOT: PLAN DETAILS FETCHED FOR PAYMENT:', plan);

        if (!plan.price || typeof plan.price !== 'number' || plan.price <= 0) {
            console.error(`BOT: Invalid price for plan ID ${plan_id}:`, plan.price);
            return res.status(500).json({ message: `Payment processor error: The price for the selected plan is invalid. Please contact support.` });
        }

        // Generate a new order ID
        const order_id = `nexxtrade-bot-${telegram_handle.replace('@', '')}-${Date.now()}`;

        // STEP 1: Check if this user already has this plan
        const existingUserPlan = await pool.query(
            'SELECT * FROM users WHERE telegram_handle = $1 AND plan_name = $2',
            [telegram_handle, plan.plan_name]
        );

        if (existingUserPlan.rows.length > 0) {
            const userRecord = existingUserPlan.rows[0];

            if (userRecord.subscription_status === 'active') {
                // Already bought and active
                return res.status(409).json({ message: `You already have an active subscription for the ${plan.plan_name} plan.` });
            }

            // Pending subscription exists → Update the record
            await pool.query(
                `UPDATE users SET whatsapp_number = $1, order_id = $2, subscription_status = 'pending', last_payment_attempt = NOW(), payment_attempts = payment_attempts + 1, telegram_chat_id = $3, registration_source = 'bot'
                 WHERE id = $4`,
                [whatsapp_number, order_id, chat_id, userRecord.id]
            );

        } else {
            // STEP 2: This user does NOT have this plan yet → Create a new record
            const temp_fullname = `User ${telegram_handle}`;
            const temp_email = `${telegram_handle.replace('@','')}@telegram.user`; // still needed for column but not unique logic
            const registrationDate = new Date().toISOString().split('T')[0];

            await pool.query(
                `INSERT INTO users (full_name, email, telegram_handle, plan_name, subscription_status, registration_date, order_id, payment_attempts, last_payment_attempt, telegram_chat_id, registration_source, whatsapp_number)
                 VALUES ($1, $2, $3, $4, 'pending', $5, $6, 1, NOW(), $7, 'bot', $8)`,
                [temp_fullname, temp_email, telegram_handle, plan.plan_name, registrationDate, order_id, chat_id, whatsapp_number]
            );
        }

        // Call NowPayments API to create the payment
        const nowPaymentsResponse = await fetch('https://api.nowpayments.io/v1/payment', {
            method: 'POST',
            headers: {
                'x-api-key': process.env.NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                price_amount: plan.price,
                price_currency: 'usd',
                pay_currency: pay_currency,
                ipn_callback_url: `${process.env.APP_BASE_URL}/api/payments/nowpayments/webhook`,
                order_id: order_id,
                order_description: `NexxTrade ${plan.plan_name} plan for ${telegram_handle} (Bot)`
            })
        });

        if (!nowPaymentsResponse.ok) {
            const errorText = await nowPaymentsResponse.text();
            return res.status(500).json({ message: `Payment processor error: ${errorText}` });
        }

        const paymentData = await nowPaymentsResponse.json();
        res.status(200).json(paymentData);

    } catch (err) {
        console.error('Error creating payment from bot:', err);
        res.status(500).json({ message: 'Server Error during bot payment creation.' });
    }
});


// === Confirmation (Webhook): The single source of truth for payment completion ===
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
        
        const { order_id, payment_status } = ipnData;
        
        // Only process finished/confirmed payments
        if (['finished', 'confirmed'].includes(payment_status)) {
            // Find the user record associated with this order
            const userResult = await pool.query('SELECT * FROM users WHERE order_id = $1', [order_id]);
            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                
                // Activate the subscription (set expiration date, status, etc.)
                // This logic is simplified; you'd have your full subscription extension logic here.
                const planResult = await pool.query('SELECT * FROM pricingplans WHERE plan_name = $1', [user.plan_name]);
                if (planResult.rows.length === 0) throw new Error('Plan details not found for user.');
                
                const plan = planResult.rows[0];
                const today = new Date();
                let newExpiration = new Date(today);
                // Your logic to calculate newExpiration based on plan.term
                newExpiration.setMonth(newExpiration.getMonth() + 1); // Simplified: Add 1 month

                await pool.query(
                    `UPDATE users SET subscription_status = 'active', subscription_expiration = $1 WHERE id = $2`,
                    [newExpiration.toISOString().split('T')[0], user.id]
                );

                // === DELIVERY LOGIC ===
                // Check the user's registration source to determine how to deliver the invite link.
                if (user.registration_source === 'bot' && user.telegram_chat_id) {
                    // With the new flow, we no longer send the invite link directly from the webhook.
                    // The bot will now poll for status, ask for user details, and then call a new endpoint to get the link.
                    // We can optionally send a confirmation message here to prompt the user.
                    await bot.sendMessage(user.telegram_chat_id, `✅ Payment confirmed! Please return to our chat to complete your registration.`);
                
                } else {
                    // Flow 1 Delivery: User is waiting on the website.
                    // Generate the link and store it in the database for the frontend to poll.
                    const inviteLink = await bot.createChatInviteLink(plan.telegram_group_id, { member_limit: 1 });
                    await pool.query('UPDATE users SET telegram_invite_token = $1 WHERE id = $2', [inviteLink.invite_link, user.id]);
                    console.log(`Generated invite link for web user ${user.telegram_handle} and stored it.`);
                }
            }
        }

        res.status(200).send('IPN received.');

    } catch (err) {
        console.error('Error processing NOWPayments webhook:', err);
        res.status(500).send('Server Error');
    }
});


// === Status Check: Polling endpoint for the website ===
app.get('/api/payments/status/:order_id', async (req, res) => {
    try {
        const { order_id } = req.params;
        const { rows } = await pool.query('SELECT subscription_status, telegram_invite_token FROM users WHERE order_id = $1', [order_id]);

        if (rows.length === 0) {
            return res.status(404).json({ status: 'not_found' });
        }

        const user = rows[0];

        // If status is active AND there's an invite token, it means payment is complete and link is ready.
        if (user.subscription_status === 'active' && user.telegram_invite_token) {
            res.json({
                status: 'paid',
                invite_link: user.telegram_invite_token
            });
            // Clear the token after it has been retrieved to make it one-time use.
            await pool.query(`UPDATE users SET telegram_invite_token = NULL WHERE order_id = $1`, [order_id]);
        } else if (user.subscription_status === 'active') {
             // For bot users, the status will be active but the token won't be set yet.
             // We return 'paid' so the bot can proceed with collecting info.
            res.json({ status: 'paid' });
        }
        else {
            // Otherwise, just return the current status from the DB (e.g., 'pending')
            res.json({ status: user.subscription_status || 'pending' });
        }
    } catch (err) {
        console.error('Error checking payment status by order_id:', err);
        res.status(500).json({ message: 'Server Error' });
    }
});

// =================================================================
// --- END: UNIFIED PAYMENT FLOW ---
// =================================================================


// NEW ENDPOINT: Finalize registration after payment and data collection
app.post('/api/users/finalize-registration', async (req, res) => {
    const { orderId, fullName, email } = req.body;

    if (!orderId || !fullName || !email) {
        return res.status(400).json({ message: 'Missing orderId, fullName, or email.' });
    }

    try {
        // Get the user record before updating
        const userResult = await pool.query('SELECT * FROM users WHERE order_id = $1', [orderId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'User for this order not found.' });
        }
        const user = userResult.rows[0];

        // Check if the provided email conflicts with a DIFFERENT user
        const emailConflictQuery = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, user.id]);

        let emailForDb = email;
        if (emailConflictQuery.rows.length > 0) {
            console.warn(`BOT FINALIZE: Email "${email}" conflicts. Keeping original synthetic email for user ID ${user.id}.`);
            emailForDb = user.email; // Keep the original temp email to proceed
        }

        // Step 1: Update the user's details in the database with the safe email
        const updateUserQuery = await pool.query(
            `UPDATE users SET full_name = $1, email = $2 WHERE order_id = $3 RETURNING *`,
            [fullName, emailForDb, orderId]
        );

        if (updateUserQuery.rows.length === 0) {
            // This case should ideally not be reached due to the check above
            return res.status(404).json({ message: 'User for this order not found during update.' });
        }

        const updatedUser = updateUserQuery.rows[0];

        // Step 2: Get the plan details to find the correct Telegram group
        const planResult = await pool.query('SELECT telegram_group_id FROM pricingplans WHERE plan_name = $1', [updatedUser.plan_name]);
        if (planResult.rows.length === 0 || !planResult.rows[0].telegram_group_id) {
            throw new Error('Telegram group ID not found for this plan.');
        }
        const telegramGroupId = planResult.rows[0].telegram_group_id;

        // Step 3: Generate the one-time invite link
        const inviteLink = await bot.createChatInviteLink(telegramGroupId, { member_limit: 1 });

        // Step 4: Send the link back to the bot
        res.status(200).json({ invite_link: inviteLink.invite_link });

    } catch (err) {
        console.error('Error finalizing registration:', err);
        res.status(500).json({ message: 'Server Error during finalization.' });
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

