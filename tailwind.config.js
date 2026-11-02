/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#3F6B51',
          600: '#315441',
          50: '#E7EEE8'
        },
        paper: '#EFF1EA',
        ink: '#26302A',
        muted: '#6F7568',
        line: '#D6D3C6',
        brass: '#A9762F',
        rust: '#8E4A38',
        moss: '#3F6B51',
        green: '#2FA36B',
        gold: '#F5B800',
        blue: '#2F6FE4'
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', 'sans-serif'],
        serif: ['Songti SC', 'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'Times New Roman', 'serif']
      },
      maxWidth: {
        app: '44rem'
      }
    }
  },
  plugins: []
}
