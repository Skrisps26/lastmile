import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        status: {
          created: '#3b82f6',
          assigned: '#8b5cf6',
          picked_up: '#06b6d4',
          in_transit: '#f59e0b',
          out_for_delivery: '#ec4899',
          delivered: '#10b981',
          failed: '#ef4444',
          rescheduled: '#d97706',
          cancelled: '#6b7280',
        },
      },
    },
  },
  plugins: [],
};

export default config;
