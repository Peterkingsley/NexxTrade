const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs'); // Import the file system module
const app = express();

require('dotenv').config();
const port = process.env.PORT || 3000;

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

// --- Multer setup for file uploads ---
// Create the uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// API Routes for Blogs Management
app.get('/api/blogs', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM blogposts ORDER BY published_date DESC');
    // Prepend the base URL to the image URL for correct display
    const blogsWithImageUrls = rows.map(blog => {
      const featured_image_url = blog.featured_image_url ? `${req.protocol}://${req.get('host')}/${blog.featured_image_url}` : null;
      return { ...blog, featured_image_url };
    });
    res.json(blogsWithImageUrls);
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
    const blog = rows[0];
    const featured_image_url = blog.featured_image_url ? `${req.protocol}://${req.get('host')}/${blog.featured_image_url}` : null;
    res.json({ ...blog, featured_image_url });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.post('/api/blogs', upload.single('featured-image'), async (req, res) => {
  try {
    const { title, teaser, content, author, published_date, status } = req.body;
    const featured_image_url = req.file ? path.join('uploads', req.file.filename) : null;

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

app.put('/api/blogs/:id', upload.single('featured-image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, teaser, content, author, published_date, status, existing_image_url } = req.body;
    let featured_image_url = existing_image_url;
    
    // If a new file is uploaded, use the new file path
    if (req.file) {
      featured_image_url = path.join('uploads', req.file.filename);
    }

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
        const { rows } = await pool.query(
            'SELECT * FROM adminusers WHERE username = $1', 
            [username]
        );

        if (rows.length > 0) {
            const user = rows[0];
            const match = await bcrypt.compare(password, user.hashed_password);

            if (match) {
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
app.get('/api/performances', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM performancesignals ORDER BY date DESC');
    res.json(rows);
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

// API Routes for PnL Proofs
app.get('/api/pnlproofs', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pnlproofs ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.post('/api/pnlproofs', async (req, res) => {
  try {
    const { description, image_url } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO pnlproofs(description, image_url) VALUES($1, $2) RETURNING *',
      [description, image_url]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.put('/api/pnlproofs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { description, image_url } = req.body;
    const { rows } = await pool.query(
      'UPDATE pnlproofs SET description = $1, image_url = $2 WHERE id = $3 RETURNING *',
      [description, image_url, id]
    );
    if (rows.length === 0) {
      return res.status(404).send('PnL proof not found.');
    }
    res.json(rows[0]);
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
      return res.status(404).send('PnL proof not found.');
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
