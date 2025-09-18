// telegram_bot.js
// This file sets up the webhook and defines the bot's logic.
// It will not be run with `node telegram_bot.js` as a standalone script.
// Instead, its webhook initialization logic will be called from server.js.

// Load environment variables from .env file
require('dotenv').config();
// Use dynamic import for node-fetch to support different module versions
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Import the Telegram Bot API library
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_BOT_TOKEN;

// Get the server URL from your .env file
const serverUrl = process.env.APP_BASE_URL;

// Create a new Telegram bot instance without polling.
const bot = new TelegramBot(token, { polling: false });

// This object will hold the state of users going through the registration process.
// In a production environment, this should be replaced with a database or a persistent cache like Redis.
const userRegistrationState = {};


// This function sets up the webhook on Telegram's side and registers the commands.
const setupWebhook = async () => {
    try {
        const webhookUrl = `${serverUrl}/bot${token}`;
        await bot.setWebHook(webhookUrl);
        console.log(`Webhook set to: ${webhookUrl}`);

        // Define the list of commands to be displayed in the menu
        const commands = [
            { command: 'start', description: 'Restart the Bot' },
            { command: 'getsignals', description: 'Get Signals' },
            { command: 'faq', description: 'View FAQ' },
            { command: 'support', description: 'Contact Support' }
        ];
        
        // Set the commands for the bot
        await bot.setMyCommands(commands);
        console.log('Bot commands have been set successfully.');

    } catch (error) {
        console.error('Failed to set webhook or commands:', error);
    }
};

// --- Bot Menus and Messages ---

const mainMenuOptions = {
    reply_markup: {
        inline_keyboard: [
            [{ text: 'Join VIP', callback_data: 'join_vip' }, { text: 'Pricing', callback_data: 'pricing' }],
            [{ text: 'Recent Signals', callback_data: 'recent_signals' }, { text: 'Signal Stats', callback_data: 'signal_stats' }],
            [{ text: 'Get Signals Now', callback_data: 'get_signals_now' }]
        ]
    }
};

const introMessage = `
Hi NexxTrader. I'm your dedicated AI assistant. 

My job is to help you navigate our services and onboard you in just a few clicks

Trade like the Banks.
 Make $100-$500 Daily with Our Ultra-Precise Signals!
  👉 Daily 2-3 Futures Signal
  👉 Automated Access and Signals
  👉 75-80%+ Accuracy 
  👉 Weekly GEM Calls
  👉 Long Term 10x Signals 
  👉  Macro and Technical Analysis
  👉 Risk / Money Management Tips
  👉 Trading Psychology Insights & more

Please choose from the options below to get started


`;

// --- Bot Command Handlers ---

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    // Clear any previous registration state for this user
    if (userRegistrationState[chatId]) {
        delete userRegistrationState[chatId];
    }
    bot.sendMessage(chatId, introMessage, mainMenuOptions);
});

bot.onText(/\/getsignals/, (msg) => {
    const chatId = msg.chat.id;
    // This function shows the subscription plans, starting the registration flow.
    showSubscriptionPlans(chatId, 'Choose your plan to continue');
});

bot.onText(/\/faq/, (msg) => {
    const chatId = msg.chat.id;
    // The FAQ link will point to the main page's FAQ section.
    const faqUrl = `${serverUrl}/#faq`;
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'View our FAQ', url: faqUrl }]
            ]
        }
    };
    bot.sendMessage(chatId, 'Click the button below to read our Frequently Asked Questions.', opts);
});

bot.onText(/\/support/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'The support feature is coming soon!');
});


// --- Helper Functions ---

const showSubscriptionPlans = async (chatId, messageText) => {
    try {
        const response = await fetch(`${serverUrl}/api/pricing`);
        const plans = await response.json();

        const inlineKeyboard = plans.map(plan => ([{
            text: `${plan.plan_name} - $${plan.price} ${plan.term}`,
            callback_data: `select_plan_${plan.id}`
        }]));
        
        inlineKeyboard.push([{ text: '⬅️ Back to Main Menu', callback_data: 'main_menu' }]);
        
        const keyboardOptions = {
            reply_markup: { inline_keyboard: inlineKeyboard }
        };

        bot.sendMessage(chatId, messageText, keyboardOptions);

    } catch (error) {
        console.error('Error fetching pricing for plans:', error);
        bot.sendMessage(chatId, "Could not fetch pricing plans. Please try again later or visit our website.");
    }
};

const handleSignalStats = async (chatId) => {
    try {
        const response = await fetch(`${serverUrl}/api/performances/stats`);
        const stats = await response.json();

        const message = `
📊 *NexxTrade Signal Statistics*

Total Signals: ${stats.totalSignals}
Wins: ${stats.wins}
Losses: ${stats.losses}
Cum. ROI: ${stats.cumulativeROI}%

Most traded Pair: ${stats.mostTradedPair}

*Win Rate: ${stats.winRate}%*
        `;

        const opts = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Take your next trade with us', callback_data: 'join_vip' }]
                ]
            }
        };

        bot.sendMessage(chatId, message, opts);
    } catch (error) {
        console.error('Error fetching signal stats:', error);
        bot.sendMessage(chatId, "I couldn't retrieve the signal statistics right now. Please check our performance page.");
    }
};

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

// --- Main Callback Query Handler for Inline Buttons ---

bot.on('callback_query', async (callbackQuery) => {
    try {
        const msg = callbackQuery.message;
        if (!msg || !msg.chat || !msg.chat.id) {
            console.error("Callback query received without a valid message/chat ID.", callbackQuery);
            return bot.answerCallbackQuery(callbackQuery.id, { text: "Error processing request." });
        }

        const chatId = msg.chat.id;
        const data = callbackQuery.data;
        const telegramUser = callbackQuery.from;

        bot.answerCallbackQuery(callbackQuery.id);

        // --- Main Menu Navigation ---
        if (data === 'pricing' || data === 'join_vip' || data === 'back_to_plans' || data === 'get_signals_now') {
            if(data === 'back_to_plans' && userRegistrationState[chatId]) {
                 delete userRegistrationState[chatId];
            }
            return showSubscriptionPlans(chatId, 'Choose your plan to continue');
        }
        if (data === 'recent_signals') {
            return createLinkMenu(chatId, 'Click the button below to see our recent signals and full performance history.', `${serverUrl}/performance`);
        }
        if (data === 'signal_stats') {
            return handleSignalStats(chatId);
        }
        if (data === 'main_menu') {
             if (userRegistrationState[chatId]) {
                delete userRegistrationState[chatId];
            }
            bot.sendMessage(chatId, introMessage, mainMenuOptions);
            return;
        }

        // --- Registration and Payment Flow ---
        if (data.startsWith('select_plan_')) {
            const planId = parseInt(data.split('_')[2], 10);
            const telegramHandle = telegramUser.username ? `@${telegramUser.username}` : `user_${telegramUser.id}`;
            
            userRegistrationState[chatId] = {
                planId: planId,
                telegramHandle: telegramHandle
            };

            const paymentMessage = `You have selected a plan. Please choose your payment method:`;
            const paymentKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Pay with Crypto', callback_data: `select_payment_crypto` }],
                        [{ text: 'Pay with Fiat', callback_data: `select_payment_fiat` }],
                        [{ text: '⬅️ Back to Plans', callback_data: 'back_to_plans' }]
                    ]
                }
            };
            bot.sendMessage(chatId, paymentMessage, paymentKeyboard);
            return;
        }

        if (data === 'select_payment_fiat') {
            const state = userRegistrationState[chatId];
            if (!state) return bot.sendMessage(chatId, "Please select a plan first.");
            
            const fiatMessage = `To complete your payment with Fiat, please use the button below to visit our secure checkout page on our website.`;
            const fiatKeyboard = {
                inline_keyboard: [
                    [{ text: 'Proceed to Fiat Checkout', url: `${serverUrl}/join?telegram=${state.telegramHandle.replace('@','')}` }],
                    [{ text: '⬅️ Back', callback_data: `select_plan_${state.planId}` }]
                ]
            };
            bot.sendMessage(chatId, fiatMessage, { reply_markup: fiatKeyboard });
            return;
        }

        if (data === 'select_payment_crypto') {
            const state = userRegistrationState[chatId];
            if (!state) return bot.sendMessage(chatId, "Please select a plan first.");

            const cryptoNetworkMessage = `Please select the crypto network for your USDT payment:`;
            const cryptoNetworkKeyboard = {
                 reply_markup: {
                    inline_keyboard: [
                        [{ text: 'USDT (TRC-20)', callback_data: `select_network_usdttrc20` }],
                        [{ text: 'USDT (BEP-20)', callback_data: `select_network_usdtbsc` }],
                        [{ text: '⬅️ Back', callback_data: `select_plan_${state.planId}` }]
                    ]
                }
            };
            bot.sendMessage(chatId, cryptoNetworkMessage, cryptoNetworkKeyboard);
            return;
        }
        
        // =================================================================
        // --- START: MODIFIED LOGIC TO CALL THE BACKEND ---
        // =================================================================
        if (data.startsWith('select_network_')) {
            const network = data.split('_')[2]; // e.g., usdtbsc
            const state = userRegistrationState[chatId];

            if (!state || !state.telegramHandle || !state.planId) {
                return bot.sendMessage(chatId, "Something went wrong. Please start the registration over with /start.");
            }
            
            bot.sendMessage(chatId, "Generating your unique payment address... please wait.");

            try {
                // Instead of calling NOWPayments directly, call our new server endpoint.
                const response = await fetch(`${serverUrl}/api/payments/create-from-bot`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        telegram_handle: state.telegramHandle,
                        chat_id: chatId,
                        plan_id: state.planId,
                        pay_currency: network
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: "An unexpected server error occurred." }));
                    console.error("Failed to create crypto payment via backend:", errorData);
                    const errorMessage = `⚠️ Sorry, there was a problem generating your payment address.\n\n_Reason: ${errorData.message || 'Please try again later.'}_`;
                    await bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
                    return;
                }

                const paymentData = await response.json();
                
                // Store the order_id from our server for status checks
                state.orderId = paymentData.order_id;

                const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${paymentData.pay_address}&size=200x200`;
                const networkMap = { 'usdttrc20': 'USDT(TRC20)', 'usdtbsc': 'USDT(BEP20)' };
                const formattedCurrency = networkMap[paymentData.pay_currency.toLowerCase()] || paymentData.pay_currency.toUpperCase();

                const addressMessage = `Please send exactly *${paymentData.pay_amount} ${formattedCurrency}* to the address below.\n\n*Address:*\n\`${paymentData.pay_address}\``;
                const monitoringMessage = `👆 Tap & copy the address to pay.\n\nWe are now monitoring the blockchain for your payment. You will be notified automatically and receive your invite link as soon as it's confirmed (usually within 2-5 minutes).`;
                
                const checkStatusKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Check Payment Status', callback_data: `check_payment_status_${state.orderId}` }]
                        ]
                    }
                };

                await bot.sendPhoto(chatId, qrCodeUrl, { caption: addressMessage, parse_mode: 'Markdown' });
                await bot.sendMessage(chatId, monitoringMessage, checkStatusKeyboard);

            } catch (err) {
                console.error("Error in bot's select_network handler:", err);
                await bot.sendMessage(chatId, "A critical error occurred. Please try again or contact support.");
            }
            return;
        }
        // =================================================================
        // --- END: MODIFIED LOGIC ---
        // =================================================================

        if (data.startsWith('check_payment_status_')) {
            const orderId = data.split('_')[3];
            bot.sendMessage(chatId, "Checking payment status on our server, please wait...");

            try {
                // This endpoint now checks our own database, which is updated by the webhook.
                const statusResponse = await fetch(`${serverUrl}/api/payments/status/${orderId}`);
                if (!statusResponse.ok) throw new Error("Could not reach our server.");

                const statusData = await statusResponse.json();
                
                if (statusData.status === 'paid') {
                    // Although the webhook should handle this, this is a good fallback.
                    await bot.sendMessage(chatId, `✅ Payment confirmed! Your invite link is: ${statusData.invite_link}`);
                    delete userRegistrationState[chatId];
                } else {
                    let statusMessage = `Current status: *${statusData.status}*. Please wait for blockchain confirmation. You will be notified automatically.`;
                    await bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
                }

            } catch(err) {
                console.error(`Error manually checking payment status for order ${orderId}:`, err);
                bot.sendMessage(chatId, "Sorry, I couldn't check the status right now. You will be notified automatically when payment is complete.");
            }
            return;
        }

    } catch (error) {
        console.error("Critical error in callback_query handler:", error);
        if (callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id) {
            bot.sendMessage(callbackQuery.message.chat.id, "Sorry, a critical error occurred. Please try again or contact support.");
        }
    }
});

// The server's webhook now handles all logic for successful payment,
// including sending the final invite link to the user.
// This bot no longer needs polling or conversational message handlers for post-payment details,
// as that is handled by the server's single source of truth.

// Export the bot instance and the setup function for server.js
module.exports = {
    bot,
    setupWebhook
};
