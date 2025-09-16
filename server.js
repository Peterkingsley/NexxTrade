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
// Load environment variables from .env file
require('dotenv').config();
const port = process.env.PORT || 3000;

// NEW: Import the Telegram bot and webhook setup function
const { bot } = require('./telegram_bot.js');

// Middleware setup
// IMPORTANT: We need the raw body for webhook verification, so we apply the JSON parser later, conditionally.
// app.use(express.json({ limit: '10mb' })); // We will move this
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
// NEW: PAYMENT VERIFICATION LOGIC
// =================================================================================

/**
 * This function is called after a payment is successfully verified.
 * It updates the user's status in the database and sends them their VIP group link via Telegram.
 * @param {string} uniquePaymentId - The unique ID for the user's payment record.
 */
const finalizeSuccessfulPayment = async (uniquePaymentId) => {
    console.log(`Finalizing payment for ID: ${uniquePaymentId}`);
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
            // This can happen if the payment was already processed or the ID is invalid.
            console.log(`No pending user found for payment ID ${uniquePaymentId}, it might be already processed.`);
            await client.query('ROLLBACK');
            return;
        }

        const { telegram_chat_id, plan } = result.rows[0];

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
        // Optionally, send an error message to the user or an alert to an admin.
        if (error.telegram_chat_id) {
            bot.sendMessage(error.telegram_chat_id, "We confirmed your payment, but there was an issue granting you access. Please contact support.");
        }
    } finally {
        client.release();
    }
};

/**
 * This function periodically checks for pending payments that might have been missed by the webhook.
 * It queries your database for users with 'pending' status and tries to verify their transaction.
 * * !!! IMPORTANT !!!
 * You MUST implement the logic inside `verifyTransactionOnBlockchain` based on your specific
 * payment processor's API (e.g., checking a transaction hash on Etherscan, calling Coinbase API, etc.).
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
            // This is a placeholder function. You need to replace this with the
            // actual API call to your payment provider to verify the transaction.
            const isConfirmed = await verifyTransactionOnBlockchain(user.transaction_hash);

            if (isConfirmed) {
                console.log(`Transaction ${user.transaction_hash} confirmed by periodic check.`);
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
 * !!! ACTION REQUIRED !!!
 * This is a placeholder for your actual transaction verification logic.
 * @param {string} transactionHash - The transaction hash/ID provided by the user.
 * @returns {Promise<boolean>} - True if the transaction is confirmed, false otherwise.
 */
const verifyTransactionOnBlockchain = async (transactionHash) => {
    //
    // EXAMPLE: If you were using an Etherscan-like API, your logic might look like this:
    //
    // const apiKey = process.env.BLOCKCHAIN_API_KEY;
    // const url = `https://api.etherscan.io/api?module=transaction&action=gettxreceiptstatus&txhash=${transactionHash}&apikey=${apiKey}`;
    // try {
    //   const response = await fetch(url);
    //   const data = await response.json();
    //   // Check if the status is '1' (success)
    //   return data.status === '1' && data.result.status === '1';
    // } catch (error) {
    //   console.error('Error verifying transaction:', error);
    //   return false;
    // }
    //
    // For now, it returns false. You must implement this.
    if (!transactionHash) return false;
    console.log(`(Placeholder) Verifying transaction: ${transactionHash}... This needs to be implemented.`);
    return false;
};


// =================================================================================
// NEW: WEBHOOK ENDPOINT FOR INSTANT PAYMENT NOTIFICATION
// =================================================================================
// This endpoint receives notifications from your payment gateway (e.g., Coinbase Commerce, Stripe).
app.post('/api/payment-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        console.log('Webhook received...');
        // --- Webhook Verification ---
        // This is crucial for security. It ensures the request came from your payment provider.
        // This example uses Coinbase Commerce's signature header. Adapt for your provider.
        const signature = req.headers['x-cc-webhook-signature'];
        const webhookSecret = process.env.COINBASE_COMMERCE_WEBHOOK_SECRET;

        if (!signature || !webhookSecret) {
            console.warn('Webhook secret not configured or signature missing.');
            return res.status(400).send('Webhook signature is missing.');
        }

        // Create a hash using the secret and the raw request body
        const hmac = crypto.createHmac('sha256', webhookSecret);
        hmac.update(req.body);
        const digest = hmac.digest('hex');

        // Compare our hash with the one from the header
        if (digest !== signature) {
            console.error('Invalid webhook signature.');
            return res.status(400).send('Invalid signature.');
        }
        
        console.log('Webhook signature verified successfully.');

        // --- Process the Event ---
        const event = JSON.parse(req.body.toString());

        // Example for Coinbase Commerce: Check if the charge is confirmed
        if (event.event.type === 'charge:confirmed') {
            const chargeData = event.event.data;
            // You should pass your `unique_payment_id` in the metadata when creating the charge.
            const uniquePaymentId = chargeData.metadata.custom; 
            
            if (uniquePaymentId) {
                console.log(`Webhook: Confirmed charge for payment ID ${uniquePaymentId}`);
                await finalizeSuccessfulPayment(uniquePaymentId);
            } else {
                 console.warn('Webhook received for confirmed charge but no unique_payment_id found in metadata.');
            }
        } else {
            console.log(`Webhook received event type: ${event.event.type} - not processing.`);
        }

        // Respond to the webhook provider that we received it successfully.
        res.status(200).send('Webhook received.');

    } catch (error) {
        console.error('Error handling webhook:', error.message);
        res.status(500).send('Internal Server Error');
    }
});


// We use express.json() for all other routes that are not the webhook.
app.use(express.json({ limit: '10mb' }));


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
        // Check if user with the same email or telegram username already exists
        const userCheck = await pool.query('SELECT * FROM users WHERE email = $1 OR telegram_username = $2', [email, telegramUsername]);
        if (userCheck.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'User with this email or Telegram username already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
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
            uniquePaymentId: uniquePaymentId
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'An internal server error occurred.' });
    }
});


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
    // Start the periodic check for pending payments 5 minutes after server start,
    // and run it every 5 minutes thereafter.
    setTimeout(() => {
        setInterval(checkAndUpdatePendingPayments, 300000); // 300000 ms = 5 minutes
    }, 300000);
});
