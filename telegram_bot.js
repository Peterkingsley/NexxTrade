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

// NEW: Variable to store the bot's username
let botUsername = '';

// This function sets up the webhook on Telegram's side and registers the commands.
const setupWebhook = async () => {
    try {
        const webhookUrl = `${serverUrl}/bot${token}`;
        await bot.setWebHook(webhookUrl);
        console.log(`Webhook set to: ${webhookUrl}`);

        // NEW: Get bot's info to build referral links correctly
        const me = await bot.getMe();
        botUsername = me.username;
        console.log(`Bot username is @${botUsername}`);


        // Define the list of commands to be displayed in the menu
        const commands = [
            { command: 'start', description: 'Restart the Bot' },
            { command: 'getsignals', description: 'Get Signals' },
            { command: 'myreferral', description: 'Get your referral link' },
            { command: 'setreferral', description: 'Set your custom referral name' },
            { command: 'referralstats', description: 'Check your referral stats' },
            { command: 'requestpayout', description: 'Request a payout of your earnings' },
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
            [{ text: 'Refer & Earn', callback_data: 'refer_earn' }],
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

bot.onText(/\/start(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const referralCode = match[1]; // This will capture the referral code from /start [referral_code]

    // Clear any previous registration state for this user
    userRegistrationState[chatId] = {}; // Reset the state object

    if (referralCode) {
        userRegistrationState[chatId].referralCode = referralCode;
        bot.sendMessage(chatId, `Welcome! You've been referred by ${referralCode}.`);
    }

    bot.sendMessage(chatId, introMessage, mainMenuOptions);
});

bot.onText(/\/getsignals/, (msg) => {
    const chatId = msg.chat.id;
    // This function shows the subscription plans, starting the registration flow.
    showSubscriptionPlans(chatId, 'Choose your plan to continue');
});

// --- REFERRAL COMMANDS ---
bot.onText(/\/setreferral/, (msg) => {
    const chatId = msg.chat.id;
    userRegistrationState[chatId] = { stage: 'awaiting_referral_code' };
    bot.sendMessage(chatId, "Please enter your desired referral username. It can only contain letters and numbers (e.g., kingslayer21).");
});

bot.onText(/\/myreferral/, (msg) => {
    const chatId = msg.chat.id;
    handleReferralInfo(chatId, msg.from.username, 'link');
});

bot.onText(/\/referralstats/, (msg) => {
    const chatId = msg.chat.id;
    handleReferralInfo(chatId, msg.from.username, 'stats');
});

bot.onText(/\/requestpayout/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramUsername = msg.from.username;

    if (!telegramUsername) {
        return bot.sendMessage(chatId, "Please set a username in your Telegram settings to use the referral system.");
    }
    
    try {
        const response = await fetch(`${serverUrl}/api/users/referral-stats/${telegramUsername}`);
        if (!response.ok) {
            throw new Error('Could not fetch your balance.');
        }
        const stats = await response.json();
        const availableBalance = parseFloat(stats.availableBalance || 0);

        if (availableBalance <= 0) {
            return bot.sendMessage(chatId, "You do not have any available earnings to withdraw at this time.");
        }

        userRegistrationState[chatId] = { 
            stage: 'awaiting_payout_amount',
            balance: availableBalance
        };

        bot.sendMessage(chatId, `Your available balance is *$${availableBalance.toFixed(2)}*.\n\nPlease enter the amount you would like to withdraw.`, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error initiating payout:', error);
        bot.sendMessage(chatId, "Sorry, I couldn't retrieve your balance to start the payout process. Please try again later.");
    }
});
// --- END REFERRAL COMMANDS ---

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
    bot.sendMessage(chatId, '☎Customer Support: @NexxTrade_Support.');
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

const handleReferralInfo = async (chatId, telegramUsername, type) => {
    if (!telegramUsername) {
        return bot.sendMessage(chatId, "Please set a username in your Telegram settings to use the referral system.");
    }

    try {
        const response = await fetch(`${serverUrl}/api/users/referral-stats/${telegramUsername}`);
        if (response.status === 404) {
             return bot.sendMessage(chatId, "It looks like you're not registered yet. Please sign up for a plan to activate your referral features!");
        }
        if (!response.ok) {
            throw new Error('Failed to fetch referral data from the server.');
        }

        const stats = await response.json();
        const referralCode = stats.referralCode;

        if (type === 'link') {
            if (referralCode) {
                const websiteLink = `${serverUrl}/@${referralCode}`;
                const botLink = `https://t.me/${botUsername}?start=${referralCode}`;
                const message = `
🔗 *Your Personal Referral Links*

*For Website Sign-ups:*
Share this link for users who prefer to register on the website.
\`${websiteLink}\`

*For Direct Bot Sign-ups:*
Share this link to bring users directly to this Telegram bot.
\`${botLink}\`
                `;
                bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, "You haven't set your custom referral name yet. Use the /setreferral command to create your unique link!");
            }
        }
        
        if (type === 'stats') {
             const statsMessage = `
📈 *Your Referral Stats*

👥 *Total Referrals:* ${stats.totalReferrals}
💰 *Total Lifetime Earnings:* $${parseFloat(stats.totalEarnings || 0).toFixed(2)}
💸 *Total Paid Out:* $${parseFloat(stats.totalPayouts || 0).toFixed(2)}
🏦 *Available Balance:* $${parseFloat(stats.availableBalance || 0).toFixed(2)}

To withdraw your available balance, use the \`/requestpayout\` command.
            `;
            bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });

            if (!referralCode) {
                 bot.sendMessage(chatId, "You haven't set your custom referral name yet. Use the /setreferral command to create your unique link!");
            }
        }
    } catch (error) {
        console.error('Error fetching referral info:', error);
        bot.sendMessage(chatId, "Sorry, I couldn't retrieve your referral information right now. Please try again later.");
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


// --- Main Message Handler for collecting user input ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const state = userRegistrationState[chatId];

    // Ignore commands (handled by onText) and messages from users not in a registration flow.
    if (!msg.text || msg.text.startsWith('/') || !state || !state.stage) {
        return;
    }

    try {
        switch (state.stage) {
            case 'awaiting_referral_code':
                const referralCode = msg.text.trim();
                const telegramHandle = msg.from.username ? `@${msg.from.username}` : null;

                if (!telegramHandle) {
                    bot.sendMessage(chatId, "You must have a public Telegram username to set a referral code. Please set one in your Telegram settings and try again.");
                    delete userRegistrationState[chatId];
                    return;
                }

                if (!/^[a-zA-Z0-9]+$/.test(referralCode)) {
                    bot.sendMessage(chatId, "Invalid format. Your referral name can only contain letters and numbers. Please try another name.");
                    return;
                }

                const response = await fetch(`${serverUrl}/api/users/set-referral-code`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ telegram_handle: telegramHandle, referral_code: referralCode })
                });

                const data = await response.json();

                if (response.ok) {
                    const websiteLink = `${serverUrl}/@${data.referral_code}`;
                    const botLink = `https://t.me/${botUsername}?start=${data.referral_code}`;
                    const message = `
✅ Success! Your new referral links are ready:

*For Website Sign-ups:*
\`${websiteLink}\`

*For Direct Bot Sign-ups:*
\`${botLink}\`
                    `;
                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                } else {
                    bot.sendMessage(chatId, `⚠️ ${data.message}`);
                }
                
                delete userRegistrationState[chatId];
                break;
            
            case 'awaiting_payout_amount':
                const amount = parseFloat(msg.text);
                if (isNaN(amount) || amount <= 0) {
                    bot.sendMessage(chatId, "Please enter a valid positive number for the amount.");
                    return;
                }
                if (amount > state.balance) {
                    bot.sendMessage(chatId, `The amount you entered exceeds your available balance of $${state.balance.toFixed(2)}. Please enter a smaller amount.`);
                    return;
                }
                state.payoutAmount = amount;
                state.stage = 'awaiting_payout_address';
                bot.sendMessage(chatId, `You are requesting to withdraw *$${amount.toFixed(2)}*.\n\nPlease provide your USDT (TRC-20) wallet address for the payout.`, { parse_mode: 'Markdown' });
                break;
            
            case 'awaiting_payout_address':
                const address = msg.text.trim();
                // Basic validation for a TRC20 address (starts with 'T' and is 34 chars long)
                if (!/^T[A-Za-z1-9]{33}$/.test(address)) {
                    bot.sendMessage(chatId, "That does not appear to be a valid USDT (TRC-20) address. Please double-check and send the correct address.");
                    return;
                }
                state.payoutAddress = address;
                
                bot.sendMessage(chatId, "Submitting your payout request...");

                const payoutResponse = await fetch(`${serverUrl}/api/users/request-payout`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        telegram_username: msg.from.username,
                        amount: state.payoutAmount,
                        payout_address: state.payoutAddress
                    })
                });

                if (payoutResponse.ok) {
                    bot.sendMessage(chatId, "✅ Your payout request has been successfully submitted for review. You will be notified once it has been processed by an admin.");
                } else {
                    const error = await payoutResponse.json();
                    bot.sendMessage(chatId, `⚠️ There was an error submitting your request: ${error.message}`);
                }

                delete userRegistrationState[chatId];
                break;

            case 'awaiting_whatsapp':
                if (!/^\+?\d{10,}$/.test(msg.text)) {
                    bot.sendMessage(chatId, "That doesn't look right. Please enter a valid WhatsApp number, including the country code (e.g., +1234567890).");
                    return;
                }
                
                state.whatsapp = msg.text;
                state.stage = 'awaiting_payment';
                bot.sendMessage(chatId, "Thank you! Generating your unique payment address... please wait.");

                const paymentResponse = await fetch(`${serverUrl}/api/payments/create-from-bot`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        telegram_handle: state.telegramHandle,
                        chat_id: chatId,
                        plan_id: state.planId,
                        pay_currency: state.network,
                        whatsapp_number: state.whatsapp,
                        referral_code: state.referralCode // Pass the referral code if it exists
                    }),
                });
                
                if (paymentResponse.status === 409) { 
                    const errorData = await paymentResponse.json();
                    bot.sendMessage(chatId, `⚠️ ${errorData.message}`, {
                         reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Choose a Different Plan', callback_data: 'pricing' }],
                                [{ text: 'Contact Support', callback_data: 'support_contact' }]
                            ]
                        }
                    });
                    delete userRegistrationState[chatId];
                    return;
                }

                if (!paymentResponse.ok) {
                    const errorData = await paymentResponse.json().catch(() => ({ message: "An unexpected server error occurred." }));
                    throw new Error(errorData.message || 'Please try again later.');
                }

                const paymentData = await paymentResponse.json();
                state.orderId = paymentData.order_id;
                
                const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${paymentData.pay_address}&size=200x200`;
                const networkMap = { 'usdttrc20': 'USDT(TRC20)', 'usdtbsc': 'USDT(BEP20)' };
                const formattedCurrency = networkMap[paymentData.pay_currency.toLowerCase()] || paymentData.pay_currency.toUpperCase();

                const addressMessage = `Please send exactly *${paymentData.pay_amount} ${formattedCurrency}* to this address:\n\n` + `\`${paymentData.pay_address}\``;
                const monitoringMessage = `👆 Tap & copy the address above to pay.\n\n✅ Auto Join VIP: Access in ~2 minutes after payment.\n☎️ Support: @Nexxtrade_Support\n\n🔃Checking payment Status: ⏳`;
                
                const checkStatusKeyboard = {
                    reply_markup: {
                        inline_keyboard: [[{ text: '🔐Unlock VIP Signals', callback_data: `check_payment_status_${state.orderId}` }]]
                    }
                };
                
                await bot.sendPhoto(chatId, qrCodeUrl, { caption: addressMessage, parse_mode: 'Markdown' });
                await bot.sendMessage(chatId, monitoringMessage, checkStatusKeyboard);
                break;

            case 'awaiting_full_name':
                state.fullName = msg.text;
                state.stage = 'awaiting_email';
                bot.sendMessage(chatId, `Great, ${state.fullName}! Now, please enter your email address.`);
                break;

            case 'awaiting_email':
                if (!/\S+@\S+\.\S+/.test(msg.text)) {
                    bot.sendMessage(chatId, "That doesn't look like a valid email. Please try again.");
                    return;
                }
                state.email = msg.text;
                state.stage = 'finalizing';
                bot.sendMessage(chatId, "Perfect! Finalizing your registration and generating your secure invite link...");

                const finalResponse = await fetch(`${serverUrl}/api/users/finalize-registration`, {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({
                         orderId: state.orderId,
                         fullName: state.fullName,
                         email: state.email
                     })
                });

                if (!finalResponse.ok) {
                    throw new Error("Failed to finalize registration on the server.");
                }

                const finalData = await finalResponse.json();
                
                const successMessage = `Thank you! Your registration is complete. Click below to join the VIP channel immediately.`;
                const joinKeyboard = {
                    reply_markup: {
                        inline_keyboard: [[{ text: 'Join Now', url: finalData.invite_link }]]
                    }
                };
                await bot.sendMessage(chatId, successMessage, joinKeyboard);
                delete userRegistrationState[chatId];
                break;
        }
    } catch (err) {
        console.error("Error in message handler:", err);
        bot.sendMessage(chatId, `An unexpected error occurred: ${err.message}. Please contact support or try /start again.`);
        delete userRegistrationState[chatId];
    }
});


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

        if (data === 'pricing' || data === 'join_vip' || data === 'back_to_plans' || data === 'get_signals_now') {
            if(data === 'back_to_plans' && userRegistrationState[chatId]) delete userRegistrationState[chatId];
            return showSubscriptionPlans(chatId, 'Choose your plan to continue');
        }
        if (data === 'recent_signals') return createLinkMenu(chatId, 'Click the button below to see our recent signals and full performance history.', `${serverUrl}/performance`);
        if (data === 'signal_stats') return handleSignalStats(chatId);
        if (data === 'refer_earn') return handleReferralInfo(chatId, telegramUser.username, 'link');
        
        if (data === 'main_menu') {
            if (userRegistrationState[chatId]) delete userRegistrationState[chatId];
            return bot.sendMessage(chatId, introMessage, mainMenuOptions);
        }

        if (data.startsWith('select_plan_')) {
            const planId = parseInt(data.split('_')[2], 10);
            const telegramHandle = telegramUser.username ? `@${telegramUser.username}` : `user_${telegramUser.id}`;
            // Preserve referral code if it exists
            const existingState = userRegistrationState[chatId] || {};
            userRegistrationState[chatId] = { ...existingState, planId, telegramHandle, stage: 'awaiting_payment_method' };

            const paymentKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Pay with Crypto', callback_data: `select_payment_crypto` }],
                        [{ text: 'Pay with Fiat', callback_data: `select_payment_fiat` }],
                        [{ text: '⬅️ Back to Plans', callback_data: 'back_to_plans' }]
                    ]
                }
            };
            return bot.sendMessage(chatId, `You have selected a plan. Please choose your payment method:`, paymentKeyboard);
        }

        if (data === 'select_payment_fiat') {
            const state = userRegistrationState[chatId];
            if (!state) return bot.sendMessage(chatId, "Please select a plan first.");
            const fiatKeyboard = {
                inline_keyboard: [
                    [{ text: 'Proceed to Fiat Checkout', url: `${serverUrl}/join?telegram=${state.telegramHandle.replace('@','')}` }],
                    [{ text: '⬅️ Back', callback_data: `select_plan_${state.planId}` }]
                ]
            };
            return bot.sendMessage(chatId, `To complete your payment with Fiat, please use the button below to visit our secure checkout page.`, { reply_markup: fiatKeyboard });
        }

        if (data === 'select_payment_crypto') {
            const state = userRegistrationState[chatId];
            if (!state) return bot.sendMessage(chatId, "Please select a plan first.");
            const cryptoNetworkKeyboard = {
                 reply_markup: {
                    inline_keyboard: [
                        [{ text: 'USDT (TRC-20)', callback_data: `select_network_usdttrc20` }],
                        [{ text: 'USDT (BEP-20)', callback_data: `select_network_usdtbsc` }],
                        [{ text: '⬅️ Back', callback_data: `select_plan_${state.planId}` }]
                    ]
                }
            };
            return bot.sendMessage(chatId, `Please select the crypto network for your USDT payment:`, cryptoNetworkKeyboard);
        }
        
        if (data.startsWith('select_network_')) {
            const network = data.split('_')[2];
            const state = userRegistrationState[chatId];
            if (!state) return bot.sendMessage(chatId, "Your session seems to have expired. Please start again with /start.");

            state.network = network;
            state.stage = 'awaiting_whatsapp';
            return bot.sendMessage(chatId, "Please enter your WhatsApp number (including country code) to proceed.");
        }

        if (data.startsWith('check_payment_status_')) {
            const orderId = data.split('_')[3];
            bot.sendMessage(chatId, "Checking payment status on our server, please wait...");
            const statusResponse = await fetch(`${serverUrl}/api/payments/status/${orderId}`);
            if (!statusResponse.ok) throw new Error("Could not reach our server.");
            const statusData = await statusResponse.json();
            
            if (statusData.status === 'paid') {
                const state = userRegistrationState[chatId];
                if (state) {
                    state.stage = 'awaiting_full_name';
                    return await bot.sendMessage(chatId, `✅ Payment confirmed! To complete your registration, please provide your full name.`);
                } else {
                    return await bot.sendMessage(chatId, `✅ Payment confirmed! Your session expired. Please contact support with your transaction ID to get your link.`);
                }
            } else {
                return await bot.sendMessage(chatId, `Current status: *${statusData.status}*. Please wait for blockchain confirmation and try again.`, { parse_mode: 'Markdown' });
            }
        }

    } catch (error) {
        console.error("Critical error in callback_query handler:", error);
        if (callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id) {
            bot.sendMessage(callbackQuery.message.chat.id, "Sorry, a critical error occurred. Please try again or contact support.");
        }
    }
});

module.exports = {
    bot,
    setupWebhook,
    userRegistrationState
};
