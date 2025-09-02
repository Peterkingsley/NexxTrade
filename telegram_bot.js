// telegram_bot.js
// This file is now used to set up the webhook and define the bot's logic.
// It will not be run with `node telegram_bot.js` as a standalone script.
// Instead, its webhook initialization logic will be called from server.js.

// Load environment variables from .env file
require('dotenv').config();

// Import the Telegram Bot API library
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_BOT_TOKEN;

// Get the server URL from your .env file
// We'll use this to construct the webhook URL.
const serverUrl = process.env.APP_BASE_URL;
const privateChannelId = process.env.PRIVATE_CHANNEL_ID;

// Create a new Telegram bot instance without polling.
// The webhook will handle incoming messages.
const bot = new TelegramBot(token, { polling: false });

// This function sets up the webhook on Telegram's side.
// It should only be run once when the server starts.
const setupWebhook = async () => {
    try {
        const webhookUrl = `${serverUrl}/bot${token}`;
        await bot.setWebHook(webhookUrl);
        console.log(`Webhook set to: ${webhookUrl}`);
    } catch (error) {
        console.error('Failed to set webhook:', error);
    }
};

// Listen for a simple '/start' command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramHandle = msg.from.username;

    if (!telegramHandle) {
        bot.sendMessage(chatId, "Please set a public Telegram username in your profile settings before proceeding.");
        return;
    }

    try {
        const chatMember = await bot.getChatMember(privateChannelId, msg.from.id);
        
        if (chatMember.status !== 'left' && chatMember.status !== 'kicked') {
            bot.sendMessage(chatId, "You are already a member of the group!");
            return;
        }
    } catch (error) {
        console.log(`User @${telegramHandle} is not a member of the chat. Proceeding with verification.`);
    }

    try {
        const response = await fetch(`${serverUrl}/api/users/status-by-telegram-handle/${telegramHandle}`);
        const data = await response.json();

        if (response.ok && data.subscription_status === 'active') {
            const inviteLink = await bot.createChatInviteLink(privateChannelId, {
                member_limit: 1,
                expire_date: Math.floor(Date.now() / 1000) + 600
            });
            
            bot.sendMessage(chatId, 
                `Hello @${telegramHandle}! Your subscription is active. Here is your private, one-time invite link: ${inviteLink.invite_link}`
            );
        } else {
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
bot.onText(/\/remove (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const adminTelegramHandle = msg.from.username;
    const usernameToRemove = match[1];

    if (adminTelegramHandle !== 'PeterKingsley') {
        bot.sendMessage(chatId, "You do not have permission to use this command.");
        return;
    }

    try {
        const response = await fetch(`${serverUrl}/api/users/find-by-telegram-handle/${usernameToRemove}`);
        const data = await response.json();

        if (response.ok) {
            const userToRemoveId = data.id;
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
    if (msg.text.toString().toLowerCase().startsWith("/start") || msg.text.toString().toLowerCase().startsWith("/status") || msg.text.toString().toLowerCase().startsWith("/remove")) {
        return;
    }
    
    bot.sendMessage(chatId, "Hello! I am the NexxTrade bot. To gain access to our private channels, please sign up and pay via our website. Your unique invite link will be sent to you automatically after payment.");
});

// Export the bot instance and the setup function so they can be used in server.js
module.exports = {
    bot,
    setupWebhook
};
