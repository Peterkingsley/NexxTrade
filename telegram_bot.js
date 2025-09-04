// server.js
// This file sets up a Node.js backend server using Express and a PostgreSQL database.
// It handles API routes for managing blogs, pricing plans, roles, and performance data.

// Import required modules
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api'); // Import TelegramBot here
const { setupBotHandlers } = require('./telegram_bot.js'); // Import the handler setup function

// Load environment variables from .env file
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const token = process.env.TELEGRAM_BOT_TOKEN;
const serverUrl = process.env.APP_BASE_URL;
const privateChannelId = process.env.PRIVATE_CHANNEL_ID;

// --- BOT AND WEBHOOK SETUP ---
// Create the bot instance here
const bot = new TelegramBot(token, { polling: false });

// This function sets up the webhook on Telegram's side.
const setupWebhook = async () => {
    try {
        const webhookUrl = `${serverUrl}/bot${token}`;
        await bot.setWebHook(webhookUrl);
        console.log(`Webhook set to: ${webhookUrl}`);
    } catch (error) {
        console.error('Failed to set webhook:', error);
    }
};

// Pass the bot instance to the handler setup function
setupBotHandlers(bot, serverUrl, privateChannelId);

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- DATABASE CONNECTION ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function connectToDatabase() {
  try {
    const client = await pool.connect();
    console.log('Successfully connected to the PostgreSQL database.');
    client.release();
  } catch (error) {
    console.error('Database connection failed:', error.stack);
  }
}
connectToDatabase();

// --- API ROUTES ---

// Blogs Management
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


// Pricing Plans Management
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


// User Roles Management
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


// Performance Signals
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


// PNL Proofs
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


// User and Subscription Management
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

app.post('/api/payments/opay', async (req, res) => {
    try {
        const { fullname, email, telegram, plan } = req.body;
        const USD_TO_NGN_RATE = 750;
        const prices = { monthly: 39, quarterly: 99, yearly: 299 };
        const amountUSD = prices[plan];

        if (!amountUSD) {
            return res.status(400).json({ message: 'Invalid plan selected.' });
        }
        const amountNGN = amountUSD * USD_TO_NGN_RATE;
        const transactionRef = crypto.randomBytes(16).toString('hex');
        const telegramInviteToken = crypto.randomBytes(32).toString('hex');
        const registrationDate = new Date().toISOString().split('T')[0];

        await pool.query(
            `INSERT INTO users (full_name, email, telegram_handle, plan_name, subscription_status, registration_date, telegram_invite_token)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [fullname, email, telegram, plan, 'pending', registrationDate, telegramInviteToken]
        );
        
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

app.post('/api/payments/opay/webhook', async (req, res) => {
    const { reference, status } = req.body;
    if (!reference || !status) {
        return res.status(400).send('Invalid webhook payload');
    }

    if (status === 'success') {
        try {
            const { rows } = await pool.query('SELECT * FROM users WHERE telegram_invite_token = $1', [reference]);
            if (rows.length === 0) {
                return res.status(404).send('User not found for this transaction reference.');
            }
            const user = rows[0];
            let expirationDate = new Date();
            if (user.plan_name === 'monthly') expirationDate.setMonth(expirationDate.getMonth() + 1);
            else if (user.plan_name === 'quarterly') expirationDate.setMonth(expirationDate.getMonth() + 3);
            else if (user.plan_name === 'yearly') expirationDate.setFullYear(expirationDate.getFullYear() + 1);

            await pool.query(
                `UPDATE users SET subscription_status = 'active', subscription_expiration = $1 WHERE telegram_invite_token = $2`,
                [expirationDate.toISOString().split('T')[0], reference]
            );
            console.log(`User ${user.email} subscription activated successfully.`);
            res.status(200).send('Webhook received and processed successfully.');
        } catch (err) {
            console.error('Error processing OPay webhook:', err);
            res.status(500).send('Server Error');
        }
    } else {
        console.log(`Received webhook for reference ${reference} with status: ${status}`);
        res.status(200).send('Webhook received, but payment was not successful.');
    }
});

app.post('/api/subscriptions/cleanup', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const { rows } = await pool.query(
            "SELECT id, telegram_handle FROM users WHERE subscription_status = 'active' AND subscription_expiration < $1",
            [today]
        );
        if (rows.length === 0) {
            return res.status(200).json({ message: 'No expired subscriptions found.' });
        }
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
            await pool.query('UPDATE users SET telegram_invite_token = NULL WHERE id = $1', [user.id]);
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

// Telegram Webhook
app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});


// --- STATIC FILES & PAGE ROUTES ---
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/join', (req, res) => res.sendFile(path.join(__dirname, 'public', 'registration.html')));
app.get('/performance', (req, res) => res.sendFile(path.join(__dirname, 'public', 'performance.html')));
app.get('/blog', (req, res) => res.sendFile(path.join(__dirname, 'public', 'blog.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin_dashboard.html')));
app.get('/admin/blogs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin_blogs.html')));
app.get('/admin/performance', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin_performance.html')));
app.get('/admin/pricing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin_pricing.html')));
app.get('/admin/roles', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin_roles.html')));


// --- SERVER STARTUP ---
app.listen(port, async () => {
  console.log(`Server is running on http://localhost:${port}`);
  await setupWebhook();
});

