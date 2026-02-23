import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        'Missing Supabase env vars. Copy .env.example to .env and fill in your project values.'
    );
}

// Singleton client — import this wherever you need Supabase
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
