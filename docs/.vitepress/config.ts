import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'SelDiA',
  description: 'The diagram engine — keep your Mermaid, PlantUML, or SelDiA DSL; SelDiA keeps it true.',
  lang: 'en-US',
  lastUpdated: true,
  themeConfig: {
    logo: '/icon.svg',
    siteTitle: 'SelDiA',
    nav: [
      { text: 'Guide', link: '/user_guide' },
      { text: 'Architecture', link: '/arch' },
      { text: 'Roadmap', link: '/next_steps' },
      { text: 'Positioning', link: '/market' },
    ],
    sidebar: [
      {
        text: 'Docs',
        items: [
          { text: 'User Guide', link: '/user_guide' },
          { text: 'Architecture', link: '/arch' },
          { text: 'Roadmap', link: '/next_steps' },
          { text: 'Positioning & Market', link: '/market' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mkyr/seldia' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025 SelDiA',
    },
  },
});
