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
app.use(express.json());
// Use express.urlencoded() to parse URL-encoded bodies, important for form submissions
app.use(express.urlencoded({ extended: true }));

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
// Based on the 'pricingplans' table from your SQL dump.
// The columns are: id, plan_name, price, term, description, features, is_best_value
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

// NEW ROUTE: Endpoint for OPay payment initiation
// This route is called by the frontend form submission
app.post('/api/payments/opay', async (req, res) => {
    try {
        const { fullname, email, telegram, plan } = req.body;

        // Approximate conversion rate (1 USD to NGN)
        const USD_TO_NGN_RATE = 750;

        const prices = {
            monthly: 39,
            quarterly: 99,
            yearly: 299
        };
        const amountUSD = prices[plan];

        if (!amountUSD) {
            return res.status(400).json({ message: 'Invalid plan selected.' });
        }

        // Convert the USD price to NGN for OPay
        const amountNGN = amountUSD * USD_TO_NGN_RATE;

        // Generate a unique token for this transaction. This will be used to
        // securely identify the user later when OPay's webhook pings us.
        const transactionRef = crypto.randomBytes(16).toString('hex');
        const telegramInviteToken = crypto.randomBytes(32).toString('hex');

        // --- 1. Save the user to the database with a 'pending' status ---
        const registrationDate = new Date().toISOString().split('T')[0];
        const { rows } = await pool.query(
            `INSERT INTO users (full_name, email, telegram_handle, plan_name, subscription_status, registration_date, telegram_invite_token)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [fullname, email, telegram, plan, 'pending', registrationDate, telegramInviteToken]
        );

        // --- 2. Make a real API call to OPay (this is a placeholder for now) ---
        // You would uncomment this block and replace the placeholder with your actual OPay API call

        // const opayResponse = await fetch('https://api.opay.com/v1/checkout/initiate', {
        //     method: 'POST',
        //     headers: {
        //         'Authorization': `Bearer ${process.env.OPAY_API_KEY}`,
        //         'Merchant-ID': process.env.OPAY_MERCHANT_ID,
        //         'Content-Type': 'application/json'
        //     },
        //     body: JSON.stringify({
        //         amount: amountNGN,
        //         currency: 'NGN',
        //         reference: transactionRef,
        //         callback_url: `${process.env.APP_BASE_URL}/api/payments/opay/webhook`,
        //         // other OPay specific details
        //     })
        // });
        // const opayData = await opayResponse.json();

        // --- 3. Return the redirect URL from OPay to the frontend ---
        // For now, we'll return a mock URL.
        const mockRedirectUrl = `https://mock-opay.com/pay?ref=${transactionRef}&amount=${amountNGN}`;

        res.status(200).json({
            message: 'Payment initiated successfully.',
            redirectUrl: mockRedirectUrl,
            transactionRef: transactionRef
        });

    } catch (err) {
        console.error('Error initiating OPay payment:', err);
        res.status(500).json({ message: 'Server Error during payment initiation.' });
    }
});

// NEW ROUTE: OPay Webhook Handler for payment confirmation
app.post('/api/payments/opay/webhook', async (req, res) => {
    // In a real scenario, you would perform a signature validation here
    // to ensure the request is genuinely from OPay.

    // Assume the webhook body contains 'reference' and 'status'
    const { reference, status } = req.body;

    if (!reference || !status) {
        return res.status(400).send('Invalid webhook payload');
    }

    if (status === 'success') {
        try {
            // Find the user in the database using the transaction reference
            const { rows } = await pool.query(
                'SELECT * FROM users WHERE telegram_invite_token = $1',
                [reference]
            );

            if (rows.length === 0) {
                return res.status(404).send('User not found for this transaction reference.');
            }

            const user = rows[0];

            // Calculate subscription expiration date
            let expirationDate = new Date();
            if (user.plan_name === 'monthly') {
                expirationDate.setMonth(expirationDate.getMonth() + 1);
            } else if (user.plan_name === 'quarterly') {
                expirationDate.setMonth(expirationDate.getMonth() + 3);
            } else if (user.plan_name === 'yearly') {
                expirationDate.setFullYear(expirationDate.getFullYear() + 1);
            }

            // Update the user's subscription status and expiration date
            await pool.query(
                `UPDATE users SET subscription_status = 'active', subscription_expiration = $1 WHERE telegram_invite_token = $2`,
                [expirationDate.toISOString().split('T')[0], reference]
            );

            // Log the successful update
            console.log(`User ${user.email} subscription activated successfully.`);

            // Respond to OPay to acknowledge receipt of the webhook.
            // This is a crucial step to prevent OPay from resending the webhook.
            res.status(200).send('Webhook received and processed successfully.');

        } catch (err) {
            console.error('Error processing OPay webhook:', err);
            res.status(500).send('Server Error');
        }
    } else {
        // Handle other statuses like 'failed' or 'cancelled'
        console.log(`Received webhook for reference ${reference} with status: ${status}`);
        res.status(200).send('Webhook received, but payment was not successful.');
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

        // This is a placeholder for a notification system. In a real application, you might
        // want to notify a separate service or a Telegram function to handle removals.
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

            // In a real-world scenario, you would redeem the token here
            // to prevent it from being used again.
            await pool.query(
                'UPDATE users SET telegram_invite_token = NULL WHERE id = $1',
                [user.id]
            );

            // Respond to the bot with success
            res.status(200).json({
                message: 'Verification successful. User is active.',
                user: {
                    id: user.id,
                    email: user.email,
                    telegram_handle: user.telegram_handle,
                    plan_name: user.plan_name
                }
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
// This route will receive updates from Telegram.
app.post(`/bot${token}`, (req, res) => {
    // Process the incoming update from Telegram
    bot.processUpdate(req.body);
    // Send a 200 OK response to Telegram to acknowledge the update
    res.sendStatus(200);
});


// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
// Removed serving uploaded files since they are now Base64 strings in the database
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// This is the new "catch-all" route. It's crucial for serving your frontend.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
// NOTE: Make sure this is the last app.listen() call in your file.
app.listen(port, async () => {
  console.log(`Server is running on http://localhost:${port}`);
  // IMPORTANT: Set up the webhook once the server is listening.
  await setupWebhook();
});
