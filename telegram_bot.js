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
            [{ text: 'PNL Proofs' }, { text: '🎮 Trading Game' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

// Define the keyboard for the Trading Game menu
const gameMenuKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '📈 New Trade' }, { text: '📊 Open Trades & PNL' }],
            [{ text: '📜 Trade History' }, { text: '🔄 Reset Game' }],
            [{ text: '⬅️ Back to Main Menu' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

// --- BOT LOGIC ---

// Listen for the /start command - REVISED to be informational
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const introMessage = `
👋 *Welcome to NexxTrade!*

I'm your AI assistant, here to guide you through our premium futures signals service. At NexxTrade, we focus on providing high-conviction trade setups with clear entries, targets, and risk management.

*What to expect from NexxTrade:*
✅ *Signal Clarity:* Actionable entries, invalidations, and targets.
✅ *Risk-First Approach:* Every signal includes a stop-loss framework.
✅ *Timely Alerts:* Real-time updates so you can plan, not chase.
✅ *Expert Community:* Join a group of traders who win together.

Use the menu below to explore our performance, see pricing, or try our Trading Game to practice your skills!
    `;
    bot.sendMessage(chatId, introMessage, { ...mainMenuKeyboard, parse_mode: 'Markdown' });
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

// --- TRADING GAME LOGIC (ENHANCED) ---

// Function to get crypto prices
async function getCryptoPrice(cryptoId) {
    try {
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
            params: { ids: cryptoId.toLowerCase(), vs_currencies: 'usd' }
        });
        return response.data[cryptoId.toLowerCase()]?.usd || null;
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
            positions: [], // Now an array to support multiple trades
            tradeHistory: [], // To store closed trades
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

Here you can practice your trading skills with a virtual portfolio of $10,000. This version includes leverage, limit orders, TP/SL, and more!

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

// Handler for "Open Trades & PNL"
bot.onText(/📊 Open Trades & PNL/, async (msg) => {
    const chatId = msg.chat.id;
    const session = getSession(chatId);
    let totalUnrealizedPNL = 0;
    
    // Send a thinking message first
    const thinkingMessage = await bot.sendMessage(chatId, "Calculating your open positions... ⏳");

    if (session.positions.length === 0) {
        bot.editMessageText("You have no open positions.", { chat_id: chatId, message_id: thinkingMessage.message_id });
        return;
    }

    // Process each position
    for (const pos of session.positions) {
        let message = "";
        const currentPrice = await getCryptoPrice(pos.asset);
        let pnl = 0;
        let pnlPercent = 0;

        if (currentPrice) {
            if (pos.orderType === 'limit' && !pos.isActive) {
                if ((pos.direction === 'long' && currentPrice <= pos.entryPrice) || (pos.direction === 'short' && currentPrice >= pos.entryPrice)) {
                    pos.isActive = true;
                    message += `*🔔 LIMIT ORDER TRIGGERED for ${pos.asset.toUpperCase()}!* \n`;
                } else {
                    message += `*⏳ PENDING LIMIT ORDER*\n`;
                    message += `ID: ${pos.id}\nAsset: ${pos.asset.toUpperCase()} | ${pos.leverage}x ${pos.direction.toUpperCase()}\n`;
                    message += `Target Entry: $${pos.entryPrice}\nAmount: $${pos.amountUSD.toFixed(2)}\n\n`;
                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                    continue;
                }
            }

            const assetAmount = pos.amountUSD / pos.entryPrice;
            const currentValue = assetAmount * currentPrice;
            if (pos.direction === 'long') pnl = currentValue - pos.amountUSD;
            else pnl = pos.amountUSD - currentValue;
            
            pnl *= pos.leverage;
            totalUnrealizedPNL += pnl;
            pnlPercent = (pnl / pos.amountUSD) * 100;
        }

        const pnlSign = pnl >= 0 ? '+' : '';
        message += `*${pos.asset.toUpperCase()} | ${pos.leverage}x ${pos.direction.toUpperCase()}*\n`;
        message += `ID: \`${pos.id}\`\n`;
        message += `Entry: $${pos.entryPrice} | Current: $${currentPrice ? currentPrice : 'N/A'}\n`;
        message += `Invested: $${pos.amountUSD.toFixed(2)}\n`;
        message += `TP: $${pos.takeProfit || 'N/A'} | SL: $${pos.stopLoss || 'N/A'}\n`;
        message += `Unrealized P/L: *${pnlSign}$${pnl.toFixed(2)} (${pnlSign}${pnlPercent.toFixed(2)}%)*`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📥 Download ROI', callback_data: `downloadroi_${pos.id}` }, { text: '❌ Close Trade', callback_data: `closetrade_${pos.id}` }]
                ]
            }
        };

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
    }
    
    // Delete the "thinking" message
    bot.deleteMessage(chatId, thinkingMessage.message_id);

    // Send the final portfolio summary
    const portfolioValue = session.balance + totalUnrealizedPNL;
    const summaryMessage = `*Your Portfolio Summary*\nBalance: *$${session.balance.toFixed(2)}*\nTotal Unrealized P/L: *$${totalUnrealizedPNL.toFixed(2)}*\n\n*Total Portfolio Value: $${portfolioValue.toFixed(2)}*`;
    bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
});


// --- Multi-step Trade Logic ---
// ... (The new trade setup flow is complex and will be handled by a series of functions and callbacks)

// 1. User clicks "New Trade"
bot.onText(/📈 New Trade/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Which crypto would you like to trade? (e.g., `bitcoin`, `ethereum`, `solana`)").then(() => {
        bot.once('message', (assetMsg) => handleAssetSelection(chatId, assetMsg.text.trim()));
    });
});

// Helper to reset the trade setup process
function resetTradeSetup(chatId) {
    if (gameSessions[chatId]) gameSessions[chatId].tradeSetup = {};
}

// This object will map chat IDs to the next expected message handler
const nextStepHandlers = {};

function setNextStep(chatId, handler) {
    nextStepHandlers[chatId] = handler;
}

// Universal message handler for conversational flow
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    if (nextStepHandlers[chatId]) {
        const handler = nextStepHandlers[chatId];
        delete nextStepHandlers[chatId]; // Consume the handler
        handler(msg); // Execute it
    }
});


// 2. User provides asset -> ask for leverage
async function handleAssetSelection(chatId, asset) {
    const session = getSession(chatId);
    bot.sendMessage(chatId, `Fetching price for ${asset}...`);
    const price = await getCryptoPrice(asset);

    if (!price) {
        bot.sendMessage(chatId, `Sorry, I couldn't find the price for "${asset}". Please try again.`);
        return;
    }
    session.tradeSetup = { asset, price };
    
    const leverageKeyboard = { reply_markup: { inline_keyboard: [[
        { text: '5x', callback_data: 'leverage_5' }, { text: '10x', callback_data: 'leverage_10' },
        { text: '20x', callback_data: 'leverage_20' }, { text: '50x', callback_data: 'leverage_50' }
    ]]}};
    bot.sendMessage(chatId, `Current price of ${asset.toUpperCase()} is *$${price}*. Select your leverage:`, { parse_mode: 'Markdown', ...leverageKeyboard });
}

// Universal callback handler
bot.on('callback_query', (cbq) => {
    const chatId = cbq.message.chat.id;
    const [action, value] = cbq.data.split('_');

    switch(action) {
        case 'leverage':
            handleLeverageSelection(chatId, parseInt(value));
            break;
        case 'direction':
            handleDirectionSelection(chatId, value);
            break;
        case 'ordertype':
            handleOrderTypeSelection(chatId, value);
            break;
        case 'closetrade':
            closePositionById(chatId, value);
            break;
        case 'downloadroi':
            handleDownloadROI(chatId, value);
            break;
    }
    bot.answerCallbackQuery(cbq.id);
});

// NEW: Handler for downloading ROI image
async function handleDownloadROI(chatId, positionId) {
    const session = getSession(chatId);
    const position = session.positions.find(p => p.id == positionId);
    if (!position) {
        bot.sendMessage(chatId, "Could not find this trade. It might be closed already.");
        return;
    }

    bot.sendMessage(chatId, "Generating your ROI image... 🎨");

    const currentPrice = await getCryptoPrice(position.asset);
    if (!currentPrice) {
        bot.sendMessage(chatId, "Could not fetch the latest price to generate the ROI image.");
        return;
    }

    const assetAmount = position.amountUSD / position.entryPrice;
    const currentValue = assetAmount * currentPrice;
    let pnl = 0;
    if (position.direction === 'long') pnl = currentValue - position.amountUSD;
    else pnl = position.amountUSD - currentValue;
    pnl *= position.leverage;
    const pnlPercent = (pnl / position.amountUSD) * 100;

    try {
        const response = await axios.post(`${serverUrl}/api/generate-trade-image`, {
            pair: `${position.asset.toUpperCase()}/USDT`,
            direction: position.direction,
            leverage: position.leverage,
            pnlPercent: pnlPercent,
            entryPrice: position.entryPrice,
            currentPrice: currentPrice,
        }, {
            responseType: 'arraybuffer'
        });

        const imageBuffer = Buffer.from(response.data);
        bot.sendPhoto(chatId, imageBuffer, { caption: `ROI for your ${position.asset.toUpperCase()} trade.` });

    } catch (error) {
        console.error("Error generating or sending trade image:", error.message);
        bot.sendMessage(chatId, "Sorry, there was an error creating your ROI image.");
    }
}


// 3. User selects leverage -> ask for direction
function handleLeverageSelection(chatId, leverage) {
    const session = getSession(chatId);
    session.tradeSetup.leverage = leverage;
    
    const directionKeyboard = { reply_markup: { inline_keyboard: [[
        { text: '🟢 Long (Buy)', callback_data: 'direction_long' },
        { text: '🔴 Short (Sell)', callback_data: 'direction_short' }
    ]]}};
    bot.sendMessage(chatId, `Leverage set to *${leverage}x*. Do you want to go long or short?`, { parse_mode: 'Markdown', ...directionKeyboard });
}

// 4. User selects direction -> ask for order type
function handleDirectionSelection(chatId, direction) {
    const session = getSession(chatId);
    session.tradeSetup.direction = direction;

    const orderTypeKeyboard = { reply_markup: { inline_keyboard: [[
        { text: 'Market Order', callback_data: 'ordertype_market' },
        { text: 'Limit Order', callback_data: 'ordertype_limit' }
    ]]}};
    bot.sendMessage(chatId, `You chose *${direction.toUpperCase()}*. Select order type:`, { parse_mode: 'Markdown', ...orderTypeKeyboard });
}

// 5. User selects order type -> ask for details
function handleOrderTypeSelection(chatId, orderType) {
    const session = getSession(chatId);
    session.tradeSetup.orderType = orderType;

    if (orderType === 'market') {
        bot.sendMessage(chatId, `Enter investment amount in USD (Balance: $${session.balance.toFixed(2)}):`);
        setNextStep(chatId, (msg) => handleAmountSelection(chatId, msg.text.trim()));
    } else { // limit
        bot.sendMessage(chatId, `Current price is $${session.tradeSetup.price}. At what price do you want to enter?`);
        setNextStep(chatId, (msg) => handleEntryPriceSelection(chatId, msg.text.trim()));
    }
}

// 6a. User provides limit entry price -> ask for amount
function handleEntryPriceSelection(chatId, entryPrice) {
    const price = parseFloat(entryPrice);
    if (isNaN(price) || price <= 0) {
        bot.sendMessage(chatId, "Invalid price. Please enter a positive number.");
        resetTradeSetup(chatId);
        return;
    }
    const session = getSession(chatId);
    session.tradeSetup.entryPrice = price;
    bot.sendMessage(chatId, `Enter investment amount in USD (Balance: $${session.balance.toFixed(2)}):`);
    setNextStep(chatId, (msg) => handleAmountSelection(chatId, msg.text.trim()));
}

// 6b. User provides amount -> ask for Take Profit
function handleAmountSelection(chatId, amount) {
    const session = getSession(chatId);
    const amountUSD = parseFloat(amount);

    if (isNaN(amountUSD) || amountUSD <= 0) {
        bot.sendMessage(chatId, "Invalid amount. Please enter a positive number.");
        resetTradeSetup(chatId);
        return;
    }
    if (amountUSD > session.balance) {
        bot.sendMessage(chatId, `Insufficient balance. You only have $${session.balance.toFixed(2)}.`);
        resetTradeSetup(chatId);
        return;
    }
    session.tradeSetup.amountUSD = amountUSD;
    bot.sendMessage(chatId, `Enter your Take Profit price (or type 'skip'):`);
    setNextStep(chatId, (msg) => handleTakeProfitSelection(chatId, msg.text.trim()));
}

// 7. User provides TP -> ask for Stop Loss
function handleTakeProfitSelection(chatId, tp) {
    const session = getSession(chatId);
    if (tp.toLowerCase() !== 'skip') {
        const takeProfit = parseFloat(tp);
        if (isNaN(takeProfit) || takeProfit <= 0) {
            bot.sendMessage(chatId, "Invalid TP price. Please enter a positive number or 'skip'.");
            resetTradeSetup(chatId);
            return;
        }
        session.tradeSetup.takeProfit = takeProfit;
    }
    bot.sendMessage(chatId, `Enter your Stop Loss price (or type 'skip'):`);
    setNextStep(chatId, (msg) => handleStopLossSelection(chatId, msg.text.trim()));
}

// 8. User provides SL -> Finalize trade
function handleStopLossSelection(chatId, sl) {
    const session = getSession(chatId);
    if (sl.toLowerCase() !== 'skip') {
        const stopLoss = parseFloat(sl);
        if (isNaN(stopLoss) || stopLoss <= 0) {
            bot.sendMessage(chatId, "Invalid SL price. Please enter a positive number or 'skip'.");
            resetTradeSetup(chatId);
            return;
        }
        session.tradeSetup.stopLoss = stopLoss;
    }
    
    // Finalize and open the position
    const { asset, price, leverage, direction, orderType, entryPrice, amountUSD, takeProfit, stopLoss } = session.tradeSetup;
    const finalEntryPrice = orderType === 'market' ? price : entryPrice;
    
    const newPosition = {
        id: Date.now(),
        asset,
        leverage,
        direction,
        orderType,
        entryPrice: finalEntryPrice,
        amountUSD,
        takeProfit: takeProfit || null,
        stopLoss: stopLoss || null,
        isActive: orderType === 'market' // Limit orders are not active initially
    };
    
    session.balance -= amountUSD;
    session.positions.push(newPosition);

    let confirmationMessage = `✅ *Trade Setup Complete!*\n\n`;
    if (orderType === 'market') {
        confirmationMessage += `*MARKET ORDER EXECUTED*\n`;
    } else {
        confirmationMessage += `*LIMIT ORDER PLACED*\n`;
    }
    confirmationMessage += `*${asset.toUpperCase()} | ${leverage}x ${direction.toUpperCase()}*\n`;
    confirmationMessage += `Entry Price: $${finalEntryPrice}\n`;
    confirmationMessage += `Amount: $${amountUSD.toFixed(2)}\n`;
    confirmationMessage += `Take Profit: $${takeProfit || 'N/A'}\n`;
    confirmationMessage += `Stop Loss: $${stopLoss || 'N/A'}\n\n`;
    confirmationMessage += `Your remaining balance is $${session.balance.toFixed(2)}.`;
    
    bot.sendMessage(chatId, confirmationMessage, { parse_mode: 'Markdown' });
    resetTradeSetup(chatId);
}

// Handler to close an open position
bot.onText(/❌ Close Position/, (msg) => {
    const chatId = msg.chat.id;
    const session = getSession(chatId);

    if (session.positions.length === 0) {
        bot.sendMessage(chatId, "You have no open positions to close.");
        return;
    }

    const closeButtons = session.positions.map(pos => ([{
        text: `${pos.asset.toUpperCase()} | ${pos.leverage}x ${pos.direction.toUpperCase()} (ID: ${pos.id})`,
        callback_data: `closetrade_${pos.id}`
    }]));
    
    const closeKeyboard = { reply_markup: { inline_keyboard: closeButtons }};
    bot.sendMessage(chatId, "Select a trade to close:", closeKeyboard);
});

async function closePositionById(chatId, positionId, reason = 'Manual Close') {
    const session = getSession(chatId);
    const positionIndex = session.positions.findIndex(p => p.id == positionId);
    if (positionIndex === -1) {
        bot.sendMessage(chatId, "Could not find the specified trade to close.");
        return;
    }

    const pos = session.positions[positionIndex];

    const currentPrice = await getCryptoPrice(pos.asset);
    if (!currentPrice) {
        bot.sendMessage(chatId, `Could not fetch price for ${pos.asset.toUpperCase()} to close the trade. Please try again.`);
        return;
    }

    const assetAmount = pos.amountUSD / pos.entryPrice;
    const currentValue = assetAmount * currentPrice;
    let pnl = 0;
    if (pos.direction === 'long') pnl = currentValue - pos.amountUSD;
    else pnl = pos.amountUSD - currentValue;
    pnl *= pos.leverage;

    session.balance += pos.amountUSD + pnl;
    
    session.tradeHistory.push({
        asset: pos.asset,
        pnl: pnl,
        closeReason: reason,
        closedAt: new Date().toISOString()
    });

    // Remove position from active trades
    session.positions.splice(positionIndex, 1);

    const resultEmoji = pnl >= 0 ? '🎉' : '📉';
    const message = `
${resultEmoji} *Trade Closed!* ${resultEmoji}
*Reason: ${reason}*

Asset: ${pos.asset.toUpperCase()}
Direction: ${pos.direction.toUpperCase()}
Entry Price: $${pos.entryPrice}
Closing Price: $${currentPrice}
P/L: *${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}*

Your new balance is *$${session.balance.toFixed(2)}*.`;
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}


// Handler for "Trade History" -> Download PNL
bot.onText(/📜 Trade History/, (msg) => {
    const chatId = msg.chat.id;
    const session = getSession(chatId);

    if (session.tradeHistory.length === 0) {
        bot.sendMessage(chatId, "You have no closed trades in your history yet.");
        return;
    }

    let fileContent = `NexxTrade Paper Trading - PNL Report\nGenerated on: ${new Date().toUTCString()}\n\n`;
    fileContent += "========================================\n";

    session.tradeHistory.forEach(trade => {
        const pnlSign = trade.pnl >= 0 ? '+' : '';
        fileContent += `Asset: ${trade.asset.toUpperCase()}\n`;
        fileContent += `Closed At: ${new Date(trade.closedAt).toLocaleString()}\n`;
        fileContent += `Reason: ${trade.closeReason}\n`;
        fileContent += `Realized PNL: ${pnlSign}$${trade.pnl.toFixed(2)}\n`;
        fileContent += "----------------------------------------\n";
    });

    const fileOptions = {
        filename: 'nexxtrade_pnl_report.txt',
        contentType: 'text/plain',
    };

    bot.sendDocument(chatId, Buffer.from(fileContent), {}, fileOptions);
});


// NEW: Command for registered users to get their invite link
bot.onText(/\/verify/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramHandle = msg.from.username;

    if (!telegramHandle) {
        bot.sendMessage(chatId, "Please set a public Telegram username in your profile settings before proceeding.");
        return;
    }

    // Check if user is already in the channel
    try {
        const chatMember = await bot.getChatMember(privateChannelId, msg.from.id);
        if (chatMember.status !== 'left' && chatMember.status !== 'kicked') {
            bot.sendMessage(chatId, "You are already a member of the group!");
            return;
        }
    } catch (error) {
        console.log(`User @${telegramHandle} is not a member. Proceeding with verification.`);
    }

    // Verify subscription status from the backend
    try {
        const response = await fetch(`${serverUrl}/api/users/status-by-telegram-handle/${telegramHandle}`);
        const data = await response.json();

        if (response.ok && data.subscription_status === 'active') {
            const inviteLink = await bot.createChatInviteLink(privateChannelId, {
                member_limit: 1,
                expire_date: Math.floor(Date.now() / 1000) + 600 // Link valid for 10 minutes
            });
            
            bot.sendMessage(chatId, `Hello @${telegramHandle}! Your subscription is active. Here is your private, one-time invite link: ${inviteLink.invite_link}`);
        } else {
            bot.sendMessage(chatId, `Your status could not be found or your subscription is inactive. Please visit our website to subscribe or contact support.`);
        }
    } catch (error) {
        console.error('Error in /verify process:', error);
        bot.sendMessage(chatId, "An error occurred during verification. Please contact support.");
    }
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


// Catch-all message handler
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // If a handler is expecting the next message, don't trigger this.
    if (nextStepHandlers[chatId]) return;

    // A list of all known commands and menu options that are handled by onText
    const knownInputs = [
        '/start', '/status', '/remove', '/verify',
        'Pricing', 'Pay Now', 'Past Signals', 'Signal Stats', 'PNL Proofs',
        '🎮 Trading Game', '📈 New Trade', '📊 Open Trades & PNL', '❌ Close Position', 
        '📜 Trade History', '🔄 Reset Game', '⬅️ Back to Main Menu'
    ];
    
    // Check if the message is a known command/option
    const isKnown = knownInputs.some(input => text && text.trim().startsWith(input));

    if (!isKnown) {
        bot.sendMessage(chatId, "I'm not sure how to respond to that. Please select an option from the menu, or use /start to begin.", mainMenuKeyboard);
    }
});


// Export the bot instance and the setup function so they can be used in server.js
module.exports = {
    bot,
    setupWebhook
};

