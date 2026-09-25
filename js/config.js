// Public, browser-safe settings. Commit this file.
//
// Only the Supabase *publishable* (or legacy anon) key belongs here. It is
// designed to be public; Row Level Security in sql/schema.sql is what
// protects the data.
//
// NEVER put any of these in this file (or anywhere in this repo):
//   service_role / secret key, database password, Anthropic or OpenAI API key.
// The Claude key lives only in the collider Edge Function's secrets.
window.APP_CONFIG = {

    SUPABASE_URL:
        '',          // e.g. 'https://abcdefghijkl.supabase.co'

    SUPABASE_KEY:
        '',          // e.g. 'sb_publishable_xxxxx'

    // How people get an account:
    //   'anonymous' : no sign-up step. A guest account is created the first
    //                 time someone adds a block or posts. They can optionally
    //                 add an email to keep their block across devices.
    //                 Needs Authentication > Sign In / Providers > "Allow
    //                 anonymous sign-ins" switched on.
    //   'email'     : magic-link email only. Needs working email (set up
    //                 custom SMTP; the built-in sender allows ~2 emails/hour).
    AUTH_MODE: 'anonymous',

    // Set to true once the `collider` Edge Function is deployed with an
    // ANTHROPIC_API_KEY secret (see README). Otherwise the collider section
    // shows a short "not switched on" note.
    COLLIDER_ENABLED: false

};
