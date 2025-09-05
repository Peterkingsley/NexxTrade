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
            [{ text: 'Join VIP' }, { text: 'Pricing' }],
            [{ text: 'Recent Signals' }, { text: 'PNL Proofs' }],
            [{ text: 'Blog' }, { text: 'Signal Stats' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

const introMessage = `
Hello there! I'm your dedicated AI assistant for all things NexxTrade. I'm here to help you navigate our services, check out our performance, and get you started with trading.

You can visit our official website here: www.nexxtrade.io

Please choose one of the options below to get started.
    `;

// Listen for a simple '/start' command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
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
        message += `\nTo subscribe, click on "Join VIP" from the menu.`;
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error fetching pricing plans:', error);
        bot.sendMessage(chatId, "I couldn't retrieve the pricing information right now. Please check our website: www.nexxtrade.io/#pricing");
    }
});

// Listen for the 'Join VIP' menu option
bot.onText(/Join VIP/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const response = await fetch(`${serverUrl}/api/pricing`);
        const plans = await response.json();

        const inlineKeyboard = plans.map(plan => ([{
            text: `${plan.plan_name} - $${plan.price}`,
            callback_data: `select_plan_${plan.id}`
        }]));

        bot.sendMessage(chatId, 'Please select a subscription plan:', {
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    } catch (error) {
        console.error('Error fetching pricing for Join VIP:', error);
        bot.sendMessage(chatId, "Could not fetch pricing plans. Please try again later or visit our website.");
    }
});


// Generic handler for link buttons
const createLinkMenu = (chatId, text, url) => {
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Click Me to View', url: url }],
                [{ text: '⬅️ Back to Main Menu', callback_data: 'main_menu' }]
            ]
        }
    };
    bot.sendMessage(chatId, text, opts);
};

// Listen for the 'Recent Signals' menu option
bot.onText(/Recent Signals/, (msg) => {
    const chatId = msg.chat.id;
    createLinkMenu(
        chatId,
        'Click the button below to see our recent signals and full performance history.',
        `${serverUrl}/performance`
    );
});

// Listen for the 'PNL Proofs' menu option
bot.onText(/PNL Proofs/, (msg) => {
    const chatId = msg.chat.id;
    createLinkMenu(
        chatId,
        'Click the button below to browse our gallery of PNL proofs.',
        `${serverUrl}/performance#pnl-gallery`
    );
});

// Listen for the 'Blog' menu option
bot.onText(/Blog/, (msg) => {
    const chatId = msg.chat.id;
    createLinkMenu(
        chatId,
        'Click the button below to read our latest blog posts and market analysis.',
        `${serverUrl}/blog`
    );
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


// Callback Query Handler for inline buttons
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;

    // Acknowledge the button press to remove the loading icon
    bot.answerCallbackQuery(callbackQuery.id);

    if (data.startsWith('select_plan_')) {
        const planId = data.split('_')[2];
        
        try {
            const response = await fetch(`${serverUrl}/api/pricing`); 
            const plans = await response.json();
            const selectedPlan = plans.find(p => p.id == planId);

            if (!selectedPlan) {
                bot.sendMessage(chatId, "Sorry, that plan is no longer available.");
                return;
            }

            // Map plan name to the URL query parameter
            let planQueryParam = 'monthly'; // default
            if (selectedPlan.plan_name.toLowerCase().includes('quarterly')) {
                planQueryParam = 'quarterly';
            } else if (selectedPlan.plan_name.toLowerCase().includes('elite') || selectedPlan.plan_name.toLowerCase().includes('bi-annually')) {
                planQueryParam = 'yearly';
            }

            const paymentMessage = `You've selected the *${selectedPlan.plan_name}* plan for *$${selectedPlan.price}*. Please choose your payment method:`;
            const paymentKeyboard = {
                inline_keyboard: [
                    [
                        { text: 'Pay with OPay', url: `${serverUrl}/join?plan=${planQueryParam}` },
                        { text: 'Pay with Crypto', url: `${serverUrl}/join?plan=${planQueryParam}` }
                    ],
                    [
                        { text: '⬅️ Back to Plans', callback_data: 'back_to_plans' }
                    ]
                ]
            };

            bot.editMessageText(paymentMessage, {
                chat_id: chatId,
                message_id: msg.message_id,
                parse_mode: 'Markdown',
                reply_markup: paymentKeyboard
            });
        } catch(error) {
            console.error("Error processing plan selection:", error);
            bot.sendMessage(chatId, "An error occurred. Please try again.");
        }
    }

    if (data === 'back_to_plans') {
        try {
            const response = await fetch(`${serverUrl}/api/pricing`);
            const plans = await response.json();

            const inlineKeyboard = plans.map(plan => ([{
                text: `${plan.plan_name} - $${plan.price}`,
                callback_data: `select_plan_${plan.id}`
            }]));
            
            bot.editMessageText('Please select a subscription plan:', {
                chat_id: chatId,
                message_id: msg.message_id,
                reply_markup: {
                    inline_keyboard: inlineKeyboard
                }
            });
        } catch(error) {
            console.error("Error going back to plans:", error);
            bot.sendMessage(chatId, "An error occurred. Please try again.");
        }
    }

    if (data === 'main_menu') {
        bot.sendMessage(chatId, introMessage, mainMenuKeyboard);
    }
});


// Legacy command for status checks
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


// Respond to any other messages by showing the main menu again.
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Guard against undefined text (e.g., for photos, stickers)
    if (!text) return;

    // If a button text is sent, the specific onText handler will take over.
    // This catches other messages and displays the menu.
    const isCommand = text.startsWith('/');
    const isMenuOption = ['Join VIP', 'Pricing', 'Recent Signals', 'PNL Proofs', 'Blog', 'Signal Stats'].includes(text);

    if (!isCommand && !isMenuOption) {
        bot.sendMessage(chatId, "Please select an option from the menu below or use the /start command to see the main menu again.", mainMenuKeyboard);
    }
});


// Export the bot instance and the setup function so they can be used in server.js
module.exports = {
    bot,
    setupWebhook
};
