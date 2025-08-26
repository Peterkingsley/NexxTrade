// Filename: server.js
// This is a simple Node.js server using Express.js.
// It is designed to serve all the static files (HTML, CSS, JS) from your 'public' directory.

// Import the necessary modules.
const express = require('express');
const path = require('path');

// Initialize the Express application.
const app = express();

// Define the port the server will listen on.
// We use process.env.PORT to allow Render to dynamically set the port.
const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory.
// This is the most important part. It tells the server to treat the 'public' folder
// as the root for all web requests, so 'index.html' is served at the base URL.
app.use(express.static(path.join(__dirname, 'public')));

// Set up a basic route for the homepage to ensure it works.
// This is a fallback and generally not needed if `express.static` is used correctly,
// but it's good practice.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server and listen for incoming requests on the specified port.
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Serving files from the "public" directory.');
});
