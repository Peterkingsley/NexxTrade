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

// ... (existing code for /start and /remove commands)

// Listen for the '/status' command
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramHandle = msg.from.username;

    if (!telegramHandle) {
        bot.sendMessage(chatId, "Please set a public Telegram username in your profile settings before checking your status.");
        return;
    }

    try {
        // We'll add a new backend endpoint for this in the next step
        const response = await fetch(`${serverUrl}/api/users/status-by-telegram-handle/@${telegramHandle}`);
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

// We will also modify the /start command slightly to handle existing members

bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramHandle = msg.from.username;
    const telegramInviteToken = match[1];

    if (!telegramHandle) {
        bot.sendMessage(chatId, "Please set a public Telegram username in your profile settings before proceeding.");
        return;
    }

    try {
        // First, check if the user already exists in the database with an active subscription.
        const checkStatusResponse = await fetch(`${serverUrl}/api/users/status-by-telegram-handle/@${telegramHandle}`);
        const checkStatusData = await checkStatusResponse.json();

        if (checkStatusResponse.ok && checkStatusData.subscription_status === 'active') {
            bot.sendMessage(chatId, "Welcome back! You already have an active subscription. Use the /status command to see your details.");
            return;
        }

        // If the user is new or has an inactive subscription, proceed with the original verification flow
        // ... (rest of the original /start command code)
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
            const inviteLink = await bot.createChatInviteLink(privateChannelId, {
                member_limit: 1,
                expire_date: Math.floor(Date.now() / 1000) + 600
            });
            
            bot.sendMessage(chatId, 
                `Verification successful, ${data.user.full_name}! You have been granted access to the private channel. \n\nYour plan: ${data.user.plan_name}\n\nHere is your private, one-time invite link: ${inviteLink.invite_link}`
            );
        } else {
            bot.sendMessage(chatId, `Verification failed: ${data.message}. Please contact support.`);
        }
    } catch (error) {
        console.error('Error in bot verification process:', error);
        bot.sendMessage(chatId, "An error occurred during verification. Please contact support.");
    }
});

// ... (existing code for other commands and on-message listeners)

// Listen for the '/remove' command
// Your bot must be an admin in the group with 'Restrict members' permission.
bot.onText(/\/remove (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const adminTelegramHandle = msg.from.username;
    const usernameToRemove = match[1];

    // Only allow this command from a designated admin (e.g., your own Telegram handle)
    // Replace 'your_admin_handle' with your actual Telegram username
    if (adminTelegramHandle !== '@KingsleyPeter') {
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
    if (msg.text.toString().toLowerCase() !== "/start") {
        bot.sendMessage(chatId, "Hello! I am the NexxTrade bot. To gain access to our private channels, please sign up and pay via our website. Your unique invite link will be sent to you automatically after payment.");
    }
});