import express from 'express';
import cors from 'cors';
import path from 'path';
import { dbQueries } from './db.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static dashboard files from public directory
app.use(express.static(path.join(process.cwd(), 'public')));

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
        dbQueries.removePrompt(req.params.id);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export const startServer = () => {
    app.listen(port, () => {
        console.log(`📊 Admin Dashboard running on http://localhost:${port}`);
    });
};
