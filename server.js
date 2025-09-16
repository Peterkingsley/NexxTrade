// server.js
// This file sets up a Node.js backend server using Express and a PostgreSQL database.
// It handles API routes for managing blogs, pricing plans, roles, and performance data.

// Import required modules
const express = require('express');
const cors = require('cors'); // Import the cors package
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcrypt'); // Import bcrypt for password hashing
const crypto = require('crypto'); // Import crypto for generating unique tokens and webhook verification
const app = express();
// Use dynamic import for node-fetch
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Load environment variables from .env file
require('dotenv').config();
const port = process.env.PORT || 3000;

// NEW: Import the Telegram bot and webhook setup function
const { bot } = require('./telegram_bot.js');

// Middleware setup
// IMPORTANT: We need the raw body for webhook verification, so we apply the JSON parser later, conditionally.
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Use the CORS middleware to allow cross-origin requests
app.use(cors());

// PostgreSQL database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


// =================================================================================
// NEW: NOWPAYMENTS VERIFICATION LOGIC
// =================================================================================

/**
 * This function is called after a payment is successfully verified.
 * It updates the user's status in the database and sends them their VIP group link via Telegram.
 * @param {string} uniquePaymentId - The unique ID for the user's payment record (should match NowPayments order_id).
 */
const finalizeSuccessfulPayment = async (uniquePaymentId) => {
    console.log(`Finalizing payment for Order ID: ${uniquePaymentId}`);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Step 1: Update the user's payment status to 'successful'
        const updateUserQuery = `
            UPDATE users 
            SET payment_status = 'successful' 
            WHERE unique_payment_id = $1 AND payment_status = 'pending'
            RETURNING email, telegram_chat_id, plan;
        `;
        const result = await client.query(updateUserQuery, [uniquePaymentId]);

        if (result.rows.length === 0) {
            console.log(`No pending user found for Order ID ${uniquePaymentId}, it might be already processed.`);
            await client.query('ROLLBACK');
            return;
        }

        const { telegram_chat_id, plan } = result.rows[0];
        console.log(`User with plan '${plan}' found. Proceeding to send Telegram invite.`);

        // Step 2: Get the Telegram Group ID for the user's subscribed plan
        const planQuery = 'SELECT telegram_group_id FROM pricing_plans WHERE plan_name = $1';
        const planResult = await client.query(planQuery, [plan]);

        if (planResult.rows.length === 0 || !planResult.rows[0].telegram_group_id) {
            throw new Error(`Telegram Group ID not found for plan: ${plan}. Please check admin configuration.`);
        }

        const telegramGroupId = planResult.rows[0].telegram_group_id;

        // Step 3: Generate a one-time invite link and send it via Telegram
        const inviteLink = await bot.createChatInviteLink(telegramGroupId, { member_limit: 1 });
        const joinMessage = "✅ Payment confirmed! Your access has been granted. Here is your one-time invite link to the VIP channel. Please note it can only be used once.";
        const joinOptions = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Join VIP Channel', url: inviteLink.invite_link }]
                ]
            }
        };

        await bot.sendMessage(telegram_chat_id, joinMessage, joinOptions);
        console.log(`Successfully sent invite link to chat ID ${telegram_chat_id}`);

        await client.query('COMMIT');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error finalizing successful payment:', error.message);
        if (error.telegram_chat_id) {
            bot.sendMessage(error.telegram_chat_id, "We confirmed your payment, but there was an issue granting you access. Please contact support.");
        }
    } finally {
        client.release();
    }
};

/**
 * Reconciles all past payments from NowPayments with the local database on server startup.
 */
const reconcilePastPayments = async () => {
    console.log('Starting historical payment reconciliation with NowPayments...');
    const apiKey = process.env.NOWPAYMENTS_API_KEY;

    if (!apiKey) {
        console.error('NowPayments API key is not configured. Skipping reconciliation.');
        return;
    }
    
    try {
        const response = await fetch('https://api.nowpayments.io/v1/payment/?orderBy=created_at&limit=500', { // Fetches last 500 payments
            method: 'GET',
            headers: { 'x-api-key': apiKey }
        });

        if (!response.ok) {
            throw new Error(`NowPayments API returned status: ${response.status}`);
        }

        const payments = await response.json();
        const confirmedStatuses = ['finished', 'confirmed', 'sending'];
        let processedCount = 0;

        if (payments && payments.data) {
             for (const payment of payments.data) {
                if (confirmedStatuses.includes(payment.payment_status) && payment.order_id) {
                    await finalizeSuccessfulPayment(payment.order_id);
                    processedCount++;
                }
            }
            console.log(`Historical payment reconciliation complete. Processed ${processedCount} confirmed payments.`);
        } else {
             console.log('No past payments found or empty response from NowPayments.');
        }

    } catch (error) {
        console.error('Error during historical payment reconciliation:', error.message);
    }
};


/**
 * Periodically checks for pending payments that might have been missed by the webhook.
 */
const checkAndUpdatePendingPayments = async () => {
    console.log('Running periodic check for pending payments...');
    
    const client = await pool.connect();
    try {
        const { rows: pendingUsers } = await client.query("SELECT unique_payment_id, transaction_hash FROM users WHERE payment_status = 'pending'");

        if (pendingUsers.length === 0) {
            console.log('No pending payments to check.');
            return;
        }

        console.log(`Found ${pendingUsers.length} pending payment(s).`);

        for (const user of pendingUsers) {
            // The transaction_hash should store the NowPayments payment_id
            const isConfirmed = await verifyNowPaymentsTransaction(user.transaction_hash);

            if (isConfirmed) {
                console.log(`Transaction ${user.transaction_hash} confirmed by periodic check.`);
                // The unique_payment_id is the order_id for NowPayments
                await finalizeSuccessfulPayment(user.unique_payment_id);
            }
        }
    } catch (error) {
        console.error('Error during periodic payment check:', error);
    } finally {
        client.release();
    }
};

/**
 * Verifies a single transaction's status with the NowPayments API.
 * @param {string} paymentId - The payment ID from NowPayments (stored as transaction_hash).
 * @returns {Promise<boolean>} - True if the transaction is confirmed, false otherwise.
 */
const verifyNowPaymentsTransaction = async (paymentId) => {
    if (!paymentId) return false;
    
    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    if (!apiKey) {
        console.error('NowPayments API Key is missing.');
        return false;
    }

    try {
        const response = await fetch(`https://api.nowpayments.io/v1/payment/${paymentId}`, {
             method: 'GET',
             headers: { 'x-api-key': apiKey }
        });
        const data = await response.json();
        const confirmedStatuses = ['finished', 'confirmed', 'sending'];
        return confirmedStatuses.includes(data.payment_status);

    } catch (error) {
        console.error('Error verifying NowPayments transaction:', error.message);
        return false;
    }
};


// =================================================================================
// NOWPAYMENTS WEBHOOK (IPN) ENDPOINT
// =================================================================================
app.post('/api/payment-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        console.log('NowPayments webhook received...');
        
        const signature = req.headers['x-nowpayments-sig'];
        const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET_KEY;

        if (!ipnSecret) {
            console.warn('NowPayments IPN secret not configured.');
            return res.status(500).send('IPN secret not configured.');
        }

        const hmac = crypto.createHmac('sha512', ipnSecret);
        hmac.update(JSON.stringify(JSON.parse(req.body.toString()), Object.keys(JSON.parse(req.body.toString())).sort()));
        const digest = hmac.digest('hex');

        if (digest !== signature) {
            console.error('Invalid webhook signature.');
            return res.status(400).send('Invalid signature.');
        }
        
        console.log('Webhook signature verified successfully.');

        const event = JSON.parse(req.body.toString());
        const confirmedStatuses = ['finished', 'confirmed', 'sending'];

        if (confirmedStatuses.includes(event.payment_status) && event.order_id) {
            console.log(`Webhook: Confirmed charge for Order ID ${event.order_id}`);
            await finalizeSuccessfulPayment(event.order_id);
        } else {
            console.log(`Webhook received non-confirmed status: ${event.payment_status}`);
        }

        res.status(200).send('Webhook received.');

    } catch (error) {
        console.error('Error handling webhook:', error.message);
        res.status(500).send('Internal Server Error');
    }
});


// We use express.json() for all other routes that are not the webhook.
app.use(express.json({ limit: '10mb' }));

// ... (The rest of your API routes: /api/blogs, /api/pricing, etc. remain unchanged) ...
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));


// API route to get all blogs
app.get('/api/blogs', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM blogs ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API route to create a new blog
app.post('/api/blogs', async (req, res) => {
    const { title, content, author, image_url } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO blogs (title, content, author, image_url) VALUES ($1, $2, $3, $4) RETURNING *',
            [title, content, author, image_url]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API route to delete a blog
app.delete('/api/blogs/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM blogs WHERE id = $1 RETURNING *', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Blog not found' });
        }
        res.json({ message: 'Blog deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API route to get all pricing plans
app.get('/api/pricing', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pricing_plans');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API route to create a pricing plan
app.post('/api/pricing', async (req, res) => {
    const { plan_name, price, features, telegram_group_id } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO pricing_plans (plan_name, price, features, telegram_group_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [plan_name, price, features, telegram_group_id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API route to update a pricing plan
app.put('/api/pricing/:id', async (req, res) => {
    const { id } = req.params;
    const { plan_name, price, features, telegram_group_id } = req.body;
    try {
        const result = await pool.query(
            'UPDATE pricing_plans SET plan_name = $1, price = $2, features = $3, telegram_group_id = $4 WHERE id = $5 RETURNING *',
            [plan_name, price, features, telegram_group_id, id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Pricing plan not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// API route to delete a pricing plan
app.delete('/api/pricing/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM pricing_plans WHERE id = $1 RETURNING *', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Pricing plan not found' });
        }
        res.json({ message: 'Pricing plan deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// API route to get all admin roles
app.get('/api/roles', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM admin_roles');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API route to get all performance data
app.get('/api/performance', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM performance_data');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// User registration endpoint
app.post('/api/register', async (req, res) => {
    const { fullName, email, password, telegramUsername, telegramChatId, plan, transactionHash } = req.body;

    // Basic validation
    if (!fullName || !email || !password || !telegramUsername || !telegramChatId || !plan) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    try {
        // Find existing user by email
        const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        // A user can sign up for multiple plans. We check if they already have an active subscription for the *same plan*.
        const existingPlan = userCheck.rows.find(u => u.plan === plan && u.payment_status === 'successful');
        
        if (existingPlan) {
            return res.status(409).json({ success: false, message: `You already have an active subscription for the ${plan} plan.` });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        // This ID will be used as the order_id for NowPayments
        const uniquePaymentId = `NXT-${crypto.randomBytes(8).toString('hex')}`;
        
        const query = `
            INSERT INTO users (full_name, email, password, telegram_username, telegram_chat_id, plan, transaction_hash, payment_status, unique_payment_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
            RETURNING id;
        `;
        
        const values = [fullName, email, hashedPassword, telegramUsername, telegramChatId, plan, transactionHash, uniquePaymentId];
        
        const result = await pool.query(query, values);

        res.status(201).json({ 
            success: true, 
            message: 'Registration successful! Your payment is being confirmed.',
            userId: result.rows[0].id,
            uniquePaymentId: uniquePaymentId // This is the order_id
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'An internal server error occurred.' });
    }
});

// ... (Your page-serving routes: /, /join, /admin, etc. remain unchanged) ...
// Route for the homepage
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


app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    
    // ** ACTION: Run the historical payment check once on startup **
    reconcilePastPayments();

    // Start the periodic check for any pending payments every 10 minutes.
    setInterval(checkAndUpdatePendingPayments, 600000); // 600000 ms = 10 minutes
});

