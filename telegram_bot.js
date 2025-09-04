// telegram_bot.js
// This file is now used to set up the webhook and define the bot's logic.
// It will not be run with `node telegram_bot.js` as a standalone script.
// Instead, its webhook initialization logic will be called from server.js.

// Load environment variables from .env file
require('dotenv').config();

// Import the Telegram Bot API library
const TelegramBot = require('node-telegram-bot-api');
// NEW: Import axios for making API requests to get crypto prices.
// Make sure to add axios to your project: npm install axios
const axios = require('axios');

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

// --- TRADING GAME STATE ---
// In-memory storage for game sessions. Keyed by chat ID.
const gameSessions = {};

// --- KEYBOARDS ---

// Define the keyboard for the main menu
const mainMenuKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: 'Pricing' }, { text: 'Pay Now' }],
            [{ text: 'Past Signals' }, { text: 'Signal Stats' }],
            [{ text: 'PNL Proofs' }, { text: '🎮 Trading Game' }] // Added Game Button
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

// Define the keyboard for the Trading Game menu
const gameMenuKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '📈 New Trade' }, { text: '💰 Portfolio' }],
            [{ text: '❌ Close Position' }, { text: '🔄 Reset Game' }],
            [{ text: '⬅️ Back to Main Menu' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

// --- BOT LOGIC ---

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

// --- NEW: TRADING GAME LOGIC ---

// Function to get the current price of a cryptocurrency from CoinGecko
async function getCryptoPrice(cryptoId) {
    try {
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
            params: {
                ids: cryptoId.toLowerCase(),
                vs_currencies: 'usd'
            }
        });
        if (response.data && response.data[cryptoId.toLowerCase()] && response.data[cryptoId.toLowerCase()].usd) {
            return response.data[cryptoId.toLowerCase()].usd;
        }
        return null;
    } catch (error) {
        console.error("Error fetching crypto price for", cryptoId, error.message);
        return null;
    }
}


// Function to initialize or get a game session
function getSession(chatId) {
    if (!gameSessions[chatId]) {
        gameSessions[chatId] = {
            balance: 10000,
            position: null, // e.g., { asset: 'bitcoin', direction: 'long', entryPrice: 60000, amountUSD: 1000 }
            tradeSetup: {} // To store intermediate trade info
        };
    }
    return gameSessions[chatId];
}

// Handler for "Trading Game" button
bot.onText(/🎮 Trading Game/, (msg) => {
    const chatId = msg.chat.id;
    getSession(chatId); // Ensure a session is created
    const welcomeMessage = `
Welcome to the NexxTrade Paper Trading Game!

Here you can practice your trading skills with a virtual portfolio of $10,000.

Select an option from the menu to start. Good luck!
    `;
    bot.sendMessage(chatId, welcomeMessage, gameMenuKeyboard);
});

// Handler for "Back to Main Menu"
bot.onText(/⬅️ Back to Main Menu/, (msg) => {
    bot.sendMessage(msg.chat.id, "You are back at the main menu.", mainMenuKeyboard);
});

// Handler for "Reset Game"
bot.onText(/🔄 Reset Game/, (msg) => {
    const chatId = msg.chat.id;
    delete gameSessions[chatId];
    getSession(chatId);
    bot.sendMessage(chatId, "Your game has been reset. You have a fresh portfolio of $10,000.", gameMenuKeyboard);
});

// Handler for "Portfolio"
bot.onText(/💰 Portfolio/, async (msg) => {
    const chatId = msg.chat.id;
    const session = getSession(chatId);
    let message = `Your current balance is: *$${session.balance.toFixed(2)}*\n\n`;

    if (session.position) {
        const currentPrice = await getCryptoPrice(session.position.asset);
        if (currentPrice) {
            const entryValue = session.position.amountUSD;
            const currentAssetAmount = entryValue / session.position.entryPrice;
            const currentValue = currentAssetAmount * currentPrice;
            
            let pnl;
            if (session.position.direction === 'long') {
                pnl = currentValue - entryValue;
            } else { // short
                pnl = entryValue - currentValue;
            }

            const pnlPercent = (pnl / entryValue) * 100;
            const pnlSign = pnl >= 0 ? '+' : '';
            
            message += `*Open Position:*\n`;
            message += `Asset: ${session.position.asset.toUpperCase()}\n`;
            message += `Direction: ${session.position.direction.toUpperCase()}\n`;
            message += `Entry Price: $${session.position.entryPrice}\n`;
            message += `Current Price: $${currentPrice}\n`;
            message += `Invested: $${session.position.amountUSD.toFixed(2)}\n`;
            message += `Unrealized P/L: *${pnlSign}$${pnl.toFixed(2)} (${pnlSign}${pnlPercent.toFixed(2)}%)*`;
        } else {
            message += `Could not fetch the current price for your position on ${session.position.asset.toUpperCase()}.`;
        }
    } else {
        message += "You have no open positions.";
    }

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});


// --- Multi-step Trade Logic ---

// 1. User clicks "New Trade"
bot.onText(/📈 New Trade/, (msg) => {
    const chatId = msg.chat.id;
    const session = getSession(chatId);

    if (session.position) {
        bot.sendMessage(chatId, "You already have an open position. Please close it before opening a new one.");
        return;
    }

    bot.sendMessage(chatId, "Which crypto would you like to trade? (e.g., `bitcoin`, `ethereum`, `solana`)").then(() => {
        bot.once('message', (assetMsg) => handleAssetSelection(assetMsg));
    });
});

// 2. User provides the asset name
async function handleAssetSelection(msg) {
    const chatId = msg.chat.id;
    const asset = msg.text.trim();
    const session = getSession(chatId);

    bot.sendMessage(chatId, `Fetching price for ${asset}...`);
    const price = await getCryptoPrice(asset);

    if (!price) {
        bot.sendMessage(chatId, `Sorry, I couldn't find the price for "${asset}". Please try another asset (e.g., bitcoin).`);
        return;
    }

    session.tradeSetup = { asset: asset, price: price };
    
    const directionKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: `🟢 Long (Buy) ${asset.toUpperCase()}`, callback_data: `trade_long_${asset}` }],
                [{ text: `🔴 Short (Sell) ${asset.toUpperCase()}`, callback_data: `trade_short_${asset}` }]
            ]
        }
    };
    bot.sendMessage(chatId, `The current price of ${asset.toUpperCase()} is *$${price}*. Do you want to go long or short?`, { parse_mode: 'Markdown', ...directionKeyboard });
}

// 3. User clicks Long or Short button
bot.on('callback_query', (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const session = getSession(chatId);
    const data = callbackQuery.data;

    if (data.startsWith('trade_')) {
        const [, direction, asset] = data.split('_');
        
        if (session.tradeSetup && session.tradeSetup.asset === asset) {
            session.tradeSetup.direction = direction;
            bot.answerCallbackQuery(callbackQuery.id, { text: `You selected ${direction.toUpperCase()}` });
            bot.sendMessage(chatId, `You have a balance of $${session.balance.toFixed(2)}. How much USD would you like to invest?`).then(() => {
                bot.once('message', (amountMsg) => handleAmountSelection(amountMsg));
            });
        }
    }
});

// 4. User provides the investment amount
function handleAmountSelection(msg) {
    const chatId = msg.chat.id;
    const session = getSession(chatId);
    const amount = parseFloat(msg.text);

    if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(chatId, "Invalid amount. Please enter a positive number.");
        resetTradeSetup(chatId);
        return;
    }

    if (amount > session.balance) {
        bot.sendMessage(chatId, `Insufficient balance. You only have $${session.balance.toFixed(2)}.`);
        resetTradeSetup(chatId);
        return;
    }

    // Open the position
    session.balance -= amount;
    session.position = {
        asset: session.tradeSetup.asset,
        direction: session.tradeSetup.direction,
        entryPrice: session.tradeSetup.price,
        amountUSD: amount
    };
    
    bot.sendMessage(chatId, `✅ Trade opened! You are now *${session.position.direction.toUpperCase()}* on ${session.position.asset.toUpperCase()} with *$${amount.toFixed(2)}*.\nYour remaining balance is $${session.balance.toFixed(2)}.`, { parse_mode: 'Markdown' });
    resetTradeSetup(chatId);
}

// Helper to reset the trade setup process
function resetTradeSetup(chatId) {
    if (gameSessions[chatId]) {
        gameSessions[chatId].tradeSetup = {};
    }
}

// Handler to close an open position
bot.onText(/❌ Close Position/, async (msg) => {
    const chatId = msg.chat.id;
    const session = getSession(chatId);

    if (!session.position) {
        bot.sendMessage(chatId, "You don't have any open positions to close.");
        return;
    }

    const currentPrice = await getCryptoPrice(session.position.asset);
    if (!currentPrice) {
        bot.sendMessage(chatId, `Could not fetch the current price for ${session.position.asset.toUpperCase()} to close the trade. Please try again in a moment.`);
        return;
    }
    
    const entryValue = session.position.amountUSD;
    const currentAssetAmount = entryValue / session.position.entryPrice;
    const currentValue = currentAssetAmount * currentPrice;
    
    let pnl;
    if (session.position.direction === 'long') {
        pnl = currentValue - entryValue;
        session.balance += entryValue + pnl;
    } else { // short
        pnl = entryValue - currentValue;
        session.balance += entryValue + pnl;
    }

    const pnlSign = pnl >= 0 ? '+' : '';
    const resultEmoji = pnl >= 0 ? '🎉' : '📉';

    const message = `
${resultEmoji} *Trade Closed!* ${resultEmoji}

Asset: ${session.position.asset.toUpperCase()}
Direction: ${session.position.direction.toUpperCase()}
Entry Price: $${session.position.entryPrice}
Closing Price: $${currentPrice}
P/L: *${pnlSign}$${pnl.toFixed(2)}*

Your new balance is *$${session.balance.toFixed(2)}*.
    `;

    session.position = null; // Clear the position
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
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

    // A list of all known commands and menu options
    const knownInputs = [
        '/start', '/status', '/remove',
        'Pricing', 'Pay Now', 'Past Signals', 'Signal Stats', 'PNL Proofs',
        '🎮 Trading Game', '📈 New Trade', '💰 Portfolio', '❌ Close Position', 
        '🔄 Reset Game', '⬅️ Back to Main Menu'
    ];
    
    // Check if the message is a known command/option or part of a conversation
    const isKnown = knownInputs.some(input => text && text.startsWith(input));
    const isInTradeSetup = gameSessions[chatId] && (gameSessions[chatId].tradeSetup.asset || gameSessions[chatId].tradeSetup.direction);

    if (!isKnown && !isInTradeSetup) {
        bot.sendMessage(chatId, "Please select an option from the menu or use /start to see the main menu again.", mainMenuKeyboard);
    }
});


// Export the bot instance and the setup function so they can be used in server.js
module.exports = {
    bot,
    setupWebhook
};
