import { supabase } from './supabase.js';

export const dbQueries = {
  upsertUser: async (user: { id: number; first_name?: string; username?: string }) => {
    const { error } = await supabase
      .from('users')
      .upsert({
        id: user.id,
        first_name: user.first_name || 'Unknown',
        username: user.username || null
      }, { onConflict: 'id' });
    if (error) console.error('Error upserting user:', error);
  },

  getUser: async (id: number) => {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') console.error('Error getting user:', error);
    return data as { id: number, free_generations: number, paid_generations: number, last_free_gen_date: string } | undefined;
  },

  decrementUserGen: async (id: number) => {
    // Note: PostgreSQL doesn't support complex CASE in a single update as easily as SQLite without a function or rpc
    // We'll use a transaction logic or RPC if needed, but for now we'll fetch then update for simplicity
    // or better: use a raw SQL approach if needed.
    // However, with Supabase we can use .rpc() for atomic decrements.
    // Let's assume we might need an RPC for atomic decrement to avoid race conditions.
    // But for a simple bot, fetch-and-update is often okay if concurrency is low.
    // Let's try to use a single update with 'decrement' logic if possible.

    // Better way in Supabase:
    const { data: user } = await supabase.from('users').select('free_generations, paid_generations').eq('id', id).single();
    if (!user) return;

    if (user.free_generations > 0) {
      await supabase.from('users').update({ free_generations: user.free_generations - 1 }).eq('id', id);
    } else if (user.paid_generations > 0) {
      await supabase.from('users').update({ paid_generations: user.paid_generations - 1 }).eq('id', id);
    }
  },

  addPaidGenerations: async (id: number, amount: number) => {
    const { data: user } = await supabase.from('users').select('paid_generations').eq('id', id).single();
    if (user) {
      await supabase.from('users').update({ paid_generations: user.paid_generations + amount }).eq('id', id);
    }
  },

  addFreeGenerations: async (id: number, amount: number) => {
    const { data: user } = await supabase.from('users').select('free_generations').eq('id', id).single();
    if (user) {
      await supabase.from('users').update({ free_generations: user.free_generations + amount }).eq('id', id);
    }
  },

  getUsersForMonthlyReset: async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data, error } = await supabase
      .from('users')
      .select('id')
      .lte('last_free_gen_date', thirtyDaysAgo.toISOString());

    if (error) console.error('Error getting users for reset:', error);
    return (data || []) as { id: number }[];
  },

  resetUserFreeGens: async (id: number) => {
    await supabase
      .from('users')
      .update({ free_generations: 1, last_free_gen_date: new Date().toISOString() })
      .eq('id', id);
  },

  logGen: async (data: { user_id: number; prompt_id: string; status: 'SUCCESS' | 'FAILED'; cost?: number }) => {
    const { error } = await supabase
      .from('generations')
      .insert({
        user_id: data.user_id,
        prompt_id: data.prompt_id,
        status: data.status,
        cost: data.cost || 0
      });
    if (error) console.error('Error logging generation:', error);
  },

  getAllPrompts: async () => {
    const { data, error } = await supabase
      .from('prompts')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) console.error('Error getting all prompts:', error);
    return (data || []) as { id: string, label: string, prompt: string, is_active: boolean }[];
  },

  getActivePrompts: async () => {
    const { data, error } = await supabase
      .from('prompts')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true });
    if (error) console.error('Error getting active prompts:', error);
    return (data || []) as { id: string, label: string, prompt: string, is_active: boolean }[];
  },

  getDashboardStats: async () => {
    const { count: activeUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: totalGenerations } = await supabase.from('generations').select('*', { count: 'exact', head: true });
    const { count: successGenerations } = await supabase.from('generations').select('*', { count: 'exact', head: true }).eq('status', 'SUCCESS');
    const { data: costs } = await supabase.from('generations').select('cost').eq('status', 'SUCCESS');

    const estCost = costs?.reduce((acc, curr) => acc + (curr.cost || 0), 0) || 0;

    return {
      activeUsers: activeUsers || 0,
      totalGenerations: totalGenerations || 0,
      successGenerations: successGenerations || 0,
      estCost: estCost
    };
  },

  getUserMetrics: async () => {
    // In Supabase, complex joins like the SQLite one are best handled via RPC or Views
    // For now, let's fetch users and success generations separately and merge
    // (In a real app, you'd create a View in Supabase)
    const { data: users, error: uError } = await supabase.from('users').select('*');
    const { data: gens, error: gError } = await supabase.from('generations').select('user_id, cost').eq('status', 'SUCCESS');

    if (uError || gError) return [];

    return users.map(u => {
      const userGens = gens.filter(g => g.user_id === u.id);
      return {
        chat_id: u.id,
        first_name: u.first_name,
        username: u.username,
        free_generations: u.free_generations,
        paid_generations: u.paid_generations,
        last_free_gen_date: u.last_free_gen_date,
        generated: userGens.length,
        est_cost: userGens.reduce((acc, curr) => acc + (curr.cost || 0), 0)
      };
    }).sort((a, b) => b.generated - a.generated);
  },

  addPrompt: async (data: { id: string, label: string, prompt: string }) => {
    await supabase.from('prompts').insert(data);
  },

  updatePrompt: async (data: { id: string, label: string, prompt: string }) => {
    await supabase.from('prompts').update({ label: data.label, prompt: data.prompt }).eq('id', data.id);
  },

  togglePromptStatus: async (id: string) => {
    const { data: prompt } = await supabase.from('prompts').select('is_active').eq('id', id).single();
    if (prompt) {
      await supabase.from('prompts').update({ is_active: !prompt.is_active }).eq('id', id);
    }
  },

  removePrompt: async (id: string) => {
    await supabase.from('prompts').delete().eq('id', id);
  }
};

export default supabase;
