/*
 REQUIRED DATABASE CHANGES FOR REFERRAL & PAYOUT SYSTEM:
 Please run the following SQL commands on your database to enable these features.

 -- 1. Add columns to the 'users' table for tracking referrals
 ALTER TABLE public.users ADD COLUMN referral_code VARCHAR(255) UNIQUE;
 ALTER TABLE public.users ADD COLUMN referred_by INTEGER REFERENCES public.users(id);
 ALTER TABLE public.users ADD COLUMN total_referral_earnings NUMERIC DEFAULT 0;

 -- 2. Create the 'referrals' table to log each commission-earning event
 CREATE TABLE public.referrals (
    id SERIAL PRIMARY KEY,
    referrer_id INTEGER NOT NULL REFERENCES public.users(id),
    referred_user_id INTEGER NOT NULL REFERENCES public.users(id),
    commission_amount NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
 );

 -- 3. Create the 'payouts' table for managing withdrawal requests
 CREATE TABLE public.payouts (
    id SERIAL PRIMARY KEY,
    user_id integer NOT NULL REFERENCES public.users(id),
    amount numeric NOT NULL,
    status character varying(20) NOT NULL DEFAULT 'pending',
    payout_address text NOT NULL,
    requested_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    admin_notes text
 );

 -- 4. NEW: Create the 'affiliates' table for the new commission structure
 CREATE TABLE public.affiliates (
    user_id INTEGER PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT false,
    basic_commission_rate NUMERIC DEFAULT 0.25,
    pro_commission_rate NUMERIC DEFAULT 0.30,
    elite_commission_rate NUMERIC DEFAULT 0.35,
    total_sales_for_bonus INTEGER DEFAULT 0
 );

 -- 5. NEW: Add a default commission rate to pricing plans
 ALTER TABLE public.pricingplans
 ADD COLUMN commission_rate NUMERIC(5,2) DEFAULT 0.10;

*/

// 1. ES Module Context Setup
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Define ES Module equivalents for CommonJS globals (needed for path resolution)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 2. Imports using ES Module syntax (Ensure NO duplicates here)
import express from 'express';
import cors from 'cors';
import { Pool } from 'pg'; // <--- This is the only place Pool should be imported
import path from 'path';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import cron from 'node-cron';
import 'dotenv/config'; // Load environment variables

// 3. Database Connection Pool Initialization (This defines 'db')
const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

db.connect()
    .then(() => console.log('Successfully connected to PostgreSQL database.'))
    .catch(err => console.error('Database connection error:', err.stack));


const app = express();
const port = process.env.PORT || 3000;

const activeSubscriptionsResult = await db.query('SELECT COUNT(*)::int AS active_subscriptions FROM users WHERE subscription_expiration > NOW()');
const activeSubscriptions = activeSubscriptionsResult.rows[0].active_subscriptions;

// NEW: Import the Telegram bot and webhook setup function
// This allows the server to command the bot (e.g., to create invite links).
import { bot, setupWebhook, userRegistrationState } from './telegram_bot.js';

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

// =============================================================================
// --- NEW: AUTOMATED SUBSCRIPTION MANAGER ---
// =============================================================================

/**
 * This function checks for expired subscriptions, kicks users from groups,
 * and notifies them.
 */
async function manageExpiredSubscriptions() {
    console.log('Running scheduled job: Checking for expired subscriptions...');
    const client = await pool.connect();
    try {
        // Get all users who are 'active' but their expiration date is in the past
        // We also need the telegram_group_id from the pricingplans table
        const query = `
            SELECT 
                u.id, 
                u.telegram_handle, 
                u.telegram_user_id,
                u.telegram_chat_id,
                u.plan_name,
                p.telegram_group_id
            FROM users u
            JOIN pricingplans p ON u.plan_name = p.plan_name
            WHERE 
                u.subscription_status = 'active' 
                AND u.subscription_expiration < NOW()
                AND u.telegram_user_id IS NOT NULL
                AND p.telegram_group_id IS NOT NULL;
        `;
        const { rows: expiredUsers } = await client.query(query);

        if (expiredUsers.length === 0) {
            console.log('Subscription job: No expired users found.');
            client.release();
            return;
        }

        console.log(`Subscription job: Found ${expiredUsers.length} expired user(s).`);

        // Process each expired user
        for (const user of expiredUsers) {
            try {
                // 1. Attempt to kick user from the Telegram group
                await bot.kickChatMember(user.telegram_group_id, user.telegram_user_id);
                console.log(`Successfully kicked ${user.telegram_handle} (ID: ${user.telegram_user_id}) from group ${user.telegram_group_id}.`);

                // 2. Attempt to send a notification to the user's private chat
                if (user.telegram_chat_id) {
                    const renewalMessage = `Hi ${user.telegram_handle}, your subscription for the ${user.plan_name} plan has expired, and you have been removed from the VIP group. \n\nTo regain access, please start a new subscription.`;
                    const renewalOptions = {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Renew My Subscription', callback_data: 'join_vip' }]
                            ]
                        }
                    };
                    await bot.sendMessage(user.telegram_chat_id, renewalMessage, renewalOptions);
                }

            } catch (err) {
                // If Telegram actions fail, just log the error and continue.
                // The database update in the 'finally' block will still run.
                console.error(`Failed to process Telegram actions for user ${user.id} (${user.telegram_handle}):`, err.message);
            
            } finally {
                // 3. ALWAYS update the database status to 'expired'
                // This block runs whether the 'try' succeeded or failed.
                try {
                    await client.query(
                        "UPDATE users SET subscription_status = 'expired' WHERE id = $1",
                        [user.id]
                    );
                } catch (dbErr) {
                    console.error(`CRITICAL: Failed to update database for expired user ${user.id}:`, dbErr.message);
                }
            }
        }
    } catch (err) {
        console.error('Error during subscription management job:', err);
    } finally {
        client.release();
    }
}

// Schedule the job to run once every day at 3:00 AM
// (Uses 'minute hour day-of-month month day-of-week' format)
cron.schedule('0 3 * * *', () => {
    manageExpiredSubscriptions();
});

console.log('Scheduled subscription manager (cron job) to run daily at 3:04 AM.');

//

// =============================================================================
// --- REFERRAL SYSTEM ROUTES ---
// =============================================================================

// Route to handle vanity referral URLs like /@username
app.get('/@:referralCode', async (req, res) => {
    const { referralCode } = req.params;
    try {
        // Find the referrer to log the click
        const referrerResult = await pool.query('SELECT id FROM users WHERE referral_code = $1', [referralCode]);
        if (referrerResult.rows.length > 0) {
            const referrerId = referrerResult.rows[0].id;
            // Log the click
            await pool.query('INSERT INTO referral_clicks (referrer_id) VALUES ($1)', [referrerId]);
        }
    } catch (err) {
        console.error('Error logging referral click:', err);
    }
    // Redirect to the registration/join page with the referral code as a query parameter
    res.redirect(`/join?ref=${referralCode}`);
});


// API route for a user to set their custom referral code
app.post('/api/users/set-referral-code', async (req, res) => {
    const { telegram_handle, referral_code } = req.body;

    if (!telegram_handle || !referral_code) {
        return res.status(400).json({ message: 'Telegram handle and referral code are required.' });
    }

    // Validate that the code contains only letters and numbers
    if (!/^[a-zA-Z0-9]+$/.test(referral_code)) {
        return res.status(400).json({ message: 'Referral code can only contain letters and numbers.' });
    }

    try {
        // Check if the user exists
        const userResult = await pool.query('SELECT id FROM users WHERE telegram_handle = $1', [telegram_handle]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        const userId = userResult.rows[0].id;

        // Attempt to update the user's referral code
        await pool.query('UPDATE users SET referral_code = $1 WHERE id = $2', [referral_code, userId]);

        res.status(200).json({ message: 'Referral code set successfully!', referral_code });
    } catch (err) {
        // Check for the unique constraint violation
        if (err.code === '23505' && err.constraint === 'users_referral_code_key') {
            return res.status(409).json({ message: 'This referral name is already taken. Please choose another one.' });
        }
        console.error('Error setting referral code:', err);
        res.status(500).json({ message: 'Server error.' });
    }
});


// API route to get a user's referral statistics (UPDATED)
app.get('/api/users/referral-stats/:telegramUsername', async (req, res) => {
    const { telegramUsername } = req.params;

    try {
        const userResult = await pool.query('SELECT id, total_referral_earnings, referral_code FROM users WHERE telegram_handle = $1', ['@' + telegramUsername]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }
        const user = userResult.rows[0];
        const userId = user.id;

        // Get total number of successful referrals (signups)
        const referralsCountResult = await pool.query('SELECT COUNT(*) FROM referrals WHERE referrer_id = $1', [userId]);
        const totalReferrals = parseInt(referralsCountResult.rows[0].count, 10);

        // Get total number of clicks
        const clicksCountResult = await pool.query('SELECT COUNT(*) FROM referral_clicks WHERE referrer_id = $1', [userId]);
        const totalClicks = parseInt(clicksCountResult.rows[0].count, 10);

        // Get total amount paid out
        const payoutsResult = await pool.query(
            "SELECT COALESCE(SUM(amount), 0) as total_payouts FROM payouts WHERE user_id = $1 AND status = 'completed'",
            [userId]
        );
        const totalPayouts = parseFloat(payoutsResult.rows[0].total_payouts);
        const totalEarnings = parseFloat(user.total_referral_earnings || 0);
        const availableBalance = totalEarnings - totalPayouts;

        res.status(200).json({
            totalClicks, // New
            totalSignups: totalReferrals, // Renamed for clarity
            totalEarnings: totalEarnings.toFixed(2),
            totalPayouts: totalPayouts.toFixed(2),
            availableBalance: availableBalance.toFixed(2),
            referralCode: user.referral_code
        });
    } catch (err) {
        console.error('Error fetching referral stats:', err);
        res.status(500).json({ message: 'Server error.' });
    }
});

// NEW: API route to handle a payout request from a user
app.post('/api/users/request-payout', async (req, res) => {
    const { telegram_username, amount, payout_address } = req.body;

    if (!telegram_username || !amount || !payout_address) {
        return res.status(400).json({ message: 'Missing required information for payout request.' });
    }
    
    try {
        const userResult = await pool.query('SELECT id, total_referral_earnings FROM users WHERE telegram_handle = $1', ['@' + telegram_username]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: "User account not found." });
        }
        const user = userResult.rows[0];
        
        const payoutsResult = await pool.query(
            "SELECT COALESCE(SUM(amount), 0) as total_payouts FROM payouts WHERE user_id = $1 AND status = 'completed'",
            [user.id]
        );
        const availableBalance = parseFloat(user.total_referral_earnings) - parseFloat(payoutsResult.rows[0].total_payouts);

        if (parseFloat(amount) > availableBalance) {
            return res.status(400).json({ message: "Requested amount exceeds your available balance." });
        }

        await pool.query(
            'INSERT INTO payouts (user_id, amount, payout_address, status) VALUES ($1, $2, $3, $4)',
            [user.id, amount, payout_address, 'pending']
        );

        res.status(201).json({ message: 'Payout request submitted successfully.' });

    } catch (err) {
        console.error('Error creating payout request:', err);
        res.status(500).json({ message: 'Server error while submitting your request.' });
    }
});


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

// =============================================================================
// --- NEW: AFFILIATE MANAGEMENT ROUTES (ADMIN) ---
// =============================================================================

// Get all affiliates
// server.js - Corrected Code
app.get('/api/admin/affiliates', async (req, res) => {
    try {
        // Get the search query from the URL, if it exists
        const { search } = req.query;

        // Start with the base query
        let query = `
            SELECT u.id, u.telegram_handle, a.is_active, a.basic_commission_rate, a.pro_commission_rate, a.elite_commission_rate
            FROM users u
            LEFT JOIN affiliates a ON u.id = a.user_id
        `;
        const params = [];

        if (search) {
            // If a search term is provided, add a WHERE clause
            // Use ILIKE for a case-insensitive search
            query += ' WHERE u.telegram_handle ILIKE $1';
            // Use '%' for partial matching (e.g., "user" matches "@user123")
            params.push(`%${search}%`);
        }

        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching affiliates:', err);
        res.status(500).send('Server Error');
    }
});

// Create or update an affiliate's settings
app.post('/api/admin/affiliates', async (req, res) => {
    const { user_id, is_active, basic_commission_rate, pro_commission_rate, elite_commission_rate } = req.body;

    if (!user_id) {
        return res.status(400).json({ message: 'User ID is required.' });
    }

    try {
        const { rows } = await pool.query(
            `INSERT INTO affiliates (user_id, is_active, basic_commission_rate, pro_commission_rate, elite_commission_rate)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id) DO UPDATE SET
                is_active = EXCLUDED.is_active,
                basic_commission_rate = EXCLUDED.basic_commission_rate,
                pro_commission_rate = EXCLUDED.pro_commission_rate,
                elite_commission_rate = EXCLUDED.elite_commission_rate
             RETURNING *`,
            [user_id, is_active, basic_commission_rate, pro_commission_rate, elite_commission_rate]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        console.error('Error creating/updating affiliate:', err);
        res.status(500).send('Server Error');
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
    const { rows } = await pool.query('SELECT * FROM pnlproofs ORDER BY id DESC');
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

// MODIFIED: API route for detailed admin dashboard statistics
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        // Queries to fetch the necessary data for the dashboard stats
        const activeUsersQuery = `
            SELECT 
                p.plan_name, 
                COUNT(u.id) AS active_count
            FROM users u
            JOIN pricingplans p ON u.plan_name = p.plan_name
            WHERE u.subscription_status = 'active'
            GROUP BY p.plan_name
            ORDER BY p.plan_name;
        `;
        
        const userAcquisitionQuery = `
            SELECT
                COUNT(CASE WHEN registration_source = 'web' THEN 1 END) AS total_web,
                COUNT(CASE WHEN registration_source = 'bot' THEN 1 END) AS total_bot,
                COUNT(CASE WHEN registration_source = 'web' AND subscription_status = 'active' THEN 1 END) AS active_web,
                COUNT(CASE WHEN registration_source = 'bot' AND subscription_status = 'active' THEN 1 END) AS active_bot,
                COUNT(CASE WHEN referred_by IS NOT NULL THEN 1 END) AS total_referred,
                COUNT(CASE WHEN referred_by IS NOT NULL AND subscription_status = 'active' THEN 1 END) AS active_referred
            FROM users;
        `;

        const totalActiveUsersQuery = `
            SELECT COUNT(*)::int AS total_active_users 
            FROM users 
            WHERE subscription_status = 'active';
        `;

        const [ activeUsersResult, userAcquisitionResult, totalActiveUsersResult ] = await Promise.all([
            pool.query(activeUsersQuery),
            pool.query(userAcquisitionQuery),
            pool.query(totalActiveUsersQuery)
        ]);

        // Process results
        const activeUsersPerPackage = activeUsersResult.rows.map(row => ({
            plan_name: row.plan_name,
            active_count: parseInt(row.active_count, 10)
        }));
        
        const userAcquisition = userAcquisitionResult.rows[0];
        const totalActiveUsers = totalActiveUsersResult.rows[0].total_active_users;


        // Combine all stats into a single JSON response
        res.status(200).json({ 
            activeUsersPerPackage, 
            userAcquisition: { 
                web: { 
                    total: parseInt(userAcquisition.total_web, 10), 
                    active: parseInt(userAcquisition.active_web, 10) 
                }, 
                bot: { 
                    total: parseInt(userAcquisition.total_bot, 10), 
                    active: parseInt(userAcquisition.active_bot, 10) 
                }, 
                referred: { 
                    total: parseInt(userAcquisition.total_referred, 10), 
                    active: parseInt(userAcquisition.active_referred, 10) 
                } 
            }, 
            totalActiveUsers 
        });
    } catch (err) {
        console.error('Error fetching dashboard stats:', err);
        // Ensure the API call always responds with JSON on error
        res.status(500).json({ message: 'Internal Server Error fetching dashboard stats.' });
    }
});


// =================================================================
// --- START: Fiat Payment API Routes (Now with TransFi) ---
// =================================================================

// ==========================================================
// FINAL CORRECTED createOrUpdateTransfiUser (v4) in server.js
// Now includes 'phone' and all address fields.
// ==========================================================
/**
 * Creates or retrieves an individual user in TransFi's system using the User API.
 * @param {object} userData - User details (email, firstName, lastName, dateOfBirth, country, phone, addressLine1, city, zipCode).
 * @returns {Promise<string>} The TransFi userId.
 */
async function createOrUpdateTransfiUser(userData) {
    const { email, firstName, lastName, dateOfBirth, country, phone, addressLine1, city, zipCode } = userData;
    
    const userPayload = {
        email,
        firstName,
        lastName,
        date: dateOfBirth, 
        country,
        phone,
        // 🚨 FIX: ADDRESS FIELDS ADDED TO PAYLOAD
        addressLine1,
        city,
        zipCode,
        // TransFi may require this if Line 1 is not sufficient
        addressLine2: "", 
    };

    try {
        const response = await fetch(`${process.env.TRANSFI_BASE_URL}/v2/users/individual`, {
            method: "POST",
            headers: {
                "Authorization": createTransfiAuthToken(),
                "Content-Type": "application/json",
                "MID": process.env.TRANSFI_MID,
            },
            body: JSON.stringify(userPayload)
        });
        
        const data = await response.json();
        
        // Success
        if (response.ok && data.userId) {
            console.log(`[TransFi] New user created. UserID: ${data.userId}`);
            return data.userId;
        } 
        
        // Handle CONFLICT (User already exists)
        if (data.code === 'CONFLICT' && data.userId) {
            console.log(`[TransFi] User already exists. Using existing UserID: ${data.userId}`);
            return data.userId;
        }
    
        // Throw error for other failures
        console.error('[TransFi User Creation Error]', data);
        throw new Error(data.message || `Failed to create or verify user with TransFi. Code: ${data.code}`);

    } catch (error) {
        console.error('[TransFi User Creation Error] Network or Parsing Issue:', error.message);
        throw new Error(`Failed to create or verify user with TransFi: ${error.message}`);
    }
}
// ==========================================================

// Make sure 'fetch' is available.
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Helper function to create the Basic Auth token
// NEW
const createTransfiAuthToken = () => {
    // Auth format is username:password (the password is the 'merchant_secret')
    const credentials = `${process.env.TRANSFI_USERNAME}:${process.env.TRANSFI_PASSWORD}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
};

// NOTE: The helper function 'createTransfiAuthToken' is already correctly defined above this section.

// 1) CALL EXCHANGE RATE: GET /api/transfi/rate
// Purpose: Show the user the rate, fees, final fiat amount, and crypto amount, and get quoteId.
app.get('/api/transfi/rate', async (req, res) => {
    try {
        const { amount, currency, paymentCode } = req.query; // Now receiving currency and paymentCode from frontend

        if (!amount || !currency || !paymentCode) {
            return res.status(400).json({ message: "Missing required query parameters: amount, currency, or paymentCode." });
        }
        
        // Use the received currency and paymentCode
        const url = `${process.env.TRANSFI_BASE_URL}/v2/exchange-rates/deposit?amount=${amount}&currency=${currency}&paymentCode=${paymentCode}&direction=forward&balanceCurrency=${currency}`;
        
        const response = await fetch(url, {
            headers: {
                "Authorization": createTransfiAuthToken(),
                "MID": process.env.TRANSFI_MID
            }
        });

        const data = await response.json();
        
        if (!response.ok || data.status !== 'success') {
            console.error('TransFi Rate API Error:', data);
            return res.status(response.status).json({ message: data.message || "Failed to fetch exchange rate from TransFi.", details: data });
        }

        // Response contains: exchangeRate, fees, fiatAmount (in CENTS), quoteId, withdrawAmount
        res.json(data);

    } catch (err) {
        console.error('Error fetching TransFi rate:', err);
        res.status(500).json({ message: "Error fetching rate", error: err.message });
    }
});

// 2) CREATE TRANSFI ORDER: POST /api/transfi/deposit
// Purpose: Create the order, handle user registration/update, and get the TransFi paymentUrl.
app.post('/api/transfi/deposit', async (req, res) => {
    // Note: 'amount' here is expected to be in CENTS as returned by the rate API.
    const { fullname, email, date_of_birth, telegram, whatsapp_number, addressLine1, city, zipCode, planName, pay_currency, amount, quoteId, paymentCode, country, referral_code } = req.body; 

    // --- 1. Validation (CRITICAL: Validate fields needed for TransFi User API) ---
    if (!fullname || !email || !telegram || !planName || !amount || !quoteId || !paymentCode || !country || !date_of_birth || !addressLine1 || !city || !zipCode) {
        // Added country and date_of_birth to the validation check
        return res.status(400).json({ message: 'Missing required information for payment initiation (fullname, email, date_of_birth, country, telegram, planName, amount, quoteId, or paymentCode).' });
    }

    const referrerId = await getReferrerId(referral_code);
    
    // --- 2. Prepare User Data for TransFi ---
    const nameParts = fullname.split(/\s+/);
    const firstName = nameParts.shift() || 'User'; 
    const lastName = nameParts.join(' ') || 'Name'; 
    let transfiUserId;

    try {
        // 3. 🚨 FIX: Call the User API FIRST to create/verify the user.
        // This MUST happen before the Deposit API call to avoid 'USER_NOT_FOUND'.
        transfiUserId = await createOrUpdateTransfiUser({
            email: email,
            firstName: firstName,
            lastName: lastName,
            dateOfBirth: date_of_birth,
            country: country,
            phone: whatsapp_number, // 🚨 FIX: Pass the whatsapp_number here
            addressLine1: addressLine1, 
            city: city,
            zipCode: zipCode
        });
        
    } catch (error) {
        // If user creation fails, do not proceed with deposit
        console.error('Pre-deposit TransFi user setup failed:', error.message);
        return res.status(500).json({ 
            message: 'User registration failed on TransFi. Please check user details and try again.', 
            details: error.message 
        });
    }

    try {
        // *** Your existing database logic to find or create a user ***
        const order_id = `nexxtrade-web-${Date.now()}`;
        let emailForDb = email;

        const existingUserResult = await pool.query('SELECT * FROM users WHERE telegram_handle = $1 AND plan_name = $2', [telegram, planName]);

        if (existingUserResult.rows.length > 0) {
            const userRecord = existingUserResult.rows[0];
            const emailConflictQuery = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, userRecord.id]);
            if (emailConflictQuery.rows.length > 0) {
                 emailForDb = userRecord.email; 
            }
            await pool.query(
                `UPDATE users SET full_name = $1, email = $2, whatsapp_number = $3, order_id = $4, subscription_status = 'pending', last_payment_attempt = NOW(), payment_attempts = payment_attempts + 1, registration_source = 'web', referred_by = $5 WHERE id = $6`,
                [fullname, emailForDb, whatsapp_number, order_id, referrerId, userRecord.id]
            );
        } else {
            const emailConflictQuery = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
            if (emailConflictQuery.rows.length > 0) {
                // Using crypto.randomBytes assumes you have required the 'crypto' module
                emailForDb = `${telegram.replace('@', '')}.${crypto.randomBytes(3).toString('hex')}@telegram.user`;
            }
            const registrationDate = new Date().toISOString().split('T')[0];
            await pool.query(
                `INSERT INTO users (full_name, email, telegram_handle, plan_name, subscription_status, registration_date, order_id, payment_attempts, last_payment_attempt, registration_source, whatsapp_number, referred_by) 
                 VALUES ($1, $2, $3, $4, 'pending', $5, $6, 1, NOW(), 'web', $7, $8)`,
                [fullname, emailForDb, telegram, planName, registrationDate, order_id, whatsapp_number, referrerId]
            );
        }

        // --- 4. TransFi Deposit API Call ---
        const transfiPayload = {
            orderId: order_id, // Our unique order ID
            firstName: firstName,
            lastName: lastName,
            email: email, 
            country: country, 
            amount: parseFloat(amount),
            paymentType: "bank_transfer", 
            currency: pay_currency, 
            paymentCode: paymentCode, 
            purposeCode: "expense_or_medical_reimbursement",
            quoteId: quoteId, 
            redirectUrl: `${process.env.APP_BASE_URL}/join?payment=pending&order_id=${order_id}`, 
            partnerContext: {
                planName: planName,
                telegramHandle: telegram
            },
            withdrawDetails: {
                cryptoTicker: "USDT",
                walletAddress: process.env.TRANSFI_WITHDRAWAL_WALLET_ADDRESS,
                network: "TRX", 
            }
        };

        const response = await fetch(`${process.env.TRANSFI_BASE_URL}/v2/orders/deposit`, {
            method: "POST",
            headers: {
                "Authorization": createTransfiAuthToken(),
                "Content-Type": "application/json",
                "MID": process.env.TRANSFI_MID
            },
            body: JSON.stringify(transfiPayload)
        });

        const data = await response.json();
        
        if (!response.ok || data.status !== 'SUCCESS') {
            console.error('TransFi Deposit API Error:', data);
            return res.status(response.status || 500).json({ message: data.message || "Failed to create deposit order.", details: data });
        }

        // Success: Redirect the user to the TransFi payment page
        res.json({ 
            message: 'Payment order created successfully.',
            redirectUrl: data.data.paymentUrl 
        });

    } catch (err) {
        console.error('Server error while initiating TransFi payment:', err);
        res.status(500).json({ message: 'Server error while initiating TransFi payment.' });
    }
});

// =================================================================
// --- START: TransFi Webhook Handler ---
// =================================================================

app.post('/api/payments/transfi/webhook', async (req, res) => {
    const signature = req.headers['x-transfi-signature'];
    const body = req.body;

    try {
        // 1. Verify the webhook signature
        const calculatedSignature = crypto
            .createHmac('sha256', process.env.TRANSFI_WEBHOOK_SECRET)
            .update(JSON.stringify(body))
            .digest('hex');

        if (signature !== calculatedSignature) {
            console.warn('Invalid TransFi webhook signature received.');
            return res.status(401).send('Invalid signature');
        }

        // 2. Process the payment status
        const { clientOrderId, status, amount } = body;

        // Check if the payment was successful
        if (status === 'COMPLETED' || status === 'SUCCESSFUL') {
            
            // 3. Find the user by the order_id you sent
            const userResult = await pool.query('SELECT * FROM users WHERE order_id = $1', [clientOrderId]);
            if (userResult.rows.length === 0) {
                 console.error(`TransFi Webhook: No user found for order_id ${clientOrderId}`);
                 return res.status(404).send('User not found');
            }
            
            const user = userResult.rows[0];

            // Avoid processing twice
            if (user.subscription_status === 'active') {
                return res.status(200).send('Webhook received. User already active.');
            }

            // 4. ACTIVATE THE USER (Copied from your NOWPayments webhook logic)
            
            const planResult = await pool.query('SELECT * FROM pricingplans WHERE plan_name = $1', [user.plan_name]);
            if (planResult.rows.length === 0) throw new Error('Plan details not found for user.');
            
            const plan = planResult.rows[0];
            const today = new Date();
            let newExpiration = new Date(today);
            
            if (plan.term.toLowerCase().includes('month')) newExpiration.setMonth(newExpiration.getMonth() + 1);
            if (plan.term.toLowerCase().includes('quarter')) newExpiration.setMonth(newExpiration.getMonth() + 3);
            if (plan.term.toLowerCase().includes('year')) newExpiration.setFullYear(newExpiration.getFullYear() + 1);
            if (plan.term.toLowerCase().includes('bi-annually')) newExpiration.setMonth(newExpiration.getMonth() + 6);

            await pool.query(
                `UPDATE users SET subscription_status = 'active', subscription_expiration = $1 WHERE id = $2`,
                [newExpiration.toISOString().split('T')[0], user.id]
            );

            // 5. HANDLE REFERRALS (Copied from your existing logic)
            if (user.referred_by) {
                // ...
                // PASTE your entire "START: REFERRAL COMMISSION" block here
                // (from line 1282 to 1369 in server.js)
                // Use the `amount` variable from the webhook body as the `price_amount`.
                // Example: const commissionAmount = parseFloat(amount) * commissionRate;
                // ...
                console.log("Processing referral commission for TransFi payment...");
            }
            
            // 6. GENERATE TELEGRAM LINK (Copied from your existing logic)
            const inviteLink = await bot.createChatInviteLink(plan.telegram_group_id, { member_limit: 1 });
            await pool.query('UPDATE users SET telegram_invite_token = $1 WHERE id = $2', [inviteLink.invite_link, user.id]);
            console.log(`Generated invite link for web user (fiat) ${user.telegram_handle} and stored it.`);
        }

        res.status(200).send('Webhook received.');

                        // --- START: REFERRAL COMMISSION & NOTIFICATION LOGIC ---
                if (user.referred_by) {
                    const referrerId = user.referred_by;
                    const client = await pool.connect();
                
                    try {
                        // Check if the referrer is an active affiliate with custom rates
                        const affiliateResult = await client.query('SELECT * FROM affiliates WHERE user_id = $1 AND is_active = true', [referrerId]);
                
                        let commissionRate = parseFloat(plan.commission_rate) || 0.10; // Default to plan's rate or 10%
                
                        if (affiliateResult.rows.length > 0) {
                            const affiliate = affiliateResult.rows[0];
                            const planName = user.plan_name.toLowerCase();
                
                            // Use the custom affiliate commission rate based on the plan name if it's higher
                            if (planName.includes('basic') && parseFloat(affiliate.basic_commission_rate) > commissionRate) {
                                commissionRate = parseFloat(affiliate.basic_commission_rate);
                            } else if (planName.includes('pro') && parseFloat(affiliate.pro_commission_rate) > commissionRate) {
                                commissionRate = parseFloat(affiliate.pro_commission_rate);
                            } else if (planName.includes('elite') && parseFloat(affiliate.elite_commission_rate) > commissionRate) {
                                commissionRate = parseFloat(affiliate.elite_commission_rate);
                            }
                        }
                
                        const commissionAmount = parseFloat(price_amount) * commissionRate;
                
                        await client.query('BEGIN');
                        // Log the referral transaction
                        await client.query(
                            'INSERT INTO referrals (referrer_id, referred_user_id, commission_amount) VALUES ($1, $2, $3)',
                            [referrerId, user.id, commissionAmount]
                        );
                        // Update the referrer's total earnings
                        const updatedReferrerResult = await client.query(
                            'UPDATE users SET total_referral_earnings = total_referral_earnings + $1 WHERE id = $2 RETURNING total_referral_earnings, telegram_chat_id',
                            [commissionAmount, referrerId]
                        );
                
                        // --- NEW: BONUS PAYOUT LOGIC ---
                        // Increment the sales count for the bonus
                        const salesUpdateResult = await client.query(
                            'UPDATE affiliates SET total_sales_for_bonus = total_sales_for_bonus + 1 WHERE user_id = $1 RETURNING total_sales_for_bonus',
                            [referrerId]
                        );
                        
                        if (salesUpdateResult.rows.length > 0) {
                            const newSalesCount = salesUpdateResult.rows[0].total_sales_for_bonus;
                            if (newSalesCount % 15 === 0) {
                                // Award the $100 bonus
                                await client.query(
                                    'UPDATE users SET total_referral_earnings = total_referral_earnings + 100 WHERE id = $1',
                                    [referrerId]
                                );
                                // Reset the sales counter for the next bonus
                                await client.query(
                                    'UPDATE affiliates SET total_sales_for_bonus = 0 WHERE user_id = $1',
                                    [referrerId]
                                );
                            }
                        }
                
                        await client.query('COMMIT');
                        console.log(`Successfully awarded $${commissionAmount.toFixed(2)} commission to user ID ${referrerId}.`);
                
                        // Send notification if chat ID is available
                        if (updatedReferrerResult.rows.length > 0) {
                            const referrer = updatedReferrerResult.rows[0];
                            if (referrer.telegram_chat_id) {
                                const newTotalEarnings = parseFloat(referrer.total_referral_earnings);
                                // Fetch their total payouts to calculate available balance for the message
                                const payoutsResult = await pool.query("SELECT COALESCE(SUM(amount), 0) as total_payouts FROM payouts WHERE user_id = $1 AND status = 'completed'", [referrerId]);
                                const newAvailableBalance = newTotalEarnings - parseFloat(payoutsResult.rows[0].total_payouts);
                
                                let notificationMessage = `🎉 Congratulations! A new user has subscribed using your referral link. You've just earned $${commissionAmount.toFixed(2)}!\n\nYour new available balance is $${newAvailableBalance.toFixed(2)}.`;
                                
                                // Add bonus notification if applicable
                                if (salesUpdateResult.rows.length > 0 && salesUpdateResult.rows[0].total_sales_for_bonus === 0) {
                                    notificationMessage += `\n\n💰 BONUS ALERT! You've made 15 sales and earned a $100 bonus!`;
                                }
                                
                                bot.sendMessage(referrer.telegram_chat_id, notificationMessage).catch(err => console.error("Failed to send referral notification:", err));
                            }
                        }
                
                    } catch (e) {
                        await client.query('ROLLBACK');
                        console.error('Failed to process referral commission:', e);
                    } finally {
                        client.release();
                    }
                }
                // --- END: REFERRAL COMMISSION & NOTIFICATION LOGIC ---

    } catch (err) {
        console.error('Error processing TransFi webhook:', err);
        res.status(500).send('Server Error');
    }
});

// =================================================================
// --- END: TransFi Webhook Handler ---
// =================================================================

// =================================================================
// --- START: UNIFIED PAYMENT FLOW (WEB + TELEGRAM BOT) ---
// =================================================================

// Helper function to find referrer ID
async function getReferrerId(referralCode) {
    if (!referralCode) {
        return null;
    }
    const referrerResult = await pool.query('SELECT id FROM users WHERE referral_code = $1', [referralCode]);
    if (referrerResult.rows.length > 0) {
        return referrerResult.rows[0].id;
    }
    return null;
}


// === Flow 1: User starts payment from the Website ===
app.post('/api/payments/create-from-web', async (req, res) => {
    try {
        const { fullname, email, telegram, planName, pay_currency, whatsapp_number, referral_code } = req.body;
        
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
        const referrerId = await getReferrerId(referral_code);
        
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
                `UPDATE users SET full_name = $1, email = $2, whatsapp_number = $3, order_id = $4, subscription_status = 'pending', last_payment_attempt = NOW(), payment_attempts = payment_attempts + 1, registration_source = 'web', referred_by = $5 WHERE id = $6`,
                [fullname, emailForDb, whatsapp_number, order_id, referrerId, userRecord.id]
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
           // This is the CORRECTED code block
          await pool.query(
          `INSERT INTO users (full_name, email, telegram_handle, plan_name, subscription_status, registration_date, order_id, payment_attempts, last_payment_attempt, registration_source, whatsapp_number, referred_by)
           VALUES ($1, $2, $3, $4, 'pending', $5, $6, 1, NOW(), 'web', $7, $8)`,
          [fullname, emailForDb, telegram, planName, registrationDate, order_id, whatsapp_number, referrerId]
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
        const { telegram_handle, chat_id, plan_id, pay_currency, whatsapp_number, referral_code, telegram_user_id } = req.body;
        if (!telegram_handle || !chat_id || !plan_id || !pay_currency || !whatsapp_number) {
            return res.status(400).json({ message: 'Missing required fields from bot.' });
        }

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

        const order_id = `nexxtrade-bot-${telegram_handle.replace('@', '')}-${Date.now()}`;
        const referrerId = await getReferrerId(referral_code);

        const existingUserPlan = await pool.query(
            'SELECT * FROM users WHERE telegram_handle = $1 AND plan_name = $2',
            [telegram_handle, plan.plan_name]
        );

        if (existingUserPlan.rows.length > 0) {
            const userRecord = existingUserPlan.rows[0];
            if (userRecord.subscription_status === 'active') {
                return res.status(409).json({ message: `You already have an active subscription for the ${plan.plan_name} plan.` });
            }
            await pool.query(
                `UPDATE users SET whatsapp_number = $1, order_id = $2, subscription_status = 'pending', last_payment_attempt = NOW(), payment_attempts = payment_attempts + 1, telegram_chat_id = $3, registration_source = 'bot', referred_by = $4, telegram_user_id = $6 WHERE id = $5`,
                [whatsapp_number, order_id, chat_id, referrerId, userRecord.id, telegram_user_id]
            );
        } else {
            const temp_fullname = `User ${telegram_handle}`;
            let temp_email = `${telegram_handle.replace('@','')}@telegram.user`;
            
            // **FIX APPLIED HERE**
            // Check if the synthetic email already exists from a previous plan purchase
            const emailConflictQuery = await pool.query('SELECT id FROM users WHERE email = $1', [temp_email]);
            if (emailConflictQuery.rows.length > 0) {
                console.warn(`BOT INSERT: Email "${temp_email}" already exists. Generating unique synthetic email.`);
                // If it exists, create a new, unique synthetic email to avoid the constraint violation
                temp_email = `${telegram_handle.replace('@', '')}.${crypto.randomBytes(3).toString('hex')}@telegram.user`;
            }

            const registrationDate = new Date().toISOString().split('T')[0];
            await pool.query(
                `INSERT INTO users (full_name, email, telegram_handle, plan_name, subscription_status, registration_date, order_id, payment_attempts, last_payment_attempt, telegram_chat_id, registration_source, whatsapp_number, telegram_user_id, referred_by)
                VALUES ($1, $2, $3, $4, 'pending', $5, $6, 1, NOW(), $7, 'bot', $8, $9, $10)`,
                [temp_fullname, temp_email, telegram_handle, plan.plan_name, registrationDate, order_id, chat_id, whatsapp_number, telegram_user_id, referrerId]
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
                order_description: `NexxTrade ${plan.plan_name} plan for ${telegram_handle} (Bot)`
            })
        });

        if (!nowPaymentsResponse.ok) {
            const errorText = await nowPaymentsResponse.text();
            return res.status(500).json({ message: `Payment processor error: ${errorText}`});
        }
        
        const paymentData = await nowPaymentsResponse.json();

        res.status(200).json(paymentData);

    } catch (err) {
        console.error('Error creating payment from bot:', err);
        res.status(500).json({ message: 'Server Error during bot payment creation.' });
    }
});


// === Confirmation (Webhook): The single source of truth for payment completion (UPDATED) ===
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
        
        const { order_id, payment_status, price_amount } = ipnData;
        
        // Only process finished/confirmed payments
        if (['finished', 'confirmed'].includes(payment_status)) {
            // Find the user record associated with this order
            const userResult = await pool.query('SELECT * FROM users WHERE order_id = $1', [order_id]);
            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                
                // Activate the subscription
                const planResult = await pool.query('SELECT * FROM pricingplans WHERE plan_name = $1', [user.plan_name]);
                if (planResult.rows.length === 0) throw new Error('Plan details not found for user.');
                
                const plan = planResult.rows[0];
                const today = new Date();
                let newExpiration = new Date(today);
                
                if (plan.term.toLowerCase().includes('month')) newExpiration.setMonth(newExpiration.getMonth() + 1);
                if (plan.term.toLowerCase().includes('quarter')) newExpiration.setMonth(newExpiration.getMonth() + 3);
                if (plan.term.toLowerCase().includes('year')) newExpiration.setFullYear(newExpiration.getFullYear() + 1);
                if (plan.term.toLowerCase().includes('bi-annually')) newExpiration.setMonth(newExpiration.getMonth() + 6);


                await pool.query(
                    `UPDATE users SET subscription_status = 'active', subscription_expiration = $1 WHERE id = $2`,
                    [newExpiration.toISOString().split('T')[0], user.id]
                );
                
                // --- START: REFERRAL COMMISSION & NOTIFICATION LOGIC ---
                if (user.referred_by) {
                    const referrerId = user.referred_by;
                    const client = await pool.connect();
                
                    try {
                        // Check if the referrer is an active affiliate with custom rates
                        const affiliateResult = await client.query('SELECT * FROM affiliates WHERE user_id = $1 AND is_active = true', [referrerId]);
                
                        let commissionRate = parseFloat(plan.commission_rate) || 0.10; // Default to plan's rate or 10%
                
                        if (affiliateResult.rows.length > 0) {
                            const affiliate = affiliateResult.rows[0];
                            const planName = user.plan_name.toLowerCase();
                
                            // Use the custom affiliate commission rate based on the plan name if it's higher
                            if (planName.includes('basic') && parseFloat(affiliate.basic_commission_rate) > commissionRate) {
                                commissionRate = parseFloat(affiliate.basic_commission_rate);
                            } else if (planName.includes('pro') && parseFloat(affiliate.pro_commission_rate) > commissionRate) {
                                commissionRate = parseFloat(affiliate.pro_commission_rate);
                            } else if (planName.includes('elite') && parseFloat(affiliate.elite_commission_rate) > commissionRate) {
                                commissionRate = parseFloat(affiliate.elite_commission_rate);
                            }
                        }
                
                        const commissionAmount = parseFloat(price_amount) * commissionRate;
                
                        await client.query('BEGIN');
                        // Log the referral transaction
                        await client.query(
                            'INSERT INTO referrals (referrer_id, referred_user_id, commission_amount) VALUES ($1, $2, $3)',
                            [referrerId, user.id, commissionAmount]
                        );
                        // Update the referrer's total earnings
                        const updatedReferrerResult = await client.query(
                            'UPDATE users SET total_referral_earnings = total_referral_earnings + $1 WHERE id = $2 RETURNING total_referral_earnings, telegram_chat_id',
                            [commissionAmount, referrerId]
                        );
                
                        // --- NEW: BONUS PAYOUT LOGIC ---
                        // Increment the sales count for the bonus
                        const salesUpdateResult = await client.query(
                            'UPDATE affiliates SET total_sales_for_bonus = total_sales_for_bonus + 1 WHERE user_id = $1 RETURNING total_sales_for_bonus',
                            [referrerId]
                        );
                        
                        if (salesUpdateResult.rows.length > 0) {
                            const newSalesCount = salesUpdateResult.rows[0].total_sales_for_bonus;
                            if (newSalesCount % 15 === 0) {
                                // Award the $100 bonus
                                await client.query(
                                    'UPDATE users SET total_referral_earnings = total_referral_earnings + 100 WHERE id = $1',
                                    [referrerId]
                                );
                                // Reset the sales counter for the next bonus
                                await client.query(
                                    'UPDATE affiliates SET total_sales_for_bonus = 0 WHERE user_id = $1',
                                    [referrerId]
                                );
                            }
                        }
                
                        await client.query('COMMIT');
                        console.log(`Successfully awarded $${commissionAmount.toFixed(2)} commission to user ID ${referrerId}.`);
                
                        // Send notification if chat ID is available
                        if (updatedReferrerResult.rows.length > 0) {
                            const referrer = updatedReferrerResult.rows[0];
                            if (referrer.telegram_chat_id) {
                                const newTotalEarnings = parseFloat(referrer.total_referral_earnings);
                                // Fetch their total payouts to calculate available balance for the message
                                const payoutsResult = await pool.query("SELECT COALESCE(SUM(amount), 0) as total_payouts FROM payouts WHERE user_id = $1 AND status = 'completed'", [referrerId]);
                                const newAvailableBalance = newTotalEarnings - parseFloat(payoutsResult.rows[0].total_payouts);
                
                                let notificationMessage = `🎉 Congratulations! A new user has subscribed using your referral link. You've just earned $${commissionAmount.toFixed(2)}!\n\nYour new available balance is $${newAvailableBalance.toFixed(2)}.`;
                                
                                // Add bonus notification if applicable
                                if (salesUpdateResult.rows.length > 0 && salesUpdateResult.rows[0].total_sales_for_bonus === 0) {
                                    notificationMessage += `\n\n💰 BONUS ALERT! You've made 15 sales and earned a $100 bonus!`;
                                }
                                
                                bot.sendMessage(referrer.telegram_chat_id, notificationMessage).catch(err => console.error("Failed to send referral notification:", err));
                            }
                        }
                
                    } catch (e) {
                        await client.query('ROLLBACK');
                        console.error('Failed to process referral commission:', e);
                    } finally {
                        client.release();
                    }
                }
                // --- END: REFERRAL COMMISSION & NOTIFICATION LOGIC ---


                // === DELIVERY LOGIC ===
               if (user.registration_source === 'bot' && user.telegram_chat_id) {
                    userRegistrationState[user.telegram_chat_id] = {
                        orderId: user.order_id,
                        stage: 'awaiting_full_name'
                    };
                    await bot.sendMessage(
                      user.telegram_chat_id,
                      `✅ Payment confirmed! To complete your registration, please provide your full name.`
                    );
                } else {
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

// =================================================================
// --- NEW: LINK EXISTING TELEGRAM USER ID ---
// =================================================================

app.post('/api/users/link-telegram-id', async (req, res) => {
    const { telegram_handle, telegram_user_id } = req.body;

    if (!telegram_handle || !telegram_user_id) {
        return res.status(400).json({ message: 'Missing Telegram handle or user ID.' });
    }

    try {
        // We only update the user if the handle matches AND the user_id is currently empty.
        // This prevents existing linked accounts from being overwritten.
        const { rowCount } = await pool.query(
            `UPDATE users 
             SET telegram_user_id = $1 
             WHERE telegram_handle = $2 AND telegram_user_id IS NULL`,
            [telegram_user_id, '@' + telegram_handle]
        );

        if (rowCount > 0) {
            console.log(`Successfully linked telegram_user_id ${telegram_user_id} for user @${telegram_handle}`);
            res.status(200).json({ message: 'Account linked successfully!' });
        } else {
            // This can happen if the user was not found or was already linked.
            console.log(`No user found to link for @${telegram_handle}, or they were already linked.`);
            res.status(200).json({ message: 'Account already linked or user not found.' }); // Send 200 to avoid bot error logs
        }
    } catch (err) {
        console.error('Error linking Telegram user ID:', err);
        res.status(500).json({ message: 'Server error during account linking.' });
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

// --- NEW PAYOUT ADMIN ROUTES ---
app.get('/api/payouts', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT p.id, u.telegram_handle, p.amount, p.payout_address, p.status, p.requested_at 
            FROM payouts p
            JOIN users u ON p.user_id = u.id
            ORDER BY p.requested_at DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error("Error fetching payouts:", err);
        res.status(500).send("Server Error");
    }
});

app.put('/api/payouts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // Expecting status: 'completed' or 'rejected'
        if (!['completed', 'rejected'].includes(status)) {
            return res.status(400).send("Invalid status provided.");
        }
        
        const { rows } = await pool.query(
            "UPDATE payouts SET status = $1, completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END WHERE id = $2 RETURNING *",
            [status, id]
        );
         if (rows.length === 0) {
            return res.status(404).send('Payout request not found.');
        }

        // Notify user about the status update
        const payout = rows[0];
        const userResult = await pool.query('SELECT telegram_chat_id FROM users WHERE id = $1', [payout.user_id]);
        if (userResult.rows.length > 0 && userResult.rows[0].telegram_chat_id) {
            const chatId = userResult.rows[0].telegram_chat_id;
            let message = '';
            if (status === 'completed') {
                message = `✅ Your payout request for $${payout.amount} has been approved and processed.`;
            } else if (status === 'rejected') {
                message = `⚠️ Your payout request for $${payout.amount} has been rejected. Please contact support for more details.`;
            }
            if (message) {
                bot.sendMessage(chatId, message).catch(err => console.error("Failed to send payout status notification:", err));
            }
        }
        
        res.json(payout);
    } catch (err) {
        console.error("Error updating payout status:", err);
        res.status(500).send("Server Error");
    }
});


// --- UPDATED: NOTIFICATION ROUTE TO HANDLE BASE64 IMAGE UPLOADS ---
app.post('/api/notifications/send', async (req, res) => {
    try {
        const { message, target, commands, telegramHandles, images } = req.body;

        if (!message || !target) {
            return res.status(400).json({ message: 'Message and target audience are required.' });
        }

        let query = '';
        const params = [];

        switch (target) {
            case 'all':
                query = `SELECT telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL AND registration_source = 'bot'`;
                break;
            case 'active':
                query = `SELECT telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL AND registration_source = 'bot' AND subscription_status = 'active'`;
                break;
            case 'pending':
                query = `SELECT telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL AND registration_source = 'bot' AND subscription_status = 'pending'`;
                break;
            case 'specific':
                if (!telegramHandles || telegramHandles.length === 0) {
                    return res.status(400).json({ message: 'At least one Telegram handle is required for specific users.' });
                }
                query = `SELECT telegram_chat_id FROM users WHERE telegram_handle = ANY($1::text[])`;
                params.push(telegramHandles.map(h => h.startsWith('@') ? h : '@' + h));
                break;
            default:
                return res.status(400).json({ message: 'Invalid target audience specified.' });
        }

        const { rows: users } = await pool.query(query, params);

        if (users.length === 0) {
            return res.status(404).json({ message: 'No users found for the selected criteria.' });
        }

        const messageOptions = {};
        if (commands && commands.length > 0) {
            const commandMap = {
                '/start': { text: 'Go to Main Menu', callback_data: 'main_menu' },
                '/getsignals': { text: '🚀 Get Signals Now', callback_data: 'get_signals_now' },
                '/myreferral': { text: '🔗 Get My Referral Link', callback_data: 'refer_earn' },
                '/referralstats': { text: '📈 View My Stats', callback_data: 'referral_stats' },
                '/requestpayout': { text: '💰 Request Payout', callback_data: 'request_payout' }
            };
            const buttons = commands.map(command => commandMap[command]).filter(Boolean);
            
            if (buttons.length > 0) {
                messageOptions.reply_markup = {
                    inline_keyboard: [buttons]
                };
            }
        }

        let successCount = 0;
        let errorCount = 0;
        
        const sendPromises = users.map((user, index) => {
            return new Promise(resolve => {
                setTimeout(async () => {
                    try {
                        if (user.telegram_chat_id) {
                            const hasImages = images && images.length > 0;

                            if (!hasImages) {
                                await bot.sendMessage(user.telegram_chat_id, message, messageOptions);
                            } else if (images.length === 1) {
                                // Convert Base64 to Buffer for a single image
                                const buffer = Buffer.from(images[0].replace(/^data:image\/\w+;base64,/, ""), 'base64');
                                await bot.sendPhoto(user.telegram_chat_id, buffer, {
                                    caption: message,
                                    ...messageOptions
                                });
                            } else {
                                // Convert multiple Base64 strings to Buffers for a media group
                                const mediaGroup = images.slice(0, 10).map((base64Image, i) => {
                                    const buffer = Buffer.from(base64Image.replace(/^data:image\/\w+;base64,/, ""), 'base64');
                                    return {
                                        type: 'photo',
                                        media: buffer,
                                        caption: i === 0 ? message : undefined 
                                    };
                                });
                                await bot.sendMediaGroup(user.telegram_chat_id, mediaGroup);
                                if (messageOptions.reply_markup) {
                                    await bot.sendMessage(user.telegram_chat_id, "Choose an option:", messageOptions);
                                }
                            }
                            successCount++;
                        }
                    } catch (err) {
                        console.error(`Failed to send message to chat_id ${user.telegram_chat_id}:`, err.response ? err.response.body : err.message);
                        errorCount++;
                    }
                    resolve();
                }, index * 100);
            });
        });

        await Promise.all(sendPromises);

        console.log(`Notification batch completed. Successful: ${successCount}, Failed: ${errorCount}`);
        
        res.status(200).json({ 
            message: `Notification sent successfully to ${successCount} user(s). Failed for ${errorCount} user(s).` 
        });

    } catch (err) {
        console.error('Error in /api/notifications/send:', err);
        res.status(500).json({ message: 'Server error while sending notifications.' });
    }
});


// --- UPDATED: Routes for Clean URLs ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/*', (req, res) => {
    // This will catch all routes and redirect to the correct html file.
    const route = req.path.split('/')[1] || '';

    // If the route starts with @, it's a referral link, which is handled above.
    // We can add a check here just in case, but the specific route handler should catch it first.
    if (route.startsWith('@')) {
        // The /@:referralCode route handler will manage this
        return;
    }


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
                'roles': 'admin_roles.html',
                'payouts': 'admin_payouts.html',
                'affiliates': 'admin_affiliates.html', // NEW
                'notifications': 'admin_notifications.html' // NEW
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