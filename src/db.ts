import Database from 'better-sqlite3';
import path from 'path';

// Define the absolute path for the sqlite file so it doesn't get lost
const dbPath = path.resolve(process.cwd(), 'imageen.db');
const db = new Database(dbPath, { verbose: console.log });

// Enable performance pragmas
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, -- Telegram Chat ID
    first_name TEXT,
    username TEXT,
    free_generations INTEGER DEFAULT 1,
    paid_generations INTEGER DEFAULT 0,
    last_free_gen_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Migration for existing users table
  BEGIN;
  SELECT count(*) FROM pragma_table_info('users') WHERE name='free_generations';
  COMMIT;
`);

try {
  db.exec(`
    ALTER TABLE users ADD COLUMN free_generations INTEGER DEFAULT 1;
    ALTER TABLE users ADD COLUMN paid_generations INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN last_free_gen_date DATETIME DEFAULT CURRENT_TIMESTAMP;
`);
} catch (e) {
  // columns likely exist
}

db.exec(`

  CREATE TABLE IF NOT EXISTS generations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  prompt_id TEXT,
  cost REAL DEFAULT 0.0,
  status TEXT CHECK(status IN('SUCCESS', 'FAILED')),
  generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

  CREATE TABLE IF NOT EXISTS prompts(
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  prompt TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

--Add is_active column if it doesn't exist (for existing DB migration)
BEGIN;
  SELECT count(*) FROM pragma_table_info('prompts') WHERE name = 'is_active';
COMMIT;
`);

try {
  db.exec(`ALTER TABLE prompts ADD COLUMN is_active INTEGER DEFAULT 1; `);
} catch (e) {
  // column likely exists
}

/** Seed initial preset prompts if they don't exist */
const seedPrompts = () => {
  const defaults = [
    { id: 'fire', label: 'Make it fire 🔥', prompt: 'Transform the image to make it look like it is made of fire, with bright orange and red flames, glowing embers, and a dark background. High quality, cinematic lighting.' },
    { id: 'cyberpunk', label: 'Cyberpunk 🤖', prompt: 'Convert the image into a cyberpunk style, with neon lights, futuristic city elements, glowing blue and pink colors, and high-tech details. 8k resolution, highly detailed.' },
    { id: 'anime', label: 'Anime Style 🌸', prompt: 'Redraw the image in a high-quality anime style, with vibrant colors, detailed shading, and expressive features. Studio Ghibli style, beautiful scenery.' },
    { id: 'sketch', label: 'Pencil Sketch ✏️', prompt: 'Turn the image into a detailed pencil sketch, with realistic shading, graphite textures, and a hand-drawn look. Fine art, highly detailed.' },
    { id: 'watercolor', label: 'Watercolor 🎨', prompt: 'Transform the image into a beautiful watercolor painting, with soft blended colors, visible brush strokes, and an artistic feel.' }
  ];

  const countStmt = db.prepare('SELECT COUNT(*) as count FROM prompts');
  const count = (countStmt.get() as any).count;

  if (count === 0) {
    const insert = db.prepare('INSERT INTO prompts (id, label, prompt) VALUES (@id, @label, @prompt)');
    const insertMany = db.transaction((prompts) => {
      for (const p of prompts) insert.run(p);
    });
    insertMany(defaults);
    console.log('Seeded default preset prompts.');
  }
};

seedPrompts();

// --- Prepared Statements --- //

const insertUser = db.prepare(`
  INSERT INTO users(id, first_name, username)
VALUES(@id, @first_name, @username)
  ON CONFLICT(id) DO UPDATE SET
first_name = excluded.first_name,
  username = excluded.username
    `);

const logGeneration = db.prepare(`
  INSERT INTO generations(user_id, prompt_id, cost, status)
VALUES(@user_id, @prompt_id, @cost, @status)
`);

const getPrompts = db.prepare(`SELECT * FROM prompts ORDER BY created_at ASC`);

const getActivePrompts = db.prepare(`SELECT * FROM prompts WHERE is_active = 1 ORDER BY created_at ASC`);

const insertPrompt = db.prepare(`
  INSERT INTO prompts(id, label, prompt)
VALUES(@id, @label, @prompt)
  `);

const updatePromptQuery = db.prepare(`
  UPDATE prompts 
  SET label = @label, prompt = @prompt 
  WHERE id = @id
  `);

const togglePromptActiveQuery = db.prepare(`
  UPDATE prompts 
  SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END 
  WHERE id = ?
  `);

const deletePrompt = db.prepare(`DELETE FROM prompts WHERE id = ? `);

const getStats = db.prepare(`
  SELECT
  (SELECT COUNT(*) FROM users) as activeUsers,
  (SELECT COUNT(*) FROM generations) as totalGenerations,
    (SELECT COUNT(*) FROM generations WHERE status = 'SUCCESS') as successGenerations,
      (SELECT COALESCE(SUM(cost), 0) FROM generations WHERE status = 'SUCCESS') as estCost
        `);

const getUserListMetrics = db.prepare(`
SELECT
u.id as chat_id,
  u.first_name,
  u.username,
  u.free_generations,
  u.paid_generations,
  u.last_free_gen_date,
  COUNT(g.id) as generated,
  COALESCE(SUM(g.cost), 0) as est_cost
  FROM users u
  LEFT JOIN generations g ON u.id = g.user_id AND g.status = 'SUCCESS'
  GROUP BY u.id
  ORDER BY generated DESC
`);

const getUserById = db.prepare(`SELECT * FROM users WHERE id = ? `);

const decrementUserGenerations = db.prepare(`
  UPDATE users
SET
free_generations = CASE WHEN free_generations > 0 THEN free_generations - 1 ELSE free_generations END,
  paid_generations = CASE WHEN free_generations = 0 AND paid_generations > 0 THEN paid_generations - 1 ELSE paid_generations END
  WHERE id = ?
  `);

const addPaidGenerationsQuery = db.prepare(`
  UPDATE users SET paid_generations = paid_generations + @amount WHERE id = @id
  `);

const addFreeGenerationsQuery = db.prepare(`
  UPDATE users SET free_generations = free_generations + @amount WHERE id = @id
  `);

const getUsersEligibleForReset = db.prepare(`
  SELECT id FROM users 
  WHERE datetime(last_free_gen_date) <= datetime('now', '-30 days')
`);

const resetUserFreeGensQuery = db.prepare(`
  UPDATE users 
  SET free_generations = 1, last_free_gen_date = CURRENT_TIMESTAMP 
  WHERE id = ?
  `);

export const dbQueries = {
  upsertUser: (user: { id: number; first_name?: string; username?: string }) => {
    insertUser.run({
      id: user.id,
      first_name: user.first_name || 'Unknown',
      username: user.username || null
    });
  },

  getUser: (id: number) => {
    return getUserById.get(id) as { id: number, free_generations: number, paid_generations: number, last_free_gen_date: string } | undefined;
  },

  decrementUserGen: (id: number) => {
    decrementUserGenerations.run(id);
  },

  addPaidGenerations: (id: number, amount: number) => {
    addPaidGenerationsQuery.run({ id, amount });
  },

  addFreeGenerations: (id: number, amount: number) => {
    addFreeGenerationsQuery.run({ id, amount });
  },

  getUsersForMonthlyReset: () => {
    return getUsersEligibleForReset.all() as { id: number }[];
  },

  resetUserFreeGens: (id: number) => {
    resetUserFreeGensQuery.run(id);
  },

  logGen: (data: { user_id: number; prompt_id: string; status: 'SUCCESS' | 'FAILED'; cost?: number }) => {
    logGeneration.run({ ...data, cost: data.cost || 0 });
  },

  getAllPrompts: () => {
    return getPrompts.all() as { id: string, label: string, prompt: string, is_active: number }[];
  },

  getActivePrompts: () => {
    return getActivePrompts.all() as { id: string, label: string, prompt: string, is_active: number }[];
  },

  // Dashboard methods
  getDashboardStats: () => {
    return getStats.get();
  },

  getUserMetrics: () => {
    return getUserListMetrics.all();
  },

  addPrompt: (data: { id: string, label: string, prompt: string }) => {
    insertPrompt.run(data);
  },

  updatePrompt: (data: { id: string, label: string, prompt: string }) => {
    updatePromptQuery.run(data);
  },

  togglePromptStatus: (id: string) => {
    togglePromptActiveQuery.run(id);
  },

  removePrompt: (id: string) => {
    deletePrompt.run(id);
  }
};

export default db;
