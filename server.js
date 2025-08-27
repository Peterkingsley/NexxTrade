// Filename: server.js
// This server contains only the backend API endpoints.
// Database table creation is handled separately via DBeaver or a migration script.

// Import necessary modules.
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

// Initialize the Express application.
const app = express();

// Define the port the server will listen on.
const PORT = process.env.PORT || 3000;

// Set up the database connection pool using the DATABASE_URL environment variable.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test the database connection.
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to the database:', err.stack);
  } else {
    console.log('Database connected successfully! Current time from DB:', res.rows[0].now);
  }
});

// Use Express's built-in JSON middleware.
app.use(express.json());

// Serve static files from the 'public' directory.
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoint: Create a new blog post
app.post('/api/blogs', async (req, res) => {
  const { title, teaser, content, author, status, featured_image_url } = req.body;
  const published_date = new Date().toISOString().slice(0, 10);

  try {
    const newBlog = await pool.query(
      `INSERT INTO blogPosts (title, teaser, content, author, published_date, status, featured_image_url) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, teaser, content, author, published_date, status, featured_image_url]
    );
    res.status(201).json(newBlog.rows[0]);
  } catch (err) {
    console.error('Error adding new blog post:', err.stack);
    res.status(500).json({ error: 'Failed to add blog post' });
  }
});

// API Endpoint: Get all blog posts
app.get('/api/blogs', async (req, res) => {
  try {
    const allBlogs = await pool.query('SELECT * FROM blogPosts ORDER BY published_date DESC');
    res.status(200).json(allBlogs.rows);
  } catch (err) {
    console.error('Error fetching blog posts:', err.stack);
    res.status(500).json({ error: 'Failed to fetch blog posts' });
  }
});

// API Endpoint: Get a single blog post by ID
app.get('/api/blogs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const blog = await pool.query('SELECT * FROM blogPosts WHERE id = $1', [id]);
    if (blog.rows.length === 0) {
      return res.status(404).json({ error: 'Blog post not found' });
    }
    res.status(200).json(blog.rows[0]);
  } catch (err) {
    console.error('Error fetching single blog post:', err.stack);
    res.status(500).json({ error: 'Failed to fetch blog post' });
  }
});

// API Endpoint: Delete a blog post by ID
app.delete('/api/blogs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM blogPosts WHERE id = $1', [id]);
    res.status(200).json({ message: 'Blog post deleted successfully' });
  } catch (err) {
    console.error('Error deleting blog post:', err.stack);
    res.status(500).json({ error: 'Failed to delete blog post' });
  }
});

// API Endpoint: Update a blog post
app.put('/api/blogs/:id', async (req, res) => {
  const { id } = req.params;
  const { title, teaser, content, author, status, featured_image_url } = req.body;
  try {
    const updatedBlog = await pool.query(
      `UPDATE blogPosts SET title = $1, teaser = $2, content = $3, author = $4, status = $5, featured_image_url = $6 
       WHERE id = $7 RETURNING *`,
      [title, teaser, content, author, status, featured_image_url, id]
    );
    if (updatedBlog.rows.length === 0) {
      return res.status(404).json({ error: 'Blog post not found' });
    }
    res.status(200).json(updatedBlog.rows[0]);
  } catch (err) {
    console.error('Error updating blog post:', err.stack);
    res.status(500).json({ error: 'Failed to update blog post' });
  }
});

// Fallback route for the homepage.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server and listen for incoming requests.
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Serving files from the "public" directory.');
});
