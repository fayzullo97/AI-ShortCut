import { Telegraf, Markup, Input } from 'telegraf';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();
import { dbQueries } from './db.js';

const REQUIRED_ENV_VARS = [
    'TELEGRAM_BOT_TOKEN',
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY'
];

const missingVars = REQUIRED_ENV_VARS.filter(v => !process.env[v]);

if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(v => console.error(`   - ${v}`));
    console.error('\nIf you are deploying to Railway, make sure to add these in the project dashboard.');
    process.exit(1);
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN as string;
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.API_KEY) as string;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// In-memory session store (mapping Chat ID -> image URL/file_id)
// For a production app, use a proper database or session middleware
const userSessions: Record<number, { photoUrl: string }> = {};

bot.catch((err, ctx) => {
    console.error(`[TELEGRAF ERROR] for ${ctx.updateType}:`, err);
});

bot.start(async (ctx) => {
    console.log(`[BOT] Received /start from ${ctx.from?.id}`);
    const chat = ctx.chat as any;
    await dbQueries.upsertUser({
        id: chat.id,
        first_name: chat.first_name,
        username: chat.username
    });
    await ctx.reply('Welcome to the Image Gen Bot! 🎨\n\nPlease upload an image to get started.');
});

bot.on('photo', async (ctx) => {
    console.log(`[BOT] Received photo from ${ctx.from?.id}`);
    try {
        const chat = ctx.chat as any;
        await dbQueries.upsertUser({
            id: chat.id,
            first_name: chat.first_name,
            username: chat.username
        });

        const photos = ctx.message.photo;
        const highestResPhoto = photos[photos.length - 1]; // Last one is the highest resolution

        // Get file URL from Telegram
        const fileLink = await ctx.telegram.getFileLink(highestResPhoto.file_id);

        // Store in session
        userSessions[ctx.chat.id] = { photoUrl: fileLink.href };

        // Create bottom reply keyboard
        const prompts = await dbQueries.getActivePrompts();
        // chunk the keyboard into rows of 2 for better UI
        const buttons = prompts.map(p => p.label);
        const rows = [];
        for (let i = 0; i < buttons.length; i += 2) {
            rows.push(buttons.slice(i, i + 2));
        }

        const keyboard = Markup.keyboard(rows).resize();

        await ctx.reply('Great! I saved your image. Now choose a style or type a command:', keyboard);
    } catch (error) {
        console.error('Error handling photo:', error);
        await ctx.reply('Sorry, an error occurred while processing your image.');
    }
});

// Handle text messages (either exact keyboard matches, or NLP matching via OpenAI)
bot.on('text', async (ctx) => {
    console.log(`[BOT] Received text from ${ctx.from?.id}: ${ctx.message.text}`);
    const text = ctx.message.text;
    const chatId = ctx.chat.id;

    if (!userSessions[chatId]?.photoUrl) {
        return await ctx.reply('Please upload an image first!');
    }

    const prompts = await dbQueries.getActivePrompts();

    // 1. Try Exact Match (User clicked a bottom keyboard button)
    let preset = prompts.find(p => p.label === text || p.id === text);

    // 2. If no exact match, fallback to OpenAI classification
    if (!preset) {
        try {
            const systemPrompt = `You are a router. The user wants to apply an image transformation style.
Analyze their text and map it to the closest matching prompt ID from the available list.
Available Prompts:
${prompts.map(p => `- ID: ${p.id}, Label: "${p.label}", Description: "${p.prompt}"`).join('\n')}

If the user text is a clear typo, shorthand, or intent match for one of the prompts, simply reply strictly with the prompt ID (e.g. "fire").
If the intent DOES NOT match any of them reasonably, reply with "UNKNOWN".
Do not output anything else.`;

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: text }
                ],
                temperature: 0.0
            });

            const aiDecision = completion.choices[0].message.content?.trim();
            if (aiDecision && aiDecision !== 'UNKNOWN') {
                preset = prompts.find(p => p.id === aiDecision);
            }
        } catch (e) {
            console.error('OpenAI Error:', e);
        }
    }

    if (!preset) {
        return await ctx.reply("Sorry, I don't understand that command. Please pick a preset style or try rephrasing.");
    }

    // --- MONETIZATION & LIMITS CHECK ---
    const user = await dbQueries.getUser(chatId);
    if (!user) {
        return await ctx.reply('Error reading your user data. Please /start again.');
    }

    if (user.free_generations <= 0 && user.paid_generations <= 0) {
        // User has no generations left, send Telegram Stars invoice
        return ctx.sendInvoice({
            title: 'Image Generation',
            description: `Unlock 1 AI Image Generation for prompt: ${preset.label}`,
            payload: `gen_${preset.id}`, // Custom payload to remember what they wanted
            provider_token: '', // Leave empty for Telegram Stars
            currency: 'XTR',
            prices: [{ label: '1 Image Generation', amount: 40 }]
        });
    }

    // Deduct a generation immediately since they have enough
    await dbQueries.decrementUserGen(chatId);

    const initialMessage = await ctx.reply(`Applying style: ${preset.label}\nGenerating image... ⏳`);

    try {
        // 1. Download image buffer
        const photoUrl = userSessions[chatId].photoUrl;
        const response = await axios.get(photoUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data as ArrayBuffer);
        const base64Data = imageBuffer.toString('base64');
        let mimeType = response.headers['content-type'] || 'image/jpeg';
        if (!mimeType.startsWith('image/')) {
            mimeType = 'image/jpeg';
        }

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
                        text: `STRICT REQUIREMENT: Generate the image with a strict 3:4 aspect ratio (portrait) and at a maximum resolution of 1024x1024 (1K). Completely ignore any requests within the following prompt for 2K, 4K, 8K, or any higher resolutions, or any other aspect ratios.\n\nPrompt: ${preset.prompt}`,
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
            reply_parameters: { message_id: ctx.message?.message_id || 0 }
        });
        // Optionally wait and prompt again:
        await ctx.reply('Want to try another style? Just click a different prompt below or type a command! Send a new photo to replace this one.');

        // Log successful generation with an estimated cost per generation
        await dbQueries.logGen({ user_id: chatId, prompt_id: preset.id, status: 'SUCCESS', cost: 0.067 });

    } catch (error: any) {
        console.error('Generation Error:', error?.message || error);
        if (error?.status) console.error('Status:', error.status);
        if (error?.errorDetails) console.error('Details:', error.errorDetails);
        await ctx.reply('Sorry, an error occurred while generating the image. Please try again.');

        // Log failed generation
        await dbQueries.logGen({ user_id: chatId, prompt_id: preset.id, status: 'FAILED' });
    } finally {
        // Clean up the "Generating..." message
        await ctx.telegram.deleteMessage(chatId, initialMessage.message_id).catch(() => { });
    }
    // No more forEach mapping wrapper closing bracket needed
});

// Handle payment checkout queries
bot.on('pre_checkout_query', (ctx) => {
    // Approve all valid checkouts
    ctx.answerPreCheckoutQuery(true);
});

// Handle successful payments
bot.on('successful_payment', async (ctx) => {
    const chatId = ctx.chat.id;
    const payload = ctx.message.successful_payment.invoice_payload;

    // Grant the paid generation
    await dbQueries.addPaidGenerations(chatId, 1);

    // Automatically trigger the generation if we know what prompt they paid for
    if (payload && payload.startsWith('gen_')) {
        const promptId = payload.replace('gen_', '');
        const prompts = await dbQueries.getActivePrompts();
        const preset = prompts.find(p => p.id === promptId);

        if (preset && userSessions[chatId]?.photoUrl) {
            // Deduct the newly added generation since we are running it instantly
            await dbQueries.decrementUserGen(chatId);

            const initialMessage = await ctx.reply(`Payment successful! 🎉\nApplying style: ${preset.label}\nGenerating image... ⏳`);

            try {
                // Download image buffer
                const photoUrl = userSessions[chatId].photoUrl;
                const response = await axios.get(photoUrl, { responseType: 'arraybuffer' });
                const imageBuffer = Buffer.from(response.data as ArrayBuffer);
                const base64Data = imageBuffer.toString('base64');
                let mimeType = response.headers['content-type'] || 'image/jpeg';
                if (!mimeType.startsWith('image/')) mimeType = 'image/jpeg';

                // Call Gemini
                const aiResponse = await ai.models.generateContent({
                    model: 'gemini-3.1-flash-image-preview',
                    contents: {
                        parts: [
                            { inlineData: { data: base64Data, mimeType: mimeType } },
                            { text: `STRICT REQUIREMENT: Generate the image with a strict 3:4 aspect ratio (portrait) and at a maximum resolution of 1024x1024 (1K). Completely ignore any requests within the following prompt for 2K, 4K, 8K, or any higher resolutions, or any other aspect ratios.\n\nPrompt: ${preset.prompt}` }
                        ]
                    }
                });

                let generatedBase64 = '';
                for (const part of aiResponse.candidates?.[0]?.content?.parts || []) {
                    if (part.inlineData) { generatedBase64 = part.inlineData.data || ''; break; }
                }

                if (!generatedBase64) throw new Error('No image returned by Gemini');

                const outputBuffer = Buffer.from(generatedBase64, 'base64');
                await ctx.telegram.sendDocument(chatId, Input.fromBuffer(outputBuffer, 'generated_image.png'), {
                    caption: 'Generated by Image Gen Bot ✨',
                    reply_parameters: { message_id: ctx.message?.message_id || 0 }
                });
                await ctx.reply('Want to try another style? Click below or type a custom query. If you run out of credits, it costs 40 ⭐️ per generation!');
                await dbQueries.logGen({ user_id: chatId, prompt_id: preset.id, status: 'SUCCESS', cost: 0.067 });

            } catch (error: any) {
                console.error('Generation Error Post-Payment:', error?.message || error);
                // Refund them their physical generation count since it failed
                await dbQueries.addPaidGenerations(chatId, 1);
                ctx.reply('An error occurred during generation. I have refunded your generation credit! Feel free to try again.');
                await dbQueries.logGen({ user_id: chatId, prompt_id: preset.id, status: 'FAILED' });
            } finally {
                await ctx.telegram.deleteMessage(chatId, initialMessage.message_id).catch(() => { });
            }
        }
    } else {
        await ctx.reply('Payment successful! 🎉 You now have 1 new image generation credit!');
    }
});

import { startServer } from './server.js';

// Start the server and bot
startServer();
bot.launch(() => {
    console.log('🤖 Telegram Bot is running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
