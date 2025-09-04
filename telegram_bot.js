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

// Define the keyboard for the main menu
const mainMenuKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: 'Pricing' }, { text: 'Pay Now' }],
            [{ text: 'Past Signals' }, { text: 'Signal Stats' }],
            [{ text: 'PNL Proofs' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

// Listen for a simple '/start' command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    // Introduction message with a link and menu options
    const introMessage = `
Hello there! I'm your dedicated AI assistant for all things NexxTrade. I'm here to help you navigate our services, check out our performance, and get you started with trading.

You can visit our official website here: www.nexxtrade.io

Please choose one of the options below to get started.
    `;
    
    // Send the introductory message with the main menu keyboard
    bot.sendMessage(chatId, introMessage, mainMenuKeyboard);
});


// Listen for the 'Pricing' menu option
bot.onText(/Pricing/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const response = await fetch(`${serverUrl}/api/pricing`);
        const plans = await response.json();

        let message = `Here are our current pricing plans:\n\n`;
        plans.forEach(plan => {
            message += `*${plan.plan_name}*
Price: $${plan.price} ${plan.term}
Features: ${plan.features.join(', ')}
${plan.is_best_value ? '🏆 Best Value! 🏆\n' : ''}
`;
        });
        message += `\nFor more details, visit: www.nexxtrade.io/#pricing`;
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error fetching pricing plans:', error);
        bot.sendMessage(chatId, "I couldn't retrieve the pricing information right now. Please check our website: nexxtrade.io/#pricing");
    }
});

// Listen for the 'Pay Now' menu option
bot.onText(/Pay Now/, (msg) => {
    const chatId = msg.chat.id;
    const message = `Ready to get started? You can sign up and choose your plan here:
www.nexxtrade.io/join`;
    bot.sendMessage(chatId, message);
});

// Listen for the 'Past Signals' menu option
bot.onText(/Past Signals/, (msg) => {
    const chatId = msg.chat.id;
    const message = `You can view our complete history of past signals and performance data here:
www.nexxtrade.io/performance`;
    bot.sendMessage(chatId, message);
});

// Listen for the 'Signal Stats' menu option
bot.onText(/Signal Stats/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const response = await fetch(`${serverUrl}/api/performances`);
        const signals = await response.json();

        if (signals.length === 0) {
            bot.sendMessage(chatId, "I'm sorry, there are no signals available to calculate statistics. Please check back later.");
            return;
        }

        const totalSignals = signals.length;
        const wins = signals.filter(s => s.result_type === 'Win').length;
        const losses = signals.filter(s => s.result_type === 'Loss').length;
        const winRate = ((wins / totalSignals) * 100).toFixed(2);
        const mostTradedPair = signals.map(s => s.pair).reduce((acc, curr) => {
            acc[curr] = (acc[curr] || 0) + 1;
            return acc;
        }, {});
        const topPair = Object.keys(mostTradedPair).reduce((a, b) => mostTradedPair[a] > mostTradedPair[b] ? a : b);

        const message = `
📊 *NexxTrade Signal Statistics*
Total Signals: ${totalSignals}
Wins: ${wins}
Losses: ${losses}
Win Rate: ${winRate}%
Most Traded Pair: ${topPair}
        `;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error fetching signal stats:', error);
        bot.sendMessage(chatId, "I couldn't retrieve the signal statistics right now. Please check our website: www.nexxtrade.io/performance");
    }
});

// Listen for the 'PNL Proofs' menu option
bot.onText(/PNL Proofs/, (msg) => {
    const chatId = msg.chat.id;
    const message = `You can browse our PNL proof gallery to see our verified results here:
www.nexxtrade.io/performance#pnl-gallery`;
    bot.sendMessage(chatId, message);
});


// The previous subscription status check and other commands
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

// A new onText handler for the old `/start` logic for existing users
bot.onText(/start/, async (msg) => {
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


// Respond to any other messages by showing the main menu again.
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // If a button text is sent, the specific onText handler will take over.
    // This catches other messages and displays the menu.
    const isCommand = text.startsWith('/');
    const isMenuOption = ['Pricing', 'Pay Now', 'Past Signals', 'Signal Stats', 'PNL Proofs'].includes(text);

    if (!isCommand && !isMenuOption) {
        bot.sendMessage(chatId, "Please select an option from the menu below or use the /start command to see the main menu again.", mainMenuKeyboard);
    }
});


// Export the bot instance and the setup function so they can be used in server.js
module.exports = {
    bot,
    setupWebhook
};