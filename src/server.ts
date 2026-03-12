import express from 'express';
import cors from 'cors';
import path from 'path';
import { dbQueries } from './db.js';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); // Added for consistency with path.join
const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Serve static dashboard files from public directory
app.use(express.static(path.join(__dirname, 'public'))); // Changed process.cwd() to __dirname for ES Modules

// API Routes
app.get('/api/stats', (req, res) => {
    try {
        const stats = dbQueries.getDashboardStats();
        const users = dbQueries.getUserMetrics();
        res.json({ success: true, stats, users });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/prompts', (req, res) => {
    try {
        const prompts = dbQueries.getAllPrompts();
        res.json({ success: true, prompts });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/prompts', (req, res) => {
    try {
        const { id, label, prompt } = req.body;
        if (!id || !label || !prompt) {
            return res.status(400).json({ success: false, error: 'Missing required fields: id, label, prompt' });
        }
        dbQueries.addPrompt({ id, label, prompt });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/prompts/:id', (req, res) => {
    try {
        const id = req.params.id;
        const { label, prompt } = req.body;
        if (!label || !prompt) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        dbQueries.updatePrompt({ id, label, prompt });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.patch('/api/prompts/:id/toggle', (req, res) => {
    try {
        dbQueries.togglePromptStatus(req.params.id);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/prompts/:id', (req, res) => {
    try {
        const id = req.params.id;
        dbQueries.removePrompt(id);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GIFT FREE GENERATIONS
app.post('/api/users/:id/gift', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { amount } = req.body;
        if (isNaN(id) || typeof amount !== 'number') { // Added isNaN check for id
            return res.status(400).json({ error: 'Invalid payload' });
        }

        dbQueries.addFreeGenerations(id, amount);
        res.json({ success: true, message: `Gifted ${amount} generations to ${id}` });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export const startServer = () => {
    app.listen(port as number, '0.0.0.0', () => {
        console.log(`📊 Admin Dashboard running on http://0.0.0.0:${port}`);
    });

    // Start Daily Cron Job to reset free limits
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN as string);

    cron.schedule('0 0 * * *', () => {
        console.log('⏰ Running daily check for free generation resets...');
        const eligibleUsers = dbQueries.getUsersForMonthlyReset();

        eligibleUsers.forEach((user) => {
            try {
                dbQueries.resetUserFreeGens(user.id);
                // Notify the user over Telegram
                bot.telegram.sendMessage(
                    user.id,
                    '🎁 **Your monthly free AI Image Generation has been restored!**\nFeel free to upload a photo and test out a new style!'
                ).catch(e => console.error(`Failed to notify user ${user.id}:`, e));
                console.log(`Reset limit and notified user ${user.id}`);
            } catch (e) {
                console.error(`Error resetting user ${user.id}:`, e);
            }
        });
    });
};
