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
            { command: 'start', description: 'Start the bot' },
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
    updateBotCommandsForChat(chatId, mainMenuOptions);
});


// --- Helper Functions ---

// Helper function to update bot commands dynamically for a specific chat
const updateBotCommandsForChat = async (chatId, options) => {
    try {
        const baseCommands = [{ command: 'start', description: 'Start the bot' }];
        let dynamicCommands = [];

        const excludedPrefixes = ['select_plan_', 'select_network_', 'check_payment_status_'];

        if (options && options.reply_markup && options.reply_markup.inline_keyboard) {
            options.reply_markup.inline_keyboard.flat().forEach(button => {
                const cb_data = button.callback_data;
                // Check if callback_data exists, is valid, and is not in the excluded list
                if (cb_data && /^[a-z0-9_]{1,32}$/.test(cb_data) && !excludedPrefixes.some(prefix => cb_data.startsWith(prefix))) {
                    let description = button.text.replace(/[\⬅️🔐📊]/g, '').trim();
                    if (description.length < 3 || description.length > 256) {
                        description = cb_data; // fallback
                    }

                    dynamicCommands.push({
                        command: cb_data,
                        description: description
                    });
                }
            });
        }
        
        // Remove duplicates and combine with base commands
        const uniqueDynamicCommands = [...new Map(dynamicCommands.map(item => [item['command'], item])).values()];
        const finalCommands = [...baseCommands, ...uniqueDynamicCommands];

        await bot.setMyCommands(finalCommands, { scope: { type: 'chat', chat_id: chatId } });

    } catch (error) {
        console.error(`Could not set commands for chat ${chatId}: ${error.message}`);
    }
};


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
        updateBotCommandsForChat(chatId, keyboardOptions);

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
    updateBotCommandsForChat(chatId, opts);
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
        const telegramUser = callbackQuery.from; // Get user info from the callback query

        bot.answerCallbackQuery(callbackQuery.id); // Acknowledge the button press

        // --- Main Menu Navigation ---
        if (data === 'pricing' || data === 'join_vip' || data === 'back_to_plans' || data === 'get_signals_now') {
            // Check if we are coming back to plans, if so, clear state.
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
            updateBotCommandsForChat(chatId, mainMenuOptions);
            return;
        }

        // --- Registration and Payment Flow ---

        // Stage 1: Plan Selection - Kicks off the payment flow
        if (data.startsWith('select_plan_')) {
            const planId = parseInt(data.split('_')[2], 10);
            const response = await fetch(`${serverUrl}/api/pricing`);
            const plans = await response.json();
            const selectedPlan = plans.find(p => p.id === planId);

            if (!selectedPlan) return bot.sendMessage(chatId, "Sorry, that plan is no longer available.");
            
            // Automatically get telegram handle
            const telegramHandle = telegramUser.username ? `@${telegramUser.username}` : `user_${telegramUser.id}`;

            userRegistrationState[chatId] = {
                planId: planId,
                planName: selectedPlan.plan_name,
                priceUSD: selectedPlan.price,
                telegramHandle: telegramHandle,
                telegramGroupId: selectedPlan.telegram_group_id, // Store the group ID for this plan
                stage: 'awaiting_payment_method' // New stage
            };

            const paymentMessage = `Congrats, you've selected the *${selectedPlan.plan_name}* plan.\n\nPlease choose your payment method:`;
            const paymentKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Pay with Crypto', callback_data: `select_payment_crypto` }],
                        [{ text: 'Pay with Fiat', callback_data: `select_payment_fiat` }],
                        [{ text: '⬅️ Back to Plans', callback_data: 'back_to_plans' }]
                    ]
                }
            };
            bot.sendMessage(chatId, paymentMessage, { parse_mode: 'Markdown', ...paymentKeyboard });
            updateBotCommandsForChat(chatId, paymentKeyboard);
            return; // Stop further processing for this callback
        }

        // Stage 2: Payment Method Selection
        if (data === 'select_payment_fiat') {
            const state = userRegistrationState[chatId];
            if (!state || !state.planName) {
                 return bot.sendMessage(chatId, "Something went wrong. Please start the registration over with /start.");
            }
            
            let planQueryParam = 'monthly';
            if (state.planName.toLowerCase().includes('quarterly')) planQueryParam = 'quarterly';
            if (state.planName.toLowerCase().includes('bi-annually')) planQueryParam = 'yearly';

            // Fiat payment now requires name and email at the end, so we can't pre-fill.
            // Let's guide them to the website.
            const opayMessage = `To complete your payment for the *${state.planName}* with Fiat, please use the button below to visit our secure checkout page.`;
            const opayKeyboard = {
                inline_keyboard: [
                    [{ text: 'Proceed to Fiat Checkout', url: `${serverUrl}/join?plan=${planQueryParam}&telegram=${state.telegramHandle.replace('@','')}` }],
                    [{ text: '⬅️ Back', callback_data: `select_plan_${state.planId}` }]
                ]
            };
            const opayOptions = { parse_mode: 'Markdown', reply_markup: opayKeyboard };
            bot.sendMessage(chatId, opayMessage, opayOptions);
            updateBotCommandsForChat(chatId, opayOptions);
            return;
        }

        if (data === 'select_payment_crypto') {
            const state = userRegistrationState[chatId];
             if (!state) {
                 return bot.sendMessage(chatId, "Something went wrong. Please start the registration over with /start.");
            }
            state.stage = 'awaiting_crypto_network';
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
            updateBotCommandsForChat(chatId, cryptoNetworkKeyboard);
            return;
        }
        
        // Stage 3: Crypto Network Selection and Payment Creation
        if (data.startsWith('select_network_')) {
            const network = data.split('_')[2]; // e.g., usdtbsc
            const state = userRegistrationState[chatId];
            if (!state || !state.telegramHandle) {
                return bot.sendMessage(chatId, "Something went wrong. Please start the registration over with /start.");
            }
            
            bot.sendMessage(chatId, "Generating your unique crypto payment address... please wait.");
            
            const tempName = `User ${state.telegramHandle}`;
            const tempEmail = `${state.telegramHandle.replace('@','')}_${Date.now()}@nexxtrade.com`;

            // FIXED: Send the correct price (priceUSD) and plan name to the backend.
            const response = await fetch(`${serverUrl}/api/payments/nowpayments/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fullname: tempName,
                    email: tempEmail,
                    telegram: state.telegramHandle,
                    planName: state.planName, // Use the actual plan name for the description
                    priceUSD: state.priceUSD, // Use the correct price stored in the state
                    pay_currency: network
                }),
            });
            
            if (!response.ok) {
                 const errorData = await response.json();
                 console.error("NOWPayments API Error:", errorData);
                 throw new Error('Failed to create crypto payment.');
            }

            const paymentData = await response.json();
            
            state.paymentId = paymentData.payment_id;

            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${paymentData.pay_address}&size=200x200`;

            const networkMap = {
                'usdttrc20': 'USDT(TRC20)',
                'usdtbsc': 'USDT(BEP20)'
            };
            const formattedCurrency = networkMap[paymentData.pay_currency.toLowerCase()] || paymentData.pay_currency.toUpperCase();

            const addressMessage = `Please send exactly *${paymentData.pay_amount} ${formattedCurrency}* to the address below.

_(This precise amount includes network fees to ensure the full plan price is covered.)_

*Address:*
\`${paymentData.pay_address}\`
            `;

            const monitoringMessage = `👆 Tap & copy the address to pay.

✅ Auto Join VIP: Access in ~2 minutes after payment
☎️ Support: @Nexxtrade_io`;
            
            const checkStatusKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔐Unlock VIP Signals', callback_data: `check_payment_status_${paymentData.payment_id}` }]
                    ]
                }
            };

            await bot.sendPhoto(chatId, qrCodeUrl, { caption: addressMessage, parse_mode: 'Markdown' });
            await bot.sendMessage(chatId, monitoringMessage);
            await bot.sendMessage(chatId, "🔃Checking payment Status: ⏳", checkStatusKeyboard);
            updateBotCommandsForChat(chatId, checkStatusKeyboard);

            pollPaymentStatus(chatId, paymentData.payment_id);
            return;
        }

        if (data.startsWith('check_payment_status_')) {
            const paymentId = data.split('_')[3];
            bot.sendMessage(chatId, "Checking payment status, please wait...");

            try {
                const statusResponse = await fetch(`${serverUrl}/api/payments/nowpayments/status/${paymentId}`);
                if (!statusResponse.ok) {
                    throw new Error("Could not reach payment server.");
                }

                const statusData = await statusResponse.json();
                let statusMessage = `Current status: *${statusData.payment_status}*
(VIP Channel will be unlocked as soon as your payment is confirmed)

Make sure you’ve sent the required amount to the address provided`;

                const state = userRegistrationState[chatId];

                if (['finished', 'confirmed'].includes(statusData.payment_status)) {
                    statusMessage = "✅ Payment confirmed! I am finalizing your account now.";
                    if (state && state.paymentCheckInterval) {
                        clearInterval(state.paymentCheckInterval);
                        bot.sendMessage(chatId, "Let's get your details to finalize your account.");
                        state.stage = 'awaiting_name_after_payment';
                        bot.sendMessage(chatId, "What is your full name?");
                    }
                } else if (['failed', 'expired'].includes(statusData.payment_status)) {
                    statusMessage = `❌ Payment has ${statusData.payment_status}. Please try the registration again.`;
                    if (state && state.paymentCheckInterval) {
                        clearInterval(state.paymentCheckInterval);
                        delete userRegistrationState[chatId];
                    }
                     updateBotCommandsForChat(chatId, mainMenuOptions);
                }

                bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });

            } catch(err) {
                console.error(`Error manually checking payment status for ${paymentId}:`, err);
                bot.sendMessage(chatId, "Sorry, I couldn't check the status right now. Please try again in a moment.");
            }
            return;
        }

        if (data.startsWith('pay_opay_') || data.startsWith('pay_crypto_')) {
             bot.sendMessage(chatId, "This action is outdated due to a flow update. Please start again from the plan selection.");
             return showSubscriptionPlans(chatId, 'Choose your plan to continue');
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
                bot.sendMessage(chatId, "✅ Payment confirmed! Let's get your details to finalize your account.");

                state.stage = 'awaiting_name_after_payment';
                bot.sendMessage(chatId, "What is your full name?");
                
            } else if (['failed', 'expired'].includes(statusData.payment_status)) {
                clearInterval(state.paymentCheckInterval);
                bot.sendMessage(chatId, `❌ Payment has ${statusData.payment_status}. Please try the registration again or contact support if you believe this is an error.`);
                delete userRegistrationState[chatId];
                updateBotCommandsForChat(chatId, mainMenuOptions);
            }
        } catch (err) {
            console.error(`Error polling payment status for ${paymentId}:`, err);
        }
    }, 15000); // Check every 15 seconds
}


// --- Conversational Message Handler ---
bot.on('message', async (msg) => {
    if (!msg.chat || !msg.chat.id || !msg.text || msg.text.startsWith('/')) {
        return;
    }
    
    const chatId = msg.chat.id;
    const text = msg.text;
    const state = userRegistrationState[chatId];

    if (!state || !state.stage) {
        return;
    }

    switch (state.stage) {
        case 'awaiting_name_after_payment':
            state.fullName = text;
            state.stage = 'awaiting_email_after_payment';
            bot.sendMessage(chatId, `Thanks, ${text}! Now, please enter your email address.`);
            break;

        case 'awaiting_email_after_payment':
            if (!text.includes('@') || !text.includes('.')) {
                bot.sendMessage(chatId, "That doesn't look like a valid email. Please try again.");
                return;
            }
            state.email = text;
            state.stage = 'finalizing_subscription';
            bot.sendMessage(chatId, `Got it. Finalizing your subscription and generating your invite link...`);
            
            try {
                const updateResponse = await fetch(`${serverUrl}/api/users/update-details`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        telegram_handle: state.telegramHandle,
                        full_name: state.fullName,
                        email: state.email
                    })
                });

                if (!updateResponse.ok) {
                    throw new Error("Failed to update user details in the database.");
                }

                if (!state.telegramGroupId) {
                    throw new Error("Telegram Group ID not found for this plan. Please check admin configuration.");
                }

                // Generate one-time invite link using the specific group ID for the plan
                const inviteLink = await bot.createChatInviteLink(state.telegramGroupId, { member_limit: 1 });
                await bot.sendMessage(chatId, `All done! Here is your one-time invite link to the VIP channel. Please note it can only be used once:\n\n${inviteLink.invite_link}`);

                delete userRegistrationState[chatId];
                updateBotCommandsForChat(chatId, mainMenuOptions);

            } catch(err) {
                console.error("Error finalizing subscription: ", err);
                bot.sendMessage(chatId, "I encountered an error while finalizing your account. Please contact support.");
                delete userRegistrationState[chatId];
            }
            break;
    }
});


// Export the bot instance and the setup function for server.js
module.exports = {
    bot,
    setupWebhook
};

