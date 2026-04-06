/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./docs/**/*.{html,js}'],

  /* Classes constructed dynamically in JS (e.g. `past-award-chip-${type}`)
     can't be detected by Tailwind's content scanner — safelist them here. */
  safelist: [
    'past-award-chip-finalist',
    'past-award-chip-winner',
    'past-award-chip-impact',
    'past-award-chip-inspire',
    'ribbon-winner',
    'ribbon-finalist',
    'ribbon-eliminated',
    'ribbon-playing',
    'result-W',
    'result-L',
    'result-T',
    'toast-error',
    'toast-info',
    'toast-success',
    'spotlight-badge-blue',
    'spotlight-badge-red',
  ],

  theme: {
    extend: {
      /* ── Semantic colour tokens (mapped to CSS custom-properties) ── */
      colors: {
        'ct-bg':             'var(--bg)',
        'ct-surface':        'var(--surface)',
        'ct-glass':          'var(--surface-glass)',
        'ct-card':           'var(--card)',
        'ct-card-hover':     'var(--card-hover)',
        'ct-border':         'var(--border)',
        'ct-border-subtle':  'var(--border-subtle)',
        'ct-text':           'var(--text)',
        'ct-secondary':      'var(--text-secondary)',
        'ct-muted':          'var(--text-muted)',
        'ct-primary':        'var(--primary)',
        'ct-primary-glow':   'var(--primary-glow)',
        'ct-primary-hover':  'var(--primary-hover)',
        'ct-primary-soft':   'var(--primary-soft)',
        'ct-red':            'var(--red)',
        'ct-red-deep':       'var(--red-deep)',
        'ct-red-bg':         'var(--red-bg)',
        'ct-red-border':     'var(--red-border)',
        'ct-blue':           'var(--blue)',
        'ct-blue-deep':      'var(--blue-deep)',
        'ct-blue-bg':        'var(--blue-bg)',
        'ct-blue-border':    'var(--blue-border)',
        'ct-green':          'var(--green)',
        'ct-green-deep':     'var(--green-deep)',
        'ct-yellow':         'var(--yellow)',
      },

      /* ── Typography ── */
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', '"Fira Code"', 'monospace'],
      },

      /* ── Radii ── */
      borderRadius: {
        ct:   '10px',
        'ct-lg': '14px',
      },

      /* ── Shadows (theme-aware) ── */
      boxShadow: {
        'ct-sm':   'var(--shadow-sm)',
        'ct-md':   'var(--shadow-md)',
        'ct-lg':   'var(--shadow-lg)',
        'ct-glow': 'var(--shadow-glow)',
      },

      /* ── Transitions ── */
      transitionTimingFunction: {
        ct: 'cubic-bezier(.4, 0, .2, 1)',
      },
      transitionDuration: {
        ct: '250ms',
      },
    },
  },
  plugins: [],
};
