/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/ui/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      lg: '900px', // 사이드바 숨김 (모바일)
      xl: '1200px', // 사이드바 축소 (작은 데스크톱)
      '2xl': '1536px',
    },
    extend: {
      colors: {
        // Light mode
        bg: {
          primary: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          tertiary: 'var(--bg-tertiary)',
          input: 'var(--bg-input)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          inverse: 'var(--text-inverse)',
        },
        border: {
          default: 'var(--border-default)',
          strong: 'var(--border-strong)',
          focus: 'var(--border-focus)',
        },
        accent: {
          primary: 'var(--accent-primary)',
          hover: 'var(--accent-hover)',
          subtle: 'var(--accent-subtle)',
        },
        bubble: {
          user: 'var(--bubble-user)',
          assistant: 'var(--bubble-assistant)',
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--error)',
        info: 'var(--info)',
      },
      fontFamily: {
        sans: ['Pretendard', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      spacing: {
        18: '4.5rem',
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        focus: 'var(--shadow-focus)',
      },
      transitionDuration: {
        fast: '100ms',
        normal: '150ms',
        slow: '300ms',
      },
    },
  },
  plugins: [],
};
