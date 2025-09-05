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

// Define the keyboard for the main menu using inline buttons
const mainMenuOptions = {
    reply_markup: {
        inline_keyboard: [
            [{ text: 'Join VIP', callback_data: 'join_vip' }, { text: 'Pricing', callback_data: 'pricing' }],
            [{ text: 'Recent Signals', callback_data: 'recent_signals' }, { text: 'PNL Proofs', callback_data: 'pnl_proofs' }],
            [{ text: 'Blog', callback_data: 'blog' }, { text: 'Signal Stats', callback_data: 'signal_stats' }]
        ]
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
    bot.sendMessage(chatId, introMessage, mainMenuOptions);
});

// --- Functions to handle menu actions ---

const handlePricing = async (chatId, messageId) => {
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
        message += `\nTo subscribe, select an option from the "Join VIP" menu.`;
        
        const opts = {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '⬅️ Back to Main Menu', callback_data: 'main_menu' }]
                ]
            }
        };
        bot.editMessageText(message, opts);
    } catch (error) {
        console.error('Error fetching pricing plans:', error);
        bot.sendMessage(chatId, "I couldn't retrieve the pricing information right now. Please check our website: www.nexxtrade.io/#pricing");
    }
};

const handleJoinVip = async (chatId, messageId) => {
     try {
        const response = await fetch(`${serverUrl}/api/pricing`);
        const plans = await response.json();

        const inlineKeyboard = plans.map(plan => ([{
            text: `${plan.plan_name} - $${plan.price}`,
            callback_data: `select_plan_${plan.id}`
        }]));
        
        inlineKeyboard.push([{ text: '⬅️ Back to Main Menu', callback_data: 'main_menu' }]);

        bot.editMessageText('Please select a subscription plan:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    } catch (error) {
        console.error('Error fetching pricing for Join VIP:', error);
        bot.sendMessage(chatId, "Could not fetch pricing plans. Please try again later or visit our website.");
    }
};

const handleSignalStats = async (chatId) => {
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
};

// Generic handler for link buttons
const createLinkMenu = (chatId, messageId, text, url) => {
    const opts = {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Click Me to View', url: url }],
                [{ text: '⬅️ Back to Main Menu', callback_data: 'main_menu' }]
            ]
        }
    };
    bot.editMessageText(text, opts);
};


// Callback Query Handler for all inline buttons
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    const data = callbackQuery.data;

    // Acknowledge the button press to remove the loading icon
    bot.answerCallbackQuery(callbackQuery.id);
    
    // Main Menu options
    if (data === 'pricing') {
        return handlePricing(chatId, messageId);
    }
    if (data === 'join_vip') {
        return handleJoinVip(chatId, messageId);
    }
    if (data === 'recent_signals') {
        return createLinkMenu(
            chatId,
            messageId,
            'Click the button below to see our recent signals and full performance history.',
            `${serverUrl}/performance`
        );
    }
    if (data === 'pnl_proofs') {
        return createLinkMenu(
            chatId,
            messageId,
            'Click the button below to browse our gallery of PNL proofs.',
            `${serverUrl}/performance#pnl-gallery`
        );
    }
    if (data === 'blog') {
        return createLinkMenu(
            chatId,
            messageId,
            'Click the button below to read our latest blog posts and market analysis.',
            `${serverUrl}/blog`
        );
    }
    if (data === 'signal_stats') {
        return handleSignalStats(chatId);
    }

    // Plan selection flow
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

            const paymentMessage = `You've selected the *${selectedPlan.plan_name}* plan for *$${selectedPlan.price}*. Please choose your payment method:`;
            const paymentKeyboard = {
                inline_keyboard: [
                    [
                        { text: 'Pay with OPay', callback_data: `pay_opay_${planId}` },
                        { text: 'Pay with Crypto', callback_data: `pay_crypto_${planId}` }
                    ],
                    [
                        { text: '⬅️ Back to Plans', callback_data: 'back_to_plans' }
                    ]
                ]
            };
            bot.editMessageText(paymentMessage, { chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: paymentKeyboard });
        } catch(error) {
            console.error("Error processing plan selection:", error);
            bot.sendMessage(chatId, "An error occurred. Please try again.");
        }
    }
    
    // Payment method selection flow
    if (data.startsWith('pay_opay_')) {
        const planId = data.split('_')[2];
        try {
            const response = await fetch(`${serverUrl}/api/pricing`);
            const plans = await response.json();
            const selectedPlan = plans.find(p => p.id == planId);
            if (!selectedPlan) { 
                bot.sendMessage(chatId, "Sorry, that plan is no longer available.");
                return;
            }

            let planQueryParam = 'monthly'; // default
            if (selectedPlan.plan_name.toLowerCase().includes('quarterly')) {
                planQueryParam = 'quarterly';
            } else if (selectedPlan.plan_name.toLowerCase().includes('elite') || selectedPlan.plan_name.toLowerCase().includes('bi-annually')) {
                planQueryParam = 'yearly';
            }
            
            const opayMessage = `To complete your payment for the *${selectedPlan.plan_name}* with OPay, please use the button below to visit our secure checkout page where you can enter your details.`;
            const opayKeyboard = {
                inline_keyboard: [
                    [{ text: 'Proceed to OPay Checkout', url: `${serverUrl}/join?plan=${planQueryParam}` }],
                    [{ text: '⬅️ Back to Payment Methods', callback_data: `select_plan_${planId}`}]
                ]
            };
            bot.editMessageText(opayMessage, { chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: opayKeyboard });
        } catch(error) {
            console.error("Error processing OPay selection:", error);
            bot.sendMessage(chatId, "An error occurred. Please try again.");
        }
    }

    if (data.startsWith('pay_crypto_')) {
        const planId = data.split('_')[2];
        try {
            const response = await fetch(`${serverUrl}/api/pricing`);
            const plans = await response.json();
            const selectedPlan = plans.find(p => p.id == planId);
            if (!selectedPlan) {
                bot.sendMessage(chatId, "Sorry, that plan is no longer available.");
                return;
            }
            
            const cryptoMessage = `
To pay for the *${selectedPlan.plan_name}* (*$${selectedPlan.price}*), please send the equivalent amount to the address below.

*USDT (TRC20 Network)*
\`TEJ3fN8mEwK5qR2uV6gX9yP7bQ1sL4d\`

*IMPORTANT*: After payment, please send a screenshot of the transaction and your Telegram handle (@username) to our support admin for instant activation.
            `;
            const cryptoKeyboard = {
                inline_keyboard: [
                    [{ text: '⬅️ Back to Payment Methods', callback_data: `select_plan_${planId}`}]
                ]
            };
            bot.editMessageText(cryptoMessage, { chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: cryptoKeyboard });
        } catch(error) {
            console.error("Error processing Crypto selection:", error);
            bot.sendMessage(chatId, "An error occurred. Please try again.");
        }
    }


    if (data === 'back_to_plans') {
        return handleJoinVip(chatId, messageId); // Re-show the plans selection
    }

    if (data === 'main_menu') {
        // Edit the current message to show the intro and main menu
         bot.editMessageText(introMessage, {
            chat_id: chatId,
            message_id: messageId,
            ...mainMenuOptions
        });
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

    if (!text) return; // Guard against non-text messages

    // Catch any text that isn't a command and show the main menu
    if (!text.startsWith('/')) {
        bot.sendMessage(chatId, "I'm not sure how to respond to that. Please use the /start command to see the main menu.", mainMenuOptions);
    }
});


// Export the bot instance and the setup function so they can be used in server.js
module.exports = {
    bot,
    setupWebhook
};

