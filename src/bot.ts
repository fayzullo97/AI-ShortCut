import { Telegraf, Markup, Input } from 'telegraf';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;

if (!TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is not defined in .env');
    process.exit(1);
}

if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not defined in .env');
    process.exit(1);
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// In-memory session store (mapping Chat ID -> image URL/file_id)
// For a production app, use a proper database or session middleware
const userSessions: Record<number, { photoUrl: string }> = {};

const PRESET_PROMPTS = [
    { id: 'fire', label: 'Make it fire 🔥', prompt: 'Transform the image to make it look like it is made of fire, with bright orange and red flames, glowing embers, and a dark background. High quality, cinematic lighting.' },
    { id: 'cyberpunk', label: 'Cyberpunk 🤖', prompt: 'Convert the image into a cyberpunk style, with neon lights, futuristic city elements, glowing blue and pink colors, and high-tech details. 8k resolution, highly detailed.' },
    { id: 'anime', label: 'Anime Style 🌸', prompt: 'Redraw the image in a high-quality anime style, with vibrant colors, detailed shading, and expressive features. Studio Ghibli style, beautiful scenery.' },
    { id: 'sketch', label: 'Pencil Sketch ✏️', prompt: 'Turn the image into a detailed pencil sketch, with realistic shading, graphite textures, and a hand-drawn look. Fine art, highly detailed.' },
    { id: 'watercolor', label: 'Watercolor 🎨', prompt: 'Transform the image into a beautiful watercolor painting, with soft blended colors, visible brush strokes, and an artistic feel.' }
];

bot.start((ctx) => {
    ctx.reply('Welcome to the Image Gen Bot! 🎨\n\nPlease upload an image to get started.');
});

bot.on('photo', async (ctx) => {
    try {
        const photos = ctx.message.photo;
        const highestResPhoto = photos[photos.length - 1]; // Last one is the highest resolution

        // Get file URL from Telegram
        const fileLink = await ctx.telegram.getFileLink(highestResPhoto.file_id);

        // Store in session
        userSessions[ctx.chat.id] = { photoUrl: fileLink.href };

        // Create inline keyboard
        const keyboard = Markup.inlineKeyboard(
            PRESET_PROMPTS.map((preset) => [Markup.button.callback(preset.label, `preset_${preset.id}`)])
        );

        await ctx.reply('Great! Now choose a style for your image:', keyboard);
    } catch (error) {
        console.error('Error handling photo:', error);
        ctx.reply('Sorry, an error occurred while processing your image.');
    }
});

// Handle callback queries for preset selections
PRESET_PROMPTS.forEach((preset) => {
    bot.action(`preset_${preset.id}`, async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId || !userSessions[chatId]?.photoUrl) {
            return ctx.answerCbQuery('Session expired or no image found. Please upload a new image.');
        }

        // Acknowledge the callback immediately
        await ctx.answerCbQuery();

        const initialMessage = await ctx.reply(`Applying style: ${preset.label}\nGenerating image... ⏳`);

        try {
            // 1. Download image buffer
            const photoUrl = userSessions[chatId].photoUrl;
            const response = await axios.get(photoUrl, { responseType: 'arraybuffer' });
            const imageBuffer = Buffer.from(response.data as ArrayBuffer);
            const base64Data = imageBuffer.toString('base64');
            const mimeType = response.headers['content-type'] || 'image/jpeg';

            // 2. Call Gemini
            const aiResponse = await ai.models.generateContent({
                model: 'gemini-3.1-flash-image-preview',
                contents: {
                    parts: [
                        {
                            inlineData: {
                                data: base64Data,
                                mimeType: mimeType,
                            },
                        },
                        {
                            text: preset.prompt,
                        },
                    ],
                },
            });

            // 3. Extract generated image
            let generatedBase64 = '';
            let generatedMimeType = '';

            for (const part of aiResponse.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                    generatedBase64 = part.inlineData.data || '';
                    generatedMimeType = part.inlineData.mimeType || '';
                    break;
                }
            }

            if (!generatedBase64) {
                throw new Error('No image returned by Gemini');
            }

            // 4. Send back to user
            const outputBuffer = Buffer.from(generatedBase64, 'base64');

            await ctx.telegram.sendDocument(chatId, Input.fromBuffer(outputBuffer, 'generated_image.png'), {
                caption: 'Generated by Image Gen Bot ✨',
                reply_parameters: { message_id: ctx.callbackQuery.message?.message_id || 0 }
            });
            // Optionally wait and prompt again:
            await ctx.reply('Want to generate another one? Upload a new image!');

            // Cleanup session if you want single-use, or keep it to allow generating multiple styles from same image.
            // delete userSessions[chatId]; 

        } catch (error) {
            console.error('Generation Error:', error);
            ctx.reply('Sorry, an error occurred while generating the image. Please try again.');
        } finally {
            // Clean up the "Generating..." message
            await ctx.telegram.deleteMessage(chatId, initialMessage.message_id).catch(() => { });
        }
    });
});

// Start the bot
bot.launch(() => {
    console.log('🤖 Telegram Bot is running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
