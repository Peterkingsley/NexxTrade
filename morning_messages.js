import { bot } from './telegram_bot.js';

export const morningMessages = {
    0: "Happy Sunday! ☀️ A new week of trading is just around the corner. Let's get prepared for the gains! Welcome to a new trading day!",
    1: "Happy Monday! 🚀 New week, new goals. The markets are open and ready for us! Welcome to a new trading day!",
    2: "Happy Tuesday! 📈 Momentum is building up. Don't miss out on today's action! Welcome to a new trading day!",
    3: "Happy Wednesday! 🌊 We're halfway through the week, and the opportunities are flowing! Welcome to a new trading day!",
    4: "Happy Thursday! 🔥 Stay focused and keep your eyes on the charts. Success is near! Welcome to a new trading day!",
    5: "Happy Friday! ⚡ Let's finish the trading week strong and secure those profits! Welcome to a new trading day!",
    6: "Happy Saturday! 🌟 Taking a breather? Or catching up on crypto? Either way, we're here for you! Welcome to a new trading day!"
};

export const runnerMessages = [
    "Don't miss today's 200% runner! 🏃‍♂️💨",
    "Today's 200% runner is loading... are you ready? 🚀",
    "A 200% runner is in our sights! Be prepared! 🎯",
    "Keep an eye out for today's 200% runner! It's going to be huge! 🌊",
    "Today's market looks ripe for a 200% runner. Don't be left behind! ⏳"
];

export async function sendMorningMessages(pool) {
    console.log('Running scheduled job: Sending morning messages...');
    const dayOfWeek = new Date().getDay();
    const baseMessage = morningMessages[dayOfWeek];
    const runnerMessage = runnerMessages[Math.floor(Math.random() * runnerMessages.length)];
    const fullMessage = `${baseMessage}\n\n${runnerMessage}\n\nDon't wait! Join VIP now and start trading like a pro! 🚀`;

    const messageOptions = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '💎 Join VIP Now', callback_data: 'join_vip' }]
            ]
        }
    };

    try {
        const { rows: users } = await pool.query(`SELECT telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL AND registration_source = 'bot'`);

        console.log(`Sending morning messages to ${users.length} users...`);

        users.forEach((user, index) => {
            if (!user.telegram_chat_id) return;

            setTimeout(async () => {
                try {
                    await bot.sendMessage(user.telegram_chat_id, fullMessage, messageOptions);
                } catch (err) {
                    console.error(`Failed to send morning message to ${user.telegram_chat_id}:`, err.message);
                }
            }, index * 100);
        });
    } catch (err) {
        console.error('Error fetching users for morning messages:', err);
    }
}
