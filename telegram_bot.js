// telegram_bot.js

// Load environment variables from .env file
require('dotenv').config();

// Import the Telegram Bot API library
const TelegramBot = require('node-telegram-bot-api');

// Get the bot token and server URL from your .env file
const token = process.env.TELEGRAM_BOT_TOKEN;
const serverUrl = process.env.APP_BASE_URL;
const privateChannelId = process.env.PRIVATE_CHANNEL_ID;

// Create a new Telegram bot instance
// The 'polling' option is great for development, but for production, you would typically use a webhook.
const bot = new TelegramBot(token, { polling: true });

console.log('Telegram bot is now running...');

// NEW: Listen for a simple '/start' command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramHandle = msg.from.username;

    if (!telegramHandle) {
        bot.sendMessage(chatId, "Please set a public Telegram username in your profile settings before proceeding.");
        return;
    }
    
    try {
        // Step 1: Check if the user is already a member of the group
        const chatMember = await bot.getChatMember(privateChannelId, msg.from.id);
        
        // If the user is a member (not 'left' or 'kicked'), return a message.
        if (chatMember.status !== 'left' && chatMember.status !== 'kicked') {
            bot.sendMessage(chatId, "You are already a member of the group!");
            return;
        }
    } catch (error) {
        // This is expected if the user is not in the group. We can ignore this error.
        console.log(`User @${telegramHandle} is not a member of the chat. Proceeding with verification.`);
    }

    try {
        // Step 2: Check the user's subscription status via the backend API
        const response = await fetch(`${serverUrl}/api/users/status-by-telegram-handle/${telegramHandle}`);
        const data = await response.json();

        if (response.ok && data.subscription_status === 'active') {
            // Step 3: If the subscription is active, generate a new one-time invite link.
            const inviteLink = await bot.createChatInviteLink(privateChannelId, {
                member_limit: 1, // Ensure the link is single-use
                expire_date: Math.floor(Date.now() / 1000) + 600 // Expire in 10 minutes
            });
            
            bot.sendMessage(chatId, 
                `Hello @${telegramHandle}! Your subscription is active. Here is your private, one-time invite link: ${inviteLink.invite_link}`
            );
        } else {
            // If the subscription is not active or user not found
            bot.sendMessage(chatId, `Your status could not be found or your subscription is inactive. Please contact support via our website.`);
        }
    } catch (error) {
        console.error('Error in bot verification process:', error);
        bot.sendMessage(chatId, "An error occurred during verification. Please contact support.");
    }
});


// Listen for the '/status' command
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramHandle = msg.from.username;

    if (!telegramHandle) {
        bot.sendMessage(chatId, "Please set a public Telegram username in your profile settings before checking your status.");
        return;
    }

    try {
        const response = await fetch(`${serverUrl}/api/users/status-by-telegram-handle/${telegramHandle}`);
        const data = await response.json();

        if (response.ok) {
            bot.sendMessage(chatId, `Hello @${telegramHandle}! Your subscription status is: ${data.subscription_status}. It is valid until ${data.subscription_expiration}.`);
        } else {
            bot.sendMessage(chatId, `Your status could not be found. Please contact support.`);
        }
    } catch (error) {
        console.error('Error handling /status command:', error);
        bot.sendMessage(chatId, "An error occurred while checking your status. Please contact support.");
    }
});


// Listen for the '/remove' command
// Your bot must be an admin in the group with 'Restrict members' permission.
bot.onText(/\/remove (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const adminTelegramHandle = msg.from.username;
    const usernameToRemove = match[1];

    // Only allow this command from a designated admin (e.g., your own Telegram handle)
    if (adminTelegramHandle !== 'KingsleyPeter') {
        bot.sendMessage(chatId, "You do not have permission to use this command.");
        return;
    }

    try {
        // Call the backend API to find the user's ID
        const response = await fetch(`${serverUrl}/api/users/find-by-telegram-handle/${usernameToRemove}`);
        const data = await response.json();

        if (response.ok) {
            const userToRemoveId = data.id;

            // Use the Telegram Bot API to ban (remove) the member
            await bot.banChatMember(privateChannelId, userToRemoveId);

            bot.sendMessage(chatId, `@${usernameToRemove} has been successfully removed from the group.`);
        } else {
            bot.sendMessage(chatId, `User @${usernameToRemove} was not found in the database. No action taken.`);
        }
    } catch (error) {
        console.error('Error handling /remove command:', error);
        bot.sendMessage(chatId, "An error occurred while trying to remove the user. Please check the bot's permissions and the server logs.");
    }
});

// Respond to any other messages
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    // Don't send a message if it's a known command
    if (msg.text.toString().toLowerCase().startsWith("/start") || msg.text.toString().toLowerCase().startsWith("/status") || msg.text.toString().toLowerCase().startsWith("/remove")) {
        return;
    }
    
    bot.sendMessage(chatId, "Hello! I am the NexxTrade bot. To gain access to our private channels, please sign up and pay via our website. Your unique invite link will be sent to you automatically after payment.");
});