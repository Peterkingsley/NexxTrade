// telegram_bot.js
// This file defines all the handlers and logic for the Telegram bot's interactions.

const axios = require('axios');

// This object will map chat IDs to the next expected message handler for conversational flows.
const nextStepHandlers = {};
const gameSessions = {}; // In-memory storage for game sessions. Keyed by chat ID.

// --- HELPER FUNCTIONS ---

function setNextStep(chatId, handler) {
    nextStepHandlers[chatId] = handler;
}

function getSession(chatId) {
    if (!gameSessions[chatId]) {
        gameSessions[chatId] = {
            balance: 10000,
            positions: [],
            tradeHistory: [],
            tradeSetup: {}
        };
    }
    return gameSessions[chatId];
}

function resetTradeSetup(chatId) {
    if (gameSessions[chatId]) gameSessions[chatId].tradeSetup = {};
}

async function getCryptoPrice(cryptoId) {
    try {
        const saneCryptoId = cryptoId.toLowerCase().trim();
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
            params: { ids: saneCryptoId, vs_currencies: 'usd' }
        });
        if (response.data && response.data[saneCryptoId]) {
            return response.data[saneCryptoId].usd;
        }
        return null;
    } catch (error) {
        console.error(`Error fetching crypto price for '${cryptoId}':`, error.response ? error.response.data : error.message);
        return null;
    }
}

// --- MAIN FUNCTION TO ATTACH ALL BOT HANDLERS ---

function setupBotHandlers(bot, serverUrl, privateChannelId) {
    // --- KEYBOARDS ---
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

    // --- GENERAL COMMANDS & MENU HANDLERS ---

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
    
    bot.onText(/Pricing/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const response = await fetch(`${serverUrl}/api/pricing`);
            const plans = await response.json();

            let message = `Here are our current pricing plans:\n\n`;
            plans.forEach(plan => {
                message += `*${plan.plan_name}*\nPrice: $${plan.price} ${plan.term}\nFeatures: ${plan.features.join(', ')}\n${plan.is_best_value ? '🏆 Best Value! 🏆\n' : ''}\n`;
            });
            message += `\nFor more details, visit: ${serverUrl}/#pricing`;
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Error fetching pricing plans:', error);
            bot.sendMessage(chatId, `I couldn't retrieve the pricing information right now. Please check our website: ${serverUrl}/#pricing`);
        }
    });

    bot.onText(/Pay Now/, (msg) => {
        bot.sendMessage(msg.chat.id, `Ready to get started? You can sign up and choose your plan here:\n${serverUrl}/join`);
    });

    bot.onText(/Past Signals/, (msg) => {
        bot.sendMessage(msg.chat.id, `You can view our complete history of past signals and performance data here:\n${serverUrl}/performance`);
    });

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
            bot.sendMessage(chatId, `I couldn't retrieve the signal statistics right now. Please check our website: ${serverUrl}/performance`);
        }
    });

    bot.onText(/PNL Proofs/, (msg) => {
        bot.sendMessage(msg.chat.id, `You can browse our PNL proof gallery to see our verified results here:\n${serverUrl}/performance#pnl-gallery`);
    });

    // --- TRADING GAME LOGIC ---
    
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

    bot.onText(/⬅️ Back to Main Menu/, (msg) => {
        bot.sendMessage(msg.chat.id, "You are back at the main menu.", mainMenuKeyboard);
    });

    bot.onText(/🔄 Reset Game/, (msg) => {
        const chatId = msg.chat.id;
        delete gameSessions[chatId];
        getSession(chatId);
        bot.sendMessage(chatId, "Your game has been reset. You have a fresh portfolio of $10,000.", gameMenuKeyboard);
    });

    bot.onText(/📊 Open Trades & PNL/, async (msg) => {
        const chatId = msg.chat.id;
        const session = getSession(chatId);
        let totalUnrealizedPNL = 0;
        
        const thinkingMessage = await bot.sendMessage(chatId, "Calculating your open positions... ⏳");
    
        if (session.positions.length === 0) {
            bot.editMessageText("You have no open positions.", { chat_id: chatId, message_id: thinkingMessage.message_id });
            return;
        }
    
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
                        [{ text: '❌ Close Trade', callback_data: `closetrade_${pos.id}` }]
                    ]
                }
            };
    
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...keyboard });
        }
        
        bot.deleteMessage(chatId, thinkingMessage.message_id);
    
        const portfolioValue = session.balance + totalUnrealizedPNL;
        const summaryMessage = `*Your Portfolio Summary*\nBalance: *$${session.balance.toFixed(2)}*\nTotal Unrealized P/L: *$${totalUnrealizedPNL.toFixed(2)}*\n\n*Total Portfolio Value: $${portfolioValue.toFixed(2)}*`;
        bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
    });

    bot.onText(/📈 New Trade/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(chatId, "Which crypto would you like to trade? (e.g., `bitcoin`, `ethereum`, `solana`)");
        setNextStep(chatId, (assetMsg) => handleAssetSelection(chatId, assetMsg.text.trim()));
    });
    
    async function handleAssetSelection(chatId, asset) {
        const session = getSession(chatId);
        const thinkingMsg = await bot.sendMessage(chatId, `Fetching price for ${asset}...`);
        const price = await getCryptoPrice(asset);
    
        bot.deleteMessage(chatId, thinkingMsg.message_id);
    
        if (!price) {
            const errorKeyboard = {
                reply_markup: {
                    keyboard: [[{ text: 'bitcoin' }, { text: 'ethereum' }, { text: 'solana' }]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            };
            bot.sendMessage(chatId, `Sorry, I couldn't find the price for "${asset}". Please ensure it's a valid CoinGecko ID and try again.`, errorKeyboard);
            setNextStep(chatId, (assetMsg) => handleAssetSelection(chatId, assetMsg.text.trim()));
            return;
        }
        
        session.tradeSetup = { asset, price };
        
        const leverageKeyboard = { 
            reply_markup: { 
                remove_keyboard: true,
                inline_keyboard: [[
                    { text: '5x', callback_data: 'leverage_5' }, { text: '10x', callback_data: 'leverage_10' },
                    { text: '20x', callback_data: 'leverage_20' }, { text: '50x', callback_data: 'leverage_50' }
                ]]
            }
        };
        bot.sendMessage(chatId, `Current price of ${asset.toUpperCase()} is *$${price}*. Select your leverage:`, { parse_mode: 'Markdown', ...leverageKeyboard });
    }

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
        }
        bot.answerCallbackQuery(cbq.id);
    });

    function handleLeverageSelection(chatId, leverage) {
        const session = getSession(chatId);
        session.tradeSetup.leverage = leverage;
        
        const directionKeyboard = { reply_markup: { inline_keyboard: [[
            { text: '🟢 Long (Buy)', callback_data: 'direction_long' },
            { text: '🔴 Short (Sell)', callback_data: 'direction_short' }
        ]]}};
        bot.sendMessage(chatId, `Leverage set to *${leverage}x*. Do you want to go long or short?`, { parse_mode: 'Markdown', ...directionKeyboard });
    }

    function handleDirectionSelection(chatId, direction) {
        const session = getSession(chatId);
        session.tradeSetup.direction = direction;
    
        const orderTypeKeyboard = { reply_markup: { inline_keyboard: [[
            { text: 'Market Order', callback_data: 'ordertype_market' },
            { text: 'Limit Order', callback_data: 'ordertype_limit' }
        ]]}};
        bot.sendMessage(chatId, `You chose *${direction.toUpperCase()}*. Select order type:`, { parse_mode: 'Markdown', ...orderTypeKeyboard });
    }

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
            isActive: orderType === 'market'
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

    // --- ADMINISTRATIVE & VERIFICATION ---
    
    bot.onText(/\/verify/, async (msg) => {
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
            console.log(`User @${telegramHandle} is not a member. Proceeding with verification.`);
        }
    
        try {
            const response = await fetch(`${serverUrl}/api/users/status-by-telegram-handle/${telegramHandle}`);
            const data = await response.json();
    
            if (response.ok && data.subscription_status === 'active') {
                const inviteLink = await bot.createChatInviteLink(privateChannelId, {
                    member_limit: 1,
                    expire_date: Math.floor(Date.now() / 1000) + 600
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
    
        if (adminTelegramHandle !== 'PeterKingsley') { // Replace with actual superadmin username
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

    // --- CATCH-ALL MESSAGE HANDLER ---
    
    bot.on('message', (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text ? msg.text.trim() : '';

        if (nextStepHandlers[chatId]) {
            const handler = nextStepHandlers[chatId];
            delete nextStepHandlers[chatId]; // Consume the handler
            handler(msg);
            return;
        }
    
        const knownOnTextCommands = [
            /^\/start$/, /^\/status$/, /^\/remove/, /^\/verify$/,
            /^Pricing$/, /^Pay Now$/, /^Past Signals$/, /^Signal Stats$/, /^PNL Proofs$/,
            /^🎮 Trading Game$/, /^📈 New Trade$/, /^📊 Open Trades & PNL$/, /^❌ Close Position$/, 
            /^📜 Trade History$/, /^🔄 Reset Game$/, /^⬅️ Back to Main Menu$/
        ];
        
        const isKnown = knownOnTextCommands.some(regex => regex.test(text));
    
        if (!isKnown) {
            bot.sendMessage(chatId, "I'm not sure how to respond to that. Please select an option from the menu, or use /start to begin.", mainMenuKeyboard);
        }
    });
}

module.exports = { setupBotHandlers };

