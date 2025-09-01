// telegram_bot.js

// Load environment variables from .env file
require('dotenv').config();

// Import the Telegram Bot API library
const TelegramBot = require('node-telegram-bot-api');

// Get the bot token and server URL from your .env file
const token = process.env.TELEGRAM_BOT_TOKEN;
const serverUrl = process.env.APP_BASE_URL;
const privateChannelId = '-1001234567890'; // Replace with your actual private channel ID

// Create a new Telegram bot instance
// The 'polling' option is great for development, but for production, you would typically use a webhook.
const bot = new TelegramBot(token, { polling: true });

console.log('Telegram bot is now running...');

// Listen for the '/start' command
bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramHandle = msg.from.username;
    const telegramInviteToken = match[1];

    if (!telegramHandle) {
        bot.sendMessage(chatId, "Please set a public Telegram username in your profile settings before proceeding.");
        return;
    }

    try {
        // Call your backend server to verify the user and token
        const response = await fetch(`${serverUrl}/api/users/verify-telegram`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                telegram_handle: `@${telegramHandle}`,
                telegram_invite_token: telegramInviteToken
            })
        });

        const data = await response.json();

        if (response.ok) {
            // Verification successful, create an invite link
            const inviteLink = await bot.createChatInviteLink(privateChannelId, {
                member_limit: 1, // Ensure the link is single-use
                expire_date: Math.floor(Date.now() / 1000) + 600 // Expire in 10 minutes
            });
            
            bot.sendMessage(chatId, 
                `Verification successful, ${data.user.full_name}! You have been granted access to the private channel. \n\nYour plan: ${data.user.plan_name}\n\nHere is your private, one-time invite link: ${inviteLink.invite_link}`
            );
        } else {
            // Verification failed
            bot.sendMessage(chatId, `Verification failed: ${data.message}. Please contact support.`);
        }
    } catch (error) {
        console.error('Error in bot verification process:', error);
        bot.sendMessage(chatId, "An error occurred during verification. Please contact support.");
    }
});

// Respond to any other messages
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    if (msg.text.toString().toLowerCase() !== "/start") {
        bot.sendMessage(chatId, "Hello! I am the NexxTrade bot. To gain access to our private channels, please sign up and pay via our website. Your unique invite link will be sent to you automatically after payment.");
    }
});