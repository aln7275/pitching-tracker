import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cnmtvxvdlvtfgagxmbot.supabase.co';
const supabaseAnonKey = 'sb_publishable_O4UX3OkH0FHCU3eBaCflJg_TrWyVsLm';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
