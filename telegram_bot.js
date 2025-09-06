// telegram_bot.js
// This file sets up the webhook and defines the bot's logic.
// It will not be run with `node telegram_bot.js` as a standalone script.
// Instead, its webhook initialization logic will be called from server.js.

// Load environment variables from .env file
require('dotenv').config();
const fetch = require('node-fetch');

// Import the Telegram Bot API library
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_BOT_TOKEN;

// Get the server URL and Private Channel ID from your .env file
const serverUrl = process.env.APP_BASE_URL;
const privateChannelId = process.env.PRIVATE_CHANNEL_ID;

// Create a new Telegram bot instance without polling.
const bot = new TelegramBot(token, { polling: false });

// This object will hold the state of users going through the registration process.
// In a production environment, this should be replaced with a database or a persistent cache like Redis.
const userRegistrationState = {};


// This function sets up the webhook on Telegram's side.
const setupWebhook = async () => {
    try {
        const webhookUrl = `${serverUrl}/bot${token}`;
        await bot.setWebHook(webhookUrl);
        console.log(`Webhook set to: ${webhookUrl}`);
    } catch (error) {
        console.error('Failed to set webhook:', error);
    }
};

// --- Bot Menus and Messages ---

const mainMenuOptions = {
    reply_markup: {
        inline_keyboard: [
            [{ text: 'Join VIP', callback_data: 'join_vip' }, { text: 'Pricing', callback_data: 'pricing' }],
            [{ text: 'Recent Signals', callback_data: 'recent_signals' }, { text: 'Signal Stats', callback_data: 'signal_stats' }]
        ]
    }
};

const introMessage = `
Hello there! I'm your dedicated AI assistant for all things NexxTrade. I'm here to help you navigate our services, check out our performance, and get you started with trading.

You can visit our official website here: www.nexxtrade.io

Please choose one of the options below to get started.
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

        bot.sendMessage(chatId, messageText, {
            reply_markup: { inline_keyboard: inlineKeyboard }
        });
    } catch (error) {
        console.error('Error fetching pricing for plans:', error);
        bot.sendMessage(chatId, "Could not fetch pricing plans. Please try again later or visit our website.");
    }
};

const handleSignalStats = async (chatId) => {
    try {
        const response = await fetch(`${serverUrl}/api/performances`);
        const signals = await response.json();

        if (signals.length === 0) {
            bot.sendMessage(chatId, "No signals available to calculate statistics. Please check back later.");
            return;
        }

        const totalSignals = signals.length;
        const wins = signals.filter(s => s.result_type === 'Win').length;
        const losses = signals.filter(s => s.result_type === 'Loss').length;
        const winRate = totalSignals > 0 ? ((wins / totalSignals) * 100).toFixed(2) : 0;

        const message = `
📊 *NexxTrade Signal Statistics*
Total Signals: ${totalSignals}
Wins: ${wins}
Losses: ${losses}
Win Rate: ${winRate}%
        `;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
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
        bot.answerCallbackQuery(callbackQuery.id); // Acknowledge the button press

        // --- Main Menu Navigation ---
        if (data === 'pricing' || data === 'join_vip' || data === 'back_to_plans') {
            return showSubscriptionPlans(chatId, 'Here are our current pricing plans. Select one to begin registration:');
        }
        if (data === 'recent_signals') {
            return createLinkMenu(chatId, 'Click the button below to see our recent signals and full performance history.', `${serverUrl}/performance`);
        }
        if (data === 'signal_stats') {
            return handleSignalStats(chatId);
        }
        if (data === 'main_menu') {
            return bot.sendMessage(chatId, introMessage, mainMenuOptions);
        }

        // --- Registration and Payment Flow ---

        // Stage 1: Plan Selection - Kicks off the registration conversation
        if (data.startsWith('select_plan_')) {
            const planId = parseInt(data.split('_')[2], 10);
            const response = await fetch(`${serverUrl}/api/pricing`);
            const plans = await response.json();
            const selectedPlan = plans.find(p => p.id === planId);

            if (!selectedPlan) return bot.sendMessage(chatId, "Sorry, that plan is no longer available.");
            
            userRegistrationState[chatId] = {
                planId: planId,
                planName: selectedPlan.plan_name,
                priceUSD: selectedPlan.price,
                stage: 'awaiting_name'
            };

            bot.sendMessage(chatId, "Great! To get started, please tell me your full name.");
        }

        // Stage 2: Payment Method Selection
        if (data.startsWith('pay_opay_')) {
            const planId = data.split('_')[2];
            let planQueryParam = 'monthly';
            const state = userRegistrationState[chatId];
            if (state && state.planName) {
                if (state.planName.toLowerCase().includes('quarterly')) planQueryParam = 'quarterly';
                if (state.planName.toLowerCase().includes('bi-annually')) planQueryParam = 'yearly';
            }
            const opayMessage = `To complete your payment for the *${state.planName}* with OPay, please use the button below to visit our secure checkout page. Your details will be pre-filled.`;
            const opayKeyboard = {
                inline_keyboard: [
                    [{ text: 'Proceed to OPay Checkout', url: `${serverUrl}/join?plan=${planQueryParam}` }],
                    [{ text: '⬅️ Back', callback_data: 'back_to_plans' }]
                ]
            };
            bot.sendMessage(chatId, opayMessage, { parse_mode: 'Markdown', reply_markup: opayKeyboard });
        }

        if (data.startsWith('pay_crypto_')) {
            const state = userRegistrationState[chatId];
            if (!state || !state.fullName || !state.email || !state.telegramHandle) {
                return bot.sendMessage(chatId, "Something went wrong. Please start the registration over with /start.");
            }
            
            bot.sendMessage(chatId, "Generating your unique crypto payment address... please wait.");

            const response = await fetch(`${serverUrl}/api/payments/nowpayments/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fullname: state.fullName,
                    email: state.email,
                    telegram: state.telegramHandle,
                    plan: state.planName.toLowerCase().includes('monthly') ? 'monthly' : state.planName.toLowerCase().includes('quarterly') ? 'quarterly' : 'yearly'
                }),
            });
            
            if (!response.ok) throw new Error('Failed to create crypto payment.');

            const paymentData = await response.json();
            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${paymentData.pay_address}&size=200x200`;

            const paymentMessage = `
Please send exactly *${paymentData.pay_amount} ${paymentData.pay_currency.toUpperCase()}* to the address below.

*Address:*
\`${paymentData.pay_address}\`

I will monitor the payment and notify you once it's confirmed. This address is unique to your transaction.
            `;
            
            await bot.sendPhoto(chatId, qrCodeUrl, { caption: paymentMessage, parse_mode: 'Markdown' });

            // Start polling for payment confirmation
            pollPaymentStatus(chatId, paymentData.payment_id);
        }

    } catch (error) {
        console.error("Critical error in callback_query handler:", error);
        if (callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id) {
            bot.sendMessage(callbackQuery.message.chat.id, "Sorry, a critical error occurred. Please try again or contact support.");
        }
    }
});

// --- Payment Status Polling ---
function pollPaymentStatus(chatId, paymentId) {
    const state = userRegistrationState[chatId];
    if (!state) return; // Stop if user restarted

    state.paymentCheckInterval = setInterval(async () => {
        try {
            const statusResponse = await fetch(`${serverUrl}/api/payments/nowpayments/status/${paymentId}`);
            if (!statusResponse.ok) return; // Silently fail and retry

            const statusData = await statusResponse.json();
            
            if (['finished', 'confirmed'].includes(statusData.payment_status)) {
                clearInterval(state.paymentCheckInterval);
                bot.sendMessage(chatId, "✅ Payment confirmed! Generating your unique invite link...");

                // Generate one-time invite link
                const inviteLink = await bot.createChatInviteLink(privateChannelId, { member_limit: 1 });
                await bot.sendMessage(chatId, `Here is your one-time invite link to the VIP channel. Please note it can only be used once:\n\n${inviteLink.invite_link}`);

                // Clean up user state
                delete userRegistrationState[chatId];
            } else if (['failed', 'expired'].includes(statusData.payment_status)) {
                clearInterval(state.paymentCheckInterval);
                bot.sendMessage(chatId, `❌ Payment has ${statusData.payment_status}. Please try the registration again or contact support if you believe this is an error.`);
                delete userRegistrationState[chatId];
            }
        } catch (err) {
            console.error(`Error polling payment status for ${paymentId}:`, err);
        }
    }, 15000); // Check every 15 seconds
}


// --- Conversational Message Handler ---
bot.on('message', (msg) => {
    if (!msg.chat || !msg.chat.id || !msg.text || msg.text.startsWith('/')) {
        return; // Ignore commands, non-text messages, or invalid messages
    }
    
    const chatId = msg.chat.id;
    const text = msg.text;
    const state = userRegistrationState[chatId];

    // If the user is not in a registration flow, guide them to the start
    if (!state || !state.stage) {
        bot.sendMessage(chatId, "I'm not sure how to respond to that. Please use the /start command to see the main menu.", mainMenuOptions);
        return;
    }

    // Process messages based on the user's current registration stage
    switch (state.stage) {
        case 'awaiting_name':
            state.fullName = text;
            state.stage = 'awaiting_email';
            bot.sendMessage(chatId, `Thanks, ${text}! Now, please enter your email address.`);
            break;

        case 'awaiting_email':
            if (!text.includes('@') || !text.includes('.')) {
                bot.sendMessage(chatId, "That doesn't look like a valid email. Please try again.");
                return;
            }
            state.email = text;
            state.stage = 'awaiting_telegram';
            const suggestedHandle = msg.from.username ? `(e.g., @${msg.from.username})` : '(e.g., @your_handle)';
            bot.sendMessage(chatId, `Got it. Finally, please provide your Telegram handle ${suggestedHandle}.`);
            break;

        case 'awaiting_telegram':
            state.telegramHandle = text.startsWith('@') ? text : `@${text}`;
            state.stage = 'awaiting_payment_method'; // Move to next logical step

            const paymentMessage = `Thank you! All details collected for the *${state.planName}*. Please choose your payment method:`;
            const paymentKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Pay with OPay', callback_data: `pay_opay_${state.planId}` }],
                        [{ text: 'Pay with Crypto', callback_data: `pay_crypto_${state.planId}` }]
                    ]
                }
            };
            bot.sendMessage(chatId, paymentMessage, { parse_mode: 'Markdown', ...paymentKeyboard });
            break;
    }
});


// Export the bot instance and the setup function for server.js
module.exports = {
    bot,
    setupWebhook
};

