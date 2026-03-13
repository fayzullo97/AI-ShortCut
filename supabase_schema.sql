-- Users table
CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY, -- Telegram Chat ID
    first_name TEXT,
    username TEXT,
    free_generations INTEGER DEFAULT 1,
    paid_generations INTEGER DEFAULT 0,
    last_free_gen_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Prompts table
CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    prompt TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Generations table
CREATE TABLE IF NOT EXISTS generations (
    id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id),
    prompt_id TEXT REFERENCES prompts(id),
    cost DOUBLE PRECISION DEFAULT 0.0,
    status TEXT CHECK (status IN ('SUCCESS', 'FAILED')),
    generated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial prompts
INSERT INTO prompts (id, label, prompt) VALUES
('fire', 'Make it fire 🔥', 'Transform the image to make it look like it is made of fire, with bright orange and red flames, glowing embers, and a dark background. High quality, cinematic lighting.'),
('cyberpunk', 'Cyberpunk 🤖', 'Convert the image into a cyberpunk style, with neon lights, futuristic city elements, glowing blue and pink colors, and high-tech details. 8k resolution, highly detailed.'),
('anime', 'Anime Style 🌸', 'Redraw the image in a high-quality anime style, with vibrant colors, detailed shading, and expressive features. Studio Ghibli style, beautiful scenery.'),
('sketch', 'Pencil Sketch ✏️', 'Turn the image into a detailed pencil sketch, with realistic shading, graphite textures, and a hand-drawn look. Fine art, highly detailed.'),
('watercolor', 'Watercolor 🎨', 'Transform the image into a beautiful watercolor painting, with soft blended colors, visible brush strokes, and an artistic feel.')
ON CONFLICT (id) DO NOTHING;
